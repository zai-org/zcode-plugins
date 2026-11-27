# delivery-video

A skill plugin that turns a feature that **actually runs** into a trustworthy delivery demo video — real screen recordings, synthesized narration, karaoke subtitles, and a deterministic quality gate that refuses to pass a fake or broken demo.

Most "AI demo videos" are stitched from static screenshots, mock pages or stale recordings. This plugin enforces the opposite discipline: every segment must point at a real recording with a traceable time range, the last shot must end on a verified result state, and the artifact must pass hard checks for resolution/FPS/codec, audio presence, loudness, black frames and freeze frames before anything is posted. Bitrate density is reported as an informational notice; the frames are reviewed from the generated `review/` packet and that review is recorded in `visual-critic.json`. The uploaded file is always the gated file, bound by SHA256.

In DeepSeek Harness, the skill is registered in both the Host and each live Agent scope. That lets the installed plugin win over an older same-name copy in `~/.agents/skills`, even when an Agent preset mounts the filesystem skill provider in a nearer layer.

## What it does

1. **Verify first, record second** — the workflow requires evidence that the current version really runs (git SHA, tickets, request IDs) before any recording.
2. **Case-driven structure (recommended)** — for multi-case deliveries the skill suggests listing the acceptance cases first, recording one real run per case, then assembling segments in execution order with a result shot per case. Optional, not a gate.
3. **episode.json recipe** — each shot segment binds one real take + time range + one narration line + optional crop/case chip; a `kind: "card"` segment adds a renderer-made title card for the opening, the closing result or a section break.
   Set `intent: "feedback"` with an `issue` block to produce a defect report instead of a
   delivery: severity and phase chips, a repro-steps overlay, and both `feedback.json` and a
   ticket-ready `feedback.generated.md`. The gate report binds the artifact SHA256, the
   episode and timeline, a normalized hash of the `feedback.json` fields and the exact
   markdown bytes, so `verify_delivery.py` fails when the report was edited after rendering,
   or the markdown is missing or was edited after rendering. Copy `examples/feedback-episode.example.json` as a
   starting point. The same quality gate applies.
4. **Self-contained renderer** — `render.py` synthesizes every narration via edge-tts first (cached by content, word-boundary clocks), checks every segment's speed before rendering a frame, then times each segment to its narration (0.3x–3x speed is hard-checked, never clamped — out of range fails; anything outside 0.7x–1.5x is called out and disclosed), draws the label chip and karaoke subtitles, concatenates, loudness-normalizes to −14 LUFS, and runs the built-in quality gate. Output: `screen_demo.mp4` (1920×1080, 30fps, h264 with AAC audio — a non-AAC track is a gate warning `E102`, not a failure), `timeline.json`, `delivery.generated.md`, the `review/` packet, `quality_gate/report.json`.
5. **Fail-loud checks** — `preflight.py` validates the recipe before rendering (structure, intervals, crops, browser-recording evidence, narration lints); `render.py` enforces the very same validation, so it cannot be skipped. `verify_delivery.py` verifies the finished artifact, every gate binding (script, timeline, takes, generated note) and the visual review record.
6. **Attachment gate** — `render.py gate` runs the same hard checks on any mp4 before it goes into a ticket, chat or customer channel.

## Prerequisites

- `python3` 3.9+
- `ffmpeg` and `ffprobe` on PATH
- `pip install "edge-tts>=7.3.1" Pillow`

`edge-tts` 7.2.8 and older can return HTTP 403 from the upstream endpoint. Use 7.3.1 or newer; the renderer fails early with an upgrade command when the installed version is too old.
Run `preflight.py`, `render.py` and `verify_delivery.py` with the same Python interpreter. Preflight fails early when ffmpeg/ffprobe, Pillow, a supported edge-tts version or a CJK font is missing.

Platform setup:

- macOS: `brew install ffmpeg`, then `python3 -m pip install "edge-tts>=7.3.1" Pillow`
- Windows: install FFmpeg with `winget install --id Gyan.FFmpeg -e` (or `choco install ffmpeg`). If `python3` is not available, use `py -3` consistently and run `py -3 -m pip install "edge-tts>=7.3.1" Pillow`
- Linux: install `ffmpeg` and a CJK font such as `fonts-noto-cjk` with your package manager, then install the Python packages

The renderer needs a CJK font for Chinese labels and subtitles. macOS and Windows normally provide one; minimal Linux images often do not, and preflight reports the missing font before rendering.

## Side effects (disclosed for review)

- **Network**: narration synthesis calls the public edge-tts (Microsoft Cognitive Services) endpoint; no other network access.
- **Files**: writes its outputs only inside the build directory you pass in (`tts/` cache, per-segment clips, final mp4, `review/` packet, generated note, gate reports); ffmpeg's stderr goes to short-lived temporary files. It never writes `visual-critic.json` and never writes into the plugin directory.
- **Commands**: runs `ffmpeg`/`ffprobe` locally; the skill never uploads, publishes or deletes anything by itself.

## Quick start

Install: `dsh plugin add /path/to/delivery-video-plugin` (DSH bundle). It exposes the skill in `skills/delivery-video/`.

1. Record real takes of the feature with your usual tool (macOS `Cmd+Shift+5`, OBS, or a scripted browser screencast — see the skill's recording reference). For two or more acceptance cases, list them first using `examples/cases.example.md` as a template, then record one real run per case.
2. Create `build/screen_demo-<slug>/episode.json` (copy `examples/episode.example.json`).
3. Run preflight and render (use `py -3` instead of `python3` on Windows when needed):

```bash
python3 <skill>/scripts/preflight.py build/screen_demo-myfeature
python3 <skill>/scripts/render.py render build/screen_demo-myfeature
```

4. Review the frames: look at `review/sheet_NN.png` and `review/frames/`, complete `review/critic.draft.json` and save it as `visual-critic.json`. For an external delivery a second model or window does this from the packet.
5. Verify the artifact and its evidence chain:

```bash
python3 <skill>/scripts/verify_delivery.py build/screen_demo-myfeature
```

Run the unit tests with:

```bash
python3 -m unittest discover -s tests -v
```

Suggested trial prompt after install: *"用 delivery-video 把这个项目刚完成的功能录成一段 90 秒交付演示视频"* — the skill will walk verification, storyboard, recording guidance, recipe assembly, render and gating.

## Same-name skill copies

ZCode 0.17.x can keep a user-level skill and a plugin skill with the same name. If an older `~/.agents/skills/delivery-video` still exists, the unqualified `/skill delivery-video` command may select that copy. Select `delivery-video:delivery-video` in the composer, or use `/skill delivery-video:delivery-video <task>`, to run the installed plugin.

## License

MIT © Lumos-789
