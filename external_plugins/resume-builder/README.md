# Resume Builder

Write your resume in plain Markdown and get a clean PDF, Word and web version — with checks a recruiter would make. Sections, entries and bullets become an editable table (reorder, hide, rewrite), laid out in three templates (accent header, classic, compact) on A4 or Letter. It flags missing email or phone, end dates before start dates, gaps of more than six months between jobs, mixed date formats, bullets that start with 负责 / 参与 / “Responsible for”, work bullets without any numbers, overly long bullets, ID numbers and age or marital status, and a PDF that runs over your page limit. Exports PDF, DOCX, HTML and a cleaned-up Markdown. Runs locally; no account or API keys.

## Features

- **Markdown in**: `# name`, contact line, `## section`, `### org · role | dates`, `-` bullets.
- **Templates**: accent header, classic, compact; colour; A4/Letter; page limit.
- **Checks**: contact info, date order, gaps > 6 months, date formats, weak openers, bullets without numbers, long bullets, ID numbers / age / marital status, page count.
- **Exports**: PDF (embedded CJK font), DOCX, HTML, Markdown.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `resume-builder/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Lay out 林小满-简历.md as a resume"
- "Fix the wrong dates and remove the ID number"
- "Export PDF and Word"

## Tools

| Tool | Purpose |
|---|---|
| `resume_open` | Read the resume Markdown, lay it out and check it. Opens the panel |
| `resume_edit` | Change settings, edit cells by row, add or remove rows |
| `resume_status` | Show the current rows, issues and summary |
| `resume_export` | Write resume.pdf, resume.docx, resume.html and resume.md |

Output goes to `resume-builder/<project>/` in the workspace.

## Scope (v0.1)

- It checks structure and wording patterns; it does not rewrite your content or judge it against a job description.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `resume-builder/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/resume-builder/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-resume-builder test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
