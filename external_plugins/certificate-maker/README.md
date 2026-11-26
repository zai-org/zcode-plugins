# Certificate Maker

Turn a certificate background image (PNG/JPG) and a list of names into print-ready certificates: place text lines with {column} placeholders by position, size, colour and alignment, and long names shrink to fit automatically. Check empty names, fix the list in the panel, preview the first certificate and export one combined PDF plus one PDF per person. Chinese text uses a font already on your computer. Runs locally; no API keys.

## Features

- **Inputs**: a background image (a certificate design without names; 2000 px or wider prints best) and an .xlsx/.csv list.
- **Layout**: one line per text — `text | x% | y% | size | colour | left/center/right | bold | max width %`. Text can mix fixed words and `{column}` placeholders, e.g. `{姓名}` or `Awarded to {Name}`.
- **Auto-fit**: text wider than its max width shrinks step by step (down to 45%); text that still does not fit is flagged.
- **Checks**: layout fields missing from the sheet, empty values (block export) and low-resolution backgrounds.
- **Output**: a combined PDF sized to the background’s aspect ratio (A4 width) and optional per-person PDFs with a file-name pattern.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `certificate-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make certificates from 颁奖/certificate-bg.png for everyone in 颁奖/winners.xlsx"
- "The last row has no name — it should be 宋雨桐"
- "Move the award line a little lower and export the PDFs"

## Tools

| Tool | Purpose |
|---|---|
| `certificate_open` | Read the background image and the recipient list and lay out the text. Opens the panel |
| `certificate_edit` | Change settings, edit cells by row, add or remove rows |
| `certificate_status` | Show the current rows, issues and summary |
| `certificate_export` | Write certificates.pdf (one page each) and each/<name>.pdf |

Output goes to `certificate-maker/<project>/` in the workspace.

## Scope (v0.1)

- Positions are set as percentages in the layout text (no drag-and-drop in v0.1); the preview updates after each change.
- Background must be PNG or JPG (export PDF/AI designs to PNG first). One font family (your system’s Chinese font, regular and bold).
- No digital signatures, QR verification or emailing.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `certificate-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/certificate-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-certificate-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: pdf-lib (MIT), fontkit (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
