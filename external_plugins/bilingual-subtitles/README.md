# Bilingual Subtitles

Merge two subtitle tracks — say Chinese and English — into one bilingual track, paired by timing. Lines that were split differently in each language are joined automatically, unmatched lines are shown so you can move or drop them, and you can fix any text or time before exporting bilingual SRT, WebVTT or a styled ASS with separate font size and colour for each language. Runs locally; no upload or API keys.

## Features

- **Pairs by timing**: each lower-track cue joins the upper cue it overlaps most; the overlap threshold is adjustable.
- **Different line breaks**: two English cues that make up one Chinese line are joined into one bilingual line.
- **Order**: Chinese/Japanese/Korean on top automatically, or choose either file.
- **Timing**: keep the upper track's times or cover both.
- **Fix by hand**: unmatched lines are flagged; edit text and times, or drop lines.
- **Styled ASS**: separate size and colour for each language; plain SRT and WebVTT too.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `bilingual-subtitles/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Merge en.srt and zh.srt into bilingual subtitles"
- "Make an ASS file with Chinese on top in white and English below in yellow"
- "Show me the lines that didn't match"

## Tools

| Tool | Purpose |
|---|---|
| `bilingual_open` | Read both files and pair their cues by timing. Opens the panel |
| `bilingual_edit` | Change settings, edit cells by row, add or remove rows |
| `bilingual_status` | Show the current rows, issues and summary |
| `bilingual_export` | Write bilingual SRT, VTT, ASS and pairs.csv |

Output goes to `bilingual-subtitles/<project>/` in the workspace.

## Scope (v0.1)

- Two UTF-8 subtitle files at a time; no translation.
- Cues are paired by time only, not by meaning.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `bilingual-subtitles/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/bilingual-subtitles/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-bilingual-subtitles test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
