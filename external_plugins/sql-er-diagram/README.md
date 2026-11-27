# SQL ER Diagram

Draw an entity-relationship diagram and a data dictionary straight from your SQL schema. Open CREATE TABLE scripts in MySQL, PostgreSQL or SQLite syntax: tables, columns, types, primary keys, foreign keys (inline, table-level or ALTER TABLE) and comments (COMMENT '…' or COMMENT ON) are read automatically. Add missing relationships or column notes in the table, hide columns you don't want on the diagram, then export the diagram as SVG and PNG plus a data dictionary in Excel and Markdown. Runs locally; no database connection or API keys.

## Features

- **Reads real DDL**: MySQL backticks, PostgreSQL schemas and COMMENT ON, SQLite; DECIMAL(10,2)/ENUM types, composite primary keys, inline REFERENCES, CONSTRAINT … FOREIGN KEY and ALTER TABLE … ADD FOREIGN KEY.
- **Checks**: foreign keys pointing to tables or columns that don't exist, tables without a primary key, columns without comments.
- **Editable**: add a relationship by typing `table.column` in the FK cell, fix types, write comments, hide columns.
- **Diagram**: tables laid out in a grid with the most-connected tables first; PK/FK markers, NOT NULL stars and curved relationship lines; SVG and 2× PNG.
- **Data dictionary**: Excel (tables + columns sheets) and Markdown with one section per table.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `sql-er-diagram/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Draw an ER diagram from db/shop-schema.sql"
- "products.category_id points to categories.id — add that relationship"
- "Export the diagram and a data dictionary"

## Tools

| Tool | Purpose |
|---|---|
| `erd_open` | Read the CREATE TABLE statements and list every column with its keys. Opens the panel |
| `erd_edit` | Change settings, edit cells by row, add or remove rows |
| `erd_status` | Show the current rows, issues and summary |
| `erd_export` | Write er-diagram.svg, er-diagram.png, data-dictionary.xlsx and data-dictionary.md |

Output goes to `sql-er-diagram/<project>/` in the workspace.

## Scope (v0.1)

- Reads .sql DDL files; it does not connect to a database or open SQLite .db files in v0.1 — dump the schema first (e.g. `sqlite3 app.db .schema > schema.sql`).
- Layout is automatic (grid); tables cannot be dragged in v0.1 — change “tables per row” instead.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `sql-er-diagram/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/sql-er-diagram/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-sql-er-diagram test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), resvg-wasm (MPL-2.0), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
