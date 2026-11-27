# Timesheet Report

Turn time logs into client statements. Open a CSV or Excel export from your time tracker, or a sheet you keep by hand, and it totals the hours by client, project and person. It applies your hourly rates and rounding, leaves internal work unbilled, and flags duplicates, overlapping times and entries with no rate. Export an Excel summary and one statement PDF per client, ready to send with an invoice. Runs locally; no upload or API keys.

## Features

- **Any log**: CSV, TSV or Excel with Chinese or English headers — date, client, project, task, person, hours or start/end times, billable, rate.
- **Hours in any form**: 1.5, 1:30, 1h30m, 90m, 1小时30分, or start and end times, including work past midnight.
- **Rates**: a default rate plus lines like Client = 300, Client/Project = 360, @Person = 200; the most specific one wins, and any entry can have its own rate.
- **Rounding**: per entry up to 6, 15, 30 or 60 minutes, or to the nearest 15 minutes.
- **Non-billable work**: from a billable column or keywords such as 内部 / internal; shown on statements but not charged.
- **Checks**: duplicates, overlapping times for the same person, entries over 12 hours, missing dates or hours, billable work with no rate, entries outside the period.
- **Outputs**: Excel with entries, client/project and person summaries; a statement PDF per client with project subtotals, tax and total; a summary CSV.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `timesheet-report/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Summarise November's time log by client"
- "Make a statement PDF for each client at these rates"
- "Which entries look duplicated or overlap?"

## Tools

| Tool | Purpose |
|---|---|
| `timesheet_open` | Read the time logs and total them by client and project. Opens the panel |
| `timesheet_edit` | Change settings, edit cells by row, add or remove rows |
| `timesheet_status` | Show the current rows, issues and summary |
| `timesheet_export` | Write timesheet.xlsx, one statement PDF per client and summary.csv |

Output goes to `timesheet-report/<project>/` in the workspace.

## Scope (v0.1)

- Makes statements, not tax invoices — attach the statement to your own invoice.
- One currency per project.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `timesheet-report/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/timesheet-report/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-timesheet-report test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
