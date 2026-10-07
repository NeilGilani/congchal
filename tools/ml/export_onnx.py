"""Exports the SigLIP 2 image tower to ONNX (fp32, plus 8-bit weight-only MatMulNBits).

The exported graph takes `pixels`: float32 [N, 3, 256, 256] with values in
[0, 255] (RGB) and returns `embedding`: float32 [N, 768], L2-normalised.
Value scaling to [-1, 1] is baked into the graph so the app only has to lay
out raw RGB bytes.

Usage:
  python export_onnx.py --ckpt siglip2_b32_256.npz --out-dir ../../assets/models
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

from siglip_torch import SiglipConfig, load_checkpoint


class PixelWrapper(torch.nn.Module):
    def __init__(self, vision: torch.nn.Module) -> None:
        super().__init__()
        self.vision = vision

    def forward(self, pixels: torch.Tensor) -> torch.Tensor:
        return self.vision(pixels / 127.5 - 1.0)


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--work-dir", default=".")
    args = ap.parse_args()

    cfg = SiglipConfig()
    vision, _, _, _ = load_checkpoint(args.ckpt, cfg, with_text=False)
    model = PixelWrapper(vision).eval()

    fp32_path = os.path.join(args.work_dir, "siglip2_b32_256_vision_fp32.onnx")
    int8_path = os.path.join(args.work_dir, "civiclens_vision.onnx")
    os.makedirs(args.out_dir, exist_ok=True)

    dummy = torch.rand(2, 3, cfg.image_size, cfg.image_size) * 255
    torch.onnx.export(
        model,
        (dummy,),
        fp32_path,
        input_names=["pixels"],
        output_names=["embedding"],
        dynamic_axes={"pixels": {0: "batch"}, "embedding": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    onnx.checker.check_model(fp32_path)

    # Weight-only 8-bit quantisation (block size 32, symmetric). Activations stay
    # float32: SigLIP has large activation outliers, and dynamic int8
    # activation quantisation measurably destroyed the embeddings (cosine
    # 0.72-0.87 vs fp32 on real photos), while 8-bit weight-only is lossless in
    # practice (cosine > 0.999) and shrinks the file from 378 MB to ~113 MB.
    # accuracy_level=4 lets ONNX Runtime run the matmuls with int8 compute on
    # per-block (32-value) quantised activations; measured cosine vs fp32 stays
    # at 0.998+. The main gain is size. Speed vs fp32 depends on the CPU: one
    # build-machine run measured 36 vs 109 ms per image, a later one 39 vs 41 ms
    # (docs/eval/quantization.json). Phone speed has not been measured.
    model_proto = onnx.load(fp32_path)
    quantizer = MatMulNBitsQuantizer(
        model_proto, bits=8, block_size=32, is_symmetric=True, accuracy_level=4
    )
    quantizer.process()
    quantizer.model.save_model_to_file(int8_path, use_external_data_format=False)

    rng = np.random.default_rng(0)
    x = (rng.random((4, 3, 256, 256), dtype=np.float32) * 255).astype(np.float32)
    with torch.no_grad():
        ref = model(torch.from_numpy(x)).numpy()
    report = {}
    for name, path in (("fp32", fp32_path), ("q8", int8_path)):
        sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        out = sess.run(None, {"pixels": x})[0]
        cos = float((out * ref).sum(-1).min())
        t0 = time.perf_counter()
        for _ in range(5):
            sess.run(None, {"pixels": x[:1]})
        ms = (time.perf_counter() - t0) / 5 * 1000
        report[name] = {
            "path": path,
            "bytes": os.path.getsize(path),
            "min_cosine_vs_torch": cos,
            "latency_ms_batch1_host_cpu": round(ms, 1),
        }
    report["q8"]["sha256"] = sha256(int8_path)
    print(json.dumps(report, indent=2))

    # GitHub rejects files over 100 MB, so the model is committed in parts and
    # reassembled (and SHA-256 verified) by scripts/assemble-model.js on install.
    part_size = 90 * 1024 * 1024
    parts = []
    with open(int8_path, "rb") as f:
        idx = 0
        while chunk := f.read(part_size):
            name = f"civiclens_vision.onnx.part{idx}"
            with open(os.path.join(args.out_dir, name), "wb") as out:
                out.write(chunk)
            parts.append(name)
            idx += 1
    manifest = {
        "file": "civiclens_vision.onnx",
        "sha256": report["q8"]["sha256"],
        "bytes": report["q8"]["bytes"],
        "parts": parts,
        "source": "SigLIP 2 B/32 @256 (gs://big_vision/siglip2/siglip2_b32_256.npz), image tower only",
        "license": "Apache-2.0 (SigLIP 2 weights, Google)",
        "quantization": "MatMulNBits 8-bit weights, block 32, symmetric, accuracy_level 4",
        "input": "pixels float32 [N,3,256,256] RGB 0..255",
        "output": "embedding float32 [N,768] L2-normalised",
    }
    with open(os.path.join(args.out_dir, "model-manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)


if __name__ == "__main__":
    main()
