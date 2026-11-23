# Project Timeline, Rendering, Patching and QC Reference

This is the contract of `timeline_validate`, `timeline_patch`, `video_render(kind="timeline")` and `video_qc(kind="video")` for project timelines. Times are in seconds. Relative paths (sources, fonts) resolve against the project directory.

## Top level

```json
{"project": {...}, "sequence": {...}, "assets": [...], "tracks": [...], "markers": [...]}
```

`timeline_validate` reports an error unless all of these hold:

- `project` is a non-empty object, for example `{"task": "...", "assumptions": [...]}`. Free-form.
- `assets` is a non-empty array, and at least one entry has `path`, `source`, `input_path` or `src`.
- `sequence` (or a top-level `output_canvas`) is an object.
- `tracks` is a non-empty array that contains at least one video track.

A legacy top-level `clips[]` is not accepted, and neither is using `clips[]` together with `tracks[]`. `markers[]` is optional. Each marker needs `time` (or `start`) of at least 0 and an optional positive `duration`. A non-empty top-level `transitions[]` is rejected by both `timeline_validate` and `video_render`.

## Sequence (canvas, fps, duration)

| Field | Rule |
| --- | --- |
| `width`, `height` | Positive integers. Odd values are rounded down to even. Lookup order: `video_render` `output_width`+`output_height` args, then top-level `output_canvas{}`, `sequence.canvas{}`, `sequence.output_canvas{}`, `sequence.width/height`. If none is set, the canvas is the display size (after rotation) of the first video clip. |
| `fps` | Same lookup order. Default 30. Every clip is converted to this rate. |
| `duration` | Optional. If omitted, it is the latest end of all rendered clips (video, audio, text, overlay), so music that runs longer than the video adds a black tail. If set shorter than the content end, validation fails. If set longer, the tail is black and silent. |

Prefer setting the canvas in the timeline. `video_qc` compares the output resolution, fps and duration against the timeline; when the size came from `output_width`/`output_height`, it compares against that size instead.

## Assets

`assets[]` documents the materials: `id` (unique, non-empty), `source` (or `path`/`input_path`/`src`), and optional positive `duration`/`width`/`height`/`fps`. Other keys are allowed, so record provenance here, for example `"derived_from"`, `"source_range"`, `"process"`, `"license"` and `"attribution"`. A clip's `asset_id` must name an existing asset id. The renderer reads each clip's own `source`; asset entries do not substitute for it.

## Tracks

| Kind | Accepted `type` values (case-insensitive; `-` and spaces read as `_`) |
| --- | --- |
| Video | `video`, `main`, `primary`, `footage`, `source`, `v`, `v1`, `video_1`, `main_video`, `primary_video`, `source_video` |
| Audio | `audio`, `music`, `bgm`, `voiceover`, `narration`, `dialogue`, `sound`, `sfx`, `a`, `a1` |
| Text | `text`, `title`, `subtitle(s)`, `caption(s)`, `lower_third`, `chapter_card`, `callout` |
| Overlay | `overlay`, `image`, `graphic`, `sticker`, `logo`, `watermark`, `b_roll`, `broll` |

The type is read from `type`, then `track_type`, then `name`, so set `type` explicitly. An untyped or unknown track with clips fails validation ("track type is not rendered"); an empty one is only a warning. To keep such a track, disable it.

Track fields:

- `clips[]` (required)
- `order`: integer stacking order. Default is the array index; higher values draw on top.
- `enabled: false`: the track is skipped.
- `muted: true`: on an audio track, the track is skipped. On a video track, the clips' own audio is dropped.
- `visible: false`: on a video, text or overlay track, the track is skipped.
- `volume`, `opacity`: defaults for the track's clips.
- `effects[]`: if non-empty, render fails.

Stacking order: the black canvas, then all video-track clips (sorted by track order, then `timeline_start`), then all overlay clips (same sorting), then all text. Later layers cover earlier ones.

## Clip fields

Every clip needs a non-empty `reason`, otherwise validation fails. `beat` (section role) and any other keys are kept as metadata. `reason` is copied into `.edit_decisions.json` for every rendered clip, and `beat` for video-track clips.

