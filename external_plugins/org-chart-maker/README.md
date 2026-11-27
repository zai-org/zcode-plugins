# Org Chart Maker

Turn a staff list into a clean organisation chart. Each person just needs a name, a title, a department and who they report to; the chart is laid out automatically, coloured by department or level, with large teams stacked neatly. Collapse a branch to show “+N”, limit how many levels appear, and fix reporting lines by editing the manager column — missing managers, loops and duplicate names are flagged. Export SVG, a high-resolution PNG and a one-page PDF. Runs locally; no account or API keys.

## Features

- **Just a manager column**: the reporting tree is built from each person's manager name; people without a manager become top-level boxes.
- **Tidy layout**: centred tree, no overlaps; teams of more than N individual contributors are stacked vertically to keep the chart narrow.
- **Collapse and depth**: collapse a branch to a “+N” badge or show only the top levels.
- **Colours** by department (with the department under each title) or by level.
- **Checks**: managers not in the list, reporting loops, duplicate names; each person's total team size is shown.
- **Exports**: SVG, 2× PNG and a PDF fitted on one A4 (or A3 for big charts) landscape page.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `org-chart-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make an org chart from staff.csv"
- "马克 reports to 陈总 — fix that and collapse 赵磊's team"
- "Export it as PNG and PDF"

## Tools

| Tool | Purpose |
|---|---|
| `orgchart_open` | Read the staff list and build the reporting tree. Opens the panel |
| `orgchart_edit` | Change settings, edit cells by row, add or remove rows |
| `orgchart_status` | Show the current rows, issues and summary |
| `orgchart_export` | Write org-chart.svg, org-chart.png and org-chart.pdf |

Output goes to `org-chart-maker/<project>/` in the workspace.

## Scope (v0.1)

- Photos are not placed on the boxes in v0.1.
- One manager per person (no dotted-line reporting).

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `org-chart-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/org-chart-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-org-chart-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), resvg-wasm (MPL-2.0), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
