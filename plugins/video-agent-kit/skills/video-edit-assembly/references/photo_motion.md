# Stable Photo Motion

Use a still hold when the photograph already gives the viewer enough to read and the user or reference does not require motion. A photograph does not need a push-in merely to count as edited. Preserve required reference motion; otherwise choose motion when it reveals a detail, guides attention or supports a deliberate change in energy. Keep group faces, important text and photo edges readable throughout; place titles on separate overlays when they should stay still.

## Render a Continuous Path

Small zooms are particularly sensitive to integer crop steps. A fractional zoom expression in `zoompan` does not guarantee fractional crop coordinates in the resulting pixels. Resizing a crop to a new rounded size every frame can also alternate between holds and jumps. A smaller zoom or a larger intermediate image alone is not evidence that motion is smooth.

For ordinary photo push-ins, pull-outs and pans, use the bundled [photo_motion.py](../scripts/photo_motion.py). It samples every frame from one fixed canvas with floating-point coordinates, renders at twice the output dimensions and downsamples. It does not repeatedly crop, resize or transform the previous frame. Use a different implementation only after verifying its temporal behavior on the actual output.

Resolve `scripts/photo_motion.py` relative to this skill directory. This example produces a four-second, centered push-in; choose the duration and framing for the photograph, and match the timeline dimensions and frame rate:

```bash
python3 -B scripts/photo_motion.py --input photo.jpg --output photo_motion.mp4 \
  --width 1280 --height 720 --fps 30 --duration 4 \
  --start-zoom 1 --end-zoom 1.03
```

- Exchange `--start-zoom` and `--end-zoom` for a pull-out. Both must be at least 1. With both at 1, the result is still.
- `--start-x`, `--end-x`, `--start-y`, `--end-y` select fractions of the available crop: 0 is left/top, 1 is right/bottom, and 0.5 is centered. A pan needs zoom above 1 to have space to move. Values must stay between 0 and 1.
- `--fit contain` preserves the source aspect within the canvas, using `--background` for uncovered space. `--fit cover` fills the canvas by cropping. The subsequent zoom can crop either canvas: use a static hold or compose margins first when the whole photograph must remain visible.
- A composed photo card can be the input. Keep text that should not move outside that card. The script handles still-image orientation metadata and transparency, but does not add detail to low-resolution photographs.
- `--fps` accepts fractions such as `30000/1001`. Duration is rounded to the nearest frame; the `.photo_motion.json` sidecar records the actual duration, frame count, settings and source/output/script hashes. Use those actual bounds in the timeline, normally at `speed: 1`.
- Output dimensions must be positive even integers. Input must be a single still image. Existing output or provenance files are not overwritten; choose a new name for a revision.

## Composite Motion Over a Fixed Layout

`photo_motion.py` moves the camera over one photograph. A reference that moves the *photograph itself* over a fixed layout — a product enlarged over a rating table, then shrinking into its tier slot; a card sliding into a grid — needs a small compositor of your own, written to the same rules so it stays jitter-free:

- Compose every frame from one fixed canvas at 2x the output size and downsample once per frame; never crop/resize the previous frame.
- Keep the item's destination rectangle and source crop as floating-point values and draw with a single inverse affine map (PIL `Image.transform(..., AFFINE)`); round nothing per frame. Drawing the fractional edge through an alpha mask avoids a 1 px crawl along the border.
- Pre-scale the photo once to the largest size it will be drawn at (and once more to the slot size for the parked thumbnails), so a zoomed-in crop is not upsampled from a shrunken copy.
- Ease position and scale together (one `smoothstep` over the shrink window keyed to the sentence that announces the verdict), and keep the layout underneath identical between segments so hard cuts between them are invisible.
- Record per clip what moved when (`push_in`, `shrink`, caption schedule) and the script hash in a provenance sidecar, then list those clips as derived assets in the timeline.

Check it the same way as a camera move, on the **final render**: the item's bounding-box width per output frame through the shrink must change monotonically with no sign flips, and the per-frame mean absolute difference inside the item's box across a push-in should trace one smooth bell (a hold-then-jump pattern shows as near-zero frames between large ones).

## Check Time, Not Just Composition

Check the derived clip and then the photograph's interval in the final render. A montage of widely spaced frames cannot expose high-frequency jitter.

- Inspect consecutive frames at the output frame rate in the beginning, middle and end of the motion, away from a dissolve when diagnosing the photo itself. Follow fixed features such as eyes, a frame border, a building edge or lettering: their positions should move continuously along the intended path, without alternating jumps or repeated holds followed by leaps.
- Use normal-speed playback when available. Otherwise report the narrower evidence from consecutive frames or feature tracking; do not claim a playback check happened.
- Compare intended zoom/pan with observed displacement. A centered zoom should not make the whole picture bounce sideways. Feature tracking can help distinguish camera-path jitter from local texture shimmer; fades and overlapping pictures must be excluded from such measurements.
- Check exact frame-rate agreement and speed in the timeline if a smooth derived clip becomes uneven after assembly. Inspect moving edges for shimmer and faces for readability as well as global displacement.
- Rebuild a faulty motion clip and render again. If smooth motion cannot be demonstrated, use a clear static photograph only when compatible with the task and reference; otherwise disclose the unresolved limitation rather than silently dropping required motion. Do not hide visible shake with blur, stabilization of the already faulty clip, a faster transition or reassuring delivery notes.

Technical `video_qc` checks do not currently measure photo-motion jitter. A technical pass and a few attractive stills do not satisfy this check.
