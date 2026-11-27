# Subtitle Editor

Fix subtitles that drift or read too fast. Open an SRT, WebVTT or ASS file, shift everything by a few seconds, convert between frame rates, or line it up with two sync points. Edit any cue's text or times, split long cues and merge short ones, and see every overlap, too-fast reading speed, overlong line and blink-and-miss cue flagged with the new timing. Export clean SRT, VTT and ASS files plus a check report. Runs locally; no upload or API keys.

## Features

- **Retime**: shift by seconds (or a time), convert 23.976 / 24 / 25 / 29.97 fps, or give sync points — one shifts, two or more stretch piece by piece.
- **Proofread**: edit text and times cell by cell; split a cue at “|”, between lines or near the middle; merge with the next; delete.
- **Checks**: overlaps, reading speed (chars per second, CJK counts double), line width, line count and too-short cues, with a timeline view.
- **Fix overlaps** automatically with a minimum gap you choose.
- **Convert**: SRT ⇄ WebVTT ⇄ ASS; ASS styles are kept when the input is ASS, and <i>/<b> become ASS tags.
- **Report**: a CSV of every flagged cue for whoever does the next pass.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `subtitle-editor/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Shift episode.srt 1.5 seconds later"
- "Convert this ASS file to SRT and VTT"
- "Check my subtitles for overlaps and lines that are too fast to read"

## Tools

| Tool | Purpose |
|---|---|
| `subtitle_open` | Read the subtitle file and list every cue. Opens the panel |
| `subtitle_edit` | Change settings, edit cells by row, add or remove rows |
| `subtitle_status` | Show the current rows, issues and summary |
| `subtitle_export` | Write SRT, VTT, ASS and the check report |

Output goes to `subtitle-editor/<project>/` in the workspace.

## Scope (v0.1)

- One UTF-8 subtitle file at a time; no video preview or speech recognition.
- ASS override tags are kept only on cues you don't edit.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `subtitle-editor/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/subtitle-editor/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-subtitle-editor test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
