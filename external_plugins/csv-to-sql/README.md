# CSV to SQL

Load a spreadsheet into a database without writing SQL by hand: get a ready-to-run script for SQLite, MySQL or PostgreSQL with a CREATE TABLE whose column types are worked out from the data, a suggested primary key, and INSERT statements with every quote, newline and empty value escaped correctly. Review and change the schema in a table first — names, types, nullable, key, which columns to keep. Runs locally; no database connection or API keys.

## Features

- **Type inference**: INTEGER, BIGINT, DECIMAL, BOOLEAN (true/false, yes/no, 是/否), DATE, TIMESTAMP, VARCHAR(n), TEXT — long digit strings like phone numbers stay text so leading zeros survive.
- **Three dialects**: SQLite, MySQL/MariaDB (utf8mb4, backticks, TINYINT(1)) and PostgreSQL (E'' strings for newlines), or all three at once.
- **Correct escaping**: single quotes, backslashes, newlines, Chinese text and NULL for empty cells.
- **Editable schema**: rename columns (snake_case suggested, Chinese names kept and quoted), change types, nullable and primary key, or exclude columns.
- **Checks before export**: values that would turn into NULL under the chosen type, empty values in NOT NULL columns, duplicate primary keys and duplicate column names.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `csv-to-sql/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a PostgreSQL script from 会员名单.csv"
- "Call the table members and use 会员编号 as the primary key"
- "Leave out the 备注 column"

## Tools

| Tool | Purpose |
|---|---|
| `csvsql_open` | Read the table, infer a SQL schema and preview the script. Opens the panel |
| `csvsql_edit` | Change settings, edit cells by row, add or remove rows |
| `csvsql_status` | Show the current rows, issues and summary |
| `csvsql_export` | Write <table>.<database>.sql (CREATE TABLE + INSERTs) and <table>.schema.sql |

Output goes to `csv-to-sql/<project>/` in the workspace.

## Scope (v0.1)

- Generates SQL files only; it never connects to a database.
- One table per project; no foreign keys or indexes besides the primary key in v0.1.
- Dates must already be YYYY-MM-DD to be typed DATE (use CSV Cleaner first).

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `csv-to-sql/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/csv-to-sql/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-csv-to-sql test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
