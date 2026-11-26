# EXIF Privacy Cleaner

See what your photos give away before you share them — GPS location, phone or camera model, the time taken, software, comments, XMP/IPTC and PNG text — and write clean copies with all of it removed, or only the location. JPEG, PNG and WebP are cleaned without re-encoding, so quality is untouched, colours stay right and portrait photos stay upright. Originals are never changed. Runs locally; no API keys.

## Features

- **See the risk**: GPS coordinates, camera make/model, date taken, software, comments, XMP/IPTC and PNG text for every photo; the summary counts how many reveal a location.
- **Two modes**: remove all metadata, or only the GPS location (camera and dates stay).
- **Lossless**: metadata blocks are removed without re-encoding — the image data is byte-for-byte the same; the ICC colour profile and the orientation are kept.
- **Safe output**: cleaned copies go to the plugin's output folder with the same folder structure, or next to the originals as name-clean.jpg; originals are never touched.
- **Report**: privacy-report.csv lists what each photo contained and what was removed; untick photos you want to leave out.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `exif-privacy-cleaner/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Which photos in 分享/ reveal where they were taken?"
- "Remove all metadata from them before I post them"
- "Only remove the GPS location, keep the camera info"

## Tools

| Tool | Purpose |
|---|---|
| `exifclean_open` | Scan photos for location, camera, time and other hidden metadata. Opens the panel |
| `exifclean_edit` | Change settings, edit cells by row, add or remove rows |
| `exifclean_status` | Show the current rows, issues and summary |
| `exifclean_export` | Write cleaned copies (plugin output folder or name-clean.jpg next to the originals) and privacy-report.csv |

Output goes to `exif-privacy-cleaner/<project>/` in the workspace.

## Scope (v0.1)

- JPEG, PNG and WebP are cleaned; HEIC and TIFF are scanned but not cleaned in v0.1 (export them as JPEG first).
- Visible content (faces, street signs, screens) is not detected — only hidden metadata.
- Videos are not supported in v0.1.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `exif-privacy-cleaner/` folder in the workspace; with “next to originals” it writes name-clean copies beside your photos (never overwriting them). No hooks.

## Build and test (developers)

- Source: `ui-plugins/exif-privacy-cleaner/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-exif-privacy-cleaner test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
