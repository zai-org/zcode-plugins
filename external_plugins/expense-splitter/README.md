# Expense Splitter

Split the costs of a group trip, dinner or shared flat and settle up with the fewest transfers. List who paid what — one payer or several — and who shares each expense: everyone, everyone except someone, weighted shares like “A*2”, an exact amount, or an extra on top of an equal share. See what each person paid, owes and gets back, and the shortest list of “who pays whom”. Export a settlement workbook and a clean image to send to the group chat. Runs locally; no account or API keys.

## Features

- **Several payers**: “小李:900; 阿珍:500” for a bill two people paid together.
- **Flexible splits**: 全部 / all, a list of names, “全部, -Tom” (everyone but Tom), weights “小王*2”, an exact amount “Tom:80, 小王, 小李”, or an extra “Tom+80, 全部” (Tom pays 80 more, the rest is split by everyone).
- **Exact to the cent**: amounts are counted in cents and leftover cents are shared out so every split adds up exactly.
- **Fewest transfers**: groups people whose balances cancel out, so the settle-up list is as short as possible.
- **Checks**: payers that don't add up to the amount, nobody to share an expense, names spelled two ways, people missing from the member list.
- **Exports**: a workbook with transfers, balances and each expense split per person, and a PNG card for the group chat.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `expense-splitter/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Split the costs in expenses.csv"
- "Tom didn't go cycling — leave him out of that one"
- "Who pays whom, and send me a picture for the group chat"

## Tools

| Tool | Purpose |
|---|---|
| `split_open` | Read the expenses and work out who owes whom. Opens the panel |
| `split_edit` | Change settings, edit cells by row, add or remove rows |
| `split_status` | Show the current rows, issues and summary |
| `split_export` | Write settlement.xlsx and settlement.png |

Output goes to `expense-splitter/<project>/` in the workspace.

## Scope (v0.1)

- One currency per project in v0.1 — convert foreign spending before entering it.
- Refunds: enter them as a separate expense paid by the person who received the money.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `expense-splitter/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/expense-splitter/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-expense-splitter test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), resvg-wasm (MPL-2.0), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
