# Word Frequency

Count which words come up most in your documents and turn them into a word cloud. Open text or Markdown files, or a whole folder; Chinese is split into real words and English is lower-cased, with common stopwords (的, 了, the, and…) removed and your own stopwords added on top. Optionally count two- and three-word phrases. Drop words you don't want, fold synonyms together (顾客 into 客户, AI into 人工智能), then export a frequency table with per-file counts, a CSV and a word cloud in SVG and PNG with your choice of shape and colours. Runs locally; no account or API keys.

## Features

- **Chinese and English** in the same file: real word segmentation for Chinese, case folding for English; Markdown links, code blocks and URLs are ignored.
- **Stopwords**: built-in Chinese and English lists plus your own; minimum word length; numbers optional.
- **Phrases**: optional 2- and 3-word phrases.
- **Clean-up**: drop words or merge synonyms; your choices survive changes to stopwords.
- **Word cloud**: rectangle, banner or ellipse, four palettes, some words vertical, any background.
- **Exports**: XLSX (ranking + per-file counts), CSV, SVG and PNG.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `word-frequency/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Count word frequencies in the reports folder"
- "Merge 顾客 into 客户 and add 季度 as a stopword"
- "Export the word cloud"

## Tools

| Tool | Purpose |
|---|---|
| `wordfreq_open` | Read the files and count words. Opens the panel |
| `wordfreq_edit` | Change settings, edit cells by row, add or remove rows |
| `wordfreq_status` | Show the current rows, issues and summary |
| `wordfreq_export` | Write word-frequency.xlsx, word-frequency.csv, wordcloud.svg and wordcloud.png |

Output goes to `word-frequency/<project>/` in the workspace.

## Scope (v0.1)

- The list keeps the top 300 words.
- Reads .txt and .md files; convert Word/PDF to text first.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `word-frequency/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/word-frequency/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-word-frequency test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: exceljs (MIT), resvg-wasm (MPL-2.0), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
