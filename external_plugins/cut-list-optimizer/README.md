# Cut List Optimizer

Lay furniture and cabinet parts onto stock boards and get printable cutting diagrams, the number of boards to buy and edge-banding totals. Reads a parts list (name, length, width, quantity, material, grain, edge banding) and your board sizes and prices, then packs the parts guillotine-style — every cut goes straight across, as on a panel saw — biggest first, allowing for saw kerf and edge trim, and turning parts only when they have no grain. Catches parts larger than the board or that fit only across the grain, materials with no board (suggesting the near match), unreadable sizes, quantities and edge banding, and a last board that's almost empty. Exports a PDF with one labelled diagram per board, an SVG of all boards and a cut list workbook with every part's board and position, and boards, yield, cost and edge-banding metres per material. No account or API keys; runs on your computer.

## Features

- **Layout**: guillotine packing with kerf and edge trim; grain-locked parts never rotated.
- **Materials**: several board types with sizes and prices; board count, yield and cost each.
- **Edge banding**: 四边, 2长1短 or L2W1 per part; metres per material.
- **Checks**: oversized parts, cross-grain fits, unknown materials with suggestions, bad sizes, near-empty last board.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `cut-list-optimizer/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make cutting diagrams for the parts in 衣柜"
- "How many boards do I need?"
- "Export the cutting diagrams and cut list"

## Tools

| Tool | Purpose |
|---|---|
| `cut_open` | Read the parts and lay them out on boards. Opens the panel |
| `cut_edit` | Change settings, edit cells by row, add or remove rows |
| `cut_status` | Show the current rows, issues and summary |
| `cut_export` | Write cutting-diagrams.pdf, cutting-diagrams.svg and cut-list.xlsx |

Output goes to `cut-list-optimizer/<project>/` in the workspace.

## Scope (v0.1)

- Rectangular parts only; no offcut inventory or CNC output.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `cut-list-optimizer/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/cut-list-optimizer/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-cut-list-optimizer test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
