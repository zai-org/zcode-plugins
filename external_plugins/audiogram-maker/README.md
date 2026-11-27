# Audiogram Maker

Turn a podcast or audio clip into a short video for social posts: an animated waveform, the cover image, title and subtitle, a progress bar and burned-in captions. Pick the audio, optionally a cover image and captions (SRT, LRC, or a plain text file with one caption per line, spread over the clip by length). Cut a segment out of a long episode with clip start and end, choose square, vertical or landscape, set the colours and waveform style, and fix caption times in the table; reversed or overlapping times and captions too long to fit are flagged before you render. Exports an MP4 (H.264 + AAC), a poster PNG for the thumbnail and an SRT re-timed to the clip. Runs locally with ffmpeg; no account or API keys.

## Features

- **Animated waveform** drawn from the audio, in four styles, with a moving progress bar.
- **Cover, title, subtitle** laid out for square (1080×1080), vertical (1080×1920) or landscape (1920×1080).
- **Captions** from SRT, LRC or plain text, burned into the video in a box, outlined or accent style.
- **Clip a segment** of a long episode; captions outside it are skipped and the SRT is re-timed.
- **Checks**: bad or reversed times, overlaps, captions over 3 lines, clips longer than 90 s, clip end after the audio.
- **Exports**: MP4 (H.264 + AAC, fade in/out), poster PNG and clip SRT.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `audiogram-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a square audiogram from 茶馆夜话-第12期.mp3 with cover.jpg and 字幕.srt, 00:04–00:22"
- "Fix caption 4's end time and the overlap after it"
- "Export the MP4 and poster"

## Tools

| Tool | Purpose |
|---|---|
| `audiogram_open` | Read the audio, cover and captions and lay out the video. Opens the panel |
| `audiogram_edit` | Change settings, edit cells by row, add or remove rows |
| `audiogram_status` | Show the current rows, issues and summary |
| `audiogram_export` | Write <title>.mp4, <title>-poster.png and <title>.srt |

Output goes to `audiogram-maker/<project>/` in the workspace.

## Scope (v0.1)

- Needs ffmpeg installed (free; macOS: brew install ffmpeg; Windows: winget install ffmpeg).
- Captions are not transcribed automatically — bring an SRT/LRC/text file. No in-panel playback in v0.1; the panel shows the poster frame.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `audiogram-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/audiogram-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-audiogram-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
