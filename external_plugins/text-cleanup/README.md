# Text Cleanup

Tidy up Chinese and mixed Chinese–English writing in Markdown and text files. It fixes half-width punctuation inside Chinese sentences, full-width letters and digits, …… and ——, straight quotes, the space between Chinese and English words or numbers, stray spaces around punctuation, repeated spaces and extra blank lines. Code blocks, inline code, link addresses and front matter are never touched. Review every changed line side by side, skip or hand-edit any of them, then export cleaned copies of the files, a diff and a change list. Your originals stay as they are. Runs locally; no upload or API keys.

## Features

- **Punctuation**: half-width , . ! ? : ; ( ) inside Chinese → full-width; … and -- → …… and ——; straight quotes → “ ” in Chinese sentences.
- **Spacing**: a space between Chinese and English, numbers or inline code; no spaces around full-width punctuation; repeated spaces collapsed.
- **Width**: full-width letters and digits (ＡＢＣ１２３) → half-width.
- **Lines**: trailing spaces trimmed, extra blank lines removed; optionally ！！！ → ！.
- **Safe for Markdown**: code blocks, inline code, link URLs, images, HTML tags, math and front matter are left alone; English-only lines aren't changed.
- **Review first**: every changed line with before/after highlighted; skip it or edit the result; choices survive when you toggle rules.
- **Copies, not overwrites**: cleaned files in their own folder, a unified diff and a CSV change list.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `text-cleanup/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Clean up the punctuation in draft.md"
- "Add spaces between Chinese and English in the docs folder"
- "Show me what would change before writing anything"

## Tools

| Tool | Purpose |
|---|---|
| `cleanup_open` | Read the files and list every line that would change. Opens the panel |
| `cleanup_edit` | Change settings, edit cells by row, add or remove rows |
| `cleanup_status` | Show the current rows, issues and summary |
| `cleanup_export` | Write cleaned copies, changes.diff and changes.csv |

Output goes to `text-cleanup/<project>/` in the workspace.

## Scope (v0.1)

- UTF-8 text, .md and .txt; Word documents are not edited.
- Typography only — no spelling or grammar checks.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `text-cleanup/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/text-cleanup/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-text-cleanup test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: jsdiff (BSD-3-Clause), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
