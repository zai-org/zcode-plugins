# Printable Calendar

Print a calendar for the year with your holidays and events already written in. Get a monthly calendar with a page per month and big boxes to write in, and a year-at-a-glance page. Optionally pick a list of dates — holidays, make-up working days, birthdays, trips, deadlines — or type holidays straight into the settings. Choose the year and months, Monday or Sunday start, A4 or Letter, Chinese and English labels, week numbers and your colour. Runs locally; no design service or API keys.

## Features

- **Monthly pages**: big boxes with your events written in, weekends and holidays shaded, 休/班 tags, overflow marked.
- **Year at a glance**: all months on one page with holidays highlighted, event days marked and a list of dates below.
- **Your dates**: pick a CSV/Excel of 日期, 结束日期, 事项, 类型 (活动/假期/补班), 颜色 — or type holidays in the settings.
- **Any span**: choose the year, start month and up to 24 months.
- **Print options**: A4 or Letter, portrait or landscape, Monday or Sunday start, ISO week numbers, Chinese/English labels, accent colour.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `printable-calendar/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a 2027 calendar with events.csv titled 青禾 2027"
- "Start weeks on Sunday, English labels, Letter paper"
- "Add 2027-06-09 Dragon Boat holiday and show week numbers"

## Tools

| Tool | Purpose |
|---|---|
| `cal_open` | Read the event list (optional) and preview the year. Opens the panel |
| `cal_edit` | Change settings, edit cells by row, add or remove rows |
| `cal_status` | Show the current rows, issues and summary |
| `cal_export` | Write calendar-<year>-monthly.pdf and calendar-<year>-year.pdf |

Output goes to `printable-calendar/<project>/` in the workspace.

## Scope (v0.1)

- Public holidays aren't built in — enter them from your official holiday notice (examples are marked in the sample).
- No lunar calendar dates in v0.1.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `printable-calendar/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/printable-calendar/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-printable-calendar test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
