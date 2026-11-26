# Statement Categorizer

Categorise bank, card and payment-app statement exports (.csv/.xlsx, Chinese or English) with keyword rules you can edit, fix any transaction by hand, spot uncategorised and double-counted rows, and see totals by category and month. Export a categorised Excel file, CSV and an HTML report; keep your rules for next month. Runs locally; no bank login, no API keys.

## Features

- **Inputs**: one or more CSV/XLSX exports. Description lines above the table are skipped. Columns are recognised in Chinese and English: date/交易时间, payee/交易对方, description/摘要/商品说明, a signed amount, an amount plus a 收/支 (in/out) column, or separate debit and credit columns. GBK-encoded CSV files are decoded.
- **Rules**: one line per rule, `keyword|other keyword => category`, case-insensitive; the first matching rule wins. A starter set covers common Chinese and English merchants (dining, groceries, transport, shopping, subscriptions, utilities, housing, income, savings).
- **Manual categories** in the table override rules and are kept when rules change.
- **Checks**: uncategorised transactions, unreadable dates or amounts, and the same date + amount + description appearing in two different files (possible double counting).
- **Summary**: income and spending totals, a bar per category, and a month × category table in the panel and the report.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `bank-statement-categorizer/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Categorise 账单/bank-2026-10.csv and 账单/支付宝-2026-11.csv and tell me where my money went each month"
- "Put UNKNOWN MERCHANT 8831 under Dining and add a rule that 小店 means Shopping"
- "Export the categorised Excel and the monthly report"

## Tools

| Tool | Purpose |
|---|---|
| `statement_open` | Read statement exports and categorise every transaction. Opens the panel |
| `statement_edit` | Change settings, edit cells by row, add or remove rows |
| `statement_status` | Show the current rows, issues and summary |
| `statement_export` | Write categorised.xlsx (transactions, month × category, rules), categorised.csv, report.html and rules.txt |

Output goes to `bank-statement-categorizer/<project>/` in the workspace.

## Scope (v0.1)

- Reads exported files only — it does not connect to banks or payment apps.
- One currency per project (no conversion). PDF statements: export CSV/XLSX from your bank first.
- Rules are keyword matches, not machine learning; the agent can suggest new rules for uncategorised rows.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `bank-statement-categorizer/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/bank-statement-categorizer/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-bank-statement-categorizer test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