| Field | Rule |
| --- | --- |
| `source` (`input_path`, `src`) | Must exist. Required for video, audio and overlay clips. Not used for text clips. |
| `start` (`start_time`, `in`) | Source in-point, at least 0. Required for video and audio clips. Still-image clips (the suffixes listed under Image clips; not `.gif`) and text clips default to 0. |
| `end` (`end_time`, `out`) or `duration` | Source out-point, or a length. If both are given they must agree within 0.05 s. The resolved `end` may not exceed the source duration by more than 0.05 s; still-image holds are exempt from this source-duration bound. |
| `speed` | Greater than 0, default 1. Output length = `(end - start) / speed`. Video is retimed (slow motion repeats frames). Audio uses pitch-preserving tempo. On a still image, speed only shortens the hold. |
| `timeline_start` (`position`) | Output position, at least 0. If omitted, the clip starts where the previous clip on the **same track** ends (the first one at 0). |
| `volume` | Linear gain of at least 0 (0.5 is about -6 dB). Uses the clip value, else the track value, else 1.0. Values are not multiplied together; `null` means unset. On video clips it applies to the clip's own audio. |
| `opacity` | 0 to 1. Same lookup as `volume`. Applies to video and overlay clips. |
| `muted`, `enabled`, `visible` | Booleans. `enabled: false` skips the clip. `muted: true` drops its audio (on a video clip the picture stays). `visible: false` hides a video, text or overlay clip. |
| `transition_in`, `transition_out` | See "Transitions". |
| `effects[]` | If non-empty, render fails. |

**Video track clips.** Each clip is scaled to fit inside the canvas with its aspect ratio kept and centered on black bars. Clips are never cropped or zoomed. Rotation metadata is honored (`video_metadata` reports the display size and `rotation`). Footage that was shot sideways *without* rotation metadata must be fixed by preprocessing (for example `transpose`). Clip `x`, `y` and `width` have no effect here; put positioned or picture-in-picture video on an overlay track. Each clip's last frame is held for about 3 frames (0.04 to 0.12 s) past its end to avoid flashes at cuts. Longer gaps between clips show the black canvas.

**Image clips.** A still on a video track (`.png .jpg .jpeg .webp .bmp .tif .tiff`) is held for its whole duration and fitted like video: `{"source": "photo.jpg", "start": 0, "duration": 3}`. A `.gif` loops; give it an explicit `start` (usually 0), since validation treats it as a video source. There is no built-in zoom, pan or Ken Burns: render purposeful motion into a derived video using [photo_motion.md](photo_motion.md), then check consecutive output frames for jitter. A static hold needs no motion preprocessing.

**Overlay clips.** These are images or videos drawn on top of the video tracks. `x`/`y` are numbers or overlay expressions using `W`/`H` (the canvas) and `w`/`h` (the layer), for example `"W-w-20"` or `"(H-h)/2"`. Both default to 0 (top-left). Give both `width` and `height` to scale the layer to fit inside that box; otherwise it is drawn at its native pixel size. A video overlay uses `start`/`end` and `speed`; a still is held for `duration`. `opacity` and fades apply. Overlay audio is not mixed.

**Text clips.** Text is burned in with drawtext. Use `text` for the content, `timeline_start` for the position and `duration` (or `timeline_end`) for the length. `start` is **not** an output time. Style keys can sit in `style{}` or at the top level of the clip; top-level keys win.

| Key (aliases) | Default | Notes |
| --- | --- | --- |
| `font_size` (`fontsize`) | `42` | Pixels on the canvas. Scale it to the canvas height (42 is large on 360p and small on 2160p). |
| `font_color` (`fontcolor`) | `white` | ffmpeg color, for example `yellow`, `#FFD700`, `white@0.9`. |
| `box_color` (`boxcolor`) | `black@0.55` | The box is always drawn, with a 14 px border. Use `black@0` to hide it. |
| `x` | `(w-text_w)/2` | Centered. Numbers or expressions over `w`, `h`, `text_w`, `text_h`. Allowed characters: letters, digits, `_ + - * / ( ) . , %` and space. Quotes and colons are rejected. `0` is valid. |
| `y` | `h-text_h-72` | 72 px above the bottom edge. |
| `font_file` | auto | Project-relative or absolute path. The render fails if the file is missing or lacks glyphs for the clip's text. |

