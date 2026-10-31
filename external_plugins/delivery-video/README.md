# delivery-video

A skill plugin that turns a feature that **actually runs** into a trustworthy delivery demo video — real screen recordings, synthesized narration, word-synced subtitles, and a deterministic quality gate that refuses to pass a fake or broken demo.

Most "AI demo videos" are stitched from static screenshots, mock pages or stale recordings. This plugin enforces the opposite discipline: every segment must point at a real recording with a traceable time range, the last shot must end on a verified result state, and the artifact must pass a hard gate (resolution/fps/codec, audio presence, loudness, black frames, freeze frames, bitrate density) before anything is posted. The uploaded file is always the gated file, bound by SHA256.

## What it does

1. **Verify first, record second** — the workflow requires evidence that the current version really runs (git SHA, tickets, request IDs) before any recording.
2. **episode.json recipe** — each segment binds one real take + time range + one narration line + optional crop/case chip.
3. **Self-contained renderer** — `render.py` synthesizes narration via edge-tts (word-boundary clocks), times each segment to its narration (0.3x–3x speed clamp), draws the label chip and word-synced subtitles, concatenates, loudness-normalizes to −14 LUFS, and runs the built-in quality gate. Output: `screen_demo.mp4` (1920×1080, 30fps, h264+AAC), `timeline.json`, cover/preview frames, `quality_gate/report.json`.
4. **Fail-loud checks** — `preflight.py` validates the recipe before rendering (structure, intervals, crops, browser-recording evidence, TTS cache contracts, narration red lines); `verify_delivery.py` verifies the finished artifact, gate binding and optional independent visual review afterwards.
5. **Attachment gate** — `render.py gate` runs the same hard checks on any mp4 before it goes into a ticket, chat or customer channel.

## Prerequisites

- `python3` 3.9+
- `ffmpeg` and `ffprobe` on PATH
- `pip install edge-tts Pillow`

## Side effects (disclosed for review)

- **Network**: narration synthesis calls the public edge-tts (Microsoft Cognitive Services) endpoint; no other network access.
- **Files**: writes only inside the build directory you pass in (`tts/` cache, per-segment clips, final mp4, gate reports).
- **Commands**: runs `ffmpeg`/`ffprobe` locally; the skill never uploads, publishes or deletes anything by itself.

## Quick start

1. Record real takes of the feature with your usual tool (macOS `Cmd+Shift+5`, OBS, or a scripted browser screencast — see the skill's recording reference).
2. Create `build/screen_demo-<slug>/episode.json` (copy `examples/episode.example.json`).
3. Run the three scripts:

```bash
python3 <skill>/scripts/preflight.py build/screen_demo-myfeature
python3 <skill>/scripts/render.py render build/screen_demo-myfeature
python3 <skill>/scripts/verify_delivery.py build/screen_demo-myfeature
```

Suggested trial prompt after install: *"用 delivery-video 把这个项目刚完成的功能录成一段 90 秒交付演示视频"* — the skill will walk verification, storyboard, recording guidance, recipe assembly, render and gating.

## License

MIT © Lumos-789
