# Chinese Script Converter

Convert Chinese documents between Simplified and Traditional characters in bulk — Taiwan or Hong Kong character forms, and optionally regional wording too (软件 → 軟體, 鼠标 → 滑鼠, and back). Works on TXT, Markdown, SRT/VTT subtitles and Word .docx files. Add your own dictionary entries, list names that must stay exactly as written, review every changed line, fix the rare wrong pick by hand, then export converted copies plus a term list. Uses the open-source OpenCC dictionaries locally; no upload or API keys.

## Features

- **Ten directions**: Simplified → Traditional (Taiwan, Hong Kong or OpenCC standard) and back, each with or without regional wording.
- **Regional phrasing**: 软件/軟體, 鼠标/滑鼠, 打印机/印表機, 网络/網路 and thousands more from OpenCC's phrase lists, shown as chips with counts.
- **Your dictionary**: one source=target per line; it wins over the built-in one. Exclude list for names and brands that must not change.
- **Many formats**: TXT, Markdown (code, inline code and link URLs left alone), SRT/VTT subtitles (timings untouched), Word .docx (body, headers, footers, footnotes; run formatting kept).
- **Review first**: every changed line before/after; skip it or fix the wording; one-to-many characters outside known phrases are flagged for a second look.
- **Copies, not overwrites**: converted files in their own folder (optionally with converted file names), terms.csv and changes.csv.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `zh-convert/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Convert the docs folder to Traditional Chinese with Taiwan wording"
- "Turn this Traditional subtitle file into Simplified"
- "Convert to Traditional but keep our brand name 云帆 as is"

## Tools

| Tool | Purpose |
|---|---|
| `zhconv_open` | Read the files and list every line that would change. Opens the panel |
| `zhconv_edit` | Change settings, edit cells by row, add or remove rows |
| `zhconv_status` | Show the current rows, issues and summary |
| `zhconv_export` | Write converted copies, terms.csv and changes.csv |

Output goes to `zh-convert/<project>/` in the workspace.

## Scope (v0.1)

- UTF-8 text files; Word .docx (not .doc). PDFs and images are not converted.
- Dictionary-based conversion: it is very good but not perfect — check flagged lines.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `zh-convert/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/zh-convert/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-zh-convert test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: opencc-js (MIT; OpenCC dictionaries Apache-2.0), fflate (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
