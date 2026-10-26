# Photo card — command reference and acceptance numbers

Companion to [../SKILL.md](../SKILL.md). Everything here is invoked by path; nothing writes into this
skill directory.

## Scripts and their parameters

| Script | Usage | Notes |
|---|---|---|
| `ocr_boxes.ps1` | `-img <path>` | Windows OCR, prints `BOX x0 y0 x1 y1 \| text` per line. Use it to locate a watermark instead of guessing. Windows-only. |
| `remove_watermark.py` | `<photo> x0 y0 x1 y1 <out.jpg> [margin]` | Fills only that box, full resolution, nothing else touched. `margin` (default 16) is the strip borrowed for the grain overlay. |
| `prepare_card_layers.py` | `<photo> <out_dir> [x0 y0 x1 y1] [--native]` | Writes the four layers. The four numbers are the watermark box in **source** coordinates; `--native` keeps the photo's own canvas (long edge capped near 2400 px) instead of cropping to a fixed ratio. |
| `render_anim.py` | `blender --background --python render_anim.py -- <project> <out_dir> [sway] [native] [clean] [still]` | Stretches the scene's 96-frame cycle to 240 frames (10 s @ 24 fps). `sway` scales the rotation amplitude (1.8 for portraits, 2.2 for tighter framings — anything between reads well). `clean` = photo-accurate colours. `still` = one frame. |
| `encode_mp4.py` | `<frames_dir> <out.mp4> [fps] [width]` | Streams frames to the encoder; `width 0` keeps the canvas size. |
| `encode_wx_gif.py` | `<frames_dir> <out.gif> [target_mb] [fps] [out.mp4]` | Walks a width/frame-step/colour ladder and stops at the first rung under `target_mb` (default 9). Pass the fifth argument to also emit the small MP4 next to it. |

## Order matters

1. Watermark the **original** first, then derive everything from that cleaned file. Doing it the other way
   round means editing two things twice, and the "clean original" deliverable drifts from the layers.
2. Layers before the scene: `run_pipeline.py` validates the four PNGs (equal canvas, real alpha on
   subject/text, dark contours on white for lineart) and refuses to build a card from broken ones.
3. Render before encoding; the encoders read a frames directory.

## Acceptance numbers (measure, do not eyeball)

| Check | Target |
|---|---|
| Composite (background ⊕ subject) vs the original photo, outside the watermark box | ≤0.5% of pixels differ by more than 25 levels, and those pixels sit inside the box |
| Rendered frame vs the photo in the same region | mean brightness within 5 levels |
| Watermark region, bright pixels (>200) in both the clean JPG and a rendered frame | 0 (the source photo has thousands) |
| WeChat GIF | under 10 MB **and** no wider than 1000 px |
| Full-size MP4 | the canvas size the layers were built at |

A vision model is a useful coarse filter, never the verdict: on these photo cards it reports watermarks
that pixel counting shows are gone. Count pixels first.

## Pitfalls that shaped these scripts

- **Colour-extended cutouts paint over the photo.** Extending the subject's RGB into transparent areas
  smears the nearest opaque colour (skin, usually) across whatever the matte enclosed — a bench inside a
  woman's silhouette came out skin-toned. The layers therefore keep the photo's own pixels and take the
  erased mask as alpha: plate + cutout reassemble the photo exactly.
- **A harmonic fill follows the wrong boundary.** A Laplace-family inpaint in a watermark box that
  straddles a brightness gradient picks one side and leaves a visible patch; blending each column
  linearly between the rows just above and below, then adding back the neighbouring grain as zero-mean
  detail, reproduces the gradient by construction.
- **Low-confidence alpha eats limbs.** Dark, low-contrast legs get 40–70 alpha from rembg; thresholding
  that naively leaves them semi-transparent. The matte is grown by hysteresis from a confident core and
  filled solid inside, so connected limbs become opaque while disconnected faint leaks stay out.
- **The metallic finish brightens everything.** A lit Principled BSDF adds its ~4% dielectric specular
  under the scene's 2100 W lamps, which reads as washed-out. `clean` drives the artwork by emission,
  sets the view transform to Standard and switches the specular off.
- **WeChat's limits are hard.** Over 10 MB or 1000 px, the animation is delivered as a file the phone
  will not preview — which is how a 76 MB GIF "could not be opened". Send the MP4 when quality matters;
  it is roughly 20× cheaper per second.

## Desktop-side steps deliberately left to the caller

Per-card tables (which photo, which watermark box, which sway), where deliverables are copied, retry
behaviour when a player holds a file open, and any local quality ladder tuning are workflow decisions of
the project using this skill. The scripts here take parameters so that those decisions stay outside.
