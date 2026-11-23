---
name: video-edit-assembly
description: Select, deduplicate, order and assemble multiple independent video clips, photos and audio files into a structured edited video or project (material packs, montages, travel/family recaps, multi-source stories). For parts of one logical work (halves, episodes, replays), judge by the work and the task first rather than by file count.
---

# Multi-Material Assembly

Build the structure from what the materials actually contain, then assemble and verify the cut. Shared evidence and acceptance rules come from [video-agent](../video-agent/SKILL.md); for speech subtitles on the finished video read [video-speech-workflows](../video-speech-workflows/SKILL.md). Field-level contract for timelines, rendering, patching and QC: [references/timeline.md](references/timeline.md). For selection, pacing, structure and audience review, read [references/editing_judgment.md](references/editing_judgment.md) before committing to the edit.

## Reproduce a reference video

When the user provides a reference video, observe that task's own reference before designing. Faithfully reproduce its canvas and aspect, background, colors, overall style, layout and proportions, font and subtitle treatment, as well as its characteristic motion, transitions and pacing, unless the user explicitly requests a change. Observe representative static and moving phases, and adapt timing as needed for the requested content and duration. Keep the requested subjects, materials and narration. Do not invent a new design or substitute another task's reference; follow the user's instructions about whether to use the reference audio. If the reference and explicit task instructions conflict, ask when possible; otherwise follow the explicit instruction and disclose the conflict and any unresolved uncertainty.

Before delivery, compare representative frames of the rendered video with corresponding visual phases of the reference at viewing size, including layout, colors and subtitles. Inspect consecutive frames or playback for representative motion and transitions; sparse stills cannot establish timing or motion quality. Correct deviations, render and check again, and disclose any remaining limitations.

## Narration (口播) written for the edit

When the brief asks for voice-over that does not exist in the materials (a "口播版", a template whose host speaks over stills), the narration is produced here and the picture is timed to it, not the other way round:

1. Write the script as a JSON object `{"segments": [{"seg_id": "s01_apple", "semantic_units": [{"text": "一句话。"}, ...]}, ...]}` — one segment per section or object, one unit per spoken sentence. Use only facts the brief or materials give; a verdict/tier line goes last in its segment so motion can key off it. Keep the script in `out/` as a deliverable.
2. `synthesize_narration(script_path=..., by_sentence=true, output_json="out/script_tts.json")` returns real per-segment `audio_dur` and a per-sentence `sentences[]` timeline (`start`/`end`/`text`). Custom keys on units (roles, tiers) are not carried into the output; look them up from your script by position. `tts_generate` is for a single line. Both need the configured TTS credentials; a `credentials_not_set` error is an environment gap to report, not something to work around with the reference audio.
3. Set each section's picture duration from its `audio_dur` plus a short hold, drive in-section motion (reveal, shrink into place) and phrase captions from `sentences[]`, and place the segment's audio on an audio track at the same `timeline_start` as its picture. Verify at least one segment's audio against its text (`transcribe` the clip) before rendering everything, and check speech onsets against section starts in the final mix (`silencedetect`).

## Workflow

