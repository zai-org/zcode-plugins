---
name: video-speech-workflows
description: Use for transcription, narration/dubbing with preset TTS voices, creating or repairing subtitles for speech videos, condense talking-head/interview/podcast recordings, and combine post-edit subtitle pipelines. Covers subtitle layout, speaker labels, word-level highlighting (karaoke), bilingual subtitles and long talking-head selections; assemble multiple materials into a final video first.
---

# Speech Video Editing

Read the workflow the task needs:

| Task | Workflow |
| --- | --- |
| Condense, shorten or tidy a long talking-head/interview | [speech-condense](workflows/speech-condense.md) |
| Subtitle generation, timing repair, layout and burn-in | [talking-head-subtitles](workflows/talking-head-subtitles.md) |
| Combine editing/condensing with subtitles or translation | [video-pipeline](workflows/video-pipeline.md) |

For a transcript only, call `transcribe` on the file and check the result against the requested language and coverage. For narration or dubbing audio, call `tts_generate` with a preset voice. Lay the audio onto the video with [video-edit-agent](../video-edit-agent/references/deterministic.md#audio-tracks) for one file, or as an audio track in [video-edit-assembly](../video-edit-assembly/SKILL.md) for a multi-material cut, and check sync against the picture.

Subtitles target the current final video; for a bundle of materials use [video-edit-assembly](../video-edit-assembly/SKILL.md) first. For local subtitle/identity checks, call `video_observe` directly on the relevant window; no dense full-video scan is needed. Observation calls return only images and an optional transcript; actually listening requires host audio/player capability. When you cannot listen, keep those items marked unverified.

Tool file parameters resolve relative to the project directory.
