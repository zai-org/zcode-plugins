# Bilingual Aligner

Line up a document and its translation sentence by sentence and turn them into a translation memory. Pick the source and the translation (text, Markdown or Word); both are split into sentences and aligned with a proven length-based method plus number anchors, so one sentence translated as two, or two merged into one, still line up. Rows that need a look are flagged: sentences with no counterpart, odd length ratios, and numbers that differ between the two sides, which often reveals real translation errors. Fix text, merge rows or drop them, then export Excel, TMX for translation tools such as Trados, memoQ and OmegaT, a tab-separated file and a side-by-side HTML. Runs locally; no account or API keys.

## Features

- **Reads .txt, .md and .docx** (body paragraphs).
- **Sentence splitting** for Chinese and English, with quotes, abbreviations (Dr., e.g.) and decimals handled.
- **Gale–Church alignment** with number anchors; 1-1, 1-2, 2-1, 2-2 and unmatched sentences; paragraphs aligned first when their counts match.
- **QA flags**: unmatched sentences, unusual length ratios, numbers that differ.
- **Editing**: change either side, merge a row with the next, drop rows, add rows.
- **Exports**: XLSX, TMX 1.4, TSV and side-by-side HTML.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `bilingual-aligner/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Align 隐私政策.txt with privacy-policy-en.docx"
- "Fix the number mismatch and merge the title with the first sentence"
- "Export TMX"

## Tools

| Tool | Purpose |
|---|---|
| `align_open` | Split both files into sentences and align them. Opens the panel |
| `align_edit` | Change settings, edit cells by row, add or remove rows |
| `align_status` | Show the current rows, issues and summary |
| `align_export` | Write aligned.xlsx, aligned.tmx, aligned.tsv and aligned.html |

Output goes to `bilingual-aligner/<project>/` in the workspace.

## Scope (v0.1)

- Two files per project; for many file pairs open one project per pair.
- Tables, footnotes and text boxes in .docx are not read in v0.1.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `bilingual-aligner/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/bilingual-aligner/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-bilingual-aligner test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: exceljs (MIT), fflate (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
