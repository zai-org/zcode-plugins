# Contact List Cleaner

Turn several messy contact spreadsheets (a CRM export, a trade-show sign-up sheet, an address book) into one clean, de-duplicated list, with a log of every merge.

## Features

- **Input**: CSV, TSV and XLSX. GBK/GB18030 CSV saved by Chinese Excel is detected. Each file's columns are mapped to one template: name, phone, phone 2, email, email 2, company, title, city, WeChat, notes. The mapping is guessed from header names in Chinese and English (and from the contents when headers are unhelpful). Split first/last name columns are joined.
- **Normalising**:
  - Names: whitespace removed inside Chinese names, ALL CAPS / lowercase Latin names title-cased.
  - Phones: several numbers in one cell are split. Numbers are formatted internationally with libphonenumber (`+86 138 1234 5678`, `+86 21 6234 5678`, `+44 20 7946 0958`), extensions are kept, and invalid numbers are flagged. The default country is China (configurable). 10-digit numbers that cannot be Chinese are read as North American and flagged.
  - Emails: lower-cased, `mailto:` removed, invalid ones flagged. Companies: full-width brackets for Chinese names; comparison ignores suffixes such as 有限公司 / Inc. / LLC.
- **Duplicates**:
  - Sure duplicates are merged automatically: the same phone or email with a compatible name, or the same phone *and* email.
  - Possible duplicates are shown side by side, with the differing values highlighted, for you to confirm: the same phone with a different name (shared office line?), the same name + same company, the same last 8 phone digits, or the same email name.
- **Merging**: the first non-empty value wins (files in the order given). Extra phones and emails go to phone 2 / email 2, the longer company name is kept, and other conflicts go to notes and the merge log.
- **Export**: Excel with four sheets (contacts, merge log, problems, undecided pairs) or CSV (contacts + merge log, UTF-8 with BOM).
- **Panel**: pick files, see the counts, confirm pairs, change the column mapping, browse and search the result (invalid values in red), read the merge log, export.

## Usage

Ask the agent in ZCode Desktop:

- "Merge the CRM export and the trade-show list into one clean contact list"
- "Find duplicate customers across these three spreadsheets"
- "Export the cleaned contacts to Excel with a merge log"

## Tools

| Tool | Purpose |
|---|---|
| `contacts_load` | Load lists, map columns, normalise, merge sure duplicates, list possible ones |
| `contacts_map` | Change a file's column mapping |
| `contacts_decide` | Merge or keep apart possible-duplicate pairs |
| `contacts_export` | Write the cleaned list (xlsx or csv with the merge log, or a vCard .vcf for phones and mail apps) |

## Scope (v0.1)

- No online lookup or enrichment. No vCard/Outlook formats (export them to CSV first).
- An automatic merge cannot be undone in the panel. Change the source rows (or the mapping) and run again.
- .xls files must be saved as .xlsx first.

## Privacy, network and files

- Runs locally: no network access, no API keys. The source files are never modified.
- Writes `.contact-cleaner/project.json` (files, mappings, decisions) and the export folder (default `cleaned/`). No hooks.

## Build and test (developers)

- Source: `ui-plugins/contact-list-cleaner/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-contact-list-cleaner test`. `CONTACT_SAMPLES` points to the fictional sample lists. `test:e2e` needs Chrome.

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: exceljs (MIT), libphonenumber-js (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`. The exceljs streaming reader (unzipper) is not used and is replaced with an empty module.
