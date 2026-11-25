# DB Admin Generator

Turn a **SQLite database** into a working **admin panel**: sign-in, roles, a list per table with search and filters, and add/edit/delete forms that follow the database rules. The generated admin has **no third-party dependencies**; it needs only Node.js 22.13+. Before you get it, it is **started and self-tested** against a temporary copy of your database.

## What it does

- **Reads the schema** (read-only):
  - Tables and views, primary keys (or rowid), foreign keys, and `CHECK (col IN (…))` options.
  - Required (NOT NULL without default), unique and `VARCHAR(n)` lengths.
  - Booleans, dates and datetimes, email, phone and URL columns, and which tables reference which.
- **Plan**:
  - Pick the tables and the operations allowed on each (read / create / update / delete).
  - Pick what each role may do: **admin** can do everything, **editor** defaults to read/create/update, **viewer** to read only.
  - Pick the column shown when other tables refer to a row.
  - Password-, hash- and token-like columns are hidden by default (never sent to the browser). Migration tables are left out by default.
- **Generates** `<db>-admin/`:
  - `server.mjs`: `node:http` + `node:sqlite`. It provides:
    - Sign-in with salted scrypt passwords and an HMAC-signed HttpOnly SameSite=Strict cookie.
    - Role checks on the server, parameterised SQL with identifiers from the schema only, a CSRF header check and a sign-in lockout after 5 failures.
    - Friendly messages for UNIQUE / foreign-key / CHECK conflicts, and an `audit.log` of every change.
  - `public/`: a browser UI with no inline scripts and a strict CSP:
    - A sidebar of tables and a list with search, filters (options, yes/no, references), sorting and paging. References show the referenced row's name.
    - A form per row: dropdowns for references and options, date and checkbox inputs, required marks and max length. Server errors appear on the field.
    - Read-only mode for viewers and views. Chinese or English.
  - `admin.config.json` (editable), `README.md`, `package.json`, `.gitignore`.
  - User CLI: `node server.mjs user add <name> <role>`, `user passwd`, `user list`, `user remove`.
- **Self-test**: the admin is started on a free port against a **temporary copy** of the database. It is then checked over HTTP, about 90 checks for the sample shop:
  - Sign-in for each role and rejection of wrong passwords.
  - Listing every table (row counts match), search, sorting, and SQL-injection attempts.
  - Required-field and type errors, then create → read → update → delete.
  - Duplicate unique values (409), and deleting a row that is still referenced (409).
  - Viewer and editor permissions, and the audit log.

## Usage

Ask the agent in ZCode Desktop:

- "Generate an admin panel for data/shop.db"
- "Make a read-only admin for the customers and orders tables"
- "Re-run the self-test on the generated admin"

Or use the panel: choose the database, **Read schema**, adjust tables, operations and roles, then **Generate & self-test**. Then run it:

```bash
cd shop-admin
node server.mjs      # http://127.0.0.1:8787 — the first start creates "admin" and prints its password
```

## Tools

| Tool | Purpose |
|---|---|
| `db_inspect` | Read the schema and propose a plan (writes nothing) |
| `db_generate` | Write the admin folder, then self-test it |
| `db_selftest` | Run the self-test again (for example after editing the generated code) |

## Scope (v0.1)

- **SQLite only.** Postgres and MySQL are not supported yet (a Postgres version needs a database to test against).
- Single-column foreign keys become dropdowns; composite foreign keys are shown as plain values.
- No schema changes or migrations, no file uploads or BLOB editing, no per-row permissions.
- Use a test copy of the database while you try it. The plugin itself never writes to the database; the generated admin does, once you run it.
- Listens on 127.0.0.1 by default. Put it behind HTTPS before sharing it on a network.

## Privacy, network and files

- Runs locally with no network access and no API keys. The self-test talks only to 127.0.0.1.
- Reads the database read-only. Writes `<out>/` and `.db-admin-generator/plans.json`. The self-test's temporary copy, test users and passwords are deleted afterwards.
- Needs Node.js 22.13 or newer for `node:sqlite`, both in ZCode and for running the generated admin.

## License

MIT.
