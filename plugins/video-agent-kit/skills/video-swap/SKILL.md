---
name: video-swap
description: Whole-person replacement (face + hair + wardrobe, keeping action, framing and rhythm). Replace the performers in a video you have the right to use with the people in reference images - recasting an MV, swapping a person for a meme, recasting a short drama. Flow - shot split, person labels, frame-grid windows, one replaced storyboard per shot, one H3 generation per window, identity/freeze acceptance, frame-grid assembly. Use when the user says "replace the person", "recast", "swap A for B", "change the actor", "AI person swap (not face swap)", or 换人 / 换角 / 把A换成B / 换演员 / AI换人. Not for face-only swaps that keep the wardrobe (use a pixel-level face-swap tool), and not for material you have no right to use.
---

# Video Swap (whole-person replacement)

Replace the performers of a source video **as whole people** (face + hairstyle + wardrobe) with the people in reference images, keeping the original action, framing, cutting rhythm and audio track. The result is a faithful re-performance: story beats, wardrobe and environment follow the source, but frame-level lock is not promised.

**Read before starting**: [pitfalls.md](references/pitfalls.md) (twelve measured fault modes; match the symptom before changing anything) and [providers.md](references/providers.md) (which ToolHub channel does what - person replacement runs on `minimax_h3_video`; the Seedance channel refuses footage of real people).

## Tools and paths

The six tools are `swap_scan`, `swap_plan`, `swap_storyboards`, `swap_generate`, `swap_assemble` and `swap_verify`, called in that order. Relative paths are project paths. Every tool takes `workdir`; without it the working files go next to the file the step reads (the timeline, the labels table or the windows file). Use one `workdir` for the whole job, for example `out/swap`, so that `swap_frames/`, `swap_sb/`, `swap_clips/` and `swap_out/` end up together.

`detect_shots`, `image_generate`, `swap_storyboards` and `swap_generate` are long jobs: the call returns a `job_id`; collect it with `job_action=status` and that `job_id` on the same tool (no other argument) before the next step. A project runs two jobs at a time by default.

`cast` is the same array in `swap_storyboards` and `swap_generate`, one entry per person to replace:

```json
[{"label": "A", "orig": "the blonde woman in the black stage outfit", "card": "out/swap/cast/card_a.png"}]
```

`label` is the slot used in the labels table, `orig` describes how the original performer looks in the source (so the model knows whom to replace), and `card` is that character's sheet image from step 3. Do not describe the new person in words anywhere.

## Workflow

0. **Input contract**: the user supplies the source video, one **anchor image** per character (a portrait-format costume photo) and a one-line description of the look. The character sheet and everything after it are your work.
1. **Check-up (S1)**: split shots with `detect_shots` (it refines the boundaries to the frame); check the source's fps and whether it is constant-frame-rate; run `swap_scan {video, timeline_path, workdir}` to get numbered contact sheets and `swap_labels.template.json`. Read the sheets and fill each shot's row, then save the table (for example as `swap_labels.json`):
   - `who`: the cast label(s) of the people to replace in the shot - `A`; several people in one shot `AB` or `A+B`; `none` when nobody to replace is visible. Label from what the frames show. `?` blocks planning.
   - `size`: close-up / medium close-up / medium / wide.
   - `diff`: `normal`, or the difficulty - handheld mic / body contact / fast head turn / close-up singing.

   Check several frames for burned-in subtitles and watermarks. **Go on only when the shot table covers the film with no holes** (D3); `swap_scan` asserts this.
