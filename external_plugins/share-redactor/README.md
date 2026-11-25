# Share Redactor

Remove personal data from documents before you send them outside: find it, confirm it, export clean copies, and check that nothing was left behind.

## Features

- **Inputs**: `.pdf` (with a text layer), `.docx`, `.xlsx`, `.csv`, `.txt` and `.md`.
- **What it finds**:
  - Phone numbers: Chinese mobiles (also written with spaces or dashes, or with +86), landlines and international numbers.
  - Chinese ID-card numbers (checksum and birth date verified).
  - Bank card numbers (Luhn verified).
  - Email addresses.
  - Amounts (optional).
  - Any names or terms you type, such as customer names or a project code name.
- **Where it looks**:
  - DOCX: body, headers, footers, footnotes, endnotes and comments, including text split across formatting runs, `mailto:` links and document properties.
  - XLSX: every sheet, including numbers stored as numeric cells (a redacted cell becomes text and its formula is removed).
  - PDF: page text (also numbers broken across lines), link annotations and metadata.
- **Review panel**:
  - Every hit with its context. Untick a hit to keep that value everywhere, for example your company's service line.
  - PDF pages are shown with the boxes that will be blacked out. Click a box to keep it. Drag on the page to black out an extra area such as a signature or a photo.
- **Output**:
  - Copies go to `redacted/<name>.redacted.<ext>`; the originals are not changed.
  - DOCX, XLSX and text files are edited in place with a label (`[手机号]` / `[phone]`), a block (`███`) or a partial mask (`138****5678`). Author and other document properties are cleared by default.
  - **PDFs are flattened**: every page becomes an image with black boxes, so no text layer, links, form fields or metadata survive.
  - `redaction-log.csv` lists the kind and location of every redaction; it never contains the original values.
- **Self-check**: each output is re-read in full after export (all text, links, properties and metadata) and checked that none of the redacted values remains, in common spellings too (with or without spaces and dashes). A PDF must have no text layer left.

## Usage

Ask the agent in ZCode Desktop:

- "Redact phone numbers, ID numbers and bank cards in 报价单.pdf and 客户名单.xlsx before I send them"
- "Also hide the names 王晓明 and 李娜, but keep our company's service email"
- "Export the redacted copies and tell me whether the self-check passed"

## Tools

| Tool | Purpose |
|---|---|
| `redact_scan` | Scan files and list every hit with an id; open the review panel |
| `redact_save` | Change options, keep or un-keep values by id |
| `redact_export` | Write the redacted copies, the log and the self-check |

The agent only ever sees partially masked values (for example `138****5678`).

## Scope (v0.1)

- Text inside images and scanned PDFs (OCR) is not detected; draw boxes by hand on scanned pages.
- Names are found only when you list them; there is no automatic name recognition.
- Old `.doc` / `.xls`, PPTX and images are not supported. Embedded images in DOCX/XLSX are left as they are.
- Flattened PDFs are larger and their text can no longer be selected or searched.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the output folder (`redacted/` by default) and `.share-redactor/settings.json` in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/share-redactor/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-share-redactor test` and `test:e2e` (the e2e needs Chrome and poppler-utils).
- `REDACT_SAMPLES` points to the sample files: a contract, a customer list, a contact list, meeting notes and a quote with fictional personal data.

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: pdf.js (Apache-2.0, with its CMaps and standard fonts), pdf-lib (MIT), fflate (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
