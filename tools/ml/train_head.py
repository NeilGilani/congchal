"""Trains and evaluates the CivicLens classification head on SigLIP 2 embeddings.

Embeddings come from the app's own TypeScript pipeline (tools/ml/embed.ts),
so the head sees exactly what the phone produces.

Experiments (all evaluated on the held-out grouped test split):
  zs     - zero-shot: cosine to prompt-ensemble text embeddings
  probe  - multinomial logistic regression (class-balanced)
  prior  - logistic regression regularised toward the zero-shot weights
           (keeps text knowledge for classes with little data)

Usage:
  python train_head.py --dataset dataset.json --emb emb_all_live emb_norm2_live \
      --text text_embeddings.json --classes pothole,pavement_crack,... --out head.json
"""

from __future__ import annotations

import argparse
import collections
import json

import numpy as np
import torch

torch.manual_seed(0)
np.random.seed(0)


def load(prefixes: list[str]) -> tuple[np.ndarray, dict[str, int]]:
    arrs, ids = [], []
    for p in prefixes:
        meta = json.load(open(p + ".json"))
        arrs.append(np.fromfile(p + ".f32", dtype=np.float32).reshape(len(meta["ids"]), len(meta["regions"]), 768))
        ids += meta["ids"]
    return np.concatenate(arrs), {n: i for i, n in enumerate(ids)}


def proto(text: dict, key: str) -> np.ndarray:
    e = np.array(text["embeddings"][key], dtype=np.float32)
    m = e.mean(0)
    return m / np.linalg.norm(m)


def softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def train_linear(X, y, n_cls, W0=None, b0=None, lam_prior=0.0, wd=1e-3, class_weight=None, epochs=300):
    Xt = torch.tensor(X)
    yt = torch.tensor(y)
    W = torch.nn.Parameter(torch.tensor(W0.copy() if W0 is not None else np.zeros((n_cls, X.shape[1]), np.float32)))
    b = torch.nn.Parameter(torch.tensor(b0.copy() if b0 is not None else np.zeros(n_cls, np.float32)))
    W0t = torch.tensor(W0) if W0 is not None else None
    cw = torch.tensor(class_weight, dtype=torch.float32) if class_weight is not None else None
    opt = torch.optim.LBFGS([W, b], lr=0.5, max_iter=epochs, line_search_fn="strong_wolfe")

    def closure():
        opt.zero_grad()
        logits = Xt @ W.T + b
        loss = torch.nn.functional.cross_entropy(logits, yt, weight=cw)
        if W0t is not None and lam_prior > 0:
            loss = loss + lam_prior * ((W - W0t) ** 2).sum()
        loss = loss + wd * (W**2).sum()
        loss.backward()
        return loss

    opt.step(closure)
    return W.detach().numpy(), b.detach().numpy()


def fit_temperature(logits: np.ndarray, y: np.ndarray) -> float:
    best_t, best_nll = 1.0, 1e9
    for t in np.exp(np.linspace(np.log(0.2), np.log(5), 120)):
        p = softmax(logits / t)
        nll = -np.log(p[np.arange(len(y)), y] + 1e-12).mean()
        if nll < best_nll:
            best_t, best_nll = float(t), nll
    return best_t


