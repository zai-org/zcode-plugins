# Shift Scheduler

Build a fair weekly shift rota from your team's availability. List who can work when — any shift, a day off, named shifts like 早班/晚班 or a time window like 10-18 — set each person's maximum weekly hours, and define the shifts and how many people each needs. Shifts are shared out evenly by hours while respecting maximum hours, one shift a day and a minimum rest between shifts (no closing then opening). Understaffed shifts are highlighted so you can fix them. Export a rota workbook, a printable HTML rota and a calendar file for each person. Runs locally; no account or API keys.

## Features

- **Flexible availability**: empty or 全天 = any shift, 休/x = off, shift names (早班, 晚班), or a time window (10-18) per weekday.
- **Any shifts**: “早班 08:00-16:00 ×2; 晚班 16:00-24:00 ×2”, overnight shifts like 22-6 included.
- **Fair and legal-minded**: shares hours evenly, never over a person's weekly maximum, one shift per day by default, and a minimum rest between shifts.
- **Understaffing shown**: shifts that couldn't be filled are red in the panel and the workbook, with how many people are missing.
- **Exports**: a rota workbook (grid, hours per person, full list), a printable HTML rota and one .ics calendar per person.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `shift-scheduler/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make next week's rota from staff.csv: 早班 08-16 ×2, 晚班 16-24 ×2"
- "Tom can't work Sunday — redo it"
- "Export the rota and send everyone their calendar file"

## Tools

| Tool | Purpose |
|---|---|
| `shifts_open` | Read staff availability and build the week's rota. Opens the panel |
| `shifts_edit` | Change settings, edit cells by row, add or remove rows |
| `shifts_status` | Show the current rows, issues and summary |
| `shifts_export` | Write rota.xlsx, rota.html and ics/<name>.ics |

Output goes to `shift-scheduler/<project>/` in the workspace.

## Scope (v0.1)

- One week at a time; roles/skills per shift are not matched in v0.1 (the role column is for reference).
- Assignments are calculated; to move someone, change their availability (e.g. 休 on that day) and the rota updates.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `shift-scheduler/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/shift-scheduler/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-shift-scheduler test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
