# Invoice Maker

Turn a sheet of line items (.xlsx/.csv) into numbered PDF invoices: rows are grouped by invoice number or client, amounts, tax and totals are calculated, and bad numbers or missing clients are flagged. Fix any cell in the panel, preview the invoice and export one PDF per invoice plus an Excel/CSV ledger. Runs locally; no API keys.

## Features

- **Input**: one row per line item. Chinese or English column names (发票号 / invoice no., 客户 / client, 地址 / address, 项目 / item, 数量 / qty, 单价 / price, 税率 / tax) are matched automatically; prices like `¥26,000` or `$320.00` and quantities like `一` are understood.
- **Grouping and numbering**: rows with the same invoice number form one invoice; rows without a number are grouped by client and numbered from your prefix and first number (e.g. INV-0001).
- **Checks**: non-numeric quantities and prices, tax rates outside 0–100, missing clients, one invoice number used for two clients, missing addresses and invoices that will not fit on one page.
- **PDF**: your business name and details, client block, item table, subtotal, tax and total, payment due date and notes; Chinese, English or bilingual labels; A4 or Letter; accent colour. Chinese text uses a font already on your computer.
- **Ledger**: invoices.xlsx (summary and lines), invoices.csv and an HTML list.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `invoice-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make invoices from billing/invoices-2026-11.xlsx with 6% tax, our company name Penova Labs, due in 30 days"
- "Change the support hours for Northwind to 5 and switch the invoices to USD in English"
- "Export the invoices as PDFs and the ledger"

## Tools

| Tool | Purpose |
|---|---|
| `invoice_open` | Read the line-item sheet, group rows into invoices and check them. Opens the panel |
| `invoice_edit` | Change settings, edit cells by row, add or remove rows |
| `invoice_status` | Show the current rows, issues and summary |
| `invoice_export` | Write one PDF per invoice, all-invoices.pdf, invoices.xlsx/.csv and an HTML list |

Output goes to `invoice-maker/<project>/` in the workspace.

## Scope (v0.1)

- One currency per project; tax is a percentage per line (no compound or withholding taxes).
- One page per invoice (about 20 lines). Not an official tax invoice (e.g. China fapiao or EU e-invoice formats); nothing is sent by email.
- Old .xls files: save as .xlsx first.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `invoice-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/invoice-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-invoice-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: pdf-lib (MIT), fontkit (MIT), ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
