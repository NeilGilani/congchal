"""Selects Open Images V7 candidate images for the CivicLens civic dataset.

Inputs are the human-verified image-level label files (positives with
confidence 1). Candidates are *pools* that are later verified by a person
(see prepare_review.py and reviews.txt); nothing here is treated as ground truth on its own.

Output: candidates.csv with columns split,image_id,pool
"""

from __future__ import annotations

import argparse
import collections
import csv
import random

MID = {
    "graffiti": "/m/034wh",
    "street_art": "/m/07vwy6",
    "mural": "/m/04rd7",
    "litter": "/m/03ns2k",
    "waste": "/m/01fnck",
    "bin_bag": "/m/05lw7z",
    "waste_container": "/m/0bjyj5",
    "pollution": "/m/066xq",
    "plastic_bag": "/m/05gqfk",
    "recycling_bin": "/m/068kkx",
    "mattress": "/m/03dg8j",
    "couch": "/m/02crq1",
    "junk": "/m/01g2v7",
    "rubble": "/m/08qrwn",
    "tire": "/m/0h9mv",
    "shopping_cart": "/m/019plg",
    "flood": "/m/0dbtv",
    "puddle": "/m/09x984",
    "storm": "/m/0z71l",
    "natural_disaster": "/m/0g2k1",
    "hurricane": "/m/08xv3y",
    "tree": "/m/07j7r",
    "branch": "/m/0b5gs",
    "tree_stump": "/m/0d9wys",
    "traffic_sign": "/m/01mqdt",
    "stop_sign": "/m/02pv19",
    "sidewalk": "/m/0dnhy",
    "walkway": "/m/01jm2n",
    "footpath": "/m/0bxzl3m",
    "curb": "/m/09p3jz",
    "concrete": "/m/01mxf",
    "road": "/m/06gfj",
    "road_surface": "/m/01k0mv",
    "asphalt": "/m/0hr8",
    "street": "/m/01c8br",
    "lane": "/m/033j3c",
    "alley": "/m/01lwf0",
    "residential": "/m/02nfxt",
    "neighbourhood": "/m/0180xr",
    "urban": "/m/039jbq",
    "parking_lot": "/m/02jxn5",
    "building": "/m/0cgh4",
    "house": "/m/03jm5",
    "wall": "/m/09qqq",
    "street_light": "/m/033rq4",
    "bench": "/m/0cvnqh",
    "fire_hydrant": "/m/01pns0",
    "bus_stop": "/m/01jw_1",
    "manhole": "/m/0250bv",
    "crosswalk": "/m/014xcs",
    "cobblestone": "/m/02t2zd",
    "barricade": "/m/0583b1",
    "construction": "/m/01jnzj",
    "traffic_cone": "/m/03sy7v",
    "wheelchair": "/m/0qmmr",
    "ramp": "/m/02xf10",
    "demolition": "/m/02zrvn",
    "infrastructure": "/m/017kvv",
}
OUTDOOR = {"sidewalk", "walkway", "footpath", "curb", "road", "road_surface", "asphalt", "street", "lane", "alley",
           "residential", "neighbourhood", "urban", "parking_lot"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", nargs="+", required=True, help="pos_*.csv files: split,image_id,mid")
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    rnd = random.Random(args.seed)

    inv = {v: k for k, v in MID.items()}
    labels: dict[tuple[str, str], set[str]] = collections.defaultdict(set)
    for path in args.labels:
        for line in open(path):
            split, image_id, mid = line.strip().split(",")
            if mid in inv:
                labels[(split, image_id)].add(inv[mid])

    def having(*names: str) -> list[tuple[str, str]]:
        return [k for k, v in labels.items() if v & set(names)]

    def outdoor(keys: list[tuple[str, str]]) -> list[tuple[str, str]]:
        return [k for k in keys if labels[k] & OUTDOOR]

    def sample(keys: list[tuple[str, str]], n: int) -> list[tuple[str, str]]:
        keys = sorted(set(keys))
        rnd.shuffle(keys)
        return keys[:n]

    pools: dict[str, list[tuple[str, str]]] = {
        # Issue candidate pools (verified by review afterwards).
        "graffiti": sample(having("graffiti"), 700),
        "art": sample(having("mural", "street_art"), 250),
        "trash": sample(having("litter", "waste", "bin_bag", "pollution", "plastic_bag"), 900),
        "bins": sample(having("waste_container", "recycling_bin"), 350),
        "dumping": sample(outdoor(having("mattress", "couch", "junk", "tire", "shopping_cart", "rubble")), 500),
        "flood": sample(having("flood", "puddle"), 450),
        "fallen_tree": sample(
            [k for k in having("tree", "branch", "tree_stump") if labels[k] & (OUTDOOR | {"storm", "hurricane", "natural_disaster"})
             and labels[k] & {"storm", "hurricane", "natural_disaster", "road", "street", "sidewalk"}],
            600,
        ),
        "signs": sample(having("traffic_sign", "stop_sign"), 600),
        "sidewalks": sample(having("sidewalk", "walkway", "footpath", "curb", "concrete", "cobblestone"), 900),
        "roads": sample(having("road", "road_surface", "asphalt", "street", "lane", "alley"), 900),
        "obstruction": sample(
            [k for k in having("construction", "barricade", "traffic_cone", "waste_container", "bench")
             if labels[k] & {"sidewalk", "walkway", "footpath", "curb", "street"}],
            400,
        ),
        "street_furniture": sample(having("street_light", "bench", "fire_hydrant", "bus_stop", "manhole", "crosswalk"), 450),
        "accessibility": sample(having("wheelchair", "ramp"), 200),
        "urban_scenes": sample(having("residential", "neighbourhood", "urban", "parking_lot", "infrastructure", "building", "house", "wall"), 700),
        "disaster": sample(having("demolition", "natural_disaster", "storm", "rubble"), 250),
    }
    used = set()
    with open(args.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["split", "image_id", "pool"])
        for pool, keys in pools.items():
            for split, image_id in keys:
                if (split, image_id) in used:
                    continue
                used.add((split, image_id))
                w.writerow([split, image_id, pool])
            print(f"{pool:18s} {len(keys)}")
    print("unique images:", len(used))


if __name__ == "__main__":
    main()
