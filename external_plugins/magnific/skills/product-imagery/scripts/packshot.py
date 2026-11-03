#!/usr/bin/env python3
"""Frame product photos for marketplace packshots and verify the result. Needs Pillow only.

  packshot.py measure IMAGE              where the product is, how much of the frame it fills,
                                         how far off-centre it sits, and the corner colours
  packshot.py frame PHOTO OUT [--fill 0.85] [--size 0]
                                         square crop of a photo with the product centred at the
                                         given fill; feed it to images_remove_background or upload it
  packshot.py white CUTOUT OUT [--fill 0.85] [--size 2000]
                                         a transparent cut-out (PNG with alpha) centred on pure
                                         255 white at the given fill; the exact Amazon main image

Every command prints one JSON line, so the numbers you report are measured, not estimated.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import deque

try:
    from PIL import Image, ImageChops
except ImportError:
    sys.exit("packshot.py needs Pillow: pip install Pillow")

GRID = 240          # mask resolution for finding the product among stray marks
ALPHA_MIN = 16      # alpha above this counts as product
MIN_COMPONENT = 0.02  # a mark smaller than this share of the largest one (a caption, dust) is ignored
MAX_SIDE = 10000      # Amazon's largest accepted side; anything bigger only exhausts memory


def fill_share(value: str) -> float:
    f = float(value)
    if not 0 < f <= 1:
        raise argparse.ArgumentTypeError("must be above 0 and at most 1")
    return f


def side_px(minimum: int):
    def parse(value: str) -> int:
        n = int(value)
        if not minimum <= n <= MAX_SIDE:
            raise argparse.ArgumentTypeError(f"must be from {minimum} to {MAX_SIDE}")
        return n
    return parse


def colour_distance(value: str) -> int:
    n = int(value)
    if not 0 <= n <= 255:
        raise argparse.ArgumentTypeError("must be from 0 to 255")
    return n


def backdrop_colour(img: Image.Image) -> tuple[int, int, int]:
    """Median colour of the outer border, where a studio photo shows only backdrop."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    band = max(2, min(w, h) // 50)
    px = []
    for box in ((0, 0, w, band), (0, h - band, w, h), (0, 0, band, h), (w - band, 0, w, h)):
        strip = rgb.crop(box).resize((64, 4) if box[3] - box[1] == band else (4, 64))
        px.extend(getattr(strip, "get_flattened_data", strip.getdata)())
    return tuple(sorted(c[i] for c in px)[len(px) // 2] for i in range(3))


def product_mask(img: Image.Image, threshold: int) -> Image.Image:
    """L mask, 255 where the product is: from alpha when the image has transparency,
    otherwise from the distance to the backdrop colour."""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        alpha = img.convert("RGBA").getchannel("A")
        if alpha.getextrema()[0] < 250:
            return alpha.point(lambda a: 255 if a > ALPHA_MIN else 0)
    rgb = img.convert("RGB")
    backdrop = backdrop_colour(rgb)
    if backdrop == (255, 255, 255):
        # On pure white anything off-white is product, including a near-white sole or cap.
        threshold = min(threshold, 3)
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, backdrop))
    r, g, b = diff.split()
    dist = ImageChops.lighter(ImageChops.lighter(r, g), b)
    return dist.point(lambda d: 255 if d > threshold else 0)


def product_box(mask: Image.Image) -> tuple[int, int, int, int] | None:
    """Bounding box of the product: the largest connected mark plus any mark near it,
    so a caption or a speck in a corner does not stretch the box."""
    w, h = mask.size
    scale = max(w, h) / GRID
    gw, gh = max(1, round(w / scale)), max(1, round(h / scale))
    small = mask.resize((gw, gh), Image.BOX).point(lambda v: 255 if v > 32 else 0)
    data = small.load()
    seen = [[False] * gw for _ in range(gh)]
    comps = []
    for y in range(gh):
        for x in range(gw):
            if data[x, y] and not seen[y][x]:
                q, n = deque([(x, y)]), 0
                seen[y][x] = True
                x0 = x1 = x
                y0 = y1 = y
                while q:
                    cx, cy = q.popleft()
                    n += 1
                    x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < gw and 0 <= ny < gh and data[nx, ny] and not seen[ny][nx]:
                            seen[ny][nx] = True
                            q.append((nx, ny))
                comps.append((n, (x0, y0, x1 + 1, y1 + 1)))
    if not comps:
        return None
    comps.sort(reverse=True)
    biggest_n, (bx0, by0, bx1, by1) = comps[0]
    pad = max(bx1 - bx0, by1 - by0) * 0.05
    for n, (x0, y0, x1, y1) in comps[1:]:
        near = x1 >= bx0 - pad and x0 <= bx1 + pad and y1 >= by0 - pad and y0 <= by1 + pad
        if n >= biggest_n * MIN_COMPONENT and near:
            bx0, by0, bx1, by1 = min(bx0, x0), min(by0, y0), max(bx1, x1), max(by1, y1)
    # Refine on the full-resolution mask inside the coarse box.
    m = 2 * scale
    cx0, cy0 = max(0, int(bx0 * scale - m)), max(0, int(by0 * scale - m))
    cx1, cy1 = min(w, int(bx1 * scale + m)), min(h, int(by1 * scale + m))
    fine = mask.crop((cx0, cy0, cx1, cy1)).getbbox()
    if not fine:
        return None
    return cx0 + fine[0], cy0 + fine[1], cx0 + fine[2], cy0 + fine[3]


