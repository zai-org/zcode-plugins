# Sheet Merge & Split

Combine many Excel/CSV files — and every sheet inside a workbook — into one table, even when their columns are named differently (日期/Date, 金额/Amount (元)), with a column showing where each row came from. Or split one table into a sheet or a file per store, region, person or any other column. Missing columns are reported, numbers stay numbers. Runs locally; no API keys.

## Features

- **Merge**: up to 30 files and all their sheets; columns matched by name ignoring case, spaces and units — built-in synonyms for date, store, quantity, amount, price, product, customer and notes, plus your own rules (营业额=Revenue).
- **Know what's missing**: each source's row count and missing columns are listed; a 来源 column records the file and sheet.
- **Split**: by any column — chosen automatically or by you — into one workbook with a sheet per value or a separate .xlsx/.csv per value (zipped too).
- **Clean output**: numbers stay numbers, sheet and file names are made safe and unique.
- **Edit before export**: fix or add rows in the table.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `sheet-merge-split/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Merge 门店销售-2026Q4.xlsx (all sheets) and 线上订单-11月.csv into one table"
- "Treat 营业额 and Revenue as the same column"
- "Split the table by 门店 into one file per store"

## Tools

| Tool | Purpose |
|---|---|
| `sheets_open` | Read the tables, align their columns and preview the merge or split. Opens the panel |
| `sheets_edit` | Change settings, edit cells by row, add or remove rows |
| `sheets_status` | Show the current rows, issues and summary |
| `sheets_export` | Merge: merged.xlsx (+ sources sheet) and merged.csv. Split: by-<column>.xlsx with a sheet per value, or one file per value in split/ plus split.zip |

Output goes to `sheet-merge-split/<project>/` in the workspace.

## Scope (v0.1)

- Header row must be the first row of each sheet; merged cells and formulas are read as values.
- Up to 30 files; no lookups/joins between tables (that's a different job).
- .xls must be saved as .xlsx first.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `sheet-merge-split/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/sheet-merge-split/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-sheet-merge-split test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), fflate (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
