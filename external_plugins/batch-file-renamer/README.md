# Batch File Renamer

Rename a whole folder of files by rules — find/replace or regex, name templates with numbering, dates and folder names, case and space clean-up, lower-case extensions and per-file manual names. See old → new for every file and every clash before anything changes, rename safely (swaps and case-only changes work), keep a log, and undo the last rename. Runs locally; no API keys.

## Features

- **Rules**: find/replace (plain or regex with $1), a name template with {name} {n} {date} {parent} {ext}, numbering start and digits, numbering by name or modified time.
- **Clean-up**: lower/UPPER/Title case, spaces to - or _ or removed, runs of spaces collapsed, extensions lower-cased, illegal characters (\ / : * ? " < > |) replaced.
- **Manual names**: type a new name for any file in the table; the extension is kept if you leave it out.
- **Safety**: duplicate targets, names that already belong to other files and broken regexes are errors and block the rename; renaming is two-step so swaps and case-only changes work, and it rolls back if something fails.
- **Undo**: the last rename is logged and can be reverted with the “Undo” button (it is never part of “Export all”).
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `batch-file-renamer/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Rename the photos in 相册/ to 杭州-001.jpg, 杭州-002.jpg … in date order"
- "In 扫描件/, replace “scan_” with “合同-” and make extensions lower-case"
- "Undo the last rename"

## Tools

| Tool | Purpose |
|---|---|
| `rename_open` | List the files in a workspace folder and preview their new names. Opens the panel |
| `rename_edit` | Change settings, edit cells by row, add or remove rows |
| `rename_status` | Show the current rows, issues and summary |
| `rename_export` | Write rename-plan.csv, rename the files on disk (with rename-log-*.csv), or undo the last rename |

Output goes to `batch-file-renamer/<project>/` in the workspace.

## Scope (v0.1)

- Renames files only, not folders, inside the workspace; hidden files are skipped.
- Up to 5 folders and 5,000 files per project; subfolders are optional.
- Reading EXIF dates for photo names is a separate plugin (Photo Date Organizer).

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `batch-file-renamer/` folder in the workspace; it also renames files inside the folder you pick, but only when you click “Rename files” (or “Undo last rename”). No hooks.

## Build and test (developers)

- Source: `ui-plugins/batch-file-renamer/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-batch-file-renamer test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