2. **Preprocessing (S2)**: with burned-in subtitles, make a clean version with delogo and use it for every later step; when the source is not 24 fps, first run a pass-through assembly test without generation, then settle the master.
3. **Character sheet (S3a, your work)**: from the anchor image, make an 11-zone character sheet with the plugin's existing `image_generate` (`kind: "character"`, high quality; orthographic front/side/back three-view on white; the four expressions in their own zone; hairstyle including side and back). For several characters in one video, run the **same-production difference check** (at least three of silhouette, shape language, main color and signature element must differ). **Look at the generated sheet yourself** - a successful decode is not content acceptance. Put the sheet's path in `cast[].card`.
4. **Windows (S4)**: `swap_plan {labels_path, workdir}` groups the shots into windows on the shared 24 fps frame grid F=round(24·t). Window boundaries are source cuts. A window shorter than `min_window` (default 3.5 s) merges with a neighbour, and grouping aims at `max_window` (default 6.5 s). Two cases block the plan with `[ERROR]`: a single shot longer than `max_window`+0.5 s, and a short window that cannot merge. The error lists each window; decide and rerun - raise `max_window` (up to 14; one request takes at most 15 s of reference video) to keep a long shot whole, lower `min_window` to accept a short window, or edit the shot rows where a cut inside the shot is acceptable. The requested duration is the window rounded up, and the output is trimmed back by frame count (D4/D5).
5. **Storyboards (S3b)**: `swap_storyboards {video, labels_path, windows_path, cast, size, workdir}` makes one replaced storyboard per shot that has people to replace (source frame + the character sheets as reference images; the prompt binds by image position, "the person from image N", and **never restates the anchor's or the sheet's appearance in words** - D12). **Every such shot in every window must have its storyboard; the preflight stops on the first missing one** (D2, a lesson learned twice). `size` is a resolution tier (`1K` / `1.5K` / `2K`, default `2K`); the aspect follows the source frame being edited. For a local reference, **crop** the matching zone of the sheet (the side-view zone for a profile shot); do not regenerate. For strong-contact shots, pick the frame with the strongest contact and check the contact geometry of the storyboard. Look at the storyboards before generating.
6. **Generation (S6)**: `swap_generate {video, windows_path, labels_path, cast, resolution, workdir}` submits one H3 request per window: **the character sheets take the reference slots (image 1..n), and the prompt is only the binding sentence "replace … with the person from image N" plus the preservation sentence**; that window's storyboards follow. It runs on ZCode ToolHub with the signed-in account (no keys): each window's reference clip is cut without audio, kept under the 10 MiB upload limit and uploaded together with the images as https links. Submits are staggered. It is resumable: finished windows are skipped, and each window's Idempotency-Key and task id are kept in `<workdir>/swap_out/tasks.json`, so calling it again replays or collects them instead of creating new tasks. `windows: <n>` runs a single window (use it for the verification round); `prompt` replaces the default prompt. No description of the anchor goes into any prompt.
7. **Acceptance (S7)**: `swap_verify {window_outputs, face_refs, compare_path}` runs the machine gate - insightface identity check, freeze detection on a stacked comparison video (original on top, generated below), and a pairwise consistency check of the storyboards; without insightface the identity check is skipped and reported as degraded. `face_refs` holds four face images: `orig_a`, `orig_b`, `new_a`, `new_b`. **Then a human review at original speed with the audio track is mandatory** - a correct identity in still frames says nothing about motion quality (D7).
8. **Assembly (S8)**: `swap_assemble {video, windows_path, workdir, out_name}` trims by frame count, concatenates, lays the original audio under the picture and asserts zero drift against the frame grid. It covers the planned windows only; if the plan covers part of the film, join the untouched parts yourself. Build the comparison version (original above, generated below) with ffmpeg.
9. **Delivery (S9)**: a light 480P comparison page (the original-resolution deliverable stays as is), the acceptance data table and the task list (`swap_out/tasks.json`).

## Iron rules

- **Do not restate in the prompt what the character sheet already locks** (text that fights the image causes drift) - the prompt carries only what changes (action / emotion / camera). Exception: for close-up shots add the appearance text, the discipline the creation tools apply to close shot sizes (lesson of v9: with the sheet attached and no text, the hairstyle drifted in close-ups).
- The verification round **must include the hardest shot types** (close-up / fast head turn / body contact / handheld mic); do not let easy segments vouch for the pipeline.
- Record for every window: source window length / requested length / actual output length / amount trimmed - the trimmed tail is a known risk (D8).
- The identity report says "no strong hit in the sampled frames", not "zero leaks"; close every weak hit by a human look.
- Scale: every window is one generation task, plus one storyboard per shot. Run the verification round on one window before the batch.
- ToolHub may watermark the delivered windows (a visible "由 Z.ai 生成" mark in the lower right, on by default for the domestic region); state it in the delivery when present.
- Footage of real people goes through `swap_generate` only, never through the creation tools' Seedance generator (see providers.md).

## Parameter quick reference

| Item | Value |
|---|---|
| `resolution` | `768P` (baseline) / `2K` (showcase) |
| Windows | 4-6.5 s typical, aligned to cuts, shared frame grid; `min_window` 3.5, `max_window` 6.5 by default |
| Requested duration | int(window length), +1 when the remainder exceeds 0.05 s |
| `concurrency` | 6 by default; at most about 10 (the provider runs at most 30 tasks at once for all ToolHub users) |
| Storyboards | ToolHub image generator, `size` tier `1K` / `1.5K` / `2K` (default `2K`) |
