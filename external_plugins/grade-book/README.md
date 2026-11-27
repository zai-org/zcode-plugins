# Grade Book

Turn a score sheet into totals, averages, rankings and report cards. Drop in a spreadsheet with one row per student and one column per subject: full marks are guessed per subject (100, 150…) or set by you, subjects can be weighted, and every student gets a total, weighted average, band (优秀 / 良好 / 及格 …) and overall and class rank. Per-subject statistics for each class — mean, highest, lowest, pass and excellent rates — and score distribution charts come with it. Fix scores or write a comment for each student, then export an Excel grade book, one A5 report card per student and a summary PDF. Runs locally; no school system login or API keys.

## Features

- **Totals, weighted averages and ranks**: overall and per class, ties share a rank (1, 2, 2, 4); rank by total or weighted average.
- **Full marks and weights per subject**: guessed from the scores or set as “语文=150; 物理=100” and “数学=1.5”.
- **Bands** by % of full marks: “优秀 85; 良好 75; 及格 60; 不及格 0”, applied to each subject and the average.
- **Class statistics**: mean, max, min, median, SD, pass and excellent rates, absences — per subject, per class.
- **Distribution charts** per subject in the panel and the summary PDF.
- **Report cards**: one A5 page per student with scores, class averages, band, ranks, a score-vs-class chart, your comment and a parent signature line.
- **Checks**: scores above full marks, text that isn't a score, duplicate students; 缺考 / absent is left out of averages.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `grade-book/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Analyse scores.xlsx and rank the students"
- "Weight maths 1.5 and rank by average"
- "Make report cards for every student"

## Tools

| Tool | Purpose |
|---|---|
| `grades_open` | Read the score sheet and compute totals, bands and ranks. Opens the panel |
| `grades_edit` | Change settings, edit cells by row, add or remove rows |
| `grades_status` | Show the current rows, issues and summary |
| `grades_export` | Write grades.xlsx, report-cards.pdf and summary.pdf |

Output goes to `grade-book/<project>/` in the workspace.

## Scope (v0.1)

- One row per student; one exam or term per sheet.
- Bands and ranks only — no GPA conversion tables for specific schools.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `grade-book/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/grade-book/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-grade-book test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
