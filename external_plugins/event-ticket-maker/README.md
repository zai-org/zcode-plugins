# Event Tickets

Issue QR-code tickets for your event and run check-in from a spreadsheet. Pick the guest list, enter the event name, time and place, and every guest gets a unique, hard-to-guess ticket code. Print three tickets per A4 page with a tear-off stub, or export one PDF per guest to send out, plus a check-in workbook with a signature column. On the day, pick the scanner's export together with the guest list to see who has arrived — unknown, mistyped and repeated scans are flagged. Codes stay the same when you reopen the list. Runs locally; no ticketing service or API keys.

## Features

- **From your guest list**: recognises 姓名, 票种, 座位, 手机, 邮箱 and English headers; existing codes in the sheet are kept.
- **Safe codes**: PREFIX-XXXX-XXXX with a check character and no look-alike letters (0/O, 1/I), so typos are caught.
- **Codes that stay**: reopening the same list reuses the codes already issued and manual check-ins.
- **Tickets**: 3 per A4 with a tear-off QR stub, or one per page for sending; one PDF per guest too.
- **Check-in**: pick scanner exports (CSV, XLSX or TXT) with the list; unknown, mistyped and repeat scans are flagged.
- **Check-in workbook**: list by name with arrival time and a signature column, plus a summary by ticket type.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `event-ticket-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make tickets from guests.csv for 青禾产品发布会 on 2026-11-28 14:00"
- "Export one ticket PDF per guest"
- "Here are the door scans (scans.csv) — who hasn't arrived?"

## Tools

| Tool | Purpose |
|---|---|
| `ticket_open` | Read the guest list (and any scan exports) and assign ticket codes. Opens the panel |
| `ticket_edit` | Change settings, edit cells by row, add or remove rows |
| `ticket_status` | Show the current rows, issues and summary |
| `ticket_export` | Write tickets.pdf, one PDF per guest and checkin.xlsx |

Output goes to `event-ticket-maker/<project>/` in the workspace.

## Scope (v0.1)

- Scanning is done with any QR scanner or phone app that can export a list; this plugin reads that export.
- Tickets aren't emailed for you — send the per-guest PDFs yourself.
- Ticket codes are recorded in event-ticket-maker/ticket-codes.json; keep that file to keep codes stable.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `event-ticket-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/event-ticket-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-event-ticket-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), node-qrcode (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
