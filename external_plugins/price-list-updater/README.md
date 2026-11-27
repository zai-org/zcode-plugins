# Price List Updater

Change a whole price list in one go: raise drinks 5%, add 1 to one supplier, set a single SKU to 12.90, or price everything from cost plus a markup — then round to charm prices like 12.9, 12.99 or 19. Every row shows old price, new price, change and margin; override any single price and it stays when you tweak the rules. Low margins, prices under cost, big jumps and rules that match nothing are flagged. Export the updated sheet with all your original columns (changed prices highlighted, old price in a note) and a before/after CSV. Runs locally; no store login or API keys.

## Features

- **Rules, first match wins**: “分类=饮料,零食: +5%”, “供应商=绿源: +1”, “SKU=A001: =12.9”, “名称=有机: x1.1”, “全部: 成本+40%”.
- **Charm rounding**: to 0.01, 0.1, 1 or 0.5, or ending in .99, .9, .8 or 9 — rounded up, down or to the nearest.
- **Override single prices**: type a new price in the grid; it is marked as manual and kept when rules change.
- **Checks**: margin under your minimum, below cost, changes over a set %, rules that match nothing, rule typos.
- **Your sheet, updated**: all original columns and order kept; changed prices highlighted red (up) or green (down) with the old price as a note, plus a 改价对照 / Changes sheet.
- **Before/after CSV** with only the changed items, for staff or a POS import.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `price-list-updater/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Raise drinks 5% and everything else 3%, ending in .9"
- "Price fresh food at cost + 50%"
- "Show the before/after list"

## Tools

| Tool | Purpose |
|---|---|
| `prices_open` | Read the price list and apply the rules. Opens the panel |
| `prices_edit` | Change settings, edit cells by row, add or remove rows |
| `prices_status` | Show the current rows, issues and summary |
| `prices_export` | Write updated-prices.xlsx and price-changes.csv |

Output goes to `price-list-updater/<project>/` in the workspace.

## Scope (v0.1)

- One price column per sheet; the first sheet of a workbook is used.
- Prices only — it does not change stock or publish to a store.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `price-list-updater/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/price-list-updater/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-price-list-updater test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
