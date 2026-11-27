# Code Stats

Count the lines of code in a project: code, comment and blank lines for 40+ languages, totals per folder, and the largest files. It respects the project's .gitignore, skips node_modules, .git and build folders, and flags minified or generated files so they don't inflate the numbers. Exclude folders or patterns, untick single files, then export an HTML report with a bar chart, an Excel workbook and a CSV summary. Runs locally; no upload or API keys.

## Features

- **40+ languages** by file extension, with each language's own line and block comment markers (//, #, --, /* */, <!-- -->, Python docstrings).
- **.gitignore aware**: common patterns (folders, *, **, anchored /paths) are applied; node_modules, .git, dist and build folders are always skipped.
- **Generated code check**: files with very long lines (minified bundles, vendor libraries) are flagged and left out by default.
- **Exclude rules** like `tests/, *.min.js, vendor/**`, or untick single files in the table.
- **Exports**: an HTML report with a bar chart, language and folder tables and the largest files; an Excel workbook (Languages, Folders, Files); a CSV language summary.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `code-stats/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "How many lines of code are in tea-shop, by language?"
- "Leave out the scripts folder and the vendor files"
- "Export the report as HTML and Excel"

## Tools

| Tool | Purpose |
|---|---|
| `codestats_open` | Scan the project folder and count lines per file and language. Opens the panel |
| `codestats_edit` | Change settings, edit cells by row, add or remove rows |
| `codestats_status` | Show the current rows, issues and summary |
| `codestats_export` | Write code-stats.html, code-stats.xlsx and languages.csv |

Output goes to `code-stats/<project>/` in the workspace.

## Scope (v0.1)

- Lines are classified with simple per-line rules; a comment marker inside a string can be counted as a comment.
- “!” re-include rules in .gitignore are not applied (a warning is shown).

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `code-stats/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/code-stats/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-code-stats test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
