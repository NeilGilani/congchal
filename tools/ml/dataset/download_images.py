"""Downloads Open Images candidates from the CVDF S3 mirror and normalises them.

Every image is EXIF-transposed, converted to RGB, downscaled so its long side
is at most 1024 px and re-encoded as JPEG (quality 90). That mirrors what the
app does on the phone (camera photo -> native resize -> JPEG) before the
TypeScript pipeline sees it.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import csv
import io
import os
import urllib.request

from PIL import Image, ImageOps

URL = "https://s3.amazonaws.com/open-images-dataset/{split}/{image_id}.jpg"
MAX_SIDE = 1024


def normalise(data: bytes, dst: str) -> None:
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im).convert("RGB")
    im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    im.save(dst, "JPEG", quality=90)


def fetch(split: str, image_id: str, out_dir: str) -> str | None:
    dst = os.path.join(out_dir, f"oi_{image_id}.jpg")
    if os.path.exists(dst):
        return dst
    try:
        with urllib.request.urlopen(URL.format(split=split, image_id=image_id), timeout=60) as r:
            normalise(r.read(), dst)
        return dst
    except Exception as e:  # noqa: BLE001 - report and continue
        print("failed", image_id, e)
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--workers", type=int, default=24)
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    rows = list(csv.DictReader(open(args.candidates)))
    ok = 0
    with cf.ThreadPoolExecutor(args.workers) as ex:
        futs = [ex.submit(fetch, r["split"], r["image_id"], args.out_dir) for r in rows]
        for i, f in enumerate(cf.as_completed(futs)):
            ok += f.result() is not None
            if i % 500 == 0:
                print(f"{i}/{len(rows)}", flush=True)
    print("downloaded", ok, "of", len(rows))


if __name__ == "__main__":
    main()
