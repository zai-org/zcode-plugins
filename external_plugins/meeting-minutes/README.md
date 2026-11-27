# Meeting Minutes

Turn rough meeting notes or a transcript into proper minutes. It picks out the date, attendees, agenda, decisions, open questions and action items, works out who owns each action and when it's due ("周五前", "下周一", "by Friday", "next Monday" are resolved against the meeting date), and flags actions with no owner or deadline. Fix anything in the table, then export a Word document, Markdown and a calendar file with one reminder per deadline. Runs locally; no upload or API keys.

## Features

- **Notes or transcripts**: Markdown/plain notes, 'Name: words' transcripts with or without [00:01:02] timestamps, and SRT/VTT captions.
- **Header**: title, date, time, location, attendees and note-taker from lines like 参会人： / Attendees:, plus transcript speakers.
- **Sorted items**: agenda, decisions, action items, open questions and discussion notes — from section headings (议程, 决定, 行动项, Agenda, Decisions…) and wording (决定/同意/agreed, TODO/[ ]/负责/I'll/can you, question marks).
- **Owners and deadlines**: @name, 负责人：, a named attendee or the speaker for 'I'll / 我来'; dates like 周五前, 下周一, 11月22日, 月底, three days, by Friday, next Monday, tomorrow, Dec 3.
- **Checks**: actions without an owner or date, owners not on the attendee list, deadlines before the meeting.
- **Exports**: Word minutes with an action table, Markdown, an .ics calendar file (all-day or timed with a reminder) and an action CSV.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `meeting-minutes/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Turn today's meeting notes into minutes"
- "List the action items with owners and deadlines"
- "Make a calendar file for the deadlines"

## Tools

| Tool | Purpose |
|---|---|
| `minutes_open` | Read the notes and sort them into agenda, decisions, actions and questions. Opens the panel |
| `minutes_edit` | Change settings, edit cells by row, add or remove rows |
| `minutes_status` | Show the current rows, issues and summary |
| `minutes_export` | Write minutes.docx, minutes.md, actions.ics and actions.csv |

Output goes to `meeting-minutes/<project>/` in the workspace.

## Scope (v0.1)

- Works from text: audio recordings need transcribing first.
- Sorting uses headings and wording, not AI summarising — review the table before sending.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `meeting-minutes/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/meeting-minutes/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-meeting-minutes test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: docx (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
