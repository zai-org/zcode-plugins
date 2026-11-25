# DOCX Mail Merge

Fill a Word template’s {{field}} placeholders from a spreadsheet to make one .docx per row — offer letters, contracts, notices, certificates — with all formatting, tables, headers and footers kept. Check missing columns and empty values, fix data in the panel, preview the first document and export the files plus a zip. Runs locally; no API keys.

## Features

- **Template**: type placeholders like `{{Name}}` or `{{姓名}}` anywhere in a Word document — body text, tables, headers, footers, footnotes. Placeholders that Word split across differently formatted runs are still found, and the replaced text keeps the formatting of the placeholder’s first character.
- **Data**: .xlsx or .csv; column names must match the field names. Multi-line values become line breaks.
- **Checks**: fields with no matching column (blocks export), columns the template does not use, rows with empty values, and repeated file names.
- **File names**: a pattern such as `{姓名}-录用通知书` or `{n}` for the row number.
- **Output**: one .docx per row, an optional zip of all documents, and a CSV log listing empty fields per file.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `docx-mail-merge/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Use 人事/offer-template.docx and 人事/new-hires.xlsx to make one offer letter per person, named after the person"
- "Alex Turner reports to 王磊 — fill that in"
- "Generate the Word files and a zip"

## Tools

| Tool | Purpose |
|---|---|
| `merge_open` | Read the template’s placeholders and the sheet rows. Opens the panel |
| `merge_edit` | Change settings, edit cells by row, add or remove rows |
| `merge_status` | Show the current rows, issues and summary |
| `merge_export` | Write documents/<name>.docx for every row, all-documents.zip and merge-log.csv |

Output goes to `docx-mail-merge/<project>/` in the workspace.

## Scope (v0.1)

- Plain text replacement only: no conditional sections, repeating table rows, images or Word MERGEFIELD fields in v0.1.
- Output is DOCX (convert to PDF in Word or WPS if needed). Old .doc templates: save as .docx first.
- Nothing is emailed.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `docx-mail-merge/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/docx-mail-merge/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-docx-mail-merge test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: fflate (MIT), ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
