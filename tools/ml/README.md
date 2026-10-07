# CivicLens ML tooling

This folder holds everything used to build the vision model and classifier
that ship in `assets/models/`, and to measure them. The app does not need
any of it at runtime.

| Step | Script | Output |
| --- | --- | --- |
| 1. Port and verify SigLIP 2 | `siglip_torch.py`, `verify_parity.py` | `docs/eval/parity.txt` |
| 2. Export and quantize | `export_onnx.py`, `check_quantization.py` | `civiclens_vision.onnx`, `docs/eval/quantization.json` |
| 3. Text prototypes and concept probes | `text_embed.py`, `prompts.json` | `text_embeddings.json` |
| 4. Build the labeled dataset | `dataset/*.py`, `embed.ts` | `dataset/dataset.json` |
| 5. Choose and train the head | `train_head.py`, `build_head.py` | `assets/models/civiclens-head.json` |
| 6. Calibrate the quality gate | `calibrate_quality.ts` | `docs/eval/quality-calibration.json` |
| 7. Evaluate | `evaluate.ts` | `docs/eval/results.json` |

`analyze.ts` runs the app's pipeline on any JPEG:
`npx tsx tools/ml/analyze.ts photo.jpg`.

## Setup

```bash
python3.13 -m venv .venv && source .venv/bin/activate
pip install -r tools/ml/requirements.txt
```

The TypeScript tools (`*.ts`) run with `npx tsx` from the repository root,
using ONNX Runtime for Node (a dev dependency) and the same source files as
the app.

Downloads (all public):
- SigLIP 2 B/32 @256 checkpoint:
  `https://storage.googleapis.com/big_vision/siglip2/siglip2_b32_256.npz`
- Gemma tokenizer (text tower only):
  `https://storage.googleapis.com/big_vision/gemma_tokenizer.model`
- For the parity check only, a checkout of
  [google-research/big_vision](https://github.com/google-research/big_vision).

## 1. Port and verify the model

`siglip_torch.py` re-implements the SigLIP 2 image and text towers in
PyTorch and loads the official `.npz` weights. `verify_parity.py` runs
Google's JAX implementation side by side. big_vision imports TensorFlow
only for file access, so `tfstub/` provides a tiny stand-in:

```bash
cd tools/ml
PYTHONPATH=<big_vision checkout>:tfstub python verify_parity.py \
  --ckpt siglip2_b32_256.npz --tokenizer gemma_tokenizer.model \
  ../../assets/demo/pothole.jpg ../../assets/demo/graffiti.jpg
```

Recorded result: image embeddings within 4.3 × 10⁻⁷, identical logits
(`docs/eval/parity.txt`).

## 2. Export and quantize

```bash
python export_onnx.py --ckpt siglip2_b32_256.npz --out-dir <dir>
```

The graph takes `pixels` (float32 `[N, 3, 256, 256]`, RGB 0–255; scaling to
[-1, 1] is inside the graph) and returns `embedding` (float32 `[N, 768]`,
L2-normalized). Weights are quantized to 8 bits with `MatMulNBits`
(block 32, symmetric, `accuracy_level` 4). Dynamic int8 activation
quantization was tried first and rejected: it dropped embedding cosine to
0.72–0.87 on real photos.

```bash
python check_quantization.py --fp32 <dir>/siglip2_b32_256_vision_fp32.onnx \
  --q8 ../../assets/models/civiclens_vision.onnx --images-dir <photos> \
  --out ../../docs/eval/quantization.json
```

GitHub rejects files over 100 MB, so the model is committed in two parts
and reassembled on `npm install` by `scripts/assemble-model.js`, which
checks the SHA-256 in `assets/models/model-manifest.json`:

```bash
split -b 90M -d -a 1 civiclens_vision.onnx civiclens_vision.onnx.part
sha256sum civiclens_vision.onnx   # update model-manifest.json
```

## 3. Text prototypes

```bash
python text_embed.py --ckpt siglip2_b32_256.npz --tokenizer gemma_tokenizer.model \
  --prompts prompts.json --out text_embeddings.json
```

`prompts.json` holds prompt ensembles for each class (`class:*`, used as
the head's prior) and the concept probes (`ev:*`, `hz:*`, `ctx:*`) used for
explanations and severity. The text tower never ships; only the resulting
vectors do (inside the head JSON).

## 4. Dataset

See [dataset/LABELING.md](dataset/LABELING.md) for the labeling rules and
their caveats (the reviewer was an AI assistant).

1. `dataset/select_openimages.py` picks candidate pools from Open Images V7
   human-verified image-level labels.
2. `dataset/download_images.py` downloads them from the public CVDF mirror,
   applies EXIF rotation and resizes to 1024 px.
3. `embed.ts` computes embeddings with the app's own pipeline
   (`--regions live` = full frame + center crop).
4. `dataset/prepare_review.py` and `dataset/contact_sheets.py` build review
   queues and numbered contact sheets (random order for issue pools; the 15%
   most issue-like images for street-scene pools).
5. Each sheet's decisions are recorded in `dataset/reviews.txt`; the image
   IDs on each sheet are in `dataset/review/sheets/`.
6. `dataset/build_dataset.py` merges the reviews with the pothole and crack
   datasets, groups near-duplicates and writes the split
   (`dataset/dataset.json`).

```bash
python dataset/build_dataset.py --reviews dataset/reviews.txt \
  --sheets-dir dataset/review/sheets --review-dir dataset/review \
  --emb <emb_all_live> <emb_norm2_live> --out dataset/dataset.json
```

The photos themselves are not committed (licenses and size). The pothole
and crack datasets must be downloaded from their authors.

## 5. Head

`train_head.py` compares a zero-shot classifier, a plain linear probe and
two strengths of regularization toward the text prototypes **on a grouped
validation subset of the training split**, and reports the choice
(`docs/eval/head-selection.json`). Test-split scores are printed only with
`--report-test` and are never used for selection.

```bash
python train_head.py --dataset dataset/dataset.json --emb <emb...> \
  --text text_embeddings.json \
  --classes pothole,pavement_crack,graffiti,flooding,overflowing_trash,illegal_dumping \
  --unsupported-as-none --out /tmp/selection.json

python build_head.py --dataset dataset/dataset.json --emb <emb...> \
  --text text_embeddings.json --out ../../assets/models/civiclens-head.json \
  --metrics-out ../../docs/eval/head-validation.json
```

`build_head.py` fits the temperature and thresholds on validation, retrains
on the whole training split and stores the concept-probe statistics.

## 6–7. Quality gate and evaluation

```bash
npx tsx tools/ml/calibrate_quality.ts --dataset tools/ml/dataset/dataset.json \
  --data-root <images> --out docs/eval/quality-calibration.json

npx tsx tools/ml/evaluate.ts --dataset tools/ml/dataset/dataset.json \
  --data-root <images> --out docs/eval/results.json --robustness 25
```

Results and caveats: [docs/EVALUATION.md](../../docs/EVALUATION.md).
