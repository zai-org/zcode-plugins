---
name: photo-card
description: Turn a photo the user already has into a 3D holographic card — cut the subject into the four card layers with rembg, optionally erase a watermark from the original, build the card with the ruic-card pipeline, render a 10-second animation and encode MP4 / WeChat-sized GIF deliverables. Use when the user brings a photo, screenshot or scan and asks for 全息闪卡, 照片转闪卡, 把照片做成卡, 去水印, 卡片动图, a holographic card from my photo, or an animated card video. Use the ruic-card skill instead when the artwork has to be generated from a text description.
---

# Photo card

The `ruic-card` skill paints four layers from a description. This skill derives the same four layers
from a photo the user already has: deterministic, no image model, and the photo's own pixels end up in
the card. Everything downstream — scene, materials, viewer — is the ruic-card pipeline, unchanged.

Reach for it whenever the input is a photograph rather than a prompt: a portrait, a pet, a product shot,
a cosplay photo, a screenshot with a watermark in the corner.

## Working sequence

1. **Look at the photo before touching it.** Note the pixel size, whether the subject touches the frame
   edge, and whether there is a watermark (a platform handle or account id in a corner). State the card
   canvas you will use — the photo's own size, long edge capped at about 2400 px — and get the subject
   and title from the user.
2. **Watermark first, on the original.** Locate the box, then erase it before any other step, so the
   layers and the standalone "clean original" both come from the same corrected file:
   `scripts/ocr_boxes.ps1 -img <photo>` prints `BOX x0 y0 x1 y1 | text` lines (Windows OCR);
   `scripts/remove_watermark.py <photo> x0 y0 x1 y1 <out.jpg> [margin]` fills that box.
   Skip this step when there is no watermark — and never guess the box.
3. **Cut the four layers.** `scripts/prepare_card_layers.py <photo> <out_dir> [x0 y0 x1 y1] [--native]`
   writes `subject.png`, `background.png`, `lineart.png`, `text.png` on one shared canvas. Pass the same
   watermark box as in step 2 so the floating cutout and the plate agree pixel for pixel.
4. **Build the card** with the ruic-card skill: write `card-config.json` for the output project, then run
   `../ruic-card/scripts/run_pipeline.py --project <project> --skip-render` (it validates the layers,
   installs the portable Blender, builds `card.blend`, exports the GLB and assembles the viewer).
5. **Render the animation.** With Blender:
   `blender --background --python scripts/render_anim.py -- <project> <out_dir> <sway> native clean`
   — 240 frames at 24 fps (10 s), `clean` keeps the photo's own colours (no foil, no gold trim, no star
   flecks). Add `still` to render a single frame for a quick look.
6. **Encode what the destination needs.** `scripts/encode_mp4.py <frames_dir> <out.mp4> [fps] [width]`
   for the full-size file; `scripts/encode_wx_gif.py <frames_dir> <out.gif> [target_mb] [fps] [out.mp4]`
   for a WeChat-sendable pair. Hand over the URL, `card.blend`, the four layers and the video files.
7. **Verify by measurement, not by eye.** See [references/photo-card.md](references/photo-card.md) for the
   acceptance numbers — composite vs original difference confined to the watermark box, render brightness
   within a few levels of the photo, no bright watermark pixels left in either.

## What stays with the caller

The scripts take paths and parameters; they do not decide where deliverables go and they carry no
per-project settings. Per-card tables (which photo, which watermark box, how much sway), the desktop
delivery step and the local tuning live in the caller's own project, not in this skill.

## Invariants worth remembering

- **The subject layer is the photo's own pixels.** Its alpha is exactly the erased region; the RGB is
  never colour-extended. Plate plus cutout must reassemble the photo, or the card shows a fake rim.
- **Watermark boxes must come from OCR or the user's own coordinates.** A guessed box erases real
  content and leaves the watermark in place.
- **A low-confidence matte hides limbs.** rembg returns 40–70 alpha on dark, low-contrast legs; the
  script grows a hysteresis matte and fills the interior so limbs stay opaque.
- **`clean` is the default for photos.** Without it the metallic finish and lamp lighting push the whole
  frame 15–75 levels brighter than the photo.
- **WeChat caps an animated image at 10 MB and 1000 px wide.** Over either limit it is sent as a plain
  file the phone cannot preview; a photographic second costs about 0.38 bytes per pixel-frame in GIF, so
  the encoder walks a quality ladder down to the best rung that fits.

## Requirements

Python 3 with Pillow, numpy, scipy and rembg (which brings onnxruntime and downloads its segmentation
model on first use), Node.js with npm, and Blender — not installed by the user: the ruic-card pipeline
downloads an official portable copy into the output project. The watermark locator `ocr_boxes.ps1` uses
Windows OCR and is therefore Windows-only; on other platforms pass the box by hand. Full dependency,
network and licence notes are in the plugin's README.
