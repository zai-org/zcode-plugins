# JSON ⇄ Table Converter

Open an API response, export or log file in JSON or JSON Lines as a normal table — nested fields become columns like customer.city, lists are joined or kept, and a list of line items can become one row per item — then edit it and save as Excel or CSV. It works the other way too: a spreadsheet with columns like spec.weight becomes properly nested JSON with real numbers and true/false. Runs locally; no API keys.

## Features

- **Finds the records**: the biggest array of objects is picked automatically (e.g. data.orders); or give a path.
- **Flatten**: nested objects become dotted columns; arrays of values are joined (tags → “老客户; 包邮”) or kept as JSON; one array of objects can be exploded into one row per item.
- **JSON Lines**: .jsonl/.ndjson and line-by-line logs are read too.
- **Back to JSON**: dotted headers nest again, numbers and true/false become real types (long numbers like phone numbers stay text), list columns split into arrays, empty cells omitted or null.
- **Edit in between**: fix values or add rows before exporting.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `json-table-converter/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Turn orders-api.json into an Excel sheet"
- "One row per item in items"
- "Convert 产品表.csv to nested JSON with tags as an array"

## Tools

| Tool | Purpose |
|---|---|
| `jsontable_open` | Read JSON/JSONL or a table and show it as an editable table. Opens the panel |
| `jsontable_edit` | Change settings, edit cells by row, add or remove rows |
| `jsontable_status` | Show the current rows, issues and summary |
| `jsontable_export` | Write table.xlsx, table.csv, data.json and data.jsonl |

Output goes to `json-table-converter/<project>/` in the workspace.

## Scope (v0.1)

- Files up to ~50 MB; only one array can be exploded at a time.
- No JSON Schema validation or JSONPath filters in v0.1.
- Exploded rows are exported to JSON as separate records.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `json-table-converter/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/json-table-converter/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-json-table-converter test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
