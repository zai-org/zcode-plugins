# Packing Slips

Turn the orders you export from your shop into printed packing slips and one picking list. Lines with the same order number become one slip with the recipient, masked phone number, address, shipping method, tick boxes for every item, a gift-message box and a scannable order barcode. The picking list totals every SKU across all orders and sorts it by bin, so one walk through the shelves picks everything. Flags missing addresses, bad quantities and conflicting order details. Export the slips PDF and the picking list workbook. Runs locally; no shop login or API keys.

## Features

- **Shop exports welcome**: Chinese or English column names are matched; follow-on rows without an order number stay with the order above.
- **One slip per order**: recipient, phone masked as 138****5678 (optional), address, shipping method, items with tick boxes, bin and quantity, notes and a gift-message box.
- **Order barcode**: Code 128 of the order number for scanning at the packing desk.
- **Picking list**: every SKU and variant totalled across orders, sorted by bin, with the order numbers it goes to.
- **Checks**: missing recipients or addresses, quantities that aren't whole numbers, conflicting addresses within one order, repeated SKUs (merged), long gift messages.
- **Paper**: A4 or A5; optional prices; your shop name, return address and thank-you line.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `packing-slip-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make packing slips from orders.csv"
- "Print them on A5 and show prices"
- "Give me the picking list sorted by bin"

## Tools

| Tool | Purpose |
|---|---|
| `slips_open` | Read the orders and group them into slips. Opens the panel |
| `slips_edit` | Change settings, edit cells by row, add or remove rows |
| `slips_status` | Show the current rows, issues and summary |
| `slips_export` | Write packing-slips.pdf and picking-list.xlsx/.csv |

Output goes to `packing-slip-maker/<project>/` in the workspace.

## Scope (v0.1)

- No shipping labels or carrier waybills in v0.1 — use the carrier's own system.
- Order numbers with Chinese characters get no barcode (Code 128 is ASCII only).

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `packing-slip-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/packing-slip-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-packing-slip-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
