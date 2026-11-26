# Calendar File Builder

Turn an event spreadsheet into a calendar file that Apple Calendar, Google Calendar, Outlook and phones can import. Pick the sheet with titles, dates and times, and get a standard .ics with time zones done properly (daylight saving included), all-day and multi-day events, reminders like 15 minutes or 1 day before, and repeats such as every week, every other week, Mon/Wed/Fri, workdays, monthly or yearly with a count or end date. Also get one .ics per event to send around and a printable schedule. Runs locally; no calendar account or API keys.

## Features

- **From your sheet**: recognises 标题, 日期, 开始, 结束, 结束日期, 全天, 地点, 说明, 重复, 重复截止, 提醒, 分类 and English headers; “14:00-16:00” in one cell works too.
- **Time zones done right**: any IANA zone, with a VTIMEZONE built from real daylight-saving changes.
- **All-day, multi-day and overnight** events.
- **Repeats in plain words**: 每周, 每两周, 每周一三五, 工作日, 每月, 每年, weekly, every 2 weeks… with a count or end date.
- **Reminders**: 15分钟, 1小时, 1天 or several at once; set a default for every event.
- **Outputs**: one calendar file, one .ics per event, and a printable schedule by month.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `ics-calendar-builder/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a calendar file from events.xlsx called 青禾 12 月日程"
- "Add a 10-minute reminder to every event"
- "Export one .ics per event and a printable schedule"

## Tools

| Tool | Purpose |
|---|---|
| `ics_open` | Read the event sheet and check every event. Opens the panel |
| `ics_edit` | Change settings, edit cells by row, add or remove rows |
| `ics_status` | Show the current rows, issues and summary |
| `ics_export` | Write <calendar>.ics, events/*.ics and schedule.html |

Output goes to `ics-calendar-builder/<project>/` in the workspace.

## Scope (v0.1)

- Creates files to import; it doesn't sync with or write to your online calendar.
- Inviting attendees isn't supported in v0.1.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `ics-calendar-builder/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/ics-calendar-builder/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-ics-calendar-builder test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
