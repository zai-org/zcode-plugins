# Gantt Planner

Turn a simple task list into a Gantt chart with real working-day dates. List tasks with durations in workdays, who owns them and what they depend on; the planner schedules each task the workday after its predecessors finish, skips weekends and the holidays you list, marks milestones and highlights the critical path — the chain of tasks that sets the finish date. Fix a start date, change a duration or a dependency and every date moves. Export the chart as SVG and PNG, the schedule as Excel, and an HTML page. Runs locally; no account or API keys.

## Features

- **Workday scheduling**: durations in workdays; weekends and listed holidays are skipped (or count weekends as workdays).
- **Dependencies**: “depends on 4, 5” starts a task the workday after both finish; fixed start dates are kept unless a predecessor finishes later (you're told).
- **Critical path**: tasks with zero slack are red; every task shows its slack in days.
- **Milestones**: duration 0 draws a diamond with its date; progress % fills each bar.
- **Checks**: circular dependencies, unknown or duplicate task ids.
- **Exports**: SVG and 2× PNG chart with months, days, weekend shading and dependency arrows; an Excel schedule with critical tasks marked; an HTML page.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `gantt-planner/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a Gantt chart from tasks.csv, with 25 Dec off"
- "前端开发 will take 12 days — what's the new finish date?"
- "Export the chart and the schedule"

## Tools

| Tool | Purpose |
|---|---|
| `gantt_open` | Read the tasks and schedule them in workdays with dependencies. Opens the panel |
| `gantt_edit` | Change settings, edit cells by row, add or remove rows |
| `gantt_status` | Show the current rows, issues and summary |
| `gantt_export` | Write gantt.svg, gantt.png, schedule.xlsx and gantt.html |

Output goes to `gantt-planner/<project>/` in the workspace.

## Scope (v0.1)

- Finish-to-start dependencies only (no lag/lead or start-to-start) in v0.1.
- No resource levelling: two tasks for the same owner may overlap.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `gantt-planner/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/gantt-planner/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-gantt-planner test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), resvg-wasm (MPL-2.0), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
