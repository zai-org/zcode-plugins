# Sheet Diff

Compare two versions of a spreadsheet — last month's and this month's price list, two exports of a customer list — and see exactly which rows were added, which were removed and which cells changed, old value next to new. Rows are matched by an ID column such as 货号, so re-sorted rows are not flagged; small number differences and extra spaces can be ignored. Export a highlighted Excel, a change list and a report. Runs locally; no API keys.

## Features

- **Smart matching**: rows are matched by a key column found automatically (the first column unique in both, like 货号) or one or more columns you choose; by position when there is no key.
- **Every change**: added rows, removed rows and changed cells with old and new values; added or removed columns and duplicate keys are reported.
- **No false alarms**: 199 vs 199.0 is equal; optional numeric tolerance, ignore extra spaces, ignore case.
- **Highlighted Excel**: the new version with changed cells in yellow (old value as a note), new rows green, new columns blue; removed rows on their own sheet; plus the change list.
- **Notes**: add a note to any change (e.g. “涨价已通知”); it's kept in the exports.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `sheet-diff/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "What changed between 价目表-10月.xlsx and 价目表-11月.xlsx?"
- "Match rows by 门店 and 货号"
- "Ignore differences smaller than 0.01"

## Tools

| Tool | Purpose |
|---|---|
| `sheetdiff_open` | Compare two tables and list added, removed and changed rows. Opens the panel |
| `sheetdiff_edit` | Change settings, edit cells by row, add or remove rows |
| `sheetdiff_status` | Show the current rows, issues and summary |
| `sheetdiff_export` | Write diff.xlsx (new version highlighted, removed rows, change list), changes.csv and diff.html |

Output goes to `sheet-diff/<project>/` in the workspace.

## Scope (v0.1)

- Two tables at a time, the first non-empty sheet of each .xlsx.
- Compares values, not formatting or formulas.
- Up to about 100,000 rows per table.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `sheet-diff/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/sheet-diff/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-sheet-diff test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
