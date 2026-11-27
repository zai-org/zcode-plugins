# PDF Form Collector

Gather the answers from a stack of filled-in PDF forms into one spreadsheet. Text boxes, checkboxes, radio buttons, dropdowns and signature fields all become columns, labelled the way the form labels them. It highlights required fields left empty, unticked consent boxes, bad emails or phone numbers, repeat submissions and PDFs that aren't fillable at all. Fix values in the table, then export Excel with the problem cells coloured and noted, or CSV. Runs locally; no upload or API keys.

## Features

- **All field types**: text (including multi-line), checkboxes, radio groups, dropdowns, list boxes and signature fields (signed or not).
- **Readable columns**: field tooltips become column names, in form order; different versions of a form are merged.
- **Checks**: required fields (the form's own flags plus any you add), unticked required checkboxes, emails, phone numbers, dates, values outside a dropdown's choices.
- **Duplicates**: the same email (or any field you choose) on two forms is flagged so you can drop the older one.
- **Problem PDFs**: blank templates, scanned or flattened forms and damaged files are listed instead of silently skipped.
- **Exports**: Excel with yellow cells for missing and red for invalid values, each with a note, plus a field fill-rate sheet; CSV with the same columns.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `pdf-form-collector/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Collect the returned forms into Excel"
- "Which forms are missing required fields?"
- "Did anyone submit twice?"

## Tools

| Tool | Purpose |
|---|---|
| `formcollect_open` | Read every PDF's form fields and list one row per form. Opens the panel |
| `formcollect_edit` | Change settings, edit cells by row, add or remove rows |
| `formcollect_status` | Show the current rows, issues and summary |
| `formcollect_export` | Write responses.xlsx (problem cells highlighted) and responses.csv |

Output goes to `pdf-form-collector/<project>/` in the workspace.

## Scope (v0.1)

- Reads fillable (AcroForm) PDFs; scanned paper forms need OCR first.
- XFA-only forms (some government templates) aren't supported.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `pdf-form-collector/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/pdf-form-collector/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-pdf-form-collector test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: pdf-lib (MIT), ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
