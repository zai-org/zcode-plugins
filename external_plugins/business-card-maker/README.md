# Business Card Maker

Make business cards for the whole team from one spreadsheet. Pick the staff list and your logo, set the company name and website, and get a print-shop PDF (one page per side, with bleed, crop marks and trim boxes) plus an A4 sheet for printing in the office. Each card can carry a QR code that saves the person straight into a phone's contacts, and every person also gets a .vcf contact file. Three front designs, 90×54, 85×55 or US sizes, Chinese and English side by side. Runs locally; no design service or API keys.

## Features

- **From your staff list**: recognises 姓名, 英文名, 职位, 英文职位, 部门, 手机, 电话, 邮箱, 地址 and English headers.
- **Print-shop PDF**: one page per side with bleed, crop marks, TrimBox and BleedBox; front and back.
- **Office A4 sheet**: 10 cards per page with crop marks; backs are mirrored so duplex printing lines up.
- **Contact QR code**: a vCard QR on the back or front saves the person into the phone's contacts.
- **vCard files**: contacts.vcf for everyone plus one .vcf per person; Chinese compound surnames are split correctly.
- **Three designs**: left-aligned, centred or side band, in your accent colour with your logo.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `business-card-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make business cards from team.xlsx with logo.png for 青禾科技"
- "Use the centred template and put the QR code on the front"
- "Export the print PDF and everyone's vCard"

## Tools

| Tool | Purpose |
|---|---|
| `card_open` | Read the team list (and logo) and preview the cards. Opens the panel |
| `card_edit` | Change settings, edit cells by row, add or remove rows |
| `card_status` | Show the current rows, issues and summary |
| `card_export` | Write cards-print.pdf, cards-a4.pdf and vCard files |

Output goes to `business-card-maker/<project>/` in the workspace.

## Scope (v0.1)

- Logo must be PNG or JPG (SVG isn't read in v0.1).
- Colours are RGB; ask your print shop if they need CMYK.
- Chinese text needs a Chinese font on the computer (found automatically).

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `business-card-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/business-card-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-business-card-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), node-qrcode (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
