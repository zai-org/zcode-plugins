# Attendance Report

Turn the raw punch records from your time clock or attendance app into a monthly attendance report. Pick the export, set the shift hours, grace minutes, flexible start, lunch break, overtime rule, rest days and holidays, and see for each person and day the first and last punch, late arrivals, early leaves, missing punches, absences and overtime. Fix a forgotten punch or mark leave and business trips right in the table, then export a summary workbook and one workbook per person for them to check. Runs locally; no HR system or API keys.

## Features

- **From any punch export**: one row per punch with 姓名 and 打卡时间 (or 日期 + 时间), in CSV or Excel; duplicate punches are merged.
- **Your rules**: shift start/end, late and early-leave grace, flexible start, lunch break, overtime threshold and minimum.
- **Calendar**: Sat+Sun, Sun-only or no rest days; public holidays and make-up working days.
- **Every day judged**: late, early leave, missing punch, absence, weekday and rest-day overtime, hours worked.
- **Fix in the table**: add a forgotten punch, or write 请假/病假/出差 in the note to excuse the day.
- **Workbooks**: a summary per person with the day-by-day detail highlighted, plus one workbook per person.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `attendance-report/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make the November attendance report from punches.xlsx"
- "Shift is 9:30–18:30 with 30 minutes flexible start"
- "Mark 赵小雨 on leave on 11-18 and 11-19 and export"

## Tools

| Tool | Purpose |
|---|---|
| `attend_open` | Read the punch records and work out each day. Opens the panel |
| `attend_edit` | Change settings, edit cells by row, add or remove rows |
| `attend_status` | Show the current rows, issues and summary |
| `attend_export` | Write attendance-<month>.xlsx and people/<name>-<month>.xlsx |

Output goes to `attendance-report/<project>/` in the workspace.

## Scope (v0.1)

- One shift per company in v0.1 — no rotating or night shifts across midnight.
- Leave balances and payroll are not calculated.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `attendance-report/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/attendance-report/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-attendance-report test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
