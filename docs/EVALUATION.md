# CivicLens model evaluation

This document reports how well the CivicLens vision pipeline recognizes
civic issues, how the numbers were produced, and where they are likely to
be wrong. Raw output: [eval/results.json](eval/results.json) (summary) and
[eval/results.rows.json](eval/results.rows.json) (one row per test photo).

## Summary

| Issue | Test photos | Precision [95% CI] | Recall [95% CI] |
| --- | ---: | --- | --- |
| Pothole | 311 | 97.9% [95.6–99.1] | 91.6% [88.0–94.2] |
| Pavement crack | 173 | 96.4% [92.5–98.4] | 94.2% [89.7–96.8] |
| Graffiti | 28 | 90.0% [74.4–96.5] | 96.4% [82.3–99.4] |
| Flooding | 16 | 100% [80.6–100] | 100% [80.6–100] |
| Overflowing trash | 10 | 64.3% [38.8–83.7] | 90.0% [59.6–98.2] |
| Illegal dumping | 6 | 57.1% [25.0–84.2] | 66.7% [30.0–90.3] |

| Other measure | Result |
| --- | --- |
| False alarms on 416 photos with no supported issue | 3.4% [2.0–5.6] (14 photos) |
| No-issue photos marked "not sure" instead | 31 (7.5%) |
| Precision of "high confidence" detections | 99.3% [97.8–99.7] (402 of 405) |
| Precision of "moderate confidence" detections | 83.6% [76.0–89.1] (102 of 122) |
| Photos rejected by the quality gate | 10 of 960 (1.0%) |
| Analysis time per scan, build machine CPU | median 416 ms, p90 464 ms |

