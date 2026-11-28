# Rubric Maker

Write a grading rubric once — criteria, levels, points and a descriptor for every cell — then score the whole class by picking a level per criterion. The rubric is a short Markdown file (weights like “论点 ×2” or “论据（8 分）”, levels like 优秀 4 | 良好 3 | 合格 2 | 待改进 1, a total such as 满分 20); the class list is a CSV or Excel roster that can already hold levels typed as names, first characters, A–D or points. Every student gets a score scaled to the total and automatic feedback: strengths from their top-level descriptors and two next steps quoting the descriptor one level up. Catches levels that don't exist (a 5 on a 4-point scale), half-scored or unscored students, duplicates, rubric cells without a descriptor, weights that don't add up to the total, and criteria where everyone got the same level. Exports the rubric as a printable table to hand out, a scores workbook with rank and level distribution, and feedback slips (three per page) to cut and return. No account or API keys; runs on your computer.

## Features

- **Rubric in Markdown**: criteria, weights, levels, points, descriptors.
- **Fast scoring**: pick a level per criterion; names, first characters, A–D or points all work.
- **Feedback**: strengths and next steps quoted from the rubric.
- **Checks**: invalid levels, missing scores, duplicates, missing descriptors, weights vs total, non-discriminating criteria.
- **Exports**: printable rubric, scores workbook with rank and distribution, feedback slips.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `rubric-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Score the class in 作文评分 with the essay rubric"
- "Fix the invalid level and remove the duplicate student"
- "Export the rubric, scores and feedback slips"

## Tools

| Tool | Purpose |
|---|---|
| `rubric_open` | Read the rubric and roster and score the students. Opens the panel |
| `rubric_edit` | Change settings, edit cells by row, add or remove rows |
| `rubric_status` | Show the current rows, issues and summary |
| `rubric_export` | Write rubric.pdf, scores.xlsx and feedback.pdf |

Output goes to `rubric-maker/<project>/` in the workspace.

## Scope (v0.1)

- Feedback is built from the rubric's own descriptors; add a personal comment where it matters.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `rubric-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/rubric-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-rubric-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
