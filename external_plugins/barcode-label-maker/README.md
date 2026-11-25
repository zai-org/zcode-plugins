# Barcode Label Maker

Turn a product sheet into barcode labels: EAN-13 and UPC-A with check-digit verification, Code 128 for SKUs and anything else, with product name and price, laid out on common A4/Letter label sheets (3×8, 4×10, 2×7, 5×13, 3×10). Set copies per product, skip labels already used on a sheet, fix codes in the panel and export a print-ready PDF plus SVG barcodes. Runs locally; no API keys.

## Features

- **Columns**: sku/货号, name/品名, price/售价, barcode/条码, qty/数量 (copies), in Chinese or English.
- **Barcode rules**: 13 digits → EAN-13 with the check digit verified; a valid 12-digit UPC-A stays UPC-A; other 12-digit numbers get the EAN-13 check digit added; wrong check digits, letters or an empty barcode (the SKU is used) → Code 128. Every fallback is explained in the issue list.
- **Label sheets**: A4 3×8, 4×10, 2×7, 5×13 and Letter 3×10, with an outline option for a test print and “skip used labels” for partly used sheets.
- **Label content**: optional name and price, bars sized to the label with quiet zones, human-readable digits under the bars.
- **Output**: labels.pdf (print at 100% / actual size), one SVG per product and a CSV of the encoded values.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `barcode-label-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make barcode labels for 店铺/products.xlsx on A4 3×8 label paper"
- "Print 6 labels for the mug, and start at label 10 because the sheet is partly used"
- "Export the label PDF and SVG barcodes"

## Tools

| Tool | Purpose |
|---|---|
| `labels_open` | Read the product sheet and encode every barcode. Opens the panel |
| `labels_edit` | Change settings, edit cells by row, add or remove rows |
| `labels_status` | Show the current rows, issues and summary |
| `labels_export` | Write labels.pdf for the chosen label sheet, svg/<sku>.svg and barcodes.csv |

Output goes to `barcode-label-maker/<project>/` in the workspace.

## Scope (v0.1)

- Linear barcodes only (EAN-13, UPC-A, Code 128); for QR codes use a QR tool. No GS1-128 application identifiers in v0.1.
- Barcode numbers are not registered for you — use numbers your business owns (e.g. from GS1) for retail.
- Custom label sizes beyond the five presets are not in v0.1.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `barcode-label-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/barcode-label-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-barcode-label-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: pdf-lib (MIT), fontkit (MIT), ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