The model is strong on the two classes with large, clean test sets
(potholes and cracks), but those test photos come from the same research
datasets as the training photos. See [Threats to validity](#threats-to-validity)
before quoting any number.

## What was evaluated

`tools/ml/evaluate.ts` runs the **same TypeScript code the app runs**:

1. Decode the JPEG and downscale it to the app's 512 px analysis resolution
   (the phone does this with its native image resizer).
2. Quality gate (`src/ml/quality.ts`).
3. 11 crops (full frame, center, 3×3 grid) → 256 px → the shipped 8-bit
   ONNX model (`assets/models/civiclens_vision.onnx`) on ONNX Runtime for
   Node.
4. Classifier head, temperature, thresholds and region logic from
   `assets/models/civiclens-head.json` (`src/ml/head.ts`,
   `src/ml/pipeline.ts`).

A photo counts as a **detection** only when the app would say "detected"
(calibrated probability ≥ 0.55). "Not sure" results and quality rejections
count as misses for recall. Confidence intervals are Wilson score intervals.

The temperature (0.64) and decision thresholds were chosen on a validation
subset of the training split
([eval/head-validation.json](eval/head-validation.json)). The quality-gate
thresholds were calibrated on training photos only
([eval/quality-calibration.json](eval/quality-calibration.json)).

The test split was seen before the final run in two places, both
disclosed here:

1. **Head variant.** While developing the head, the exploration script
   (`tools/ml/train_head.py`) printed test-split scores for three variants
   (a plain linear probe, and two strengths of regularization toward the
   zero-shot text prototypes), and a variant was first picked with those
   scores visible. To remove that leak, the script now selects on the
   validation subset only; test scores are printed only with an explicit
   `--report-test` flag, after the choice. Re-run that way, it picks the
   same variant ([eval/head-selection.json](eval/head-selection.json):
   validation macro-F1 0.885, against 0.885 for the stronger
   regularization and 0.866 for the plain probe), so the shipped head did
   not change.
2. **Quality gate.** The first test run rejected 68 photos at the quality
   gate, including 56 potholes that failed only the minimum-size check:
   the first gate required a 240 px short side, and many web photos are
   smaller. The size and blur thresholds were then recalibrated on
   **training** photos (minimum side 240 → 160 px, blur 18/45 → 20/60),
   and the test split was run again. Pothole recall went from 74.9% to
   91.6%; precision was unchanged (97.5% → 97.9%). Nothing else changed
   between the two runs.

Because the test split was looked at more than once, the reported numbers
may be slightly optimistic. The quality-gate change was prompted by the
first test results, although the new thresholds were set from training
photos.

## Data

| Class | Train | Test | Test sources |
| --- | ---: | ---: | --- |
| Pothole | 934 | 311 | Pothole Dataset (Chitale et al., IVCNZ 2020) |
| Pavement crack | 524 | 173 | DeepCrack 125, CrackForest 45, Open Images 3 |
| Graffiti | 83 | 28 | Open Images, reviewed |
| Flooding | 48 | 16 | Open Images, reviewed |
| Overflowing trash | 30 | 10 | Open Images, reviewed |
| Illegal dumping | 18 | 6 | Open Images, reviewed |
| No supported issue | 1,249 | 416 | Open Images: 101 reviewed, 315 by scene label |

- Open Images photos were reviewed one by one and labeled with the rules in
  [tools/ml/dataset/LABELING.md](../tools/ml/dataset/LABELING.md). **The
  reviewer was an AI assistant (Claude), not a person.**
- Pothole and crack labels come from the source datasets' own human
  annotations.
- Near-duplicate photos (embedding cosine ≥ 0.985) were grouped, and a
  group never spans train and test.
- Photos of the four unsupported categories (damaged signs, sidewalk
  damage, fallen trees, blocked sidewalks) count as "no supported issue":
  5 of the 416 no-issue test photos show one of them.

## Where it goes wrong

Confusion matrix on the test split (rows: true label; columns: what the app
reported).

| True \ reported | Pothole | Crack | Graffiti | Flood | Trash | Dumping | No issue | Not sure | Rejected |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pothole | **285** | 5 | 0 | 0 | 0 | 0 | 8 | 9 | 4 |
| Crack | 2 | **163** | 0 | 0 | 0 | 0 | 1 | 4 | 3 |
| Graffiti | 0 | 0 | **27** | 0 | 0 | 0 | 0 | 1 | 0 |
| Flooding | 0 | 0 | 0 | **16** | 0 | 0 | 0 | 0 | 0 |
| Trash | 0 | 0 | 0 | 0 | **9** | 1 | 0 | 0 | 0 |
| Dumping | 0 | 0 | 0 | 0 | 1 | **4** | 1 | 0 | 0 |
| No issue | 4 | 1 | 3 | 0 | 4 | 2 | **368** | 31 | 3 |

All 14 false alarms were inspected:
- **Trash (4):** ordinary bins and a dumpster that were not overflowing.
  **Dumping (2):** an alley behind garages and a patch of fallen branches.
  These two classes have the fewest training photos (30 and 18) and are
  also confused with each other.
- **Graffiti (3):** two large murals and an art-painted utility box. The
  model does not reliably tell commissioned art from vandalism.
- **Pothole (4) and crack (1):** plain roads, a parking lot and a road-works
  site with cones.

Most missed potholes were reported as "not sure" (9) or "no issue" (8),
not as something else. For those, the app asks the user to choose the issue
type instead of guessing.

## Confidence levels

The app shows "high confidence" at a calibrated probability ≥ 0.9 and
"moderate" from 0.55 to 0.9. On the test split those levels mean what they
say: 99.3% of high-confidence detections were right, against 83.6% of
moderate ones. This is why the app words moderate results as "Possible
pothole" and asks the user to confirm.

## Threshold choice (validation split)

From the validation sweep in [eval/head-validation.json](eval/head-validation.json)
(578 photos held out from training):

| Detect threshold | Precision | Issue recall | False-alarm rate |
| ---: | ---: | ---: | ---: |
| 0.35 | 94.4% | 97.3% | 5.7% |
| 0.55 (used) | 95.2% | 96.1% | 4.9% |
| 0.70 | 96.3% | 95.2% | 3.6% |
| 0.90 | 98.2% | 84.0% | 1.2% |

0.55 is the lowest threshold with at least 95% precision on validation.
Results between 0.35 and 0.55 are shown as "not sure" rather than hidden.

## Robustness to bad conditions

107 issue photos and 25 no-issue photos from the test split, each degraded
synthetically at the 512 px analysis resolution. "Issue recall" counts
quality rejections as misses.

| Condition | How it was simulated | Rejected by quality gate | Issue recall | False alarms (of 25) |
| --- | --- | ---: | ---: | ---: |
| Original | none | 1 | 95.3% | 2 |
| Evening | brightness × 0.45, gamma 1.6 | 19 | 83.2% | 1 |
| Night | brightness × 0.15, gamma 2.2 | 132 (all) | 0% | 0 |
| Slight blur | box blur, radius 2 px | 14 | 80.4% | 0 |
| Heavy blur | box blur, radius 6 px | 128 | 0.9% | 0 |
| Partly blocked | left third covered by a dark shape | 1 | 92.5% | 3 |
| Farther away | scene shrunk to the central 50% | 1 | 89.7% | 0 |

- Night and heavy blur are rejected rather than guessed at. That is the
  intended behavior; the app tells the user to turn on the flashlight or
  hold still.
- In evening light and slight blur, recall drops by 12–15 points, partly
  from rejections and partly from weaker detections.
- With only 25 no-issue photos, the false-alarm column is too small to
  compare conditions.
- Synthetic degradation is not the same as real low light (sensor noise,
  motion blur, headlights). Real night photos need their own test.

## Model conversion fidelity

| Check | Result | Evidence |
| --- | --- | --- |
| PyTorch port vs Google's JAX reference | max abs. difference 4.3 × 10⁻⁷ (image embeddings), identical logits | [eval/parity.txt](eval/parity.txt) |
| 8-bit model vs fp32 ONNX on 64 real photos | cosine mean 0.9995, min 0.9983 | [eval/quantization.json](eval/quantization.json) |
| Browser (ONNX Runtime Web, WebAssembly) vs Node on the six Demo Mode photos | same outcome and category for all six; probabilities within 0.001 | `npm run test:web` |
| Size | 113.9 MB (fp32: 378.4 MB) | `assets/models/model-manifest.json` |

The classifier head was trained on embeddings from the same 8-bit model
the app ships, so any small quantization shift is already part of the
training data.

## Pothole localization

For 98 detected potholes that have bounding-box annotations, the outlined
region overlapped an annotated pothole in all 98. This is a weak test: the
region is a large crop (up to half the photo) and "overlap" counts any
intersection. It shows the outline points at the right part of the photo,
not that it traces the pothole.

## Threats to validity

1. **Same-source test data for potholes and cracks.** All 311 test
   potholes come from the same research dataset as 932 of the 934 training
   potholes, and 170 of the 173 test cracks come from the two crack
   datasets used in training (many are close-up pavement textures).
   Grouping removed near-duplicates, but photographers, cameras and
   locations are shared. Accuracy on phone photos of other streets is
   likely lower.
2. **AI-reviewed labels.** Labels for Open Images photos were assigned by
   an AI assistant reviewing each photo. An AI reviewer may share blind
   spots with an AI model, which would make the model look better than it
   is. A human audit of the test labels is the most important next step.
3. **315 of 416 no-issue test photos were not reviewed.** They rely on
   Open Images scene labels. A random audit of 60 such photos found no
   issues, but a few may still contain one.
4. **Small classes.** Trash (10), dumping (6), flooding (16) and graffiti
   (28) test sets are small. Their intervals are wide, and flooding's 100%
   should be read as "probably above 80%".
5. **Web photos, not phone photos.** No test photo was taken with the app.
   The developer evaluation tool in the app (Settings → developer mode →
   Evaluation tool) records a field evaluation on real phone photos;
   none has been collected yet.
6. **Timing.** 416 ms is the build machine's CPU with 4 threads. Phone
   timing has not been measured.

## Reproducing

See [tools/ml/README.md](../tools/ml/README.md) for the full pipeline. The
evaluation itself:

```bash
npx tsx tools/ml/evaluate.ts --dataset tools/ml/dataset/dataset.json \
  --data-root <folder with oi/, norm/, norm2/ images> \
  --out docs/eval/results.json --robustness 25
```
