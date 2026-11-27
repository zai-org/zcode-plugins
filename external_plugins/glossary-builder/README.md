# Glossary Builder

Turn a pile of documents into a bilingual glossary. Open text or Markdown files, or a folder, in Chinese and/or English; recurring terms and compound phrases are found automatically, with an example sentence for each, and nested fragments are folded into the full term. Translations are picked up from the documents themselves wherever they write a term with its translation in brackets, such as 会员积分（Loyalty Points）, and from your existing glossary if you include it; where the old glossary and the documents disagree, you are told. Drop noise, fill in or fix translations, add terms by hand, then export Excel, CSV, Markdown and TBX for translation tools like Trados and memoQ. Runs locally; no account or API keys.

## Features

- **Term extraction** for Chinese and English: recurring 1–4-word phrases and compounds, ranked by frequency, length and spread across files, with nested fragments removed.
- **Translations from the text**: 中文（English） and English (中文) pairs are recognised.
- **Existing glossary**: include a CSV/XLSX and its translations and notes are merged; disagreements with the documents are flagged.
- **Example sentences** for every term.
- **Editing**: keep/drop, translate, add notes and new terms; your edits survive a re-scan.
- **Exports**: XLSX (missing translations highlighted), CSV, Markdown and TBX-Basic.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `glossary-builder/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Build a glossary from the docs folder"
- "储值卡 should be Stored Value Card; add 满减 = Spend-and-save"
- "Export TBX for Trados"

## Tools

| Tool | Purpose |
|---|---|
| `glossary_open` | Read the documents and find candidate terms. Opens the panel |
| `glossary_edit` | Change settings, edit cells by row, add or remove rows |
| `glossary_status` | Show the current rows, issues and summary |
| `glossary_export` | Write glossary.xlsx, glossary.csv, glossary.tbx and glossary.md |

Output goes to `glossary-builder/<project>/` in the workspace.

## Scope (v0.1)

- Candidates are statistical; review the list before publishing.
- Does not machine-translate: translations come from the documents, the old glossary or you.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `glossary-builder/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/glossary-builder/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-glossary-builder test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: exceljs (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
