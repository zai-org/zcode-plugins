# Word Count Report

Count the words in a whole folder of manuscripts — Word documents, Markdown, plain text and PDFs — the way Chinese editors and translators count them: Chinese characters, Chinese punctuation and English words separately, with a 字数 total that matches Word. Every file is split into chapters by its headings or “第一章 / Chapter 1” lines, with reading time and an optional fee per thousand words. Leave out code blocks, tables, references and anything matching your own rules, or switch off single chapters. Export the report as Excel or CSV. Runs locally; no upload, account or API keys.

## Features

- **Chinese-aware counting**: CJK characters, CJK punctuation and other words separately; 字数 = all three, the same as Word's count. Japanese and Korean count as characters.
- **Many formats at once**: .docx, .md, .txt and text-based .pdf — single files or whole folders.
- **Chapters**: DOCX heading styles, Markdown # / ##, and “第一章 / 序章 / Chapter 1” lines in text and PDF.
- **Leave things out**: code blocks, tables, headings, everything from 参考文献 / References onward, paragraphs matching your text or /regex/ rules, or any chapter you switch off.
- **Reading time and fees**: reading speed for Chinese and English, and a rate per 1,000 words, characters or English words.
- **Report**: per chapter, per file and totals in Excel, plus a CSV.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `word-count-report/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Count the words in the manuscripts folder by chapter"
- "Leave out references and code blocks"
- "Work out the fee at ¥120 per 1,000 words"

## Tools

| Tool | Purpose |
|---|---|
| `wordcount_open` | Read the documents and count words per chapter. Opens the panel |
| `wordcount_edit` | Change settings, edit cells by row, add or remove rows |
| `wordcount_status` | Show the current rows, issues and summary |
| `wordcount_export` | Write word-count.xlsx and word-count.csv |

Output goes to `word-count-report/<project>/` in the workspace.

## Scope (v0.1)

- Scanned PDFs without a text layer count as 0 (no OCR).
- Footnotes, comments and text boxes in DOCX headers and footers are not counted.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `word-count-report/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/word-count-report/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-word-count-report test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), fflate (MIT), PDF.js (Apache-2.0), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
