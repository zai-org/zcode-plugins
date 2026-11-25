# Table Scan to Excel

Turn a photo or scan of a table (purchase list, invoice lines, bank statement, paper form) into an Excel file you can trust. The ZCode agent reads the image; the plugin **checks** and **exports**: totals that don't add up and cells that were hard to read are flagged, and you confirm them next to the original image before exporting.

## Features

- **Reading**: `table_scan_open` hands the image (scaled to ≤ 2000 px) to the agent with transcription rules — copy exactly, never calculate, how to write merged cells, list every doubtful cell. One image can hold several tables; each becomes a sheet.
- **Checks**:
  - every subtotal row against the section above it, every total / grand total row against all detail rows (subtotals skipped), with the difference;
  - text in number columns (e.g. `l0` for `10`);
  - rows with a different number of cells (missing or shifted column);
  - cells the agent marked as uncertain.
  - Numbers understand thousands separators, full-width digits, bracketed negatives, minus signs, %, ¥/$/€ and 元.
- **Review panel**: the image on the left (zoomable; the selected cell is outlined approximately), an editable table on the right with merged cells and header rows; uncertain cells yellow, total mismatches red. Click an issue to jump to it, then "Looks right" or edit; or ask the agent to look again. Edits count as confirmed; confirmations survive a re-submission when the text is unchanged.
- **Export**:
  - `.xlsx`: one sheet per table; bold, frozen header rows; merged cells; numbers stored as numbers with their original thousands/decimal/percent format; remaining flagged cells coloured with a comment.
  - `.csv`: UTF-8 with BOM (opens cleanly in Excel), one file per table.
- The transcription is saved as `tables/<image>.tablescan.json` and reloaded next time.

## Usage

Ask the agent in ZCode Desktop:

- "Turn this photo of a purchase list (receipt.jpg) into an Excel file"
- "Check whether the totals in statement.png add up, then export it to xlsx"
- "Convert all the scanned tables in scans/ to CSV"

Or open **Table Scan to Excel** in the session side bar, pick an image and click "Ask the agent to read it".

## Tools

| Tool | Purpose |
|---|---|
| `table_scan_open` | Open an image, return it to the agent and open the panel; loads an earlier transcription if there is one |
| `table_submit` | The agent submits its transcription; checked, saved and shown in the panel |
| `table_export` | Write `.xlsx` and/or `.csv` (default `tables/<image>.xlsx`) |

## Scope (v0.1)

- PNG and JPG. Convert PDF scans or HEIC photos to images first.
- Recognition quality depends on the vision ability of the model you use in ZCode; the plugin ships no OCR engine and sends the image nowhere else.
- The outline on the image divides the table area evenly, so it is approximate for very tall header rows or tilted photos.
- Not in v0.1: deskew/cropping, formula reconstruction, adding/removing rows or columns in the panel (ask the agent to re-submit).

## Privacy, network and files

- The plugin itself makes **no network requests** and needs no API key or account. The image is returned as a tool result to the model you use in ZCode (just like attaching it to a message).
- It reads only the image you choose and writes only inside the workspace under `tables/` (or the export path you give). No commands, no hooks.

## Build and test (developers)

Source: `ui-plugins/table-scan-to-excel/`. Run `pnpm install --frozen-lockfile && pnpm build` at the repo root and add `dist/local-marketplace` as a local marketplace source in ZCode. Tests: `pnpm --filter @penova/plugin-table-scan-to-excel test` (number parsing, subtotal/total checks, padding, input validation, xlsx/csv content) and `test:e2e` (browser panel test: review, confirm, correct and export a photographed purchase list, plus a 1912 census scan).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), MCP SDK and ext-apps (MIT); full list in `dist/THIRD_PARTY_NOTICES.txt`. Test images: see `ui-plugins/table-scan-to-excel/test/fixtures/SOURCES.md` (self-made purchase list, CC0; census scan from Wikimedia Commons, no known copyright restrictions); not included in the package.
