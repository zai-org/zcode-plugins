# GIF Maker

Turn a screen recording or video clip into a small animated GIF or WebP for docs, chats and bug reports. Trim it, set the frame rate, width and speed, play it backwards, choose the colour count and dithering, and set a size limit — if the file comes out too big it is re-encoded smaller automatically. See frames from the start, middle and end before you export. Uses the free ffmpeg already installed on your computer; nothing is uploaded and no API keys are needed.

## Features

- **Trim** by seconds or m:ss; blank end means the end of the clip.
- **Size**: frame rate, width (height follows), speed 0.25×–8×, reverse.
- **Quality**: palette per clip with 2–256 colours and Bayer/Sierra/no dithering for GIF; quality 1–100 for animated WebP.
- **Size limit**: set max MB; files that come out bigger are re-encoded with lower fps, then smaller width, up to 5 tries.
- **Preview**: start, middle and end frames plus an estimated size before encoding.
- **Batch**: several clips or a folder; a CSV report with the real sizes.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `gif-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a GIF from seconds 2 to 6 of demo.mp4, 480px wide"
- "Turn this recording into a WebP under 2 MB"
- "Speed up the clip 2× and make it loop"

## Tools

| Tool | Purpose |
|---|---|
| `gif_open` | Read the clips (with ffprobe) and show their first, middle and last frames. Opens the panel |
| `gif_edit` | Change settings, edit cells by row, add or remove rows |
| `gif_status` | Show the current rows, issues and summary |
| `gif_export` | Encode every row to GIF/WebP and write gif-report.csv |

Output goes to `gif-maker/<project>/` in the workspace.

## Scope (v0.1)

- Needs ffmpeg installed (free; macOS: brew install ffmpeg; Windows: winget install ffmpeg).
- No captions or drawing on frames; audio is dropped.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `gif-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/gif-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-gif-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: Uses the user's installed ffmpeg (LGPL/GPL, not bundled), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
