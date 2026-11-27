# Sales Commission

Work out each salesperson's commission from a sales sheet and hand out clear statements. Set tiered rates — progressive like tax brackets, or whole-tier where reaching a level pays that rate on everything — give products such as accessories or services their own rates, and let refunds and cancellations claw back what was paid. Filter to a month, see every line's rate and commission, and catch duplicate orders, refunds booked under the wrong person and names spelled two ways. Export a summary workbook and a one-page PDF statement per person. Runs locally; no CRM login or API keys.

## Features

- **Tiers in plain words**: “0-5万:3%; 5万-10万:5%; 10万+:8%” or “5万:3%; 10万:5%; 以上:8%”.
- **Two tier methods**: progressive (each slice at its own rate) or whole-tier (the reached rate on everything).
- **Product rates**: “配件:8%; 服务:12%” — lines in those categories (or, without a category, products whose name contains the word) get their own rate outside the tiers.
- **Clawbacks**: refunds and cancellations (status 退货/refund/cancel or a negative amount) reduce the period's sales and are clawed back at the same effective rate, even for last month's orders.
- **Checks**: duplicate order numbers, refunds booked under someone else, names spelled two ways, rows outside the period.
- **Exports**: a summary / lines / rules workbook and a one-page PDF statement per person with the tier breakdown and a signature line.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `sales-commission/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Work out October commissions from sales.xlsx"
- "Accessories pay 8% and services 12%, outside the tiers"
- "Switch to whole-tier rates and compare"

## Tools

| Tool | Purpose |
|---|---|
| `commission_open` | Read the sales and work out commissions. Opens the panel |
| `commission_edit` | Change settings, edit cells by row, add or remove rows |
| `commission_status` | Show the current rows, issues and summary |
| `commission_export` | Write commission.xlsx and one PDF statement per person |

Output goes to `sales-commission/<project>/` in the workspace.

## Scope (v0.1)

- One commission plan for everyone in v0.1 (no per-person targets or caps).
- Commission is on the amounts in the sheet; margins or costs aren't used.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `sales-commission/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/sales-commission/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-sales-commission test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
