# BOM Costing

Roll up a multi-level bill of materials into unit costs and turn a production plan into a purchase list. Reads an item sheet (code, make or buy, price or added labour, stock, MOQ, pack multiple, lead time, supplier) and a BOM sheet (parent, component, quantity, scrap %) from Excel or CSV. Costs every product and sub-assembly bottom-up including scrap, explodes the build plan level by level using sub-assemblies and parts already in stock, and rounds purchases up to minimum order quantities and pack sizes. Catches components missing from the item list (and suggests the right code for typos like P-OO5), BOM loops, missing prices, bad quantities and scrap rates, duplicate BOM lines, made items with no BOM, unused items and long lead times. Exports a costed workbook (indented BOM per product with extended quantities and costs, cost summary, requirements, purchase list by supplier), a purchase list CSV and printable cost sheets. No account or API keys; runs on your computer.

## Features

- **Costing**: bottom-up through all levels, with scrap and added labour per assembly.
- **Requirements**: level-by-level explosion of a build plan, netting off stock of parts and sub-assemblies.
- **Purchasing**: MOQ and pack-multiple rounding, grouped by supplier, long lead times flagged.
- **Checks**: missing components with typo suggestions, loops, missing prices, duplicates, unused items.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `bom-costing/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Cost the BOM in 台灯BOM"
- "Plan purchases for 300 LAMP-01 and 150 LAMP-02"
- "Export the costed BOM and purchase list"

## Tools

| Tool | Purpose |
|---|---|
| `bom_open` | Read the items and BOM and roll up costs. Opens the panel |
| `bom_edit` | Change settings, edit cells by row, add or remove rows |
| `bom_status` | Show the current rows, issues and summary |
| `bom_export` | Write costed-bom.xlsx, purchase-list.csv and cost-sheets.pdf |

Output goes to `bom-costing/<project>/` in the workspace.

## Scope (v0.1)

- No scheduling by date or open purchase orders; stock is on hand only.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `bom-costing/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/bom-costing/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-bom-costing test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
