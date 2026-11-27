# Seating Planner

Seat an exam room, a classroom or a banquet in seconds. Open a name list and choose rows × seats or round tables; the planner keeps classmates from sitting next to each other in exams, keeps named people apart, seats friends together, puts people who need the front in the first rows, or fills banquet tables by family or department. Type a seat to lock it, change the seed to reshuffle the rest, and see every rule that couldn't be met. Export a printable seating chart PDF with a seat-lookup list, and a workbook. Runs locally; no account or API keys.

## Features

- **Two layouts**: rows × seats (R1C1 is front-left; the first row is nearest the front) or round tables (T1-1…).
- **Rules**: same group not side by side (exams), “keep apart from”, “sit with”, front-row seats, banquet tables filled by group.
- **Lock seats**: type a seat (R2C3, 2-3, 第2排第3列, 3桌4号) to fix it; everyone else is re-arranged around it.
- **Reproducible**: a seed makes the same list give the same plan; change it to reshuffle.
- **Checks**: more people than seats, seats that don't exist or are taken twice, rules that couldn't be met, names in rules that aren't on the list.
- **Exports**: an A4 landscape chart with the front marked, a seat-lookup page sorted by name, and a workbook with the list and a chart sheet.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `seating-planner/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Seat students.csv in a 6 × 8 exam room, keep classmates apart"
- "Lock 王子涵 at R6C8 and reshuffle"
- "Make it 4 round tables of 10, families together"

## Tools

| Tool | Purpose |
|---|---|
| `seats_open` | Read the name list and assign seats by the rules. Opens the panel |
| `seats_edit` | Change settings, edit cells by row, add or remove rows |
| `seats_status` | Show the current rows, issues and summary |
| `seats_export` | Write seating-chart.pdf and seating.xlsx |

Output goes to `seating-planner/<project>/` in the workspace.

## Scope (v0.1)

- Seats are arranged by a greedy rule-based method; with tight rules some conflicts may remain (they are listed).
- Drag-and-drop is not available in v0.1 — type a seat in the table to move someone.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `seating-planner/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/seating-planner/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-seating-planner test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
