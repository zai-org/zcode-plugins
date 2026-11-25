# Demo Video Maker

Turn product screen recordings into a demo video you can publish: trim each step, zoom smoothly into what is being clicked, add callouts, subtitles and a title card. After a product update, replace one segment's recording — the rest of the video stays as it is and is not re-rendered.

## Features

- **Segment timeline**: one segment = one demo step (recording + in/out points). Reorder, delete, add; one recording can be cut into several segments.
- **Zooms**: drag a box on the frame in the panel to add a zoom at the current time (0.45 s ease in/out, 2.5 s by default). Boxes keep the frame's shape; overlapping zooms are shortened.
- **Callouts**: rounded caption bar (top or bottom) with your accent colour, fading in and out; Chinese text wraps correctly.
- **Subtitles**: burned in, and exported as a whole-video `.srt` (offset by the intro and earlier segments).
- **Intro card**: title + subtitle on a brand gradient.
- **Output**: 1920×1080, 1280×720, vertical 1080×1920 or square 1080×1080; H.264 + AAC MP4 with `+faststart`. Silent recordings get a silent audio track.
- **Only changed segments are re-rendered**: each segment is cached by its content and the recording's modification time (`.demo-cache/`). After `demo_replace_segment` only that segment renders again; the others are reused and concatenated.
- Projects are saved as `.demovideo.json` and can be edited later.

## Usage

Ask the agent in ZCode Desktop:

- "Make a product demo video from the recordings in recordings/: zoom into each button I click and add a short caption per step"
- "We changed the signup screen — replace the 'signup' segment with signup-v2.mov and re-render"
- "Add an intro card \"Monthly reports in 3 clicks\" and English subtitles to the demo"

Or open **Demo Video Maker** in the session side bar: segments, intro and output settings on the left; the current segment's frame (scrub with the slider, drag to add a zoom) and its zoom/callout/subtitle lists on the right. "Render video" produces the MP4 and shows key frames of the result.

## Tools

| Tool | Purpose |
|---|---|
| `demo_open` | New draft from recordings (one segment each) or open a saved project; opens the panel |
| `demo_save` | Validate and save the project (times clamped to the recordings; warnings say what changed) |
| `demo_replace_segment` | Swap one segment's recording (keep or clear its zooms, callouts and subtitles) |
| `demo_render` | Render MP4 + SRT, re-rendering only changed segments |

## Requires ffmpeg

The plugin uses the ffmpeg installed on your computer (it is not bundled). macOS: `brew install ffmpeg`; Windows: `winget install ffmpeg`; Linux: your package manager. If it is not on PATH, set the ffmpeg path in the plugin settings.

## Scope (v0.1)

- Input: MP4, MOV, WebM, MKV, M4V recordings.
- Not included: automatic click detection, voice-over / speech recognition, transitions, background music.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the recordings you choose and system fonts; writes only inside the workspace: the `.demovideo.json` project, the MP4/SRT, and `.demo-cache/` next to the output (segment cache, safe to delete). ffmpeg/ffprobe are called with argument arrays (no shell). No hooks.

## Build and test (developers)

Source: `ui-plugins/demo-video-maker/`. Run `pnpm install --frozen-lockfile && pnpm build` at the repo root and add `dist/local-marketplace` as a local marketplace source in ZCode. Tests (need ffmpeg): `pnpm --filter @penova/plugin-demo-video-maker test` (project validation, SRT offsets, rendering, cache reuse, replacing one segment re-renders only that one) and `test:e2e` (browser panel test; `E2E_RECORDINGS` can point to real recordings).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: resvg-wasm (MPL-2.0, unmodified, source https://github.com/yisibl/resvg-js), fontkit (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), MCP SDK and ext-apps (MIT); full list in `dist/THIRD_PARTY_NOTICES.txt`. ffmpeg is not bundled.
