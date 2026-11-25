---
name: video-edit-agent
description: Process one existing video or audio file locally and deliver the processed file - trim, cut out, split, transcode or compress, convert to GIF, change resolution, aspect, frame rate or speed, loop, add/remove/replace audio, normalize loudness, mask regions, and ffmpeg retouching (color grade, denoise, stabilization). Also covers preparing derived assets for other workflows. Not for assembling multiple independent materials or for new creative briefs.
---

# Local Video Processing

Use this skill when the task is "this file in, a processed file out": the user supplies existing media and wants it transformed rather than restructured into a new piece. Shared evidence and acceptance rules come from [video-agent](../video-agent/SKILL.md).

| Task | Read |
| --- | --- |
| Trim, cut, split, join parts of one work, transcode, compress, GIF, resolution/aspect/fps, speed, loop, audio track changes, loudness, masking/blurring a region | [references/deterministic.md](references/deterministic.md) |
| Color grade and filter looks, denoise, stabilization, sharpening, deinterlacing | [references/retouch.md](references/retouch.md) |

## Boundaries

- Multiple independent clips, photos or audio to select and order: [video-edit-assembly](../video-edit-assembly/SKILL.md). It may hand single-file preprocessing (crop, grade, loudness, loop) back to the references here.
- Condensing a talking-head recording, subtitles, transcription, narration and dubbing: [video-speech-workflows](../video-speech-workflows/SKILL.md).
- A new creative brief (ad, story, MV), even with supplied footage: [video-creation](../video-creation/SKILL.md).
- A request that combines processing with one of the above: do this skill's step at the point the dependency order requires (for example, transcode and trim before subtitles; normalize loudness after the final mix) and keep each stage's deliverable.

## Shared Conventions

1. **Inspect first.** Run `video_metadata(source=...)` on the input: duration, display size, rotation, fps, audio presence. For anything that depends on content (where to cut, what region to mask, whether the picture is shaky), run `video_observe` on the relevant windows and read the frames. Ask only when the target is genuinely ambiguous (for example "make it smaller" could mean file size or dimensions); otherwise choose the conventional reading and state it.
2. **Check the toolchain.** Before relying on a filter or encoder, confirm it exists in this ffmpeg build: `ffmpeg -hide_banner -filters` and `ffmpeg -hide_banner -encoders`, then search the output for the name. Builds differ between Linux distributions, Homebrew, and Windows packages. Use the fallback the reference gives when something is missing, and report a substitution.
3. **Never overwrite the source.** Write each result to a new file in the project's output location, named after the source and the operation. Keep the exact command, the input path and its time range alongside the result (a short `.txt` or `.json` beside it, or the work log), so the result can be reproduced and other workflows can cite it as a derived asset.
4. **Portable commands.** Run ffmpeg with an argument list (one argument per element) from a script, or quote each path. Paths with spaces or CJK characters are common. Filter graphs that contain `:` `,` `'` or `\` are easier to keep correct on Linux, macOS and Windows when written to a file and passed with `-filter_script:v` / `-filter_complex_script`, or passed as a single argument from Python's `subprocess.run([...])`. Do not depend on shell features such as globbing, `&&` chains, or `$(...)` in the delivered instructions.
5. **Re-encode only what changed.** Use stream copy (`-c copy`) when the operation allows it and the user did not ask for a different format. When re-encoding, keep the audio unchanged unless the task touches audio, and pick settings for the stated target (platform, size, quality) rather than defaults.

## Acceptance

A finished encode only proves a file was written. Before delivery:

- Run `video_metadata` on the output and compare against the request: duration (and that cut points landed where intended), display width/height and aspect, fps, codec/container where it was specified, audio present or absent as requested, and file size when there was a size target.
- Run `video_qc(kind="video", source=<output>, output_json=...)` and resolve technical errors (black or frozen stretches that were not in the source, missing audio, broken duration). Explain warnings that are expected.
- Look at the result: `video_observe` at the cut points, start and end, and at the windows the operation changed. Retouching needs before/after frames of the same moments; motion changes (speed, stabilization, interpolation, loops) need consecutive frames or playback, not sparse stills. Mark audio as unverified when you could not listen.
- Report what was done, the output path, duration, resolution, fps and size, the command or settings that matter, and any requirement that could only be partly met.
