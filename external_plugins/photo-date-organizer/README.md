# Photo Date Organizer

Sort a messy folder of phone photos, screenshots and videos into year/month folders by the date they were taken — read from EXIF, the video's creation time or a date in the file name, with the file time only as a last resort — and optionally rename them to 20261002_091500.jpg. Every file shows where its date came from, you can correct any date, and a move can be undone. Runs locally; no API keys.

## Features

- **Real dates first**: EXIF DateTimeOriginal for JPEG/HEIC/TIFF/DNG, the MP4/MOV creation time, then dates in names (IMG_20261103_101522, Screenshot 2026-11-05 at 10.22.31, 微信图片_20261106, mmexport timestamps), and only then the file time — flagged, because copying changes it.
- **Layouts**: 2026/2026-10, 2026-10, 2026/10, 2026/2026-10-02, 2026-10-02 or no folders; keep names, rename to the date, or date + original name.
- **Fix in the table**: type a date in any format like 2024-02-02 12:00 or 2024年2月2日; the source becomes “manual”. Camera make/model is shown.
- **Safe**: same-name files get -2, -3; nothing is overwritten. Move mode can be undone; copy mode writes into the plugin's output and leaves the originals alone.
- **Plan first**: organize-plan.csv lists each file, its date, the source and its destination.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `photo-date-organizer/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Sort 手机相册/ into year/month folders by date taken"
- "Also rename them to the date, like 20261002_091500.jpg"
- "Undo the last move"

## Tools

| Tool | Purpose |
|---|---|
| `photos_open` | Read the date of every photo and video in a folder and plan the date folders. Opens the panel |
| `photos_edit` | Change settings, edit cells by row, add or remove rows |
| `photos_status` | Show the current rows, issues and summary |
| `photos_export` | Write organize-plan.csv, then move or copy the files into the date folders (organize-log.csv); undo moves them back |

Output goes to `photo-date-organizer/<project>/` in the workspace.

## Scope (v0.1)

- Dates are the camera's local time; time zones are not converted (videos use the computer's time zone).
- No face, place or content grouping; GPS is read but not used for folders in v0.1.
- One folder (with subfolders) and up to 20,000 files per project; RAW formats other than DNG fall back to the name or file time.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `photo-date-organizer/` folder in the workspace; in move mode it also moves the photos inside the folder you pick, but only when you click “Organize” (and back with “Undo last move”). No hooks.

## Build and test (developers)

- Source: `ui-plugins/photo-date-organizer/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-photo-date-organizer test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
