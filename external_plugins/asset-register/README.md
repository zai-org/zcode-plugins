# Asset Register

Keep a small company's fixed-asset register in a spreadsheet and get QR asset tags, a depreciation schedule and a stocktake checklist from it. Depreciation is monthly from the month after purchase, straight-line, double-declining (last two years straight-line) or sum-of-years, with default useful lives per category and a residual as a percentage or an amount; see accumulated depreciation and net book value as of any date. Catches duplicate or missing asset numbers, the same serial number entered twice, unreadable dates and costs, residuals that aren't below cost, assets with no useful life, checked-out items with no holder or overdue, assets with no location and fully depreciated assets still in use. Exports A4 sheets of QR labels (50×30 or 70×40 mm), a depreciation workbook (register, yearly schedule, totals by category and location, checked-out list) and a stocktake sheet by location with check boxes. No account or API keys; runs on your computer.

## Features

- **Depreciation**: straight-line, double-declining, sum-of-years; monthly from the month after purchase; default lives per category.
- **Tags**: QR labels with asset number, name, location; 50×30 or 70×40 mm on A4.
- **Checks**: duplicate numbers and serials, bad dates/costs, residual ≥ cost, missing life, overdue or ownerless check-outs, no location.
- **Exports**: depreciation workbook with yearly schedule and totals, QR tags, stocktake checklist.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `asset-register/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make asset tags from 资产"
- "Work out depreciation as of month end"
- "Export the register, tags and stocktake sheet"

## Tools

| Tool | Purpose |
|---|---|
| `asset_open` | Read the asset list and compute depreciation. Opens the panel |
| `asset_edit` | Change settings, edit cells by row, add or remove rows |
| `asset_status` | Show the current rows, issues and summary |
| `asset_export` | Write asset-tags.pdf, depreciation.xlsx and stocktake.pdf |

Output goes to `asset-register/<project>/` in the workspace.

## Scope (v0.1)

- Management accounts only; not a tax depreciation calculator; no impairment or revaluation.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `asset-register/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/asset-register/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-asset-register test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), node-qrcode (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
