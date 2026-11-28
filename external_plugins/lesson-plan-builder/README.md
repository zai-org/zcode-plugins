# Lesson Plan Builder

Write lesson plans as simple Markdown and get standard, printable 教案 in Word and PDF — and a check of the things reviewers mark you down for. Each lesson has its info (subject, grade, textbook, length), objectives, key points, materials, the teaching process (step headings with teacher / student / intent lines, a table, or one-line steps with minutes), board plan and homework. Edit any item or step in the table, add steps or homework, set the teacher, date and class start time (every step gets its start–end clock time). It checks that step times add up to the lesson length, flags objectives with vague verbs (了解 / 理解 / 掌握) and no observable outcome, long teacher-only stretches with no student activity, materials used in a step but missing from the preparation list, missing objectives, key points or homework. Exports one document for the whole unit — a lesson per page, the process as a 环节 / 时间 / 教师活动 / 学生活动 / 设计意图 table, optional blank reflection lines — as Word, PDF and Markdown. No account or API keys; runs on your computer.

## Features

- **Simple input**: Markdown per lesson; process as headings, a table or one-line steps.
- **Editable**: every objective, material, step, board line and homework is a row; add or remove rows.
- **Timing**: totals vs lesson length, start–end clock time per step.
- **Checks**: vague objectives, teacher-only stretches, materials missing from preparation, missing sections.
- **Exports**: Word, PDF and Markdown, one lesson per page, standard process table.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `lesson-plan-builder/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make Word and PDF lesson plans from the files in 教案"
- "Fix the timing and add homework to lesson 2"
- "Export the lesson plans"

## Tools

| Tool | Purpose |
|---|---|
| `lesson_open` | Read the lesson plan files and check them. Opens the panel |
| `lesson_edit` | Change settings, edit cells by row, add or remove rows |
| `lesson_status` | Show the current rows, issues and summary |
| `lesson_export` | Write lesson-plans.docx, lesson-plans.pdf and lesson-plans.md |

Output goes to `lesson-plan-builder/<project>/` in the workspace.

## Scope (v0.1)

- Checks the structure and wording, not the teaching itself.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `lesson-plan-builder/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/lesson-plan-builder/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-lesson-plan-builder test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
