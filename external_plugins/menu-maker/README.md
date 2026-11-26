# Menu Maker

Keep your menu in a spreadsheet and get a good-looking printed menu and a phone-friendly web menu from it. Sections, prices with dotted leaders, chef's picks, spice levels, vegetarian and allergen tags, and English names side by side — in a classic, two-column or compact layout on A4, A5 or Letter. Add the web menu's address and a QR code is printed on the menu for guests to scan. Change a price or mark a dish sold out and export again. Runs locally; no menu service or API keys.

## Features

- **From your sheet**: recognises 分类, 菜名, 英文名, 价格, 描述, 过敏原, 辣度, 推荐, 素食 and English headers; blank sections continue the one above.
- **Print-ready PDF**: classic, two-column or compact; A4, A5 or Letter; dotted price leaders, chef's-pick badges, spice dots, vegetarian and allergen tags, page numbers and a footer note.
- **Web menu**: one menu.html with sticky section tabs that works on any phone, no scripts.
- **QR code**: printed on the last page and saved as qr.png when you give the web menu address.
- **Flexible prices**: numbers get your currency symbol; text like 12/18 or 时价 is kept.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `menu-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a menu from 菜单.xlsx called 青禾小馆"
- "Two columns on A4, mark Mapo Tofu as a chef's pick"
- "Add a QR code to https://tea.example/menu"

## Tools

| Tool | Purpose |
|---|---|
| `menu_open` | Read the dish sheet and preview the menu. Opens the panel |
| `menu_edit` | Change settings, edit cells by row, add or remove rows |
| `menu_status` | Show the current rows, issues and summary |
| `menu_export` | Write menu.pdf, menu.html and qr.png |

Output goes to `menu-maker/<project>/` in the workspace.

## Scope (v0.1)

- No dish photos in v0.1.
- The web menu is a file — host it yourself (any static host) for the QR code to work.
- Chinese text needs a Chinese font on the computer (found automatically).

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `menu-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/menu-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-menu-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), node-qrcode (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
