# Part of the ruic-card plugin (photo-card skill). MIT License - see the plugin's LICENSE.
"""Build the four card layers from a photo as a REAL 4:3 crop - zero fabrication.

The card canvas is a crop window over the original photo at 1:1 pixels (no resampling,
no side extensions, no blur). The only synthesis left is erasing the subject from the
background (a harmonic/Laplace fill with the surroundings' high-frequency detail put
back), so the floating cutout never shows a second copy of her when the card tilts.

usage: prepare_card_layers.py <source> <out_dir> [watermark_x0 y0 x1 y1]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from rembg import new_session, remove

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
_nums = [int(v) for v in sys.argv[3:] if v.lstrip("-").isdigit()]
WM = tuple(_nums[:4]) if len(_nums) >= 4 else None   # flags like --native may sit anywhere
OUT.mkdir(parents=True, exist_ok=True)

photo_im = Image.open(SRC).convert("RGB")
SW, SH = photo_im.size

# The segmentation is deterministic, so cache it next to the assets: re-running the layer
# build (tuning, retries) must not pay for rembg again.
import hashlib  # noqa: E402
CACHE = OUT / ("_rembg_" + hashlib.sha1((str(SRC.resolve()) + str(SRC.stat().st_mtime) + str(SRC.stat().st_size)).encode()).hexdigest()[:10] + ".npz")
if CACHE.exists():
    z = np.load(CACHE)
    ra, rr = z["alpha"], z["rgb"]
    raw = Image.fromarray(np.dstack([rr, ra]), "RGBA")
    print("rembg cache hit:", CACHE.name)
else:
    raw = remove(photo_im, session=new_session("isnet-general-use"), alpha_matting=False)
    ra = np.array(raw.getchannel("A"))
    np.savez_compressed(CACHE, alpha=ra, rgb=np.array(raw.convert("RGB")))
    print("rembg done, cached:", CACHE.name)

# trust only the person's core (alpha>=64, big blobs) - isnet leaks faint alpha over
# furniture, which would otherwise become a translucent ghost in the cutout
core = ra >= 64
lab, n = ndimage.label(core)
if n:
    sizes = ndimage.sum(core, lab, range(1, n + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s >= 0.02 * sizes.max()]
    core = np.isin(lab, keep)
    print("core blobs: %d -> kept %d" % (n, len(keep)))
# isnet is sure about the torso but only ~50% sure about dark legs and low-contrast limbs, and
# its own alpha would draw those at ~20% opacity - the limbs read as missing. So grow the core
# through every faint region it touches (hysteresis): the limbs hang off the body and turn
# solid, while the isolated faint leaks over furniture have no such connection and stay out.
person = ndimage.binary_propagation(core, mask=ra >= 24)
person = ndimage.binary_closing(person, structure=np.ones((3, 3)), iterations=2)
print("person mask covers %.1f%% of source" % (100 * person.mean()))

any_ = person
ys, xs = np.where(any_)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
fig_h = y1 - y0 + 1
print("subject bbox x[%d..%d] y[%d..%d] fig_h=%d (source %dx%d)" % (x0, x1, y0, y1, fig_h, SW, SH))

# ---- canvas: native mode keeps the whole photo; otherwise a 4:3 crop window, 1:1 ----
NATIVE = "--native" in sys.argv
if NATIVE:
    CAP = 2400
    sc = min(1.0, CAP / max(SW, SH))
    CW, CH = int(round(SW * sc / 2) * 2), int(round(SH * sc / 2) * 2)
    wx = wy = 0
    print("native canvas %dx%d - whole photo, no crop (x%.3f)" % (CW, CH, sc))
else:
    sc = 1.0
    if SW / SH <= 4 / 3:                    # portrait-ish source: crop vertically
        CW, CH = SW, int(round(SW * 3 / 4 / 2) * 2)
        headroom = min(160, max(100, (CH - min(fig_h, CH)) // 2))
        wx, wy = 0, min(max(y0 - headroom, 0), SH - CH)
    else:                                   # landscape-ish source: crop horizontally
        CW, CH = int(round(SH * 4 / 3 / 2) * 2), SH
        cx = (x0 + x1) // 2
        wx, wy = min(max(cx - CW // 2, 0), SW - CW), 0
    print("crop window %dx%d at (%d,%d) - 100%% original pixels, no sides fabricated" % (CW, CH, wx, wy))

if NATIVE and sc < 1.0:                     # whole photo, uniformly scaled to fit the cap
    sc_photo = photo_im.resize((CW, CH), Image.LANCZOS)
    sc_alpha = Image.fromarray(ra).resize((CW, CH), Image.LANCZOS)
else:
    sc_photo = photo_im.crop((wx, wy, wx + CW, wy + CH))
    sc_alpha = Image.fromarray(ra).crop((wx, wy, wx + CW, wy + CH))
per_s = np.array(Image.fromarray((person * 255).astype(np.uint8)).resize((CW, CH), Image.LANCZOS)) > 8 \
    if (NATIVE and sc < 1.0) else person[wy:wy + CH, wx:wx + CW]
x_off = y_off = 0

# ---------------- background: the crop with the subject + watermark erased ----------------
# The hole follows the silhouette so the cutout's fill can never show through, but only the
# CONFIDENT part of it (alpha >= 40): where the segmenter was unsure, the photo's own pixels
# stay on the plate. A structure it wrongly grew the mask into (a railing slat, a sword
# highlight) is then never erased and left as a smear - card 1's railing opening lost the
# trees behind it that way, while the confident silhouette still guarantees no ghost of her.
hole = per_s & (np.array(sc_alpha) >= 40)
if WM:
    bx0, by0 = int(round((WM[0] - wx) * sc)), int(round((WM[1] - wy) * sc))
    bx1, by1 = int(round((WM[2] - wx) * sc)), int(round((WM[3] - wy) * sc))
    bx0, bx1, by0, by1 = max(0, bx0), min(CW, bx1), max(0, by0), min(CH, by1)
    hole[by0:by1, bx0:bx1] = True
    print("watermark erased at canvas (%d,%d)-(%d,%d)" % (bx0, by0, bx1, by1))
hole = ndimage.binary_dilation(hole, iterations=3)   # a 3px collar hides the fill's seam
known = (~hole).astype(np.float32)
print("erase hole covers %.1f%% of canvas" % (100 * hole.mean()))


def avg4(a):
    acc = np.zeros_like(a); cnt = np.zeros(a.shape[:2], np.float32)
    acc[1:] += a[:-1]; cnt[1:] += 1
    acc[:-1] += a[1:]; cnt[:-1] += 1
    acc[:, 1:] += a[:, :-1]; cnt[:, 1:] += 1
    acc[:, :-1] += a[:, 1:]; cnt[:, :-1] += 1
    return acc / cnt[..., None]


base = np.array(sc_photo).astype(np.float32)
# Solve on a half-resolution copy: the fill is a smooth interpolation, so the fine scale
# carries no information, and the full-res solve costs 4x the memory (the machine was
# paging under it). Full-resolution detail is added back below from the real pixels.
base_s = ndimage.zoom(base, (0.5, 0.5, 1), order=1)
known_s = np.clip(ndimage.zoom(known, 0.5, order=1), 0, 1)
ims, masks, im, m = [], [], base_s * known_s[..., None], known_s.copy()
for _ in range(7):
    if min(m.shape[:2]) < 24:
        break
    ims.append(im); masks.append(m)
    im = ndimage.zoom(im, (0.5, 0.5, 1), order=1); m = ndimage.zoom(m, 0.5, order=1)
filled = im / np.maximum(m, 1e-6)[..., None]
for i in range(len(ims) - 1, -1, -1):
    t = ims[i].shape[:2]
    if filled.shape[:2] != t:
        filled = ndimage.zoom(filled, (t[0] / filled.shape[0], t[1] / filled.shape[1], 1), order=1)
    for _ in range(20):
        filled = avg4(filled)
    filled = ims[i] + (1.0 - np.clip(masks[i], 0, 1)[..., None]) * filled
filled = ndimage.zoom(filled, (base.shape[0] / filled.shape[0], base.shape[1] / filled.shape[1], 1), order=1)
soft = np.array(Image.fromarray(filled.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(8))).astype(np.float32)
soft += np.random.default_rng(7).normal(0, 1.8, soft.shape).astype(np.float32)
# Put the surroundings' texture back: a pure harmonic fill erases foliage grain and reads
# as a smeared patch. Zero-mean high-frequency detail borrowed from the nearest real pixel
# restores grain without reintroducing the Voronoi colour blocks of nearest-neighbour fill.
detail = base - ndimage.gaussian_filter(base, (6, 6, 0))
didx = ndimage.distance_transform_edt(hole, return_distances=False, return_indices=True)
soft = soft + detail[tuple(didx)] * hole[..., None]
feather = np.array(Image.fromarray((hole * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(12))).astype(np.float32)[..., None] / 255.0
out = base * (1 - feather) + soft * feather
# (Tried mirroring the strips above/below into the watermark box to give it "texture": the
# pavement's own detail there is only 2.5-10 (|laplace|) against the fill's 8.7, so the fill was
# already in range, and the mirror left a 14-level step at the far edge. Harmonic fill stays.)

lum = out @ np.array([0.299, 0.587, 0.114], dtype=np.float32)


def _dilate(mask, r):        # quarter-scale binary dilation: PIL's MaxFilter is O(n*r^2)
    s = ndimage.zoom(mask.astype(np.float32), 0.25, order=0) > 0.5
    s = ndimage.binary_dilation(s, iterations=max(1, int(round(r * 0.25))))
    return ndimage.zoom(s.astype(np.float32), (mask.shape[0] / s.shape[0], mask.shape[1] / s.shape[1]), order=0) > 0.5


ring = _dilate(hole, 15) & ~hole
far = ~_dilate(hole, 120)
print("ring luminance %.1f vs far %.1f (delta %+.1f)" % (lum[ring].mean(), lum[far].mean(), lum[ring].mean() - lum[far].mean()))
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(OUT / "background.png")

# ---------------- subject: cutout drawn from the photo's own pixels ----------------
# plate + cutout must reassemble into the original photo pixel for pixel, so the cutout keeps
# the photo's own colours and is opaque exactly where the plate was erased. The previous
# edge-extension (nearest pixel with alpha>=140) was what ate the bench: with the silhouette
# covering the wood between her calves, that wood got painted over with her nearest skin tone.
sa = np.array(sc_alpha)
sc_rgb = np.array(sc_photo).astype(np.float32)
alpha = (per_s * 255).astype(np.uint8)
alpha = np.array(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1.0)))
subj = Image.fromarray(np.dstack([sc_rgb.clip(0, 255).astype(np.uint8), alpha]), "RGBA")
subj.save(OUT / "subject.png")
fa = np.array(subj.getchannel("A"))
print("subject: solid=%.3f transparent=%.3f" % ((fa >= 128).mean(), (fa < 16).mean()))
if not (0.001 < (fa >= 128).mean() < 0.99):
    sys.exit("subject alpha degenerate")

# ---------------- lineart: ink-free except a corner seal; text: empty ----------------
la = Image.new("RGB", (CW, CH), (255, 255, 255))
d = ImageDraw.Draw(la)
sx, sy = 90, CH - 260
d.rounded_rectangle([sx, sy, sx + 96, sy + 96], radius=12, outline=(30, 30, 30), width=6)
d.ellipse([sx + 28, sy + 28, sx + 68, sy + 68], outline=(30, 30, 30), width=5)
d.line([sx + 34, sy + 52, sx + 62, sy + 52], fill=(30, 30, 30), width=5)
d.line([sx + 48, sy + 34, sx + 48, sy + 62], fill=(30, 30, 30), width=5)
la.save(OUT / "lineart.png")
Image.new("RGBA", (CW, CH), (0, 0, 0, 0)).save(OUT / "text.png")

for nm in ("subject", "background", "lineart", "text"):
    p = OUT / (nm + ".png")
    with Image.open(p) as im2:
        print("  %-11s %s %s  %.1f MB" % (nm, im2.size, im2.mode, p.stat().st_size / 1e6))
print("LAYERS_DONE")