Text renders literally: `100%` and similar strings are safe, and a `\n` in the JSON string makes a line break. Text clips cannot have transitions or animation; for animated text, prepare an image or video overlay. Without `font_file`, one font is chosen for all such text: fonts from `VE_FONT_DIRS` first, then fontconfig, then common system fonts. The first one that covers every character is used, and if none does, the render fails and names the missing glyphs. For Chinese text such as `"海边的下午"`, use a CJK font (Noto Sans CJK, Source Han Sans, WenQuanYi). Clips on one text track may not overlap, so put titles and captions that are on screen at the same time on separate text tracks.

**Audio track clips.** The source may be an audio file or a video file (its audio stream is used). The source must have audio at `start`, otherwise the render fails. Audio that runs out early is padded with silence.

**Overlaps.** Overlapping clips on the same track produce a validation **warning** on video tracks, where they render, and the later-starting clip draws on top. On audio, text and overlay tracks the same overlap is an **error**, so use one track per simultaneous layer (for example a second `music` or `sfx` track).

## Transitions

Shape: `{"type": "fade" | "crossfade" | "dissolve", "duration": seconds}`. `name` is accepted for `type`. The duration must be greater than 0 and no longer than the clip's output duration; a transition without `duration` passes validation and renders no fade, so always give one. The fields are `transition_in` and `transition_out`.

All three types render the same way: **the clip fades itself**. `transition_in` fades from transparent or silent at the clip's start, and `transition_out` fades out at its end (in output time; speed is accounted for).

- Video and image clips on a video track fade their opacity over whatever is beneath them: the black canvas, or lower video tracks.
- Overlay clips fade their opacity.
- Audio-track clips fade their volume.
- The original audio of a video clip is **not** faded. To fade it, mute the video clip and put the same source on an audio track with the same `start`/`end`/`timeline_start` and audio fades.
- Text clips: render error. Any other transition type: render error. Non-empty top-level `transitions[]`: render error. These also fail validation.

**Fades do not overlap clips.** Sequential clips with `transition_out`/`transition_in` dip through black, and the total length stays the sum of the clip lengths. For a **real crossfade** of length `d`, overlap the clips: set clip B's `timeline_start = A_end - d` and give B a `transition_in` of `d`, with no `transition_out` on A. B can sit on the same video track (validation warning, renders fine) or on a second video track (no warning). Each overlap shortens the total by `d`. During the overlap both clips' original audio plays and adds up, so mute or lower one of them, or use audio-track clips with fades.

## Audio mix

Each contribution is rendered as a full-length 48 kHz stereo bed. The contributions are the original audio of each video clip (unless the clip or track is muted, or the source has no audio) and every audio-track clip. Each bed is silence before `timeline_start`, then the clip with its speed, volume and fades, then silence after. The beds are mixed with **no normalization: levels add**. A peak limiter after the mix (ceiling about -0.2 dBFS, no auto gain, no added delay) stops the sum from clipping; it does not control loudness, and heavy limiting flattens the sound, so set volumes so the sum rarely reaches it. QC warns when the peak is at or above -0.1 dBFS and when the mean is at or below -35 dB.

For music:

- Trim it with `end` (or set `sequence.duration`) so it does not outlast the picture.
- If its loudness is unknown or uneven, normalize it once as a derived asset (for example with ffmpeg `loudnorm`).
- Then set `volume` for its role: balance it under speech so the narration is clear and the music is still distinctly audible, rather than automatically making the music very quiet; use an appropriate level when it is the only sound.
- Mute or lower the clips' own audio where it competes.
- When speech and background music overlap, check representative beginning, middle and end intervals with speech. When possible, retain time-aligned voice and music stems after their actual gains, fades and any ducking, and measure each stem over the same output-time windows; measuring the original music alone does not reflect the final mix. For example, on a stem already aligned to output time, `ffmpeg -ss 12 -t 5 -i aligned_stem.wav -vn -af volumedetect -f null -` reports mean and peak levels for seconds 12–17. Apply the same window to both stems and record the levels and any adjustments. If only a premixed track is available and the stems cannot be recovered, disclose that their relative levels could not be measured.
- Listen to the rendered mix through speech and, when present, music-only sections if playback is available; adjust and render again if the balance is poor or the mix clips. A limiter or a technical QC pass alone does not prove that speech and music are balanced. If listening is unavailable, disclose that the mix is unverified.
- Level differences and ASR results are diagnostics, not proof of audible music or intelligible speech; no fixed dB difference guarantees the right balance. Check the final mix for clipping and technical issues, and report whether listening was actually performed.

