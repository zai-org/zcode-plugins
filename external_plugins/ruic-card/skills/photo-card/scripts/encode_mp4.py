# Part of the ruic-card plugin (photo-card skill). MIT License - see the plugin's LICENSE.
"""Encode the rendered frames into a full-resolution MP4, one frame at a time.

The native canvases are up to 1600x2400; holding 240 of those in memory at once needs ~3 GB,
so frames are streamed to the encoder instead of listed.

usage: encode_mp4.py <frames_dir> <out.mp4> [fps] [scale_width]
"""
import glob
import os
import sys

from PIL import Image
import imageio.v2 as imageio

FRAMES_DIR, MP4 = sys.argv[1], sys.argv[2]
FPS = float(sys.argv[3]) if len(sys.argv) > 3 else 24.0
WIDTH = int(sys.argv[4]) if len(sys.argv) > 4 else 0     # 0 = native size

files = sorted(glob.glob(os.path.join(FRAMES_DIR, "frame_*.png")))
if not files:
    sys.exit("no frames in " + FRAMES_DIR)
w0, h0 = Image.open(files[0]).size
if WIDTH:
    h0, w0 = int(round(WIDTH * h0 / w0 / 2) * 2), WIDTH

writer = imageio.get_writer(MP4, fps=FPS, codec="libx264", quality=9,
                            pixelformat="yuv420p", macro_block_size=1)
for f in files:
    im = Image.open(f).convert("RGB")
    if (im.width, im.height) != (w0, h0):
        im = im.resize((w0, h0), Image.LANCZOS)
    writer.append_data(__import__("numpy").asarray(im))
writer.close()
print("mp4 %.1f MB  %s  %dx%d  %d frames (%.1f s)" % (
    os.path.getsize(MP4) / 1e6, MP4, w0, h0, len(files), len(files) / FPS))
