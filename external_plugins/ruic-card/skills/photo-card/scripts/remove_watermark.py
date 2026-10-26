# Part of the ruic-card plugin (photo-card skill). MIT License - see the plugin's LICENSE.
"""Remove the watermark from the ORIGINAL photo, full resolution, nothing else touched.

The box usually straddles a brightness gradient (pavement/wall), and a Laplace-family fill
follows the wrong boundary and leaves a visible dark patch. So each column is linearly blended
between the rows just above and just below the box - which reproduces the local gradient by
construction - and the neighbouring grain goes back on top as zero-mean detail so the patch is
not unnaturally smooth.

usage: remove_watermark.py <image> <x0 y0 x1 y1> <out.jpg> [margin]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = Path(sys.argv[1])
x0, y0, x1, y1 = [int(v) for v in sys.argv[2:6]]
OUT = Path(sys.argv[6])
MARGIN = int(sys.argv[7]) if len(sys.argv) > 7 else 16

img = np.array(Image.open(SRC).convert("RGB")).astype(np.float32)
H, W, _ = img.shape
x0, y0 = max(0, x0 - MARGIN), max(0, y0 - MARGIN)
x1, y1 = min(W, x1 + MARGIN), min(H, y1 + MARGIN)
band, wide = y1 - y0, x1 - x0

# boundary rows: the SINGLE row adjacent to the box (averaging several rows offsets the fill's
# ends from the pixels they must join, which left a 10-level step), blurred along x only so the
# fill cannot paint per-column streaks
top = ndimage.gaussian_filter1d(img[max(0, y0 - 1), x0:x1], 10.0, axis=0)
bot = ndimage.gaussian_filter1d(img[min(H - 1, y1), x0:x1], 10.0, axis=0)
ramp = np.linspace(0.0, 1.0, band, dtype=np.float32)[:, None, None]
fill = top[None, :, :] * (1 - ramp) + bot[None, :, :] * ramp

# grain: zero-mean high-frequency detail borrowed from the strip above, amplitude capped so it
# cannot manufacture bright specks on a mid-grey pavement
strip = img[max(0, y0 - band):y0, x0:x1][::-1]
grain = strip - ndimage.gaussian_filter(strip, (5, 5, 0))
grain = np.clip(grain, -14, 14)
fill = fill + grain[:band]

out = img.copy()
out[y0:y1, x0:x1] = fill
Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(OUT, quality=97)
print("watermark box %s filled (gradient blend + grain) -> %s (%.2f MB, %dx%d)" % (
    (x0, y0, x1, y1), OUT, OUT.stat().st_size / 1e6, W, H))
