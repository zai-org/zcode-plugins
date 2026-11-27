# Loan Calculator

Compare mortgage and loan plans side by side before you sign. Enter each plan's amount, yearly rate, term and repayment method — equal monthly payments or equal principal — and add prepayments that shorten the term or lower the payment, or rate changes from a given month. See the first and highest monthly payment, total interest, payoff date and how much interest each plan saves, with a remaining-balance chart. Export a workbook with a month-by-month schedule for every plan and a chart page to share. Runs locally; no bank account or API keys.

## Features

- **Both methods**: 等额本息 (equal monthly payments) and 等额本金 (equal principal, decreasing payments).
- **Prepayments in plain words**: “2029-01:200000 缩短期限; 第36期:5万 减少月供” — shorten the term or lower the payment.
- **Rate changes**: “2028-01:2.9” takes effect from that month.
- **Side-by-side**: first and highest payment, total interest, payoff date and interest saved versus plan 1.
- **Workbook**: comparison plus a month-by-month schedule for each plan; prepayment months highlighted.
- **Chart page**: plan cards, remaining-balance lines and yearly totals.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `loan-calculator/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Compare the plans in plans.csv"
- "Add a 200,000 prepayment in 2029-01 that shortens the term"
- "What if the rate drops to 2.9% from 2028?"

## Tools

| Tool | Purpose |
|---|---|
| `loan_open` | Read the plans and compare them. Opens the panel |
| `loan_edit` | Change settings, edit cells by row, add or remove rows |
| `loan_status` | Show the current rows, issues and summary |
| `loan_export` | Write loan-schedule.xlsx and loan-report.html |

Output goes to `loan-calculator/<project>/` in the workspace.

## Scope (v0.1)

- Results are estimates; your bank's figures (day count, rounding, fees) may differ slightly.
- No provident-fund / commercial combined loans in v0.1 — enter them as separate plans.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `loan-calculator/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/loan-calculator/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-loan-calculator test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
