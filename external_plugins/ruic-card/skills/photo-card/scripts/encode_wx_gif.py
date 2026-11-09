# Part of the ruic-card plugin (photo-card skill). MIT License - see the plugin's LICENSE.
"""Encode a WeChat-sendable GIF (plus a small MP4) from the rendered frames.

WeChat rejects an animated image over 10 MB or wider than 1000 px - it goes out as a plain
file the phone then cannot preview, which is what happened to the 76 MB full-quality GIFs.
A photographic 10-second animation costs ~0.38 bytes per pixel-frame in GIF, so this walks a
width/frame-step ladder from the best rung that can fit and stops at the first one under the
budget: the sharpest file WeChat will still accept. The MP4 next to it is 20x cheaper and is
the one to send when quality matters.

usage: encode_wx_gif.py <frames_dir> <out.gif> [target_MB] [fps] [out_mp4]
"""
import glob
import os
import sys

import numpy as np
from PIL import Image
import imageio.v2 as imageio

FRAMES_DIR, GIF = sys.argv[1], sys.argv[2]
TARGET = float(sys.argv[3]) * 1e6 if len(sys.argv) > 3 else 9e6
FPS = float(sys.argv[4]) if len(sys.argv) > 4 else 24.0
MP4 = sys.argv[5] if len(sys.argv) > 5 else None

files = sorted(glob.glob(os.path.join(FRAMES_DIR, "frame_*.png")))
if not files:
    sys.exit("no frames in " + FRAMES_DIR)
src_w, src_h = Image.open(files[0]).size
print("source %dx%d, %d frames" % (src_w, src_h, len(files)), flush=True)

# (width, keep every nth frame, palette colours) - biggest first, all rungs <= 1000 px wide.
# 8 fps (step 3) beats a bigger image at 6 fps for a sway animation, so the small rungs keep it.
LADDER = [(640, 3, 160), (600, 3, 160), (560, 3, 160), (520, 3, 128), (480, 3, 128),
          (440, 3, 96), (420, 3, 96), (400, 3, 96), (360, 4, 64), (320, 4, 64)]


def build(width, step, colors):
    h = int(round(width * src_h / src_w / 2) * 2)
    out = []
    for i, f in enumerate(files):
        if i % step:
            continue
        out.append(Image.open(f).convert("RGB").resize((width, h), Image.LANCZOS))
    # One shared palette for the whole clip: per-frame adaptive palettes both bloat the file
    # (each frame ships its own 768-byte table) and make the colours crawl between frames.
    # Sampled from every ~10th frame - quantising all 120 at once costs minutes for no
    # visible palette gain.
    samples = out[::max(1, len(out) // 10)]
    montage = Image.new("RGB", (width, h * len(samples)))
    for k, im in enumerate(samples):
        montage.paste(im, (0, k * h))
    pal = montage.quantize(colors=colors, method=Image.MEDIANCUT)
    return [im.quantize(palette=pal, dither=Image.NONE) for im in out], h


best = None
for width, step, colors in LADDER:
    frames, h = build(width, step, colors)
    dur = max(1, int(round(1000.0 / (FPS / step))))
    frames[0].save(GIF, save_all=True, append_images=frames[1:], duration=dur, loop=0,
                   optimize=True, disposal=2)
    size = os.path.getsize(GIF)
    print("  try %4dx%-4d step %d (%.1f fps) colors %3d -> %5.2f MB  (%d frames)" % (
        width, h, step, FPS / step, colors, size / 1e6, len(frames)), flush=True)
    if size <= TARGET:
        best = (width, h, size, len(frames), dur)
        break
if best:
    print("gif %.2f MB  %s  %dx%d  %d frames @%.1f fps" % (
        best[2] / 1e6, GIF, best[0], best[1], best[3], 1000.0 / best[4]), flush=True)
else:
    print("gif %.2f MB  %s (ladder exhausted, smallest kept)" % (os.path.getsize(GIF) / 1e6, GIF), flush=True)

if MP4:
    w = 720
    h = int(round(w * src_h / src_w / 2) * 2)
    arr = [np.array(Image.open(f).convert("RGB").resize((w, h), Image.LANCZOS)) for f in files]
    imageio.mimsave(MP4, arr, fps=FPS, codec="libx264", quality=7, pixelformat="yuv420p",
                    macro_block_size=1)
    print("mp4 %.2f MB  %s  %dx%d  %d frames" % (os.path.getsize(MP4) / 1e6, MP4, w, h, len(files)), flush=True)
