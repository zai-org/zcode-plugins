# CSV Cleaner

Clean up a messy CSV or Excel export in one pass — stray and double spaces, full-width digits and letters, money text like ¥1,280.00, mixed date formats, upper-case emails, phone numbers with dashes and brackets, empty rows and columns, and duplicate rows. Column types are detected for you, every change is listed, and values that can't be cleaned are flagged. Chinese-Excel GBK CSVs open correctly. Runs locally; no API keys.

## Features

- **Text**: trim, collapse double spaces, full-width digits/letters/@ to half-width (Chinese punctuation is left alone).
- **Typed columns**: numbers (¥1,280.00, (500), ２５６０ → numbers), dates (2026/11/3, 2026年11月5日, 11/20/2026, 2026.11.21 → 2026-11-03), emails (lower-case + validity check), phones (digits, keeps +).
- **Rows and columns**: drop empty rows and empty columns; remove duplicates by whole row or by key columns such as 客户名称.
- **You stay in control**: types are detected per column and can be overridden (金额=text); each rule can be turned off; edit any cell in the table.
- **Traceable**: cleaned.xlsx highlights changed cells with the old value as a note and keeps removed rows on a “removed” sheet; changes.csv lists every change.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `csv-cleaner/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Clean up 客户名单-导出.csv"
- "Treat two rows with the same 客户名称 as duplicates"
- "Export the cleaned Excel and the change log"

## Tools

| Tool | Purpose |
|---|---|
| `clean_open` | Read the table, detect column types and preview every clean-up. Opens the panel |
| `clean_edit` | Change settings, edit cells by row, add or remove rows |
| `clean_status` | Show the current rows, issues and summary |
| `clean_export` | Write cleaned.xlsx (changes highlighted, removed rows on a second sheet), cleaned.csv and changes.csv |

Output goes to `csv-cleaner/<project>/` in the workspace.

## Scope (v0.1)

- One table (first non-empty sheet of an .xlsx) up to 50,000 rows.
- No fuzzy matching of near-duplicates (e.g. “青禾茶业” vs “青禾茶业有限公司”) in v0.1.
- Formulas are read as their values; .xls must be saved as .xlsx first.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `csv-cleaner/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/csv-cleaner/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-csv-cleaner test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
