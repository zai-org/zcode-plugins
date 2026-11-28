# Rent Ledger

Keep the rent book for a few rental rooms or flats: tenants, leases and payments in two sheets, and the plugin works out what each tenant owes, what's overdue and by how many days, and prints receipts. Rent is charged per lease cycle (monthly, quarterly, half-yearly, yearly) on each tenant's rent day, the last part-month is charged by day, and payments go to the oldest unpaid rent first, so part payments and advance payments just work. Catches payments for a room that doesn't exist (suggesting the right one for typos like 3O2), duplicate payments, unreadable dates and amounts, payments after a lease ended, rent paid late and leases about to end. Exports a ledger workbook (tenants with balances, rent schedule, payments and what each one paid for, arrears), receipts with amounts in figures and Chinese capitals (大写), and polite overdue reminders ready to paste into a chat. No account or API keys; runs on your computer.

## Features

- **Schedule**: monthly, quarterly, half-yearly or yearly rent from each lease, last part-month by day.
- **Payments**: oldest rent first, part payments, advance credit, receipt numbers.
- **Checks**: unknown rooms with typo suggestions, duplicates, overdue days, late payments, leases ending soon.
- **Exports**: ledger workbook, receipts with 大写 amounts, paste-ready reminders.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `rent-ledger/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Check who still owes rent in 房租"
- "Record today's payment from 201"
- "Print receipts and overdue reminders"

## Tools

| Tool | Purpose |
|---|---|
| `rent_open` | Read tenants and payments and work out balances. Opens the panel |
| `rent_edit` | Change settings, edit cells by row, add or remove rows |
| `rent_status` | Show the current rows, issues and summary |
| `rent_export` | Write ledger.xlsx, receipts.pdf and reminders.md |

Output goes to `rent-ledger/<project>/` in the workspace.

## Scope (v0.1)

- Rent only; utilities and deposits are recorded but not billed.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `rent-ledger/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/rent-ledger/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-rent-ledger test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
