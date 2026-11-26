# Coupon Code Generator

Generate batches of unique coupon, gift and redeem codes and printable cards from a small campaign sheet. Set a pattern like XXXX-XXXX, a prefix per batch, and a character set without look-alike letters, with an optional check character so typos are caught. Codes come from a seed, so the same campaign always gives the same codes, and a list of codes you have already issued is never reused. Export a CSV for your shop system and a cards PDF with value, code, expiry and a QR code that can open your redeem page. Runs locally; no coupon service or API keys.

## Features

- **Batches from a sheet**: recognises 批次, 前缀, 数量, 面值, 有效期, 说明 and English headers.
- **Readable codes**: patterns like XXXX-XXXX; letters + digits without 0/O/1/I, letters only, or digits only.
- **Check character**: optional last character (Luhn for digits) so a mistyped code can be spotted.
- **Reproducible and unique**: codes come from a seed; codes across batches and in your already-issued list are never repeated.
- **Shop-ready CSV**: code, batch, value, expiry, note and QR link, UTF-8 with BOM for Excel.
- **Printable cards**: 10 per A4 with cut lines, value, code, expiry, note and a QR code (just the code or your redeem URL).
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `coupon-code-generator/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Generate codes from campaign.csv with seed winter-2026, avoid used-codes.txt"
- "Use digits only with a check digit"
- "Put https://shop.example/redeem?code={code} in the QR and export cards"

## Tools

| Tool | Purpose |
|---|---|
| `coupon_open` | Read the campaign sheet and generate the codes. Opens the panel |
| `coupon_edit` | Change settings, edit cells by row, add or remove rows |
| `coupon_status` | Show the current rows, issues and summary |
| `coupon_export` | Write codes.csv and coupon-cards.pdf |

Output goes to `coupon-code-generator/<project>/` in the workspace.

## Scope (v0.1)

- Codes are generated, not registered — import codes.csv into your shop or POS to make them work.
- The seed is the secret behind the codes: don't publish it.
- Very large batches (over 20,000) export as CSV only.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `coupon-code-generator/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/coupon-code-generator/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-coupon-code-generator test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), node-qrcode (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
