# Dataset Masker

Make a safe copy of a spreadsheet with personal data before you hand it to an outsourcer, a vendor or an AI tool. Names, phone numbers, emails, ID and bank card numbers, addresses and birthdays are found automatically; choose per column to mask part of it (138****1234), hash it, replace it with a consistent pseudonym (用户0001), coarsen it (just the city, just the year), clean phone numbers and emails out of free-text notes, or drop the column. It warns if anything personal is still left. Runs locally; no API keys.

## Features

- **Finds personal data**: 姓名, 手机, 邮箱, 身份证, 银行卡, 地址, 生日 and note columns by header and by content (Chinese ID and mobile formats, emails, card numbers).
- **Seven methods**: keep, partial mask, keyed hash (HMAC-SHA256 — same value, same hash, so you can still count repeat customers), pseudonym (用户0001, consistent), generalize (year, province/city/district, amount ranges), scrub free text, drop.
- **Leak check**: warns when a kept or partly treated column still contains phone numbers, emails or ID numbers.
- **Before/after preview** for every column and the first rows of the result.
- **Report without secrets**: masking-report.md lists what was done to each column, never the original values or the hash key; the original file is never changed.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `dataset-masker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Mask the personal data in 会员数据-给外包.csv before I send it out"
- "Hash the phone numbers so the vendor can still match repeat customers"
- "Drop the ID card column"

## Tools

| Tool | Purpose |
|---|---|
| `mask_open` | Read the table, detect personal-data columns and preview the masked copy. Opens the panel |
| `mask_edit` | Change settings, edit cells by row, add or remove rows |
| `mask_status` | Show the current rows, issues and summary |
| `mask_export` | Write masked.csv, masked.xlsx and masking-report.md (methods only, no original values) |

Output goes to `dataset-masker/<project>/` in the workspace.

## Scope (v0.1)

- Pattern-based detection is tuned for Chinese and common international formats; always review the column list.
- Masking reduces risk but is not a legal anonymisation guarantee; rare combinations (birthday + district) can still identify people.
- One table per project; free-text names inside notes are not detected in v0.1.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `dataset-masker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/dataset-masker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-dataset-masker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
