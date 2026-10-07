"""Builds review queues (contact sheets) for each candidate pool.

Positive pools are reviewed in full, in *random* order (not model-sorted), so
the reviewed set is not biased toward images the zero-shot model already
finds easy. Negative pools (ordinary street scenes) are reviewed for the 15%
most issue-like images, where label noise would matter most.

Usage:
  python prepare_review.py --emb emb_all_live --candidates candidates.csv \
      --text text_embeddings.json --images-root DATA --out-dir review
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import subprocess
import sys

import numpy as np

POSITIVE_POOLS = ["graffiti", "art", "trash", "bins", "dumping", "flood", "fallen_tree", "signs", "sidewalks", "obstruction",
                  "accessibility", "disaster"]
NEGATIVE_POOLS = ["roads", "urban_scenes", "street_furniture"]


def load_embeddings(prefix: str) -> tuple[np.ndarray, list[str], list[str]]:
    meta = json.load(open(prefix + ".json"))
    regions = meta["regions"]
    arr = np.fromfile(prefix + ".f32", dtype=np.float32).reshape(len(meta["ids"]), len(regions), 768)
    return arr, meta["ids"], regions


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--emb", required=True)
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--text", required=True)
    ap.add_argument("--images-root", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--seed", type=int, default=11)
    args = ap.parse_args()
    rnd = random.Random(args.seed)

    emb, ids, _ = load_embeddings(args.emb)
    full = emb[:, 0, :]
    text = json.load(open(args.text))
    classes = [k for k in text["embeddings"] if k.startswith("class:")]
    proto = []
    for k in classes:
        e = np.array(text["embeddings"][k])
        m = e.mean(0)
        proto.append(m / np.linalg.norm(m))
    proto = np.stack(proto)
    zs = full @ proto.T  # cosine
    issue_idx = [i for i, k in enumerate(classes) if k != "class:none"]
    issue_score = zs[:, issue_idx].max(1) - zs[:, classes.index("class:none")]
    id_index = {name: i for i, name in enumerate(ids)}

    pools: dict[str, list[str]] = {}
    for row in csv.DictReader(open(args.candidates)):
        name = f"oi_{row['image_id']}.jpg"
        if name in id_index:
            pools.setdefault(row["pool"], []).append(name)

    os.makedirs(args.out_dir, exist_ok=True)
    summary = {}
    for pool, names in pools.items():
        if pool in POSITIVE_POOLS:
            queue = names[:]
            rnd.shuffle(queue)
        elif pool in NEGATIVE_POOLS:
            ranked = sorted(names, key=lambda n: -issue_score[id_index[n]])
            queue = ranked[: max(20, int(len(ranked) * 0.15))]
            with open(os.path.join(args.out_dir, f"{pool}_unreviewed.txt"), "w") as f:
                f.write("\n".join(ranked[len(queue):]))
        else:
            continue
        ids_file = os.path.join(args.out_dir, f"{pool}_queue.txt")
        with open(ids_file, "w") as f:
            f.write("\n".join(queue))
        subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "contact_sheets.py"), "--images-dir",
                        os.path.join(args.images_root, "oi"), "--ids", ids_file, "--out-dir",
                        os.path.join(args.out_dir, "sheets"), "--prefix", pool], check=True)
        summary[pool] = len(queue)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
