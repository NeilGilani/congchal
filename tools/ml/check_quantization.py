"""Compares the shipped 8-bit model with the fp32 export on real photos.

Usage:
  python check_quantization.py --fp32 vision_fp32.onnx --q8 civiclens_vision.onnx \
      --images-dir DATA/oi --limit 64 --out ../../docs/eval/quantization.json
"""

from __future__ import annotations

import argparse
import json
import os
import time

import numpy as np
import onnxruntime as ort
from PIL import Image


def load(path: str) -> np.ndarray:
    im = Image.open(path).convert("RGB").resize((256, 256), Image.BILINEAR)
    return np.asarray(im, dtype=np.float32).transpose(2, 0, 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fp32", required=True)
    ap.add_argument("--q8", required=True)
    ap.add_argument("--images-dir", required=True)
    ap.add_argument("--limit", type=int, default=64)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    names = sorted(n for n in os.listdir(args.images_dir) if n.endswith(".jpg"))[: args.limit]
    x = np.stack([load(os.path.join(args.images_dir, n)) for n in names])
    outs, ms = {}, {}
    for name, path in (("fp32", args.fp32), ("q8", args.q8)):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 4
        sess = ort.InferenceSession(path, opts, providers=["CPUExecutionProvider"])
        outs[name] = np.concatenate([sess.run(None, {"pixels": x[i : i + 8]})[0] for i in range(0, len(x), 8)])
        t0 = time.perf_counter()
        for i in range(8):
            sess.run(None, {"pixels": x[i : i + 1]})
        ms[name] = round((time.perf_counter() - t0) / 8 * 1000, 1)
    cos = (outs["fp32"] * outs["q8"]).sum(-1)
    report = {
        "images": len(names),
        "cosine_q8_vs_fp32": {"min": float(cos.min()), "mean": float(cos.mean())},
        "bytes": {"fp32": os.path.getsize(args.fp32), "q8": os.path.getsize(args.q8)},
        "latency_ms_batch1_host_cpu_4_threads": ms,
        "note": "Host CPU timings from the build machine, not a phone.",
    }
    json.dump(report, open(args.out, "w"), indent=2)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
