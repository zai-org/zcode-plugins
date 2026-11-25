# Sheet To App

Turn an **inventory, booking or customer spreadsheet** (.xlsx / .csv / .tsv) into a small web app: **one HTML file** that opens by double-clicking, with search, filters and forms. No server, no account, no internet.

## What it does

- **Field mapping**: reads the header row and the data, then guesses each column's type: text, long text, number, money, date, email, phone, link, options (select) or yes/no. It also guesses which columns are required, the options of a select column, a unique key column (SKU, ID, 编号…) and the record title. Every guess can be changed in the panel or by asking the agent.
- **Data problems**: lists rows where a required value is missing, a value has the wrong type ("十" in a number column, a bad email or date), a value is not one of the options, or a key is duplicated, with sheet row numbers. These rows are still imported and shown in red in the app.
- **The app** (`apps/<id>/index.html`):
  - Search across text columns, a filter for each options / yes-no column, click a header to sort, and pages of rows.
  - Add, edit and delete records in a form with validation (required, number, date, email, link, unique key).
  - An optional highlight rule, for example `库存 ≤ 5 → 库存不足`.
  - CSV export (opens in Excel with Chinese text intact) and import (append or replace), plus JSON backup and restore.
  - Chinese or English interface and an accent colour.
  - Data is saved in the browser that opened the file (localStorage).
- **When the sheet changes**: `app_refresh` re-reads it, keeps your field settings, adds new columns, drops removed ones and rebuilds. Anyone who already used the app sees a banner offering to load the new data; their own edits stay until they choose.

## Usage

Ask the agent in ZCode Desktop:

- "Turn inventory.xlsx into a small app I can search and edit"
- "Make a booking tracker from this CSV"
- "The sheet changed — rebuild the app and keep my settings"

Or use the panel: pick the spreadsheet, click **Make app**, adjust field types, labels and the highlight rule, then **Apply & rebuild**. The right side shows a static preview.

## Tools

| Tool | Purpose |
|---|---|
| `app_new` | Read a sheet, infer the mapping, write the app and list data problems |
| `app_update` | Change fields (type, label, required, options, list / filter / hide, key, title) and settings (title, language, colour, page size, sort, highlight), then rebuild |
| `app_refresh` | Re-read the changed sheet, keep the settings and rebuild |
| `app_check` | List data problems without rebuilding |
| `app_list` | List the apps in this workspace |

## Scope (v0.1)

- One sheet per app. The first row holds the headers. Up to 20,000 rows.
- Data lives in one browser on one computer; there is no sync between people. Use **Backup** / **Export CSV** to move it, and keep the spreadsheet as the master copy.
- Edits made in the app are not written back to the spreadsheet. Export a CSV if you want them there.
- No hosting is included. The `apps/<id>/` folder is a plain static site, so you can upload it later to any static host such as Cloudflare Pages. Data would still stay per browser.
- Formulas are read as their last calculated values. .xls files must be saved as .xlsx first.

## Privacy, network and files

- Runs locally with no network access and no API keys. The generated app loads nothing from the internet.
- Reads the spreadsheet. Writes `apps/<id>/index.html` and `.sheet-to-app/apps.json` (the saved mappings). The spreadsheet is never changed.

## License

MIT. Uses [ExcelJS](https://github.com/exceljs/exceljs) (MIT) to read .xlsx files.
