"""PyTorch port of the SigLIP 2 (big_vision) two-tower model.

Loads the official big_vision `.npz` checkpoint (e.g. siglip2_b32_256.npz from
gs://big_vision/siglip2/) without TensorFlow/JAX so the image tower can be
exported to ONNX for on-device inference.

Numerical parity against the reference JAX implementation is checked by
`verify_parity.py`. Architecture notes (mirroring big_vision/models/vit.py):
  * pre-LayerNorm transformer blocks, LayerNorm eps = 1e-6 (flax default)
  * MLP uses tanh-approximated GELU (flax `nn.gelu` default)
  * image tower pools with a MAP head (attention probe), no projection
  * text tower pools the last token ("sticky" EOS) and applies a dense head
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import torch
from torch import nn
import torch.nn.functional as F

LN_EPS = 1e-6


@dataclass(frozen=True)
class SiglipConfig:
    width: int = 768
    depth: int = 12
    mlp_dim: int = 3072
    num_heads: int = 12
    patch_size: int = 32
    image_size: int = 256
    vocab_size: int = 256_000
    text_len: int = 64


class MultiHeadAttention(nn.Module):
    def __init__(self, width: int, num_heads: int) -> None:
        super().__init__()
        self.num_heads = num_heads
        self.head_dim = width // num_heads
        self.q = nn.Linear(width, width)
        self.k = nn.Linear(width, width)
        self.v = nn.Linear(width, width)
        self.o = nn.Linear(width, width)

    def forward(self, xq: torch.Tensor, xkv: torch.Tensor) -> torch.Tensor:
        n, lq, d = xq.shape
        lk = xkv.shape[1]
        h, hd = self.num_heads, self.head_dim
        q = self.q(xq).view(n, lq, h, hd).transpose(1, 2)
        k = self.k(xkv).view(n, lk, h, hd).transpose(1, 2)
        v = self.v(xkv).view(n, lk, h, hd).transpose(1, 2)
        attn = (q @ k.transpose(-2, -1)) / math.sqrt(hd)
        attn = attn.softmax(dim=-1)
        y = (attn @ v).transpose(1, 2).reshape(n, lq, d)
        return self.o(y)


class MlpBlock(nn.Module):
    def __init__(self, width: int, mlp_dim: int) -> None:
        super().__init__()
        self.fc1 = nn.Linear(width, mlp_dim)
        self.fc2 = nn.Linear(mlp_dim, width)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.fc2(F.gelu(self.fc1(x), approximate="tanh"))


class EncoderBlock(nn.Module):
    def __init__(self, cfg: SiglipConfig) -> None:
        super().__init__()
        self.ln0 = nn.LayerNorm(cfg.width, eps=LN_EPS)
        self.attn = MultiHeadAttention(cfg.width, cfg.num_heads)
        self.ln1 = nn.LayerNorm(cfg.width, eps=LN_EPS)
        self.mlp = MlpBlock(cfg.width, cfg.mlp_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = self.ln0(x)
        x = x + self.attn(y, y)
        return x + self.mlp(self.ln1(x))


class Encoder(nn.Module):
    def __init__(self, cfg: SiglipConfig) -> None:
        super().__init__()
        self.blocks = nn.ModuleList([EncoderBlock(cfg) for _ in range(cfg.depth)])
        self.norm = nn.LayerNorm(cfg.width, eps=LN_EPS)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        for blk in self.blocks:
            x = blk(x)
        return self.norm(x)


class MapHead(nn.Module):
    def __init__(self, cfg: SiglipConfig) -> None:
        super().__init__()
        self.probe = nn.Parameter(torch.zeros(1, 1, cfg.width))
        self.attn = MultiHeadAttention(cfg.width, cfg.num_heads)
        self.ln = nn.LayerNorm(cfg.width, eps=LN_EPS)
        self.mlp = MlpBlock(cfg.width, cfg.mlp_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        probe = self.probe.expand(x.shape[0], -1, -1)
        y = self.attn(probe, x)
        y = y + self.mlp(self.ln(y))
        return y[:, 0]


class SiglipVision(nn.Module):
    """Image tower. Input: NCHW float32 in [-1, 1]. Output: L2-normalised embedding."""

    def __init__(self, cfg: SiglipConfig) -> None:
        super().__init__()
        self.cfg = cfg
        self.patch = nn.Conv2d(3, cfg.width, cfg.patch_size, stride=cfg.patch_size)
        n_tok = (cfg.image_size // cfg.patch_size) ** 2
        self.pos = nn.Parameter(torch.zeros(1, n_tok, cfg.width))
        self.encoder = Encoder(cfg)
        self.head = MapHead(cfg)

    def forward(self, pixels: torch.Tensor) -> torch.Tensor:
        x = self.patch(pixels)  # N, D, H', W'
        x = x.flatten(2).transpose(1, 2) + self.pos
        x = self.encoder(x)
        z = self.head(x)
        return z / z.norm(dim=-1, keepdim=True)


class SiglipText(nn.Module):
    """Text tower. Input: int64 token ids [N, 64]. Output: L2-normalised embedding."""

    def __init__(self, cfg: SiglipConfig) -> None:
        super().__init__()
        self.embed = nn.Embedding(cfg.vocab_size, cfg.width)
        self.pos = nn.Parameter(torch.zeros(1, cfg.text_len, cfg.width))
        self.encoder = Encoder(cfg)
        self.head = nn.Linear(cfg.width, cfg.width)

    def forward(self, tokens: torch.Tensor) -> torch.Tensor:
        x = self.embed(tokens) + self.pos
        x = self.encoder(x)
        z = self.head(x[:, -1])
        return z / z.norm(dim=-1, keepdim=True)


# --------------------------------------------------------------------------
# Checkpoint loading


def _t(a: np.ndarray) -> torch.Tensor:
    return torch.from_numpy(np.ascontiguousarray(a, dtype=np.float32))


def _load_mha(mha: MultiHeadAttention, p: dict[str, np.ndarray], prefix: str, idx: int | None) -> None:
    def g(name: str) -> np.ndarray:
        a = p[f"{prefix}/{name}"]
        return a[idx] if idx is not None else a

    for ours, theirs in (("q", "query"), ("k", "key"), ("v", "value")):
        kernel = g(f"{theirs}/kernel")  # (D, H, hd)
        bias = g(f"{theirs}/bias")  # (H, hd)
        lin: nn.Linear = getattr(mha, ours)
        lin.weight.data = _t(kernel.reshape(kernel.shape[0], -1).T)
        lin.bias.data = _t(bias.reshape(-1))
    kernel = g("out/kernel")  # (H, hd, D)
    mha.o.weight.data = _t(kernel.reshape(-1, kernel.shape[-1]).T)
    mha.o.bias.data = _t(g("out/bias"))


def _load_ln(ln: nn.LayerNorm, p: dict[str, np.ndarray], prefix: str, idx: int | None) -> None:
    s, b = p[f"{prefix}/scale"], p[f"{prefix}/bias"]
    ln.weight.data = _t(s[idx] if idx is not None else s)
    ln.bias.data = _t(b[idx] if idx is not None else b)


def _load_mlp(mlp: MlpBlock, p: dict[str, np.ndarray], prefix: str, idx: int | None) -> None:
    def g(name: str) -> np.ndarray:
        a = p[f"{prefix}/{name}"]
        return a[idx] if idx is not None else a

    mlp.fc1.weight.data = _t(g("Dense_0/kernel").T)
    mlp.fc1.bias.data = _t(g("Dense_0/bias"))
    mlp.fc2.weight.data = _t(g("Dense_1/kernel").T)
    mlp.fc2.bias.data = _t(g("Dense_1/bias"))


def _load_encoder(enc: Encoder, p: dict[str, np.ndarray], prefix: str) -> None:
    blk = f"{prefix}/encoderblock"
    for i, b in enumerate(enc.blocks):
        _load_ln(b.ln0, p, f"{blk}/LayerNorm_0", i)
        _load_mha(b.attn, p, f"{blk}/MultiHeadDotProductAttention_0", i)
        _load_ln(b.ln1, p, f"{blk}/LayerNorm_1", i)
        _load_mlp(b.mlp, p, f"{blk}/MlpBlock_0", i)
    _load_ln(enc.norm, p, f"{prefix}/encoder_norm", None)


def load_checkpoint(path: str, cfg: SiglipConfig = SiglipConfig(), with_text: bool = True):
    """Returns (vision, text|None, logit_scale, logit_bias)."""
    z = np.load(path)
    p = {k.removeprefix("params/"): z[k] for k in z.keys() if with_text or "/txt/" not in k}

    vision = SiglipVision(cfg)
    vision.patch.weight.data = _t(p["img/embedding/kernel"].transpose(3, 2, 0, 1))
    vision.patch.bias.data = _t(p["img/embedding/bias"])
    vision.pos.data = _t(p["img/pos_embedding"])
    _load_encoder(vision.encoder, p, "img/Transformer")
    vision.head.probe.data = _t(p["img/MAPHead_0/probe"])
    _load_mha(vision.head.attn, p, "img/MAPHead_0/MultiHeadDotProductAttention_0", None)
    _load_ln(vision.head.ln, p, "img/MAPHead_0/LayerNorm_0", None)
    _load_mlp(vision.head.mlp, p, "img/MAPHead_0/MlpBlock_0", None)
    vision.eval()

    text = None
    if with_text:
        text = SiglipText(cfg)
        text.embed.weight.data = _t(p["txt/Embed_0/embedding"])
        text.pos.data = _t(p["txt/pos_embedding"])
        _load_encoder(text.encoder, p, "txt/Encoder_0")
        text.head.weight.data = _t(p["txt/head/kernel"].T)
        text.head.bias.data = _t(p["txt/head/bias"])
        text.eval()

    logit_scale = float(np.exp(p["t"][0]))
    logit_bias = float(p["b"][0])
    return vision, text, logit_scale, logit_bias


class GemmaTokenizer:
    """Replicates big_vision `lower|tok(length=64, model="gemma", bos="no", eos="sticky")`."""

    PAD, EOS = 0, 1

    def __init__(self, model_path: str, length: int = 64) -> None:
        import sentencepiece as spm

        self.sp = spm.SentencePieceProcessor(model_file=model_path)
        self.length = length
        assert self.sp.pad_id() == self.PAD and self.sp.eos_id() == self.EOS, (
            self.sp.pad_id(),
            self.sp.eos_id(),
        )

    def __call__(self, texts: list[str]) -> torch.Tensor:
        out = np.full((len(texts), self.length), self.PAD, dtype=np.int64)
        for i, t in enumerate(texts):
            ids = self.sp.encode(t.lower()) + [self.EOS]
            if len(ids) > self.length:
                ids = ids[: self.length - 1] + [self.EOS]
            out[i, : len(ids)] = ids
        return torch.from_numpy(out)
