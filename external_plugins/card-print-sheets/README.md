# Card Print Sheets

Turn a folder of card images into print-ready sheets for board games, tarot, flash cards or business cards. Pick a card size (poker, bridge, tarot, mini, business, square or your own), add bleed, gap, paper and crop marks, and set how many copies of each card to print — from a counts sheet or by editing. Double-sided printing places a mirrored back page after each front page so backs line up on long- or short-edge flip, with a different back per card if you need one. Checks for images missing from the folder, low resolution at print size, art with the wrong shape or no bleed, double-sided cards without a back, bad counts, duplicates, sizes that don't fit the paper and empty slots on the last sheet. Exports print-sheets.pdf, backs.pdf and card-list.csv. Runs locally.

## Features

- **Sizes**: poker, bridge, tarot, mini, business, square or custom WxH mm; bleed, gap, A4/Letter/A3, portrait or landscape.
- **Double-sided**: mirrored back pages for long- or short-edge flip; one default back or a back per card.
- **Print marks**: crop marks at every trim line; art cropped to the card with cover or shown whole with contain.
- **Checks**: missing images, dpi at print size, wrong shape or no bleed, missing backs, bad counts, duplicates, empty slots.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `card-print-sheets/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Lay out the cards in 卡牌 for printing"
- "Make it double-sided with back.png"
- "Export the print sheets"

## Tools

| Tool | Purpose |
|---|---|
| `cards_open` | Read the card images and counts. Opens the panel |
| `cards_edit` | Change settings, edit cells by row, add or remove rows |
| `cards_status` | Show the current rows, issues and summary |
| `cards_export` | Write print-sheets.pdf, backs.pdf and card-list.csv |

Output goes to `card-print-sheets/<project>/` in the workspace.

## Scope (v0.1)

- PNG and JPEG images; no colour management or CMYK conversion.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `card-print-sheets/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/card-print-sheets/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-card-print-sheets test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
