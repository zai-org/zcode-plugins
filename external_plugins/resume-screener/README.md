# Resume Screener

Screen a folder of resumes against a job description on your own computer. It reads the must-haves, nice-to-haves, minimum years and degree from the JD (Markdown or text), then scores every resume — Word, PDF with text, Markdown or text, Chinese or English — showing which requirements were found and which must-haves are missing, years of experience from merged work dates, degree, email and phone. Chinese and English terms match each other (A/B 测试 = A/B test, 餐饮 = restaurant…). Age, gender and marital-status requirements in the JD are flagged and never scored. Also catches duplicate candidates (same email or phone), unreadable or scanned resumes and missing contact details. Track status and notes per candidate, and export a ranked Excel shortlist and a Markdown summary. Keyword matching to speed up a first pass — a person makes the decision. No account or API keys; resumes never leave the machine.

## Features

- **JD parsing**: must-haves, nice-to-haves (“A 或 B” = either), minimum years, degree; editable in settings.
- **Resume reading**: .docx, .pdf (text layer), .md, .txt; Chinese and English, with cross-language aliases.
- **Per candidate**: score, matched and missing requirements, merged work years, degree, email, phone, status, note.
- **Fairness & hygiene**: age/gender/marital requirements flagged and ignored; duplicate candidates, unreadable files, missing contacts.
- **Exports**: ranked Excel shortlist with highlighted gaps, Markdown summary.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `resume-screener/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Screen the resumes in 招聘 against the data analyst JD"
- "Drop the duplicate and mark the top two for interview"
- "Export the shortlist"

## Tools

| Tool | Purpose |
|---|---|
| `screen_open` | Read the JD and resumes and score each candidate. Opens the panel |
| `screen_edit` | Change settings, edit cells by row, add or remove rows |
| `screen_status` | Show the current rows, issues and summary |
| `screen_export` | Write shortlist.xlsx (ranked) and shortlist.md |

Output goes to `resume-screener/<project>/` in the workspace.

## Scope (v0.1)

- Keyword and date matching, not an AI judgement: it can miss skills described in other words. Use it to sort the pile, then read the resumes.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `resume-screener/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/resume-screener/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-resume-screener test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
