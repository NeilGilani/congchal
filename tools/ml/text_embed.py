"""Embeds text prompts with the SigLIP 2 text tower (offline; never shipped).

Usage:
  python text_embed.py --ckpt siglip2_b32_256.npz --tokenizer gemma_tokenizer.model \
      --prompts prompts.json --out text_embeddings.json

prompts.json: {"<key>": ["prompt", ...], ...}
Output: {"logit_scale": float, "logit_bias": float,
         "embeddings": {"<key>": [[768 floats], ...]}}
"""

from __future__ import annotations

import argparse
import json

import torch

from siglip_torch import GemmaTokenizer, load_checkpoint


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--prompts", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    _, text, scale, bias = load_checkpoint(args.ckpt)
    assert text is not None
    tok = GemmaTokenizer(args.tokenizer)
    prompts: dict[str, list[str]] = json.load(open(args.prompts))
    out: dict[str, list[list[float]]] = {}
    with torch.no_grad():
        for key, texts in prompts.items():
            z = text(tok(texts)).numpy()
            out[key] = [[round(float(v), 6) for v in row] for row in z]
    json.dump({"logit_scale": scale, "logit_bias": bias, "embeddings": out, "prompts": prompts}, open(args.out, "w"))
    print(f"embedded {sum(len(v) for v in prompts.values())} prompts for {len(prompts)} keys")


if __name__ == "__main__":
    main()
