# Product Catalog Maker

Turn a product spreadsheet and a folder of photos into a print-ready A4 catalog PDF and an editable web version. Rebuild whenever the spreadsheet changes — you get a list of what was added, removed or re-priced.

## What it does

- **Reads your spreadsheet** (CSV, TSV or XLSX; GBK CSVs from Chinese Excel work too) and recognises common column names in Chinese and English: SKU/编号/货号, name/名称, spec/规格, description/卖点, price/价格/售价, original price/原价/划线价, image/图片, category/分类, unit/单位. Any column can be mapped by hand.
- **Finds the photos**: by the image column (file name, case-insensitive, with or without extension) or by the SKU as file name, anywhere under the image folder. JPG and PNG; large photos are downscaled for a compact PDF.
- **A4 catalog PDF**: cover with logo, title, subtitle, product count, date and a contents page with page numbers; one section per category; 2×2, 2×3, 3×3 or 3×4 products per page; header with logo and category, footer with your contact line and page numbers; price highlighted in the brand colour, original price struck through, SKU and spec; "no image" placeholders. **Text is real text** (Chinese fonts embedded as subsets), so the PDF is searchable and copyable.
- **Editable HTML**: one self-contained `catalog.html` (images embedded) — click any text to edit it, print to PDF from the browser.
- **Checks**: missing names, prices that aren't numbers, missing prices, duplicate SKUs, missing or unmatched images, low-resolution photos, names too long to fit.
- **Change list**: every build saves `catalog.json`; the next build compares and writes `changes.md` / `changes.csv` (added, removed, price/name/category/photo changed).

## Usage

In ZCode Desktop, ask the agent:

- "Make a product catalog PDF from products.xlsx and the photos in images/ — 3 per row, our logo on the cover"
- "I changed some prices in the spreadsheet — rebuild the catalog and tell me what changed"
- "Which products in the catalog are missing photos or prices?"

Or open "Product Catalog Maker" from the session sidebar, pick the table and the image folder. Style and column mapping are on the left, problems and a live page preview on the right.

## Tools

| Tool | Purpose |
|---|---|
| `catalog_open` | Read the table, map columns, match photos, check, plan pages and open the panel |
| `project_save` | Save the settings as `.catalogmaker.json` |
| `catalog_build` | Write `catalog.pdf`, `catalog.html`, `catalog.json` and the change list |

## Scope (v0.1)

- One A4 portrait layout family with a grid per page; one language per catalog.
- Logo as PNG or JPG (export SVG logos to PNG first).
- Not in v0.1: InDesign/Word export, free-form layouts, side-by-side translations, print bleed / CMYK, QR codes.

## Privacy, network and file writes

- **Everything runs locally.** No network access, nothing is uploaded, no API keys or accounts.
- Reads the chosen spreadsheet, photos, logo and a system font; writes only inside the workspace (default `catalog/`, plus the `.catalogmaker.json` you choose). The spreadsheet and photos are never modified. No commands are executed and there are no hooks.

## Build and test (developers)

Source lives in `ui-plugins/product-catalog-maker/`. From the repository root run `pnpm install --frozen-lockfile && pnpm build`, add `dist/local-marketplace` as a local source in the ZCode plugin store and install. Tests: `pnpm --filter @penova/plugin-product-catalog-maker test` (column detection, image matching, problems, PDF/HTML output, change list) and `test:e2e` (browser panel test; point `E2E_CATALOG` at a folder with `products.csv` and photos).

## Third-party components and licenses

The plugin is MIT-licensed (author: Penova). Bundled dependencies: pdf-lib (MIT), fontkit (MIT), ExcelJS (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), pdf.js (Apache-2.0, panel preview), the MCP SDK and ext-apps (MIT). The full list ships in `dist/THIRD_PARTY_NOTICES.txt`. Test photos: Wikimedia Commons CC0 / public domain (`ui-plugins/product-catalog-maker/test/fixtures/SOURCES.md`), not part of the installed package.
