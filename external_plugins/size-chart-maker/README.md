# Size Chart Maker

Make size-chart images for product pages from a measurement sheet. Open a CSV or Excel file with one row per size (S/M/L, 160/84A, 36…) and one column per measurement (chest, length, shoulder, sleeve…; numbers or ranges like 88-92). Typos such as a letter O instead of 0 and measurements that shrink as the size grows are flagged so you can fix them. Show centimetres, inches or both, headers in Chinese, English or both, pick a clean, bold or boutique style and highlight the recommended size, then export a sharp PNG, an SVG, an HTML table to paste into your shop page and a cleaned Excel file. Runs locally; no account or API keys.

## Features

- **Any garment**: the first column is the size, every other header becomes a measurement column; numbers, ranges and units in cells are understood.
- **Checks**: non-numeric values (e.g. 7O), empty cells, duplicate sizes and measurements that shrink as sizes grow.
- **Units**: cm, inches or both, converted from whichever unit the sheet uses; weight and shoe-size columns are left as typed.
- **Bilingual headers**: common Chinese measurement names get English labels (胸围 Chest, 衣长 Length…).
- **Three styles** with an accent colour and a highlighted recommended size.
- **Exports**: 2× PNG, SVG, a paste-ready HTML table and a clean XLSX.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `size-chart-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a size chart from sizes.csv"
- "Show cm and inches with bilingual headers"
- "Highlight size L and export the PNG"

## Tools

| Tool | Purpose |
|---|---|
| `sizechart_open` | Read the measurement sheet and check the values. Opens the panel |
| `sizechart_edit` | Change settings, edit cells by row, add or remove rows |
| `sizechart_status` | Show the current rows, issues and summary |
| `sizechart_export` | Write size-chart.png, size-chart.svg, size-chart.html and size-chart.xlsx |

Output goes to `size-chart-maker/<project>/` in the workspace.

## Scope (v0.1)

- Measurement columns come from the file's headers; to add or rename one, edit the sheet and reopen.
- Size conversion between regions (CN/EU/US) is not included in v0.1.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `size-chart-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/size-chart-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-size-chart-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: exceljs (MIT), resvg-wasm (MPL-2.0), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
