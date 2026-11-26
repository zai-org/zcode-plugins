# QR Batch Studio

Make QR codes in bulk from a sheet: web links, text, Wi-Fi logins, contact cards (vCard), email, phone and SMS, with your colours, an optional centre logo and labels. Problems such as empty content, links without https://, codes that are too dense and low contrast are flagged; edit the list in the panel, preview the codes and export PNG (plus zip), SVG and an A4 print sheet. Runs locally; no API keys.

## Features

- **Types**: url, text, wifi (`network;password;WPA`), vcard (`name;phone;email;company;title;url`), email, phone, sms (`number;message`). Empty types are guessed from the content.
- **Style**: code and background colour, quiet zone, PNG size, error-correction level L/M/Q/H, and a centre logo from a PNG/JPG on a clean plate.
- **Checks**: empty content, URLs missing https:// (added automatically), content too long for a QR code, very dense codes, low contrast or inverted colours, and a logo without level H.
- **Output**: one PNG per code (and a zip), SVG vectors with optional labels, a CSV of what each code contains, and an A4 PDF grid with labels for printing.
- **Labels** become file names; duplicates get -2, -3 …
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `qr-batch-studio/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make QR codes for everything in 门店/qr-list.xlsx with our logo 门店/logo.png in the middle"
- "The last row should link to https://penova.example/survey"
- "Export PNGs and an A4 sheet with 3 codes per row"

## Tools

| Tool | Purpose |
|---|---|
| `qr_open` | Read the QR list (and optional logo) and check every code. Opens the panel |
| `qr_edit` | Change settings, edit cells by row, add or remove rows |
| `qr_status` | Show the current rows, issues and summary |
| `qr_export` | Write png/*.png + qr-png.zip, svg/*.svg + qr-list.csv, and qr-sheet.pdf |

Output goes to `qr-batch-studio/<project>/` in the workspace.

## Scope (v0.1)

- Static QR codes only (no tracking links or dynamic redirects).
- Square modules only; no artistic dot styles or gradient colours in v0.1. The logo is left out of the SVG files.
- Barcodes (EAN, Code 128) are not included.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `qr-batch-studio/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/qr-batch-studio/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-qr-batch-studio test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: node-qrcode (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), pdf-lib (MIT), fontkit (MIT), fflate (MIT), ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
