# Reorder Planner

Know what to reorder before it runs out. Combine a stock sheet with your sales history to get each item's daily sales, days of stock left and reorder point from its lead time and safety stock. Items that need restocking get a suggested quantity that covers the next few weeks, rounded up to whole cases and at least the supplier's minimum order; change any quantity by hand. See which items will run out before a new order can arrive. Export a purchase order PDF for each supplier and a reorder workbook. Runs locally; no ERP login or API keys.

## Features

- **Daily sales from your history**: a sales sheet (日期, 货号, 数量) averaged over the last N days — or a daily / 30-day sales column in the stock sheet.
- **Reorder point**: daily sales × (lead time + safety days); stock on order counts toward what you have.
- **Suggested quantity**: tops up to cover the next N days, rounded up to whole cases and at least the MOQ; type your own quantity to override.
- **Warnings**: items that will run out before a new order arrives, quantities below MOQ or not whole cases, negative stock, items without a supplier, SKUs sold but missing from the stock sheet.
- **Purchase orders**: one PDF per supplier with numbers, delivery date from the longest lead time, cases, unit costs, totals and signature lines.
- **Workbook**: the full plan (days left, reorder point, suggestion, order) with at-risk items highlighted, plus one sheet per supplier.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `inventory-reorder/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Plan reorders from stock.xlsx and sales.xlsx"
- "Keep 10 days of safety stock and order for 45 days"
- "Make the purchase orders for each supplier"

## Tools

| Tool | Purpose |
|---|---|
| `reorder_open` | Read stock and sales and suggest what to reorder. Opens the panel |
| `reorder_edit` | Change settings, edit cells by row, add or remove rows |
| `reorder_status` | Show the current rows, issues and summary |
| `reorder_export` | Write a purchase order PDF per supplier and reorder-plan.xlsx |

Output goes to `inventory-reorder/<project>/` in the workspace.

## Scope (v0.1)

- Demand is a simple average — no seasonality or promotions forecast in v0.1.
- One warehouse per project.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `inventory-reorder/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/inventory-reorder/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-inventory-reorder test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
