# Talking-head Condensing

Use to condense one long talking-head, interview or podcast. Keep the original words and argument by cutting source content; when a re-created voiceover is needed, switch to the corresponding creation workflow.

## Evidence and Selection

- Get the current source metadata and transcript. Word-level cuts depend on actual `segments[].words[]` times; with only segment times, prefer keeping whole sentences/complete units. Fine cuts require listening; do not treat interpolation as precise measurement.
- With multiple speakers where identity affects meaning, run `speaker_audit(transcript_path=...)` to find suspected error windows; judge from self-introductions, visible name tags, and shot/voice evidence. Once confirmed, use `speaker_relabel` to write a corrected copy, keep the original words, and audit again. When identity cannot be confirmed, use neutral labels.
- `speech_index(source=..., transcript_path=..., output_json="out/speech_index.json", output_table="out/speech_index.md")` builds the unit table, pause/repetition candidates and a rough visual survey. Read the images and identify existing hard subtitles, lower-third content and multi-camera setups; the rough survey is not enough to verify sentences that refer to specific visuals, so fetch the corresponding windows separately.
- Read the entire unit table and record the content skeleton, droppable repetitions, qualifiers that must be kept, and the target duration. The tool's repetition/filler-word marks are candidates; the main Agent decides what to keep. Prefer keeping a few long continuous stretches; avoid cutting every sentence.

## Plan, Read-through and Render

```text
speech_plan(index_path="out/speech_index.json", keep=["u001-u004", "u008-u010"],
            drop_fillers=false, output_json="out/condense_plan.json",
            timeline_json="out/condense_timeline.json", script_md="out/condense_script.md",
            output_transcript="out/planned_transcript.json", redline_json="out/condense_redline.json")
```

Take IDs from the current index; do not copy the example. `keep` may contain ID ranges or `{start,end}` source time ranges (which must fall within the source duration); drop takes precedence, and outward padding of clip boundaries does not extend into unselected units. target only reports the difference from the goal; it does not decide what to drop. Check the clip count, short-fragment drops, boundary risks and output duration. Filler words are not removed by default; use `hard`/`aggressive` only when clearly necessary and word-level times exist.

Read the continuous script and redline straight through: after each cut point, check for orphaned connectives, missing referents, distorted claims or lost context. Revise the keep-list and re-plan. The plan outputs the source ranges, the continuous script and an output-time transcript at the same time; that transcript is plan data until rendering.

```text
video_render(kind="speech", plan_path="out/condense_plan.json", output_path="out/condensed.mp4")
video_qc(kind="speech", plan_path="out/condense_plan.json", source="out/condensed.mp4",
         output_json="out/condense_qc.json")
```

The shared speech renderer reuses the timeline renderer, uses hard cuts and keeps the source frame rate; it currently offers no dissolve mode that would change the time mapping. The source must have a video stream: audio-only sources can be indexed and planned but cannot be rendered into a final video with `video_render`. Rendering returns `output_transcript`, a transcript of the rendered output; subsequent subtitles use it, not the source-time transcript or the plan transcript. For text with `partial=true`, correct it to match the speech actually kept and verify its timing, or re-transcribe the final video.

## Verification and Repair

QC includes technical checks, seam risks, and image/waveform evidence; images and waveforms cannot prove how it actually sounds. Separate the check records: S, read-through verifying semantics and qualifiers; A, listening verifying clipped words, clicks, room tone and volume; V, viewing jump cuts, lip sync, existing subtitles and visually dependent references.

When there are few seams, check each one. When there are many, check every error/high-risk item first, then sample low-risk items; record the total count, the number checked individually, the sampling range, items not listened to, and the measurements relied on. Do not present sampling as full coverage. Keep the check results for each new version after every repair.

Semantic problems go back to the keep-list; clipped-word/sound problems call for adjusting boundaries or keeping longer continuous stretches; visual jump cuts call for fewer cut points or a verified visual treatment. Re-plan, re-render, re-run QC and update downstream subtitles. Deliver the final video, the plan/continuous script/time mapping, QC and the check records, and report whether the target duration was met and any unresolved issues.
