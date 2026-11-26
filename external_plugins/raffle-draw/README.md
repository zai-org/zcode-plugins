# Raffle & Grouping

Run lucky draws and random team splits that anyone can check. Pick the participant list, set the prizes (like 一等奖×1, 二等奖×3, 三等奖×5) and a seed, and the winners are drawn with SHA-256 based random numbers — the same list and seed always give the same result, and an audit log records every step so the draw can be verified later. Weight by number of tickets, exclude people, lock a winner and re-draw the rest. Or split everyone into balanced groups, with each department spread evenly. Runs locally; no lottery service or API keys.

## Features

- **Reproducible**: SHA-256 based random numbers from a seed you can announce beforehand; same list + seed = same result.
- **Audit log**: audit.json with the method, a fingerprint of the list and every draw step (pool size, random number, winner).
- **Prizes and weights**: prizes like 二等奖×3, drawn smallest-first or as listed; weighted by tickets or equal; one prize per person or repeats.
- **Lock and re-draw**: type a prize into someone's row to lock it, change the seed to re-draw everyone else.
- **Balanced groups**: N groups or groups of N, spreading a column such as department evenly.
- **From your list**: recognises 姓名, 部门, 抽奖券, 不参与, 工号 and English headers; duplicate names are told apart.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `raffle-draw/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Draw 一等奖×1, 二等奖×3, 三等奖×5 from participants.csv with seed 2026-annual"
- "Lock the first prize winner and re-draw the rest"
- "Split everyone into 4 groups balanced by department"

## Tools

| Tool | Purpose |
|---|---|
| `raffle_open` | Read the participant list and run the draw. Opens the panel |
| `raffle_edit` | Change settings, edit cells by row, add or remove rows |
| `raffle_status` | Show the current rows, issues and summary |
| `raffle_export` | Write result.xlsx and audit.json |

Output goes to `raffle-draw/<project>/` in the workspace.

## Scope (v0.1)

- This is a drawing tool, not a lottery service; it does not handle payments or prizes.
- No big-screen animation in v0.1 — the result is shown in the panel and exported.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `raffle-draw/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/raffle-draw/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-raffle-draw test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
