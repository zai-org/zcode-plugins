# Duplicate File Finder

Find files that are exact copies of each other in your folders — compared by size and SHA-256 content hash, never by name — and see how much space they waste. One copy per group is kept automatically (the original-looking name, not “copy” or “(1)”), you can change which one, then export a report or move the extra copies into a review folder. Nothing is ever deleted, and moved files can be restored. Runs locally; no API keys.

## Features

- **Exact matches only**: files are grouped by size, then by SHA-256 of their content, so “same name, different content” is never a false match and renamed copies are still found.
- **Which copy to keep**: smart (no “copy / 副本 / (1)” in the name, shortest path), oldest, newest, or prefer a folder you name; change any group with the Keep checkbox.
- **Space saved**: groups are sorted by wasted space; the summary shows how much you would free.
- **Safe clean-up**: extra copies are moved into duplicate-file-finder/<project>/review/ with their original paths, never deleted; “Restore moved copies” puts them back. Groups with no kept file are blocked.
- **Filters**: skip tiny files and extensions like .DS_Store; empty files are ignored.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `duplicate-file-finder/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Find duplicate files in 下载/ and 旧电脑备份/"
- "Keep the copies inside 合同/ and move the rest to review"
- "Undo — put the moved copies back"

## Tools

| Tool | Purpose |
|---|---|
| `dupes_open` | Scan workspace folders and group byte-identical files. Opens the panel |
| `dupes_edit` | Change settings, edit cells by row, add or remove rows |
| `dupes_status` | Show the current rows, issues and summary |
| `dupes_export` | Write duplicates.csv and duplicates.html, or move extra copies into a review folder (with moved.csv); restore moves them back |

Output goes to `duplicate-file-finder/<project>/` in the workspace.

## Scope (v0.1)

- Exact duplicates only; similar photos (resized or re-encoded) are not matched in v0.1.
- Inside the workspace, up to 5 folders and 20,000 files per scan.
- It never deletes; empty the review folder yourself when you're sure.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `duplicate-file-finder/` folder in the workspace; it also moves extra copies into that folder, but only when you click “Move extra copies to review” (and back with “Restore”). No hooks.

## Build and test (developers)

- Source: `ui-plugins/duplicate-file-finder/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-duplicate-file-finder test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