## Rejected by validation and render

- Non-empty `effects[]` on a clip or track.
- A non-empty top-level `transitions[]`.
- Transition types other than fade, crossfade and dissolve.
- Transitions on text clips.
- An enabled track with clips whose type is unknown or missing (`visible: false` does not exempt it; disable the track).
- An audio-track source with no audio at `start`.
- A missing `font_file`, or fonts without the needed glyphs.
- Invalid `x`/`y` characters.
- An output path that is not `.mp4`, or an output path equal to a timeline source.

`timeline_validate` reports all of these except the output path (checked by `video_render`, which re-runs validation first and returns its report on failure).

## Example

A video clip, a photo, a sped-up clip, music with fades, a title and a CJK caption. The total is 4 + 3 + 6/1.5 = 11 s, because fades do not overlap.

```json
{
  "project": {"task": "Beach day recap, about 12 s", "assumptions": ["keep 16:9 source aspect"]},
  "sequence": {"width": 640, "height": 360, "fps": 30},
  "assets": [
    {"id": "a", "source": "materials/clip_a.mp4"},
    {"id": "b", "source": "materials/clip_b.mp4"},
    {"id": "photo", "source": "materials/photo.png"},
    {"id": "music", "source": "materials/music.wav", "license": "provided by user"}
  ],
  "tracks": [
    {"type": "video", "name": "main", "clips": [
      {"asset_id": "a", "source": "materials/clip_a.mp4", "start": 1.0, "end": 5.0,
       "volume": 0.4, "reason": "opening: arrival at the beach", "beat": "hook",
       "transition_in": {"type": "fade", "duration": 0.5},
       "transition_out": {"type": "crossfade", "duration": 0.4}},
      {"asset_id": "photo", "source": "materials/photo.png", "start": 0, "duration": 3.0,
       "reason": "family photo held as a still", "beat": "development",
       "transition_in": {"type": "dissolve", "duration": 0.4},
       "transition_out": {"type": "dissolve", "duration": 0.4}},
      {"asset_id": "b", "source": "materials/clip_b.mp4", "start": 0.0, "end": 6.0, "speed": 1.5,
       "volume": 0, "reason": "sunset walk, sped up 1.5x", "beat": "resolution",
       "transition_in": {"type": "crossfade", "duration": 0.4},
       "transition_out": {"type": "fade", "duration": 0.8}}
    ]},
    {"type": "music", "volume": 0.5, "clips": [
      {"asset_id": "music", "source": "materials/music.wav", "start": 0, "end": 11.0, "timeline_start": 0,
       "reason": "light background music under the whole piece",
       "transition_in": {"type": "fade", "duration": 1.0},
       "transition_out": {"type": "fade", "duration": 1.5}}
    ]},
    {"type": "title", "clips": [
      {"text": "Beach Day", "duration": 2.5, "timeline_start": 0.3, "reason": "opening title",
       "style": {"font_size": 48, "y": "h*0.12", "box_color": "black@0.35"}}
    ]},
    {"type": "subtitle", "clips": [
      {"text": "海边的下午", "duration": 2.5, "timeline_start": 4.3, "reason": "caption for the photo",
       "style": {"font_file": "fonts/NotoSansCJK-Regular.ttc", "font_size": 32}}
    ]}
  ]
}
```

```text
timeline_validate(timeline_path="edit/timeline.json", output_json="edit/validation.json")
video_render(kind="timeline", timeline_path="edit/timeline.json", output_path="out/beach_day.mp4")
video_qc(kind="video", source="out/beach_day.mp4", timeline_path="edit/timeline.json", output_json="out/beach_day_qc.json")
```

QC passed with two expected warnings: freeze frames during the photo, and short black frames at the cuts, which are the fades dipping through black. The 4:3 photo was pillarboxed on the 16:9 canvas.

## Render outputs

`video_render(kind="timeline", timeline_path, output_path, crf?, work_dir?, output_width?, output_height?)`.

- Output: H.264 MP4 with AAC 48 kHz stereo. `crf` is an integer from 0 to 51 (default 20).
- Always pass `output_path`; otherwise the file goes to an auto-named folder.

Next to the MP4, `.render_report.json` gives the output size, fps, expected duration and clip counts per track type; check them against your plan. `.edit_decisions.json` lists each video clip's source range, output range, `reason` and `beat`, plus the rendered overlays and audio clips with their ranges and `reason`; use it for the delivery summary.

