# PDF Form Batch Fill

Fill one blank PDF form for every row of a roster: registration forms, sign-up sheets, certificates, applications. Map the fields once, generate one PDF per person, and catch missing values and overflowing text before you print.

## What it does

- **Reads form fields**: lists the PDF's text fields, checkboxes, radio groups and dropdowns, and proposes a "field ← roster column" mapping by name.
- **Works without form fields**: on flat PDFs (scans, tables exported from Word) drag text boxes onto the page preview in the side panel.
- **Map once, reuse**: the mapping, font sizes and output file names are saved as a `.formfill.json` template in the workspace; reuse it with the next roster.
- **Checks before generating**: empty required values, text that does not fit (measured with the real font, shrinking down to a minimum size first), values longer than a field's max length, radio/dropdown values that are not options, missing columns.
- **Batch output**: one PDF per row with names built from columns (e.g. `{Name}-form.pdf`), optionally flattened, optionally one merged PDF for printing, plus a `_report.csv`.
- **Row preview**: switch to any row in the panel to see the real filled result; clicking a problem jumps to that row.

## Usage

After installing and enabling the plugin in ZCode Desktop, ask the agent:

- "Fill 报名表.pdf for everyone in 学员名单.xlsx, one PDF per person named after them"
- "Check which rows of the roster would overflow the address field"
- "This PDF has no form fields — put name and phone in the boxes on page 1 for each row"

The agent calls `form_open`, which opens the side panel. You can also open the "PDF Form Batch Fill" panel from the session sidebar and pick the PDF and roster yourself.

In the panel: edit what goes into each field on the right (type `{` to pick a column), mark required fields, set a font size; use "+ Free text box" and drag on the page to add a position, drag purple boxes to move them; tick "Preview filled" and step through rows; then "Check all rows" → "Generate".

## Tools

| Tool | Purpose |
|---|---|
| `form_open` | Open the PDF and roster, list fields, propose a mapping, open the panel |
| `roster_read` | Read roster columns and first rows |
| `template_save` | Save the `.formfill.json` template |
| `form_check` | Check every row without writing files |
| `form_generate` | Write the PDFs, the report and the optional merged file |

## Scope (v0.1)

- Input: PDF (AcroForm or flat); roster `.csv` / `.tsv` / `.xlsx` (GBK-encoded CSV is detected).
- Not yet: Word/Excel forms, signature images, barcodes, encrypted PDFs (remove the password first).

## Privacy, network and file writes

- **Everything runs locally.** No network access, nothing is uploaded, no API keys or accounts.
- Reads and writes only inside the current workspace: output PDFs go to the template's output folder (default `form-fill-output/`), templates to the `.formfill.json` path you choose. No commands are executed and there are no hooks.
- Chinese text uses a system CJK font (macOS: Arial Unicode / Hiragino Sans GB; Windows: SimHei / Microsoft YaHei; Linux: Noto CJK). If none is found, set `fontPath` in the plugin settings. Fonts are embedded as subsets.

## Build and test (developers)

Source lives in `ui-plugins/pdf-form-batch-fill/`. From the repository root run `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source in the ZCode plugin store and install. Tests: `pnpm --filter @penova/plugin-pdf-form-batch-fill test` (the real IRS W-9 form, a Chinese registration form and a 30-row roster) and `test:e2e` (browser panel test).

## Third-party components and licenses

The plugin is MIT-licensed (author: Penova). Main bundled dependencies: pdf-lib (MIT), fontkit (MIT), pdf.js / pdfjs-dist (Apache-2.0, panel preview), ExcelJS (MIT), the MCP SDK and ext-apps (MIT). The full list with license texts ships in `dist/THIRD_PARTY_NOTICES.txt`. The IRS W-9 form used in tests is a US federal government publication (public domain).
