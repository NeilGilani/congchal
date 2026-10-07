"""Builds the shipped CivicLens head (assets/models/civiclens-head.json).

Steps
  1. Train the chosen head variant ("prior_light": logistic regression lightly
     regularised toward zero-shot text weights) on the training split minus a
     grouped validation subset.
  2. Fit temperature (calibration) and choose decision thresholds on that
     validation subset only.
  3. Retrain on the full training split with the selected settings.
  4. Compute reference statistics for the concept probes used for
     explanations and severity (mean/std of cosine over no-issue street scenes).
The test split is not touched here; tools/ml/evaluate.ts measures it with the
app's TypeScript pipeline.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json

import numpy as np

from train_head import fit_temperature, load, proto, softmax, train_linear

SUPPORTED = ["pothole", "pavement_crack", "graffiti", "flooding", "overflowing_trash", "illegal_dumping"]

CONCEPT_LABELS = {
    "ctx:roadway": "Roadway surface visible",
    "ctx:sidewalk": "Sidewalk or footpath visible",
    "ctx:bike_lane": "Bike lane visible",
    "ctx:curb_ramp": "Curb ramp visible",
    "ctx:crosswalk": "Crosswalk visible",
    "ctx:wall": "Wall or fence surface",
    "ctx:alley": "Alley setting",
    "ctx:parking": "Parking area",
    "ctx:park": "Park or green space",
    "ctx:indoors": "Indoor scene",
    "ev:pothole:hole": "Irregular depression in the pavement",
    "ev:pothole:water": "Water collected in a depression",
    "ev:pothole:edges": "Broken, jagged pavement edges",
    "ev:pothole:debris": "Loose gravel or asphalt fragments",
    "ev:crack:linear": "Linear cracking in the surface",
    "ev:crack:alligator": "Interconnected (alligator) cracking",
    "ev:crack:crumbling": "Crumbling surface material",
    "ev:graffiti:tags": "Spray-painted tags or scribbles",
    "ev:graffiti:letters": "Painted lettering on a surface",
    "ev:graffiti:on_property": "Markings on a sign, pole or utility box",
    "ev:trash:full_bin": "Bin filled to the brim",
    "ev:trash:bags": "Garbage bags on the ground",
    "ev:trash:litter": "Scattered litter",
    "ev:dumping:mattress": "Discarded mattress",
    "ev:dumping:furniture": "Abandoned furniture",
    "ev:dumping:pile": "Pile of bulky items",
    "ev:dumping:tires": "Discarded tires",
    "ev:flood:standing": "Standing water covering pavement",
    "ev:flood:drain": "Water pooling at a storm drain",
    "hz:in_traffic": "Appears to be in a traffic lane",
    "hz:tripping": "Possible tripping hazard",
    "hz:large": "Defect appears large",
    "hz:minor": "Defect appears small",
    "hz:blocks_wheelchair": "Could block a wheelchair user",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--emb", nargs="+", required=True)
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--metrics-out", required=True)
    ap.add_argument("--lam", type=float, default=0.01)
    args = ap.parse_args()

    emb, index = load(args.emb)
    text = json.load(open(args.text))
    classes = ["none"] + SUPPORTED
    cidx = {c: i for i, c in enumerate(classes)}
    recs = json.load(open(args.dataset))["records"]
    recs = [{**r, "label": r["label"] if r["label"] in cidx else "none"} for r in recs if r["id"] in index]
    train = [r for r in recs if r["split"] == "train"]

    groups = sorted({r["group"] for r in train})
    rng = np.random.default_rng(7)
    val_groups = set(rng.choice(groups, size=len(groups) // 5, replace=False).tolist())
    fit = [r for r in train if r["group"] not in val_groups]
    val = [r for r in train if r["group"] in val_groups]

    def xy(rs, regions=(0, 1)):
        X = np.concatenate([emb[[index[r["id"]] for r in rs], k] for k in regions])
        y = np.array([cidx[r["label"]] for r in rs] * len(regions))
        return X, y

    W0 = (np.stack([proto(text, f"class:{c}") for c in classes]) * text["logit_scale"]).astype(np.float32)
    b0 = np.zeros(len(classes), np.float32)

    def class_weights(y):
        counts = np.bincount(y, minlength=len(classes)).astype(np.float32)
        return (counts.sum() / (len(classes) * np.maximum(counts, 1))) ** 0.5

    Xf, yf = xy(fit)
    W, b = train_linear(Xf, yf, len(classes), W0=W0, b0=b0, lam_prior=args.lam, class_weight=class_weights(yf))

    # Validation: image-level logits = mean of full-frame and centre-crop logits (as in the app).
    Xv_full = emb[[index[r["id"]] for r in val], 0]
    Xv_cent = emb[[index[r["id"]] for r in val], 1]
    yv = np.array([cidx[r["label"]] for r in val])
    logits_v = ((Xv_full @ W.T + b) + (Xv_cent @ W.T + b)) / 2
    T = fit_temperature(logits_v, yv)
    pv = softmax(logits_v / T)

    # Threshold sweep on validation: false alarms on `none` vs recall on issues.
    none_mask = yv == 0
    issue_p = pv[:, 1:].max(1)
    issue_c = pv[:, 1:].argmax(1) + 1
    sweep = []
    for tau in np.round(np.arange(0.30, 0.96, 0.05), 2):
        det = issue_p >= tau
        fa = float((det & none_mask).sum() / max(1, none_mask.sum()))
        correct = det & ~none_mask & (issue_c == yv)
        rec = float(correct.sum() / max(1, (~none_mask).sum()))
        prec = float(correct.sum() / max(1, det.sum()))
        sweep.append({"tau": float(tau), "false_alarm_rate": fa, "issue_recall": rec, "precision": prec})
    # Detect threshold: smallest tau with precision >= 0.95 on validation.
    detect = next((s["tau"] for s in sweep if s["precision"] >= 0.95), 0.6)
    # "High confidence": smallest tau with precision >= 0.98.
    high = next((s["tau"] for s in sweep if s["precision"] >= 0.98 and s["tau"] > detect), max(0.85, detect + 0.15))
    uncertain = max(0.3, round(detect - 0.2, 2))

    # Final fit on all training data (same lambda, same temperature).
    Xa, ya = xy(train)
    W, b = train_linear(Xa, ya, len(classes), W0=W0, b0=b0, lam_prior=args.lam, class_weight=class_weights(ya))

    # Concept probe reference stats over no-issue street scenes in the training split.
    ref = emb[[index[r["id"]] for r in train if r["label"] == "none"], 0]
    concepts = []
    for key, label in CONCEPT_LABELS.items():
        e = proto(text, key)
        s = ref @ e
        concepts.append(
            {
                "id": key,
                "label": label,
                "embedding": [round(float(v), 6) for v in e],
                "mean": round(float(s.mean()), 6),
                "std": round(float(s.std() + 1e-6), 6),
            }
        )

    head = {
        "version": "1.0.0",
        "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "modelName": "SigLIP 2 B/32 (256 px) + CivicLens head",
        "modelVersion": "siglip2-b32-256-q8",
        "embeddingDim": 768,
        "classes": classes,
        "weights": W.round(6).tolist(),
        "bias": b.round(6).tolist(),
        "temperature": round(T, 4),
        "thresholds": {"detect": detect, "high": high, "uncertain": uncertain},
        "region": {"rescueThreshold": high, "boxRelative": 0.6, "boxMinPeak": detect},
        "concepts": concepts,
        "siglip": {"logitScale": text["logit_scale"], "logitBias": text["logit_bias"]},
        "training": {
            "variant": f"logistic regression, L2 toward zero-shot weights (lambda={args.lam})",
            "trainImages": len(train),
            "validationImages": len(val),
            "classCounts": {c: int(sum(1 for r in train if r["label"] == c)) for c in classes},
        },
    }
    json.dump(head, open(args.out, "w"), separators=(",", ":"))
    json.dump({"temperature": T, "thresholds": head["thresholds"], "validation_sweep": sweep}, open(args.metrics_out, "w"), indent=2)
    print(json.dumps({"T": T, "thresholds": head["thresholds"]}, indent=1))
    for s in sweep:
        print(s)


if __name__ == "__main__":
    main()
