# Retouching

Picture and sound fixes on one existing file with ffmpeg.

Every retouch is judged visually, so the acceptance rule is the same throughout: extract frames at the **same timestamps** from the source and the result (`video_observe` on both with the same `start_s`/`end_s` and `num_frames`, or `layout="frames"`), compare them at viewing size, and check consecutive frames or playback where the change involves motion. Follow the general conventions in [SKILL.md](../SKILL.md#shared-conventions): confirm each filter exists in this ffmpeg build, write a new file, keep the command.

## Color Grade and Filter Looks

Decide the look from the request or a reference frame, then adjust in small steps and compare.

- **Basic correction:** `eq=brightness=0.04:contrast=1.08:saturation=1.15:gamma=1.0`.
- **Curves:** `curves=preset=increase_contrast` (also `lighter`, `darker`, `vintage`, `negative`, `strong_contrast`, `linear_contrast`, `medium_contrast`), or explicit points `curves=r='0/0 0.5/0.55 1/1':b='0/0 0.5/0.45 1/1'`.
- **Warm or cool:** `colortemperature=temperature=5000` (lower is warmer) where available, otherwise `colorbalance=rs=0.08:gs=0.0:bs=-0.08` (shadows `s`, midtones `m`, highlights `h`).
- **LUT:** `lut3d=file=look.cube` with a `.cube` LUT the user supplies or that you generate and keep with the output.
- **Black and white, sepia:** `hue=s=0`; sepia via `colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131`.
- **Vignette, grain:** `vignette=PI/5`, `noise=alls=8:allf=t`.
- **Match a reference clip:** compare a neutral area (skin, gray wall, sky) between frames of both and adjust balance until close; do not claim an exact match.

Check before/after on skin tones, highlights (clipping to white) and shadows (crushing to black), in at least three different scenes of the clip. Keep the grade consistent across cuts unless the user wants per-scene looks.

## Denoise and Sharpen

**Video noise:**

- `hqdn3d=4:3:6:4.5`: fast, general; raise values for heavier noise, at the cost of smearing fine detail.
- `nlmeans=s=3:p=7:r=15`: better detail preservation, much slower; try it on a short range first.
- `atadenoise`, `bm3d` (if present): alternatives when the above are not enough.

**Sharpen:** `unsharp=5:5:0.8:5:5:0.0`, or `cas=0.5` where available. Sharpening raises noise and halos; denoise first, sharpen lightly.

**Audio noise:**

- `afftdn=nr=12:nf=-40`: steady background hiss or hum.
- `highpass=f=80` removes rumble, `lowpass=f=12000` removes high hiss.
- `anlmdn` (if present): stronger, slower.
- These reduce steady noise; they do not remove music, crowds or other speakers (that is source separation, below).

Check: before/after frames at 100% in dark and flat areas (noise) and on edges and faces (smearing, halos). For audio, listen when possible; otherwise compare the noise floor in a silent stretch (`astats` or `volumedetect` on that range) and mark the result as not listened to.

## Stabilization

Two passes with vid.stab when the build has it (`vidstabdetect` and `vidstabtransform` in `ffmpeg -filters`):

`ffmpeg -i in.mp4 -vf vidstabdetect=shakiness=6:accuracy=15:result=transforms.trf -f null -`
`ffmpeg -i in.mp4 -vf vidstabtransform=input=transforms.trf:smoothing=20:zoom=0:optzoom=1,unsharp=5:5:0.8:3:3:0.4 -c:a copy out.mp4`

- `smoothing` sets how much camera motion is kept (higher removes more); `optzoom=1` zooms just enough to hide moving borders, which crops the edges.
- The `.trf` path should have no spaces or colons (a Windows drive letter such as `C:` breaks filter option parsing); run from the output directory with a relative name.
- Without vid.stab, `deshake` is a weaker one-pass fallback; say which was used.
- Intentional camera moves (pans, follows) should survive. Check consecutive frames in the shakiest window and in a deliberate pan, and look for wobble (rolling-shutter jello is not corrected).

## Deinterlace and Other Repairs

- Combing lines on motion (interlaced source): `bwdif=mode=send_field` or `yadif`.
- Flicker in timelapses: `deflicker=size=5`.
- Wrong range or washed-out color after conversion: check `color_range` in metadata; `scale=in_range=full:out_range=limited` or the reverse.
