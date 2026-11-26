# Badge & Tent Card Maker

Print name badges and table tent cards for an event straight from the attendee list. Pick the list (and your logo), enter the event name and date, and get badges laid out on A4 with cut marks — the name is sized to fit, with organisation, title, and a coloured band for each role such as guest, speaker or staff. Tent cards fold in half with the name readable from both sides. Five badge sizes, optional QR code of each attendee's code, Chinese and English names. Runs locally; no design service or API keys.

## Features

- **From your list**: recognises 姓名, 英文名, 单位, 职位, 身份, 桌号, 编号 and English headers.
- **Badges on A4**: 100×70, 90×120, 4×3 in, 85.6×54 or A6, with cut marks; event header with your logo.
- **Names that fit**: long Chinese, English and minority names are shrunk to fit the badge.
- **Role colours**: each role gets its own colour band automatically, or set your own (嘉宾=#b45309).
- **Tent cards**: A4 landscape, fold along the dashed line; the name reads from both sides.
- **QR code**: optionally print each attendee's code as a QR for check-in scanners.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `name-badge-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make badges from attendees.xlsx for 2026 青禾产品大会"
- "Use 90×120 badges, sort by role and add QR codes"
- "Print tent cards without the organisation"

## Tools

| Tool | Purpose |
|---|---|
| `badge_open` | Read the attendee list and preview the badges. Opens the panel |
| `badge_edit` | Change settings, edit cells by row, add or remove rows |
| `badge_status` | Show the current rows, issues and summary |
| `badge_export` | Write badges.pdf and tent-cards.pdf |

Output goes to `name-badge-maker/<project>/` in the workspace.

## Scope (v0.1)

- Badges are printed on plain sheets and cut; no die-cut label templates in v0.1.
- No photos on badges in v0.1.
- Chinese text needs a Chinese font on the computer (found automatically).

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `name-badge-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/name-badge-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-name-badge-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), node-qrcode (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
