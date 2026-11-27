# Video Compressor

Shrink a folder of videos for sharing, uploading or archiving. Pick a quality preset or a target size per file, cap the resolution, choose what to do with the sound, and see a rough size estimate before anything runs. Every video becomes an H.264 MP4 that plays everywhere and starts streaming right away; if a file wouldn't get any smaller the original is kept. A report lists the before and after sizes. Uses the free ffmpeg already installed on your computer; nothing is uploaded and no API keys are needed.

## Features

- **Presets**: high quality (CRF 20), balanced (CRF 23), small (CRF 28), or an exact target size with two-pass encoding.
- **Per file**: change the preset, target MB, max height, audio and output name for any row; blanks use the defaults.
- **Resolution cap**: 2160p down to 360p, only ever scaling down.
- **Audio**: AAC 64–160 kbps, keep the original, or remove it.
- **Safe**: originals untouched; files that wouldn't get smaller are copied as they are; warnings when a target is too small.
- **Report**: before/after size, saving and time for every file in a CSV.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `video-compressor/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Compress everything in videos/ to 720p"
- "Make demo.mov under 25 MB for email"
- "Shrink these recordings but keep the original sound"

## Tools

| Tool | Purpose |
|---|---|
| `vcompress_open` | Read every video (with ffprobe) and estimate the compressed size. Opens the panel |
| `vcompress_edit` | Change settings, edit cells by row, add or remove rows |
| `vcompress_status` | Show the current rows, issues and summary |
| `vcompress_export` | Compress every row to MP4 and write compress-report.csv |

Output goes to `video-compressor/<project>/` in the workspace.

## Scope (v0.1)

- Needs ffmpeg installed (free; macOS: brew install ffmpeg; Windows: winget install ffmpeg).
- Output is H.264/AAC MP4; no trimming, subtitles or HEVC/AV1.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `video-compressor/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/video-compressor/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-video-compressor test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: Uses the user's installed ffmpeg (LGPL/GPL, not bundled), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
