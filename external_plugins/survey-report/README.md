# Survey Report

Turn a survey export into a finished report. Drop in the spreadsheet from your form tool — one row per response — and every question gets its type detected (single choice, multiple choice, rating, NPS, number or open text), a bar or pie chart, counts and percentages. Rename questions, switch chart types, leave questions out, and cross-tab everything by one question such as age group or channel. Export a one-page HTML report, an A4 PDF and an Excel workbook with the numbers, cross-tabs and every open answer. Runs locally; no form-tool login or API keys.

## Features

- **Question types detected**: single and multiple choice (answers joined by ┋ , ; 、 |), ratings (1–5, 1–7, 1–10), NPS (0–10), numbers, open text; IDs, times and contact columns are skipped.
- **Charts**: bar or pie per question, NPS bars coloured by detractor / passive / promoter.
- **Scores**: mean and top-box % for ratings, NPS with promoter / passive / detractor shares, mean / median / range for numbers.
- **Cross-tabs**: pick one single-choice question (e.g. age group) and every other question is broken down by it.
- **Edit before export**: rename questions, change type or chart, leave questions out.
- **Three outputs**: a self-contained HTML report, an A4 PDF, and an Excel workbook with counts, cross-tabs, every open answer and the raw data.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `survey-report/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a report from survey.xlsx"
- "Cross-tab every question by age group"
- "Show the NPS and the open answers"

## Tools

| Tool | Purpose |
|---|---|
| `survey_open` | Read the survey export and detect question types. Opens the panel |
| `survey_edit` | Change settings, edit cells by row, add or remove rows |
| `survey_status` | Show the current rows, issues and summary |
| `survey_export` | Write report.html, report.pdf and results.xlsx |

Output goes to `survey-report/<project>/` in the workspace.

## Scope (v0.1)

- One row per response; matrix questions exported as one column per row work as separate questions.
- No sentiment or AI summary of open answers — they are listed as written.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `survey-report/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/survey-report/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-survey-report test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
