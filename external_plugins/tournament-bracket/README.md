# Tournament Bracket

Run a company or school tournament from a team list: generate a round-robin (single or home-and-away) or a seeded knockout with byes for the top seeds and an optional 3rd-place match, date every round, enter scores as you go and get live standings or a filled-in bracket. Results already played can come from a sheet. Standings rank by points (win/draw/loss points configurable), then head-to-head, difference and points scored; knockout winners move on automatically, draws need a decider such as 2(4):2(3). Catches typos in scores and team names, duplicate teams and seeds, scores entered before a match's teams are known, a team booked twice on one day and ties that need a lot or play-off. Exports a standings workbook with fixtures and a cross table, the bracket or standings as SVG and PNG to post in the group chat, and a printable fixture sheet with score boxes. No account or API keys; runs on your computer.

## Features

- **Formats**: round robin (single/double) or seeded knockout with byes and 3rd-place match.
- **Scores**: type 21:15 or 2(4):2(3); import results already played.
- **Standings**: points, head-to-head, difference, scored; knockout winners advance automatically.
- **Checks**: score and name typos, duplicates, early scores, double bookings, unresolved ties.
- **Exports**: standings workbook, bracket/standings image, printable fixtures.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `tournament-bracket/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a round-robin schedule for the teams in 羽毛球赛"
- "Enter today's scores"
- "Export the standings and bracket"

## Tools

| Tool | Purpose |
|---|---|
| `bracket_open` | Read the team list and build the schedule. Opens the panel |
| `bracket_edit` | Change settings, edit cells by row, add or remove rows |
| `bracket_status` | Show the current rows, issues and summary |
| `bracket_export` | Write standings.xlsx, bracket.svg, bracket.png and schedule.pdf |

Output goes to `tournament-bracket/<project>/` in the workspace.

## Scope (v0.1)

- Single-stage events; group stage + knockout can be done as two projects.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `tournament-bracket/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/tournament-bracket/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-tournament-bracket test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
