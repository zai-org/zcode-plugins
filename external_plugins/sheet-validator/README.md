# Sheet Validator

Catch bad data before you import, submit or send a spreadsheet: missing values, duplicate IDs, wrong phone numbers and emails, impossible dates like 2025-13-01, numbers out of range, values outside an allowed list, wrong formats. Write rules in plain lines like “工号: required, unique” — a starting set is suggested from your data — then fix the flagged cells right in the table and export a marked-up Excel and the list of problems. Runs locally; no API keys.

## Features

- **Plain-text rules**: required, unique, email, phone (Chinese mobile or +international), date (real calendar dates), integer, number min..max, in(A|B|C), length<=N, regex(…), after/before a date.
- **Suggested rules**: ID-like columns get unique, email/phone/date/number columns get the matching check, columns with a few repeated values get an allowed list.
- **Fix in place**: edit cells in the table and the check re-runs; each row shows its problems.
- **Clear output**: checked.xlsx with failing cells in red and the reason as a note, a problems sheet, errors.csv, and the passing and failing rows as separate CSVs.
- **Rule mistakes are caught**: unknown rules and columns that don't exist are reported.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `sheet-validator/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Check 员工花名册.csv before I import it into the HR system"
- "工号 must be unique and 月薪 between 3000 and 100000"
- "Export only the rows that pass"

## Tools

| Tool | Purpose |
|---|---|
| `validate_open` | Read the table, suggest rules and list every failing cell. Opens the panel |
| `validate_edit` | Change settings, edit cells by row, add or remove rows |
| `validate_status` | Show the current rows, issues and summary |
| `validate_export` | Write checked.xlsx (bad cells red with notes + problems sheet), errors.csv, valid-rows.csv and invalid-rows.csv |

Output goes to `sheet-validator/<project>/` in the workspace.

## Scope (v0.1)

- One table at a time; cross-table checks (e.g. a code must exist in another file) are not in v0.1.
- One rule failure is shown per cell (the first that fails).
- Fixes are not applied automatically — use CSV Cleaner for bulk normalising.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `sheet-validator/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/sheet-validator/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-sheet-validator test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
