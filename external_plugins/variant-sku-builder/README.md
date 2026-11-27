# Variant & SKU Builder

List a product's options — colour, size, material — and get every variant with a clean SKU code, price and stock in seconds. Give each option value a short code and an optional price change (+10 or +5%) or stock figure, choose a SKU pattern such as TEE01-BK-XL, and switch off combinations you don't sell. Change any single variant's SKU, price or stock by hand; your edits stay when you later change the options or pattern. Duplicate SKUs, codes with Chinese characters or spaces and bad barcodes are flagged. Export the variant list as Excel and CSV. Runs locally; no store login or API keys.

## Features

- **Options in one line each**: “颜色: 黑色=BK, 白色=WH; 尺码: S, M, L, XL(+10)” — or an options sheet (规格名, 规格值, 编码, 加价, 库存).
- **SKU patterns**: {base}, {1} {2} {3} for option codes, {尺码} by option name, {n} for a running number; upper-case on request.
- **Price and stock rules**: per-value price changes (+10, -5, +5%) and stock figures (the lowest applies).
- **Skip combinations**: “白色+XXL; 燕麦+S” switches those off; tick any variant on or off by hand.
- **Edits that stick**: manual SKUs, prices, stock, names, barcodes and weights stay when options or rules change.
- **Checks**: duplicate SKUs, non-ASCII or very long SKUs, unknown pattern tokens, prices of 0, barcodes with the wrong number of digits.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `variant-sku-builder/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Build the variants from options.xlsx"
- "Use the pattern {base}-{1}-{2} and skip White + XXL"
- "XL and XXL cost 10 and 20 more"

## Tools

| Tool | Purpose |
|---|---|
| `variants_open` | Read the options and build every variant. Opens the panel |
| `variants_edit` | Change settings, edit cells by row, add or remove rows |
| `variants_status` | Show the current rows, issues and summary |
| `variants_export` | Write variants.xlsx and variants.csv |

Output goes to `variant-sku-builder/<project>/` in the workspace.

## Scope (v0.1)

- Up to 3 options per product (the limit most stores use).
- One product per project.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `variant-sku-builder/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/variant-sku-builder/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-variant-sku-builder test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
