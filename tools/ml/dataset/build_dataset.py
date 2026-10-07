"""Assembles the labelled CivicLens dataset from review decisions + source datasets.

Sources
  * Open Images V7 (CC BY 2.0 images, human-verified image-level labels):
    candidates reviewed image by image (reviews.txt); street-scene negatives
    that were not among the most "issue-like" are used as `none`.
  * Pothole Dataset (Chitale et al., IVCNZ 2020; github.com/jaygala24/pothole-detection): `pothole`.
  * DeepCrack (Liu et al., 2019; research/educational use) and CrackForest
    (Shi et al., 2016): `pavement_crack`.

Near-duplicate photos (cosine >= 0.985 between full-frame embeddings) are
grouped so a group never straddles train and test.

Output: dataset.json with [{id, label, source, group, split}] and summary.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import random

import numpy as np

DUP_THRESHOLD = 0.985

CODE = {
    "P": "pothole",
    "C": "pavement_crack",
    "S": "sidewalk_damage",
    "G": "graffiti",
    "T": "overflowing_trash",
    "D": "illegal_dumping",
    "N": "damaged_sign",
    "F": "fallen_tree",
    "W": "flooding",
    "O": "pedestrian_obstruction",
    "0": "none",
}


def parse_reviews(path: str, sheets_dir: str) -> tuple[dict[str, str], list[str]]:
    labels: dict[str, str] = {}
    conflicts: list[str] = []
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        sheet, rest = line.split(":", 1)
        parts = [p.strip() for p in rest.split(";")]
        default = parts[0]
        overrides = {}
        if len(parts) > 1 and parts[1]:
            for tok in parts[1].split():
                k, v = tok.split("=")
                overrides[int(k)] = v
        names = [n for n in open(os.path.join(sheets_dir, f"{sheet}.txt")).read().split("\n") if n]
        for i, name in enumerate(names):
            code = overrides.get(i, default)
            if code == "X":
                labels.setdefault(name, "X")
                continue
            label = CODE[code]
            prev = labels.get(name)
            if prev and prev not in ("X", label):
                conflicts.append(f"{name}: {prev} vs {label} ({sheet})")
            labels[name] = label
    return labels, conflicts


def load_emb(prefix: str) -> tuple[np.ndarray, list[str]]:
    meta = json.load(open(prefix + ".json"))
    arr = np.fromfile(prefix + ".f32", dtype=np.float32).reshape(len(meta["ids"]), len(meta["regions"]), 768)
    return arr, meta["ids"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reviews", required=True)
    ap.add_argument("--sheets-dir", required=True)
    ap.add_argument("--review-dir", required=True, help="dir with *_unreviewed.txt negative lists")
    ap.add_argument("--emb", nargs="+", required=True, help="embedding prefixes (live regions)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--test-frac", type=float, default=0.25)
    ap.add_argument("--seed", type=int, default=2026)
    args = ap.parse_args()
    rnd = random.Random(args.seed)

    labels, conflicts = parse_reviews(args.reviews, args.sheets_dir)
    items: dict[str, tuple[str, str]] = {}  # id -> (label, source)
    for name, lab in labels.items():
        if lab != "X":
            items[name] = (lab, "openimages-reviewed")
    for pool in ("roads", "urban_scenes", "street_furniture"):
        for name in open(os.path.join(args.review_dir, f"{pool}_unreviewed.txt")).read().split("\n"):
            if name and name not in labels:
                items[name] = ("none", "openimages-scene-label")

    embs, ids = [], []
    for prefix in args.emb:
        e, i = load_emb(prefix)
        embs.append(e[:, 0])
        ids.extend(i)
    full = np.concatenate(embs)
    index = {n: k for k, n in enumerate(ids)}
    for name in ids:
        if name.startswith("pothole_"):
            items[name] = ("pothole", "pothole-dataset-ivcnz2020")
        elif name.startswith("deepcrack_"):
            items[name] = ("pavement_crack", "deepcrack")
        elif name.startswith("cfd_"):
            items[name] = ("pavement_crack", "crackforest")

    names = sorted(n for n in items if n in index)
    X = full[[index[n] for n in names]]
    # Near-duplicate grouping (union-find over cosine >= DUP_THRESHOLD). A looser
    # threshold chains similar-looking textures (e.g. crack close-ups) into giant groups.
    parent = list(range(len(names)))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    sims = X @ X.T
    dup_pairs = 0
    for a in range(len(names)):
        for b in np.nonzero(sims[a, a + 1 :] >= DUP_THRESHOLD)[0] + a + 1:
            ra, rb = find(a), find(int(b))
            if ra != rb:
                parent[rb] = ra
                dup_pairs += 1
    groups = collections.defaultdict(list)
    for k in range(len(names)):
        groups[find(k)].append(k)

    # Stratified group split: assign whole groups, by majority label.
    by_label = collections.defaultdict(list)
    for root, members in groups.items():
        labs = collections.Counter(items[names[m]][0] for m in members)
        by_label[labs.most_common(1)[0][0]].append(root)
    split = {}
    for lab, roots in by_label.items():
        rnd.shuffle(roots)
        n_test = max(1, round(len(roots) * args.test_frac)) if len(roots) >= 4 else 0
        for i, root in enumerate(roots):
            split[root] = "test" if i < n_test else "train"

    records = []
    for root, members in groups.items():
        for m in members:
            lab, src = items[names[m]]
            records.append({"id": names[m], "label": lab, "source": src, "group": int(root), "split": split[root]})

    summary = collections.Counter((r["label"], r["split"]) for r in records)
    table = collections.defaultdict(dict)
    for (lab, sp), c in summary.items():
        table[lab][sp] = c
    out = {
        "records": records,
        "summary": table,
        "conflicts": conflicts,
        "near_duplicate_merges": dup_pairs,
        "seed": args.seed,
    }
    json.dump(out, open(args.out, "w"), indent=1)
    print(json.dumps(table, indent=1))
    print("conflicts:", len(conflicts), conflicts[:10])
    print("near-duplicate merges:", dup_pairs)


if __name__ == "__main__":
    main()