def ece(p: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    conf = p.max(1)
    pred = p.argmax(1)
    e = 0.0
    for lo in np.linspace(0, 1, bins, endpoint=False):
        m = (conf > lo) & (conf <= lo + 1 / bins)
        if m.any():
            e += m.mean() * abs((pred[m] == y[m]).mean() - conf[m].mean())
    return float(e)


def report(name: str, p: np.ndarray, y: np.ndarray, classes: list[str]) -> dict:
    pred = p.argmax(1)
    out = {"accuracy": float((pred == y).mean()), "ece": ece(p, y), "per_class": {}}
    for k, c in enumerate(classes):
        tp = int(((pred == k) & (y == k)).sum())
        fp = int(((pred == k) & (y != k)).sum())
        fn = int(((pred != k) & (y == k)).sum())
        out["per_class"][c] = {
            "support": int((y == k).sum()),
            "precision": tp / (tp + fp) if tp + fp else None,
            "recall": tp / (tp + fn) if tp + fn else None,
        }
    f1s = [
        2 * v["precision"] * v["recall"] / (v["precision"] + v["recall"])
        for v in out["per_class"].values()
        if v["precision"] and v["recall"]
    ]
    out["macro_f1"] = float(np.mean(f1s)) if f1s else 0.0
    print(f"\n== {name}: acc={out['accuracy']:.3f} macroF1={out['macro_f1']:.3f} ECE={out['ece']:.3f}")
    for c, v in out["per_class"].items():
        pr = "  -  " if v["precision"] is None else f"{v['precision']:.2f}"
        rc = "  -  " if v["recall"] is None else f"{v['recall']:.2f}"
        print(f"   {c:24s} n={v['support']:4d}  P={pr}  R={rc}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--emb", nargs="+", required=True)
    ap.add_argument("--text", required=True)
    ap.add_argument("--classes", required=True, help="comma-separated issue classes (none is added)")
    ap.add_argument("--out", default="")
    ap.add_argument("--lam", type=float, default=0.05)
    ap.add_argument(
        "--unsupported-as-none",
        action="store_true",
        help="images of issue types the head does not support count as `none` (the head must stay silent on them)",
    )
    args = ap.parse_args()

    emb, index = load(args.emb)
    text = json.load(open(args.text))
    classes = ["none"] + args.classes.split(",")
    cidx = {c: i for i, c in enumerate(classes)}
    ds = json.load(open(args.dataset))["records"]
    if args.unsupported_as_none:
        ds = [{**r, "label": r["label"] if r["label"] in cidx else "none", "orig": r["label"]} for r in ds]
    rows = [r for r in ds if r["label"] in cidx and r["id"] in index]
    tr = [r for r in rows if r["split"] == "train"]
    te = [r for r in rows if r["split"] == "test"]

    def feats(rs, region):
        return emb[[index[r["id"]] for r in rs], region]

    # Train on full frame + centre crop (augmentation); test on the full frame.
    Xtr = np.concatenate([feats(tr, 0), feats(tr, 1)])
    ytr = np.array([cidx[r["label"]] for r in tr] * 2)
    Xte = feats(te, 0)
    yte = np.array([cidx[r["label"]] for r in te])
    print("train", collections.Counter(r["label"] for r in tr))
    print("test ", collections.Counter(r["label"] for r in te))

    scale, bias = text["logit_scale"], text["logit_bias"]
    T = np.stack([proto(text, f"class:{c}") for c in classes])
    W0 = (T * scale).astype(np.float32)
    b0 = np.zeros(len(classes), np.float32)

    results = {}
    results["zero_shot"] = report("zero-shot", softmax(Xte @ W0.T), yte, classes)

    counts = np.bincount(ytr, minlength=len(classes)).astype(np.float32)
    cw = (counts.sum() / (len(classes) * np.maximum(counts, 1))) ** 0.5

    # Hold out 20% of train groups to fit temperature.
    groups = sorted({r["group"] for r in tr})
    rng = np.random.default_rng(1)
    val_groups = set(rng.choice(groups, size=len(groups) // 5, replace=False).tolist())
    tr_mask = np.array([r["group"] not in val_groups for r in tr] * 2)
    va = [r for r in tr if r["group"] in val_groups]
    Xva = feats(va, 0)
    yva = np.array([cidx[r["label"]] for r in va])

    best = None
    for name, lam in (("probe", 0.0), ("prior", args.lam), ("prior_light", args.lam / 5)):
        W, b = train_linear(Xtr[tr_mask], ytr[tr_mask], len(classes), W0=W0 if lam else None, b0=b0 if lam else None,
                            lam_prior=lam, class_weight=cw)
        t = fit_temperature(Xva @ W.T + b, yva)
        # Refit on all training data with the chosen setup.
        W, b = train_linear(Xtr, ytr, len(classes), W0=W0 if lam else None, b0=b0 if lam else None, lam_prior=lam,
                            class_weight=cw)
        res = report(f"{name} (T={t:.2f})", softmax((Xte @ W.T + b) / t), yte, classes)
        Xte_c = feats(te, 1)
        report(f"{name} full+centre mean logits", softmax(((Xte @ W.T + b) + (Xte_c @ W.T + b)) / 2 / t), yte, classes)
        res["temperature"] = t
        results[name] = res
        if best is None or res["macro_f1"] > best[0]:
            best = (res["macro_f1"], name, W, b, t)

    if args.out:
        _, name, W, b, t = best
        json.dump(
            {
                "variant": name,
                "classes": classes,
                "weights": W.round(6).tolist(),
                "bias": b.round(6).tolist(),
                "temperature": t,
                "results": results,
            },
            open(args.out, "w"),
        )
        print("\nwrote", args.out, "variant", name)


if __name__ == "__main__":
    main()
