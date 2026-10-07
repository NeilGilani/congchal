"""Checks the PyTorch port against Google's reference big_vision (JAX) SigLIP 2.

Usage:
  PYTHONPATH=<big_vision checkout>:<tf stub> python verify_parity.py \
      --ckpt siglip2_b32_256.npz --tokenizer gemma_tokenizer.model img1.jpg img2.jpg

The TensorFlow dependency of big_vision is only used for file IO, so a tiny
`tensorflow.io.gfile` stub is sufficient (see README in this folder).
"""

from __future__ import annotations

import argparse

import numpy as np
import torch
from PIL import Image

from siglip_torch import GemmaTokenizer, load_checkpoint

TEXTS = [
    "a photo of a pothole in the road",
    "graffiti on a wall",
    "an overflowing trash can",
    "a clean, well maintained street",
]


def load_images(paths: list[str], size: int) -> np.ndarray:
    imgs = []
    for p in paths:
        im = Image.open(p).convert("RGB").resize((size, size), Image.BILINEAR)
        imgs.append(np.asarray(im, dtype=np.float32) / 127.5 - 1.0)
    return np.stack(imgs)  # NHWC


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("images", nargs="+")
    args = ap.parse_args()

    import big_vision.models.proj.image_text.two_towers as model_mod
    import ml_collections

    cfg = ml_collections.ConfigDict(
        dict(
            image_model="vit",
            image=dict(pool_type="map", scan=True, variant="B/32"),
            text_model="proj.image_text.text_transformer",
            text=dict(scan=True, variant="B", vocab_size=256_000),
            out_dim=[None, 768],
            bias_init=-10,
        )
    )
    model = model_mod.Model(**cfg)
    params = model_mod.load(None, args.ckpt, cfg)

    imgs = load_images(args.images, 256)
    tok = GemmaTokenizer(args.tokenizer)
    toks = tok(TEXTS)

    zimg_ref, _, _ = model.apply({"params": params}, imgs, None)
    _, ztxt_ref, out = model.apply({"params": params}, None, toks.numpy().astype(np.int32))
    zimg_ref, ztxt_ref = np.asarray(zimg_ref), np.asarray(ztxt_ref)

    vision, text, scale, bias = load_checkpoint(args.ckpt)
    with torch.no_grad():
        zimg = vision(torch.from_numpy(imgs).permute(0, 3, 1, 2)).numpy()
        ztxt = text(toks).numpy()

    print("image max |diff|:", np.abs(zimg - zimg_ref).max())
    print("text  max |diff|:", np.abs(ztxt - ztxt_ref).max())
    print("t/b ref:", float(np.exp(out["t"])) if np.ndim(out["t"]) == 0 else out["t"], out["b"], "ours:", scale, bias)
    logits_ref = zimg_ref @ ztxt_ref.T * scale + bias
    logits = zimg @ ztxt.T * scale + bias
    print("logits ref:\n", np.round(logits_ref, 3))
    print("logits ours:\n", np.round(logits, 3))
    assert np.abs(zimg - zimg_ref).max() < 1e-3, "image tower mismatch"
    assert np.abs(ztxt - ztxt_ref).max() < 1e-3, "text tower mismatch"
    print("PARITY OK")


if __name__ == "__main__":
    main()
