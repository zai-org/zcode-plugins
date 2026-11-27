# Image Watermark

Add the same text or logo watermark to a whole folder of photos in one go. Choose the corner (or tile it across the picture), size, opacity, colour and margin — sizes scale with each photo, so portrait and landscape shots look consistent. Nudge, resize or skip individual photos, preview the results, then export watermarked copies as JPEG or PNG. Your originals stay untouched. Runs locally; no upload or API keys.

## Features

- **Text, logo or both**: any text (two lines with \n) in bold with an optional shadow; any PNG logo with transparency.
- **Nine positions or tile**: corners, edges or centre; or a rotated, staggered pattern across the whole picture.
- **Relative sizes**: text size and margin follow the photo's short side, logo width follows its width.
- **Per photo**: skip, change position, nudge by percent, scale or change opacity.
- **Preview**: the first photos watermarked in the panel before exporting.
- **Copies, not overwrites**: same folder structure under watermarked/, JPEG or PNG, plus a CSV report.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `image-watermark/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Put “© 2026 My Studio” in the bottom-right of every photo in photos/"
- "Add logo.png to all product pictures at 50% opacity"
- "Tile a faint watermark across these images"

## Tools

| Tool | Purpose |
|---|---|
| `watermark_open` | List the photos, find the logo and preview the first ones. Opens the panel |
| `watermark_edit` | Change settings, edit cells by row, add or remove rows |
| `watermark_status` | Show the current rows, issues and summary |
| `watermark_export` | Write watermarked copies and watermark-report.csv |

Output goes to `image-watermark/<project>/` in the workspace.

## Scope (v0.1)

- JPEG and PNG only (convert HEIC/WebP first); EXIF metadata is not copied to the output.
- A visible watermark only — no invisible or forensic marks.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `image-watermark/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/image-watermark/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-image-watermark test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: resvg (MPL-2.0), fontkit (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