def report(img: Image.Image, box) -> dict:
    w, h = img.size
    rgb = img.convert("RGB")
    corners = [rgb.getpixel(p) for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    out = {"size": [w, h], "corners_rgb": corners, "corners_pure_white": all(c == (255, 255, 255) for c in corners)}
    if box:
        bw, bh = box[2] - box[0], box[3] - box[1]
        out.update({
            "product_box": list(box),
            "fill": round(max(bw / w, bh / h), 3),
            "fill_width": round(bw / w, 3),
            "fill_height": round(bh / h, 3),
            "offcentre_px": [round((box[0] + box[2] - w) / 2), round((box[1] + box[3] - h) / 2)],
        })
    return out


def place(box, fill: float):
    """Square side and top-left corner that put the box at `fill` of the side, centred."""
    bw, bh = box[2] - box[0], box[3] - box[1]
    side = max(bw, bh) / fill
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    return side, cx - side / 2, cy - side / 2


def cmd_measure(a) -> dict:
    img = Image.open(a.image)
    return report(img, product_box(product_mask(img, a.threshold)))


def cmd_frame(a) -> dict:
    img = Image.open(a.photo)
    box = product_box(product_mask(img, a.threshold))
    if not box:
        sys.exit("no product found; check the photo or lower --threshold")
    side, x0, y0 = place(box, a.fill)
    side = round(side)
    if side > MAX_SIDE:
        sys.exit(f"the crop would be {side} px wide; raise --fill so it stays at most {MAX_SIDE} px")
    # A crop that runs past the photo's edge is filled with the backdrop colour instead of black.
    src = img.convert("RGB")
    sx0, sy0 = max(0, round(x0)), max(0, round(y0))
    sx1, sy1 = min(src.width, round(x0) + side), min(src.height, round(y0) + side)
    canvas = Image.new("RGB", (side, side), backdrop_colour(img))
    canvas.paste(src.crop((sx0, sy0, sx1, sy1)), (sx0 - round(x0), sy0 - round(y0)))
    if a.size:
        canvas = canvas.resize((a.size, a.size), Image.LANCZOS)
    canvas.save(a.out)
    out = Image.open(a.out)
    return {"wrote": a.out, "source_box": list(box), **report(out, product_box(product_mask(out, a.threshold)))}


def cmd_white(a) -> dict:
    img = Image.open(a.cutout).convert("RGBA")
    if img.getchannel("A").getextrema()[0] >= 250:
        sys.exit("the cut-out has no transparency; run images_remove_background first, or use `frame` for a photo")
    box = product_box(product_mask(img, a.threshold))
    if not box:
        sys.exit("no product found in the cut-out")
    product = img.crop(box)
    target = a.fill * a.size
    k = target / max(product.width, product.height)
    product = product.resize((max(1, round(product.width * k)), max(1, round(product.height * k))), Image.LANCZOS)
    canvas = Image.new("RGBA", (a.size, a.size), (255, 255, 255, 255))
    left, top = (a.size - product.width) // 2, (a.size - product.height) // 2
    canvas.alpha_composite(product, (left, top))
    canvas.convert("RGB").save(a.out)
    # Report the exact placement; re-measuring cannot always tell a white product edge from the white ground.
    rep = report(Image.open(a.out), (left, top, left + product.width, top + product.height))
    rep["upscaled_by"] = round(k, 2)
    if k > 1.5:
        rep["note"] = "the product was enlarged more than 1.5x; upscale the cut-out on Magnific (images_upscale) before this step for a sharper result"
    return {"wrote": a.out, **rep}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("measure")
    m.add_argument("image")
    f = sub.add_parser("frame")
    f.add_argument("photo")
    f.add_argument("out")
    f.add_argument("--size", type=side_px(0), default=0, help="resize the square crop to this many pixels (0 keeps the crop size)")
    w = sub.add_parser("white")
    w.add_argument("cutout")
    w.add_argument("out")
    w.add_argument("--size", type=side_px(1), default=2000)
    for s in (m, f, w):
        s.add_argument("--threshold", type=colour_distance, default=12, help="colour distance from the backdrop that counts as product")
    for s in (f, w):
        s.add_argument("--fill", type=fill_share, default=0.85, help="share of the square the product's longer side fills")
    a = p.parse_args()
    print(json.dumps({"measure": cmd_measure, "frame": cmd_frame, "white": cmd_white}[a.cmd](a)))


if __name__ == "__main__":
    main()
