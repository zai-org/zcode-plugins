# Interview Scorecard

Turn several interviewers' scorecards into one fair, weighted ranking. Write the criteria once in Markdown — weights, a 1–5 (or any) scale, the hire bar and anchor descriptions for each level — and drop in the score sheets (Excel or CSV, one row per candidate × interviewer; column names are matched to the criteria, aliases allowed). It averages each candidate per criterion and by weight, suggests 建议录用 / 待定 / 需讨论 / 不建议, and catches what a spreadsheet won't: typos like 45 for 4.5, missing scores, duplicate scorecards, interviewers who disagree by two points or more, a “strong yes” with failing scores, extreme scores without evidence, and lenient or strict interviewers (with optional calibration). Exports a ranking workbook, a one-page PDF scorecard per candidate with every interviewer's scores and comments, and a blank printable scorecard with the anchors. No account or API keys; everything stays on your computer.

## Features

- **Criteria in Markdown**: weights, scale, hire bar, anchors per level; weight overrides in settings.
- **Merges sheets**: several Excel/CSV files, column names matched to criteria, Chinese/English headers.
- **Ranking**: per-criterion and weighted averages, suggestion per candidate, verdict tally.
- **Checks**: out-of-range typos, missing scores, duplicates, disagreement, verdict vs score, extreme scores without evidence, lenient/strict interviewers.
- **Exports**: ranking workbook, per-candidate PDF scorecards, blank printable scorecard.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `interview-scorecard/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Combine the interview scorecards in 面试 into a ranking"
- "Fix the 45 typo and drop the duplicate scorecard"
- "Export the ranking and scorecards"

## Tools

| Tool | Purpose |
|---|---|
| `scorecard_open` | Read the criteria and score sheets and rank the candidates. Opens the panel |
| `scorecard_edit` | Change settings, edit cells by row, add or remove rows |
| `scorecard_status` | Show the current rows, issues and summary |
| `scorecard_export` | Write ranking.xlsx, scorecards.pdf and blank-scorecard.pdf |

Output goes to `interview-scorecard/<project>/` in the workspace.

## Scope (v0.1)

- Scores support a decision, they don't make it — read the comments and discuss split candidates.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `interview-scorecard/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/interview-scorecard/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-interview-scorecard test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
