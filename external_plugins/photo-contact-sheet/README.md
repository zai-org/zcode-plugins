# Photo Contact Sheet

Turn a folder of photos into a printable contact sheet: a neat grid of thumbnails with file names or your own captions, page numbers and an optional title. Choose the paper, orientation, columns and rows, whether photos show whole or fill their cell, and a black or white background. Reorder or leave out photos, then export a PDF to print or send for selection, plus a JPG of every page. Runs locally; no upload or API keys.

## Features

- **Grid**: 1–12 columns × 1–15 rows on A4, A3, Letter or Legal, portrait or landscape; margins and gaps in mm.
- **Fit**: show each photo whole, or fill the cell and crop; portrait and landscape shots mixed.
- **Captions**: template with number, file name, size or your own caption per photo; or none.
- **Order**: natural file-name order (IMG_2 before IMG_10), change it with the order column, or leave photos out.
- **Output**: compact PDF (thumbnails at 200 dpi), a JPG for every page, and a CSV index of which photo is on which page.
- **Looks**: optional title, page numbers, white or black background.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `photo-contact-sheet/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a contact sheet of the shoot folder, 5 across"
- "Put these photos on A4 landscape with file names under each"
- "Leave out IMG_0413 and put the portrait shot first"

## Tools

| Tool | Purpose |
|---|---|
| `contact_open` | List the photos and preview page 1. Opens the panel |
| `contact_edit` | Change settings, edit cells by row, add or remove rows |
| `contact_status` | Show the current rows, issues and summary |
| `contact_export` | Write contact-sheet.pdf, one JPG per page and contact-sheet.csv |

Output goes to `photo-contact-sheet/<project>/` in the workspace.

## Scope (v0.1)

- JPEG and PNG only (convert HEIC/RAW first).
- Captions are one line; long ones are shortened with …

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `photo-contact-sheet/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/photo-contact-sheet/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-photo-contact-sheet test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: pdf-lib (MIT), fontkit (MIT), resvg (MPL-2.0), pngjs (MIT), jpeg-js (BSD-3-Clause), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
