"""Renders numbered contact sheets used for manual label review.

Usage:
  python contact_sheets.py --images-dir DIR --ids ids.txt --out-dir sheets --prefix graffiti

Each sheet holds up to 20 images (5 x 4). The tile number printed on the
image is its 0-based index within the sheet; review decisions are recorded
per sheet in reviews.txt (parsed by build_dataset.py).
"""

from __future__ import annotations

import argparse
import os

from PIL import Image, ImageDraw, ImageFont

COLS, ROWS, TILE = 5, 4, 236
PAD = 4


def font(size: int) -> ImageFont.ImageFont:
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def render(paths: list[str], dst: str, title: str) -> None:
    w = COLS * (TILE + PAD) + PAD
    h = ROWS * (TILE + PAD) + PAD + 28
    sheet = Image.new("RGB", (w, h), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    d.text((8, 4), title, fill=(230, 230, 230), font=font(18))
    f = font(22)
    for i, p in enumerate(paths):
        im = Image.open(p).convert("RGB")
        im.thumbnail((TILE, TILE))
        x = PAD + (i % COLS) * (TILE + PAD)
        y = 28 + PAD + (i // COLS) * (TILE + PAD)
        sheet.paste(im, (x + (TILE - im.width) // 2, y + (TILE - im.height) // 2))
        d.rectangle([x, y, x + 34, y + 28], fill=(0, 0, 0))
        d.text((x + 4, y + 2), str(i), fill=(255, 220, 0), font=f)
    sheet.save(dst, "JPEG", quality=85)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images-dir", required=True)
    ap.add_argument("--ids", required=True, help="file with one image filename per line, in review order")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--prefix", required=True)
    args = ap.parse_args()
    ids = [l.strip() for l in open(args.ids) if l.strip()]
    os.makedirs(args.out_dir, exist_ok=True)
    per = COLS * ROWS
    for s in range(0, len(ids), per):
        chunk = ids[s : s + per]
        n = s // per
        render([os.path.join(args.images_dir, i) for i in chunk], os.path.join(args.out_dir, f"{args.prefix}_{n:03d}.jpg"),
               f"{args.prefix} sheet {n}")
        with open(os.path.join(args.out_dir, f"{args.prefix}_{n:03d}.txt"), "w") as f:
            f.write("\n".join(chunk))
    print(f"{(len(ids) + per - 1) // per} sheets for {len(ids)} images")


if __name__ == "__main__":
    main()
