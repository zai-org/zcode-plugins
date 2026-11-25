# Subtitle Generation, Layout and Repair

Produce accurate, readable, correctly timed subtitles for the speech in the current final video. Follow the language, format and style the user chose.

## Current Materials and Transcript

1. Use `video_metadata` to read duration, aspect ratio, audio tracks and soft subtitles; observe representative frames and existing text. First decide whether existing hard/soft subtitles already satisfy the task, to avoid adding an unrequested second layer of dialogue subtitles.
2. Reuse a timed transcript confirmed to belong to the current video; if needed, run `transcribe(input_path=..., output_json="out/transcript.json")`. For condensed output, prefer the bound transcript returned by the speech renderer; for other edits without a mapping, transcribe the final video.
3. Proofread names, numbers, terms, punctuation and meaning; keep a short record of changes. speaker labels require identity evidence; do not infer names from cluster numbers. Overlapping segments or missing times are input problems to resolve.

## Observe and Build

`subtitle_layout(source=..., output_json="out/subtitle_layout.json")` provides background, contrast, font size and position suggestions plus actual images. Read them and decide the safe area by combining faces/mouths, name tags, logos, existing subtitles and platform UI; for multi-camera footage use an area acceptable in every framing. Observe more densely only as needed; do not densely sample frames across the whole video by default.

```text
subtitle_build(source="current.mp4", transcript_path="out/transcript.json",
               preset="broadcast_en", style={"font_size":40,"margin_v":50},
               output_json="out/subtitles.json", output_ass="out/subtitles.ass",
               output_srt="out/subtitles.srt")
```

Choose the preset by language/platform: `shortform_zh`, `broadcast` or `broadcast_en`. Read the cue table, coverage, overlap/dropped-segment warnings and the missing-glyph check. The package's `cues[]` is the editable authoritative data; after changing text/line breaks/timing, the renderer rebuilds ASS/SRT at the `ass_path`/`srt_path` recorded in the package, and hand edits to the sidecars are overwritten. Backslashes and curly braces in text display literally. When you plan to add Chinese names or translations while the original text is Latin script, use a `style.font_file` that covers those characters at build time; if rendering finds missing glyphs it rejects and requires a rebuild. Keep times positive-duration, monotonic and free of unintended overlap.

Enable advanced styles only on user request; see [subtitle-features](../references/subtitle-features.md) for the fields. Do not automatically add speaker names, word-level highlighting, translations or term explanations.

## Render and Check

```text
video_render(kind="subtitles", source="current.mp4", subtitles_path="out/subtitles.json",
             output_path="out/subtitled.mp4", mode="burn")
video_qc(kind="subtitles", source="out/subtitled.mp4", subtitles_path="out/subtitles.json",
         output_json="out/subtitle_qc.json", max_evidence_frames=12)
```

`mode` supports burn, soft and both; soft output filenames carry `_softsubs`, so read the actual paths from the returned `outputs`. QC verifies that the current subtitle package is bound to the final video; soft subtitles still need a display check in the target player after the data check and muxing, and an acceptance check of burned-in images cannot substitute for it. When delivering only subtitle files, no video render is needed: you can run `video_qc(kind="subtitles", subtitles_path=...)` to check the data and state that the player has not been tested.

Separate the checks: F, on still frames, covers text, line breaks, readability, occlusion and overflow; T, over time windows, covers sync, flicker, clipped words and short cues. Proofread text cue by cue; frame evidence is sampled by default. When image coverage of every cue is required, raise `max_evidence_frames` and verify the actually returned/omitted lists. Sync conclusions require continuous audio-video observation; with word-level highlighting, also watch each word's change.

For errors, modify the current transcript/cue/style, then rebuild or re-render the affected outputs; re-run QC and the checks. Record the version checked, cue/window, evidence, conclusion and uncovered range. Deliver the requested subtitles or final video, keep the cue package, QC and any necessary correction/check records, and do not treat successful encoding as proof of content accuracy.