1. **Brief and inventory.** Check the user's material list or the project directory and tell apart source materials, auxiliary assets and generated folders. Write down the asks: duration, aspect/platform, tone, music, titles/subtitles, scenes that must appear, order, things to avoid, and speech that must be kept. Run `video_metadata(source=...)` on every candidate to get duration, display width/height, rotation, fps and audio presence. You may exclude a damaged file only for a concrete technical error, and you must record that error.
2. **Observe.** Run `video_observe(source=..., start_s=..., end_s=..., num_frames=... or fps=...)` on every candidate video and photo, then read the returned images. Sample long clips window by window, and sample densely where you plan to cut (action start and end, camera shake, occlusion). Use `video_compare` to help find duplicates, but base the final choice on what you saw.
3. **Speech, only when it matters.** If a clip's speech carries meaning, transcribe each source on its own with `transcribe(input_path=..., output_json=...)`.
4. **Group, select, structure.** Group events across files and sections using the editing judgment reference. Select defining actions, reactions or discoveries, then supporting shots. Record ranges, contributions, omissions and speech constraints. When the task permits alternatives and a passage's repetition or selection is genuinely uncertain, compare current and tighter rough cuts with the [comparison method](references/selection_comparison.md). Do not shorten required content or change reference pacing merely to make a shorter cut. Plan optional observations and callbacks using [references/editorial_captions.md](references/editorial_captions.md).
5. **Design presentation and preprocess.** Compare treatments on the actual weakest important shot or photo at viewing size, within any required reference layout. For an uncertain optional caption, compare the passage with and without it. Place photos at meaningful pauses or reveals; preserve requested or reference motion and otherwise keep them still unless motion has a purpose. For zooms or pans use [references/photo_motion.md](references/photo_motion.md). See the table below for other preprocessing. Write derived assets separately, record provenance (original path, source range, exact command or script), and check them with `video_observe` before use.
6. **Build the timeline.** Write a project timeline (see the reference). `assets[]` lists the materials. `tracks[]` holds the real video, sound, titles and image overlays. Every clip needs a `reason`, and `beat` can name its section.
7. **Validate and fix.** Run `timeline_validate(timeline_path=..., output_json=...)`. On failure, the report is still written to `output_json`; fix the issues it lists. For targeted fixes, preview with `timeline_patch(..., apply=false)`, check `after_validation_status`, then repeat with `apply=true`, or rewrite the file. Validation also checks render support (effects, transitions, track types, audio availability and glyphs). A valid timeline still needs a successful render and output QC.
8. **Render.** Run `video_render(kind="timeline", timeline_path=..., output_path="....mp4")`.
9. **QC and audience review.** Run `video_qc(kind="video", source=<mp4>, timeline_path=..., output_json=...)`, resolve technical errors, then review every section and cut using the [audience review](references/editing_judgment.md#review-as-an-audience-member). Check photo motion with consecutive frames at output fps, plus normal-speed playback when available; sparse previews and technical QC cannot establish that it is free of jitter. Rebuild faulty motion; use a still hold only when compatible with the brief and reference, otherwise disclose the limitation. For narration with background music, check the mix using [timeline.md](references/timeline.md#audio-mix). Listen when a real audio capability is available, and record any unverified sound. After changing the timeline or sources, render and QC again and inspect the affected output and adjoining cuts.
10. **Deliver.** See the checklist below.

## What the renderer does and what needs preprocessing

| Need | How |
| --- | --- |
| Trim, order, place, gaps, overlap | Timeline fields (`start`/`end`, `timeline_start`) |
| Mixed sizes and aspect ratios, fps, rotation metadata | Automatic: fit inside the canvas with black bars (never cropped), convert to sequence fps, honor rotation metadata |
| Speed up or slow down | `speed` (video retimed, audio pitch-preserving tempo). Slow motion repeats frames; for smooth slow motion, make an interpolated derived clip |
| Photos | Image clip on a video track (held still for its duration) or on an overlay track; purposeful motion uses the [photo motion reference](references/photo_motion.md) |
| Fades, dissolves | `transition_in`/`transition_out` fade the clip itself through the black canvas. A real crossfade needs overlapping clips (see the reference) |
| Titles, captions | Text clips (burned in, white text on a semi-transparent box, no animation or fades, no outline/stroke or weight control). Many short phrase captions are fine as consecutive clips on one text track |
| Music, voice-over, volume | Audio tracks, `volume`, audio-clip fades. Levels add up with no loudness normalization; a limiter only stops the sum from clipping |
| Crop, reframe, fill a vertical frame, zoom, Ken Burns or pan on photos, an item moving or scaling over a fixed layout (shrinking into a slot of a rating table), content shot sideways without rotation metadata, color grade or "filter" looks, denoise, stabilization, wipes and other transitions, animated or fading text, outlined/stroked or semibold caption styles a reference uses, music loudness normalization or looping, beat analysis | **Preprocess** (for example with ffmpeg or a PIL compositor) into a recorded derived asset. Methods and checks for crop/reframe, rotation, loudness and looping are in [video-edit-agent deterministic](../video-edit-agent/references/deterministic.md); grade, denoise and stabilization in [video-edit-agent retouch](../video-edit-agent/references/retouch.md) |

## Interpreting the brief

- **Duration.** An upper bound ("at most 1 min", "时长上限1分钟", "不超过") is a ceiling: choose a duration supported by worthwhile material without exceeding it or padding to reach it. A target ("about 1 min", "1分钟左右", "控制在…左右") means land close to it, about ±10%. An exact figure ("cut it to 15 s") means within about half a second. If the material cannot support the target without filler or repetition, say so instead of padding.
- **Must-include scenes and order.** These are hard requirements. Verify in the final video that each one is present and record its output time. Keep any chronological or itinerary order the user asks for.
- **Text.** Use the strings the user gives verbatim, and add no extra text when the user asks for none. Titles and captions must not cover the main subject. Chinese or other non-Latin text needs a font that covers the characters (see the reference).
- **Aspect.** When a reference video is provided, match its canvas unless the user explicitly asks otherwise. Otherwise keep the source aspect unless the user or the target platform asks otherwise. With mixed orientations, choose the canvas from the dominant material or the stated platform. Upscaling does not add detail.
- **Mood, music, beat cuts.** Prefer music the user provided. If the task specifies a track and where it should play, use that track in the requested sections rather than substituting the reference audio. When narration and background music play together, balance them so both remain clearly audible; do not duck the music unnecessarily, mask the voice or cause clipping. When listening is available, audition the rendered mix, adjust and recheck; otherwise disclose that the balance is unverified. If the task wants music and none was provided, use external music only when the environment and the task allow it, and record the source URL, license and attribution in the delivery notes. Otherwise deliver with the original sound and say so. For beat cuts, take beat times from the actual music track and align cuts to them.
- **Effects you cannot render directly** (warm grade, slow motion, stabilization): implement them as derived assets ([video-edit-agent](../video-edit-agent/SKILL.md) has the methods), or state the limitation. Never leave them as metadata that does nothing.
- **Missing or contradictory material.** If a scene, photo or moment the user names is not in the materials, or the footage contradicts the brief (for example a landmark that does not match the stated location), say so. Do not fabricate it or pass off generated footage as real. Follow the user's explicit instruction and flag the discrepancy.

## Deliverables and checklist

For a complex edit, keep the material grouping and selection record, the timeline, the final video with its sidecars, the QC report, the derived-asset provenance, and a short report. If the user asked only for project files, deliver the project and state that nothing was exported. If subtitles are needed, make them on the final video: there is no public transcript mapping for multi-material output, so transcribe the final video again or provide a verified transcript in output time.

The final answer should:
- Link the final MP4 and state its duration, resolution and fps.
- Summarize the structure: sections with output times and the materials they use.
- State how each explicit ask was met (duration, required scenes, text strings, music and mood, aspect), and which materials went unused and why.
- Summarize the audience review: checked output ranges, consequential changes and their recheck, or evidence for retaining a questioned passage. Disclose material readability limits, substituted requirements and unverified sound.
- Give the music source and license when the music is external.
- State what was checked: validate, render and QC status, notable QC warnings and why they are expected, and which frames or windows of the final you watched.
- Mention only the limitations that matter for this task. For example, if sound quality was a requirement and you could not listen, say so; leave out boilerplate.
