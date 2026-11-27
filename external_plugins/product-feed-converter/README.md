# Product Feed Converter

Turn one product sheet into the import files online stores and shopping ads expect. From a single list of products and variants — SKU, title, description, prices, brand, category, images, stock, barcodes and colour/size options — write a Shopify-style product import CSV, a WooCommerce-style product import CSV and a shopping-ads product feed in RSS/XML. It also reads those store exports back in, so you can move a catalogue from one format to another. Before exporting, it checks every row against each format's required fields and lists what to fix. Runs locally; no store login or API keys.

## Features

- **One sheet in, three formats out**: a Shopify-style import CSV (variants on rows sharing a handle, extra images on their own rows), a WooCommerce-style import CSV (variable parent + variation rows) and an RSS 2.0 shopping feed with g: fields.
- **Variants**: rows with the same group become one product; colour, size and material become options / attributes / variant fields.
- **Prices**: a lower sale price becomes the sale/compare-at pair in each format.
- **Reads store exports too**: Shopify-style and WooCommerce-style product CSVs are recognised and merged back into one row per variant.
- **Checks per format**: missing SKU, title or price, duplicate SKUs, sale price not below price, image and link URLs, GTIN check digits, missing description/image/link/brand for the feed, variants without or with duplicate options.
- **Issue list**: issues.csv with row, SKU, field and format; rows with feed errors are left out of the XML.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `product-feed-converter/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Convert products.xlsx into import files"
- "Which rows would fail the shopping feed?"
- "Read my store's product export and make the other formats"

## Tools

| Tool | Purpose |
|---|---|
| `feed_open` | Read the product sheet and check it. Opens the panel |
| `feed_edit` | Change settings, edit cells by row, add or remove rows |
| `feed_status` | Show the current rows, issues and summary |
| `feed_export` | Write products-shopify.csv, products-woocommerce.csv, product-feed.xml and issues.csv |

Output goes to `product-feed-converter/<project>/` in the workspace.

## Scope (v0.1)

- Files follow the published import layouts; this plugin is not affiliated with Shopify, WooCommerce or any ads platform and does not upload anything.
- Images must already be online. Full https URLs work as they are; relative paths such as `img/a.jpg` are joined to the store URL when one is set.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `product-feed-converter/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/product-feed-converter/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-product-feed-converter test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
