# Pivot Report

Turn a detail table into a summary report the way an Excel pivot table does — group by store, category, salesperson or anything else, spread months or quarters across the top, and sum, count or average a value — without fiddling with Excel's pivot menus. Percentages, top N and a bar chart included; export a clean Excel report, CSV or a printable HTML page. Runs locally; no API keys.

## Features

- **Pivot fields**: one or more row fields, an optional column field, a value field with sum, count, average, min, max or distinct count.
- **Dates**: date columns grouped by day, ISO week, month, quarter or year.
- **Read it fast**: grand totals, % of row/column/grand total, sort by value, keep the top N (the rest still counts in totals), and a bar chart.
- **Smart start**: row and value fields are suggested from the data (e.g. 品类 and 金额); money text like ¥1,000 is summed correctly.
- **Export**: Excel report with number formats and a totals row plus the source data, CSV, and an HTML page you can print to PDF.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `pivot-report/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Summarise 订单明细-2026.xlsx: sales by store and month"
- "Show each store's share of the total"
- "Only the top 5 products by amount"

## Tools

| Tool | Purpose |
|---|---|
| `pivot_open` | Read the detail table and build a pivot with suggested fields. Opens the panel |
| `pivot_edit` | Change settings, edit cells by row, add or remove rows |
| `pivot_status` | Show the current rows, issues and summary |
| `pivot_export` | Write pivot.xlsx (pivot, % and source data sheets), pivot.csv and pivot.html with a bar chart |

Output goes to `pivot-report/<project>/` in the workspace.

## Scope (v0.1)

- One table up to the first non-empty sheet; no joins between tables.
- Calculated fields and filters by value are not in v0.1 (filter the source first).
- The chart shows the first 15 rows by row total.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `pivot-report/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/pivot-report/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-pivot-report test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