## timeline_validate report

The report has `status` (`pass`/`fail`), `clip_count`, `project_contract` (`ok`, `missing`) and `issues[]`. Each issue has `severity` (`error`/`warning`) and `message`, and its index fields mean:

- `track` and `clip` together: `clip` is the index **within that track** (layout checks: overlaps, transition length, unknown `asset_id`).
- `clip` alone: the **global** index over all tracks' clips flattened in track order. This is the index `timeline_patch` uses.
- `asset`, `marker` or `transition`: an index into that array.

Validation checks shape, sources, numbers, timing, overlaps and source bounds, plus the render rejections listed above.

## timeline_patch

`timeline_patch(timeline_path, instructions, patch, apply=false, output_json?)`.

- `instructions` is required and is stored as a note; the patch is never interpreted from it.
- With `apply=false` you get a preview: `after_validation_status`, `after_validation_issues`, `before_clip_count` and `after_clip_count`.
- With `apply=true` the timeline is written only if the patched result validates. If it does not, the file stays unchanged and the report still goes to `output_json`.
- `apply=true` needs at least one non-empty operation. Unknown keys produce a warning and are ignored.

Operations. Clip `index`/`from` are global flattened indices into the timeline **before** the patch. `fields` values of `null` delete that key.

| Key | Shape |
| --- | --- |
| `update_clips` | `[{"index": i, "fields": {...}}]` merges fields into the clip. |
| `replace_clips` | `[{"index": i, "clip": {...}}]` |
| `remove_clip_indices` | `[i, ...]` |
| `move_clips` | `[{"from": i, "to": position, "track_index"?: t}]`. `to` is a position inside the target track (by default the clip's own track). Only one move per call, and it cannot be combined with removals. |
| `insert_clips` | `[{"index": position, "clip": {...}, "track_index"?: t}]`. Without `track_index`, the clip goes into the first video track. |
| `add_clips` | `[{...}]` appends to the first video track. |
| `set_track_fields` | `[{"index": t, "fields": {...}}]`. Cannot touch `clips`. |
| `add_tracks`, `insert_tracks`, `replace_tracks`, `remove_track_indices` | `[track]`, `[{"index", "track"}]`, `[{"index", "track"}]`, `[t]` |
| `add_assets`, `update_assets`, `remove_asset_indices` | `[asset]`, `[{"index", "fields"}]`, `[i]` |
| `set_timeline_fields` | `{"sequence": {...}, ...}`. Cannot set `clips` or `tracks`. |

Track-structure operations and clip operations must go in separate calls. Indices must be in range and must not repeat. A clip cannot be both updated (or replaced) and removed in the same call. For large restructures, rewriting the timeline file is simpler. Validate and render again after every applied patch.

## video_qc (kind=video)

`video_qc(kind="video", source=<mp4>, timeline_path?, output_json?)`.

**Errors** (status `fail`):

- The file is empty, has no video stream, shows decoder corruption, or a scan failed.
- The audio ends more than 0.25 s before the video.
- With `timeline_path`:
  - The duration differs from the timeline's expected duration by more than max(0.35 s, 3%).
  - The resolution differs from the declared canvas.
  - **Render provenance is invalid.** The MP4 must sit next to its `.render_report.json` from `video_render`, and the timeline and every source must be byte-identical to render time. Copying or renaming the MP4, or editing the timeline after rendering, fails this check, so render again. This one is checked before the scan: the call returns `[ERROR] render provenance missing, stale or ambiguous; rerun video_render` (or `render input changed` / `render does not bind the current timeline`) and writes no QC report.

**Warnings:**

- Black of 0.2 s or more.
- A short black (0.025 s or more) within 0.08 s of a video cut. Expected with fades through black.
- Freeze of 1 s or more. Expected for photos and static shots.
- Silence of 0.5 s or more below -35 dB.
- No audio stream.
- A peak at or above -0.1 dBFS.
- A mean at or below -35 dB.
- An fps that differs by more than 0.5.

The report includes `media` (probe), `timeline_expectations`, `volume_stats` and the tails of the detection logs (`black_start`, `freeze_start`, `silence_start` times). Explain each warning or fix it. QC is technical only: watch the final video with `video_observe` to judge content, framing and text placement.
