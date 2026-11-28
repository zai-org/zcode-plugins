# Timetable Builder

Turn a list of what each class needs — subject, teacher, periods per week, a shared room, fixed slots, double periods — into clash-free class and teacher timetables. Teacher limits (周三下午 for a research meeting, no first two periods on Monday…) and room capacity (the sports field takes two classes at once, the computer lab one) come from extra sheets or settings. The scheduler never double-books a class, teacher or room, keeps fixed slots like 班会 周五7, places double periods together, spreads each subject across the week, keeps core subjects in the morning and avoids piling up one teacher's day; when something can't be placed it says why. Change a teacher, hours or a fixed slot and the timetable is rebuilt. Exports a workbook with a master sheet and one grid per class and per teacher, and a colour-coded landscape PDF to print or post. No account or API keys; runs on your computer.

## Features

- **Requirements sheet**: class, subject, teacher, hours, room, fixed slots, double periods; teacher limits and room capacity sheets.
- **Clash-free scheduling**: classes, teachers and rooms never double-booked; fixed slots and limits respected.
- **Good spread**: subjects across the week, core subjects in the morning, balanced teacher days.
- **Checks**: unplaced periods with the reason, clashing fixed slots, overloaded teachers and classes, unreadable slots.
- **Exports**: master + per-class + per-teacher Excel, colour-coded PDF.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `timetable-builder/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Build the timetables from 排课/课程需求.xlsx"
- "Fix the clashing fixed slot"
- "Export class and teacher timetables"

## Tools

| Tool | Purpose |
|---|---|
| `timetable_open` | Read the requirements and build the timetables. Opens the panel |
| `timetable_edit` | Change settings, edit cells by row, add or remove rows |
| `timetable_status` | Show the current rows, issues and summary |
| `timetable_export` | Write timetables.xlsx and timetables.pdf |

Output goes to `timetable-builder/<project>/` in the workspace.

## Scope (v0.1)

- A fast heuristic scheduler for a school or grade, not an optimiser for a whole district.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `timetable-builder/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/timetable-builder/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-timetable-builder test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
