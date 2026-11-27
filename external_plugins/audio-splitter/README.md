# Audio Splitter

Cut a long recording into tracks: a lecture into chapters, a podcast into segments, a live set into songs. Open an audio file (or a video's soundtrack) and it is split at the pauses, at a fixed length, or at the times in your chapter list; add a plain list of titles and the tracks are named in order. Very short pieces are merged into their neighbours and over-long ones are cut again at their longest pause. Move any cut point, rename or skip tracks, then export numbered audio files (copied without re-encoding, or as MP3, M4A or WAV, with title, track and album tags), a track list CSV, YouTube-style chapter timestamps and a CUE sheet. Runs locally with ffmpeg; no account or API keys.

## Features

- **Three ways to split**: at silences (threshold and minimum pause), fixed length, or times from a chapter list.
- **Sensible tracks**: too-short pieces merged, too-long ones re-cut at their longest pause, silence trimmed at the edges.
- **Titles** from a plain list or a timed chapter list; file names from a pattern with {n}, {title}, {album}.
- **Checks**: bad or overlapping times, duplicate file names, title count not matching the tracks.
- **Output**: lossless copy or MP3/M4A/WAV with title, track, album and artist tags.
- **Lists**: tracks.csv, YouTube chapters.txt and a CUE sheet.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `audio-splitter/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Split 茶艺讲座.mp3 at the pauses and name the parts from 章节.txt"
- "Move track 3 to start at 00:30 and rename the last one 问答"
- "Export the tracks and chapter list"

## Tools

| Tool | Purpose |
|---|---|
| `split_open` | Find the cut points in the recording. Opens the panel |
| `split_edit` | Change settings, edit cells by row, add or remove rows |
| `split_status` | Show the current rows, issues and summary |
| `split_export` | Write tracks/NN title.ext, tracks.csv, chapters.txt and album.cue |

Output goes to `audio-splitter/<project>/` in the workspace.

## Scope (v0.1)

- Needs ffmpeg installed (free; macOS: brew install ffmpeg; Windows: winget install ffmpeg).
- Copy mode cuts on the nearest audio frame; choose a re-encode format for sample-exact cuts.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `audio-splitter/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/audio-splitter/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-audio-splitter test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
