# Test Data Generator

Make realistic fake data for demos, tests and training — Chinese or English names, mobile numbers, emails, cities and addresses, companies, dates, amounts, member levels with the mix you want, IDs, UUIDs and codes like ORD-1234-AB. Describe the columns in a small table (or load a schema sheet), choose how many rows, and export CSV, Excel, JSON or SQL. Everything is invented, and the same seed always gives the same data. Runs locally; no API keys.

## Features

- **21 column types**: sequence (C{0000}), name/first/last name, phone, email, city, address, company, date, datetime, integer and decimal ranges, boolean with probability, weighted choice, UUID, text, pattern (#=digit, ?=letter), constant, URL, IP.
- **Chinese or English**: Chinese names, 11-digit mobile numbers, Chinese cities/addresses/companies — or English equivalents.
- **Control the mix**: weighted choices (普通*6|银卡*3|金卡*1), a share of blank cells per column, unique columns (with a warning if a range is too small).
- **Repeatable**: the same seed and settings always produce identical data; change the seed for a new set.
- **Safe**: everything is invented — emails use example.com/test domains — so no real personal data is ever involved.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `test-data-generator/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Generate 500 fake customers with name, phone, email, city and signup date"
- "Make 会员等级 70% 普通, 25% 银卡, 5% 金卡"
- "Export as SQL inserts for table customers"

## Tools

| Tool | Purpose |
|---|---|
| `fakedata_open` | Start from the template or a schema sheet and preview generated rows. Opens the panel |
| `fakedata_edit` | Change settings, edit cells by row, add or remove rows |
| `fakedata_status` | Show the current rows, issues and summary |
| `fakedata_export` | Write test-data.csv, test-data.xlsx, test-data.json and test-data.sql |

Output goes to `test-data-generator/<project>/` in the workspace.

## Scope (v0.1)

- Up to 100,000 rows per export.
- Columns are independent (no foreign keys between tables or formulas between columns, except emails built from English names).
- Phone numbers look valid but are random; don't use them to contact anyone.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `test-data-generator/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/test-data-generator/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-test-data-generator test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
