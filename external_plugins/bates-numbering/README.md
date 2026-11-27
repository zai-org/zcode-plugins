# Bates Numbering

Stamp running numbers on every page of a set of PDFs, the way exhibits and document productions are numbered (DOC-000001, DOC-000002…), continuing from one file to the next. Add a label such as COPY, 副本 or CONFIDENTIAL to every page and an exhibit label (Exhibit A, 证据 1) to each file's first page. Put the files in order, choose the prefix, digits and position, then export the stamped PDFs, an optional combined PDF and an index of which numbers went where. Your originals stay as they are. Runs locally; no upload or API keys.

## Features

- **Continuous numbers**: prefix, start number, digits and suffix (PNV00101…); numbering runs on across files in the order you set.
- **Labels**: one label on every page (COPY, 副本, CONFIDENTIAL) and a first-page file label with {n}, {A} or {name} — or type a label per file.
- **Placement**: six positions, font size, margin, colour and a white box behind the stamp so it stays readable on dark scans.
- **Rotated pages**: stamps follow each page's rotation and crop box, so they read upright in any viewer.
- **Chinese labels**: a Chinese font from your computer is embedded when the stamp has Chinese text.
- **Outputs**: stamped copies named by Bates range, one combined PDF if you want it, and an index CSV of files, page counts and number ranges.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `bates-numbering/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Bates-number the exhibits folder starting at ABC000001"
- "Stamp COPY on every page and label each file Exhibit A, B, C"
- "Put the email first and renumber"

## Tools

| Tool | Purpose |
|---|---|
| `bates_open` | Read the PDFs, count pages and plan the number ranges. Opens the panel |
| `bates_edit` | Change settings, edit cells by row, add or remove rows |
| `bates_status` | Show the current rows, issues and summary |
| `bates_export` | Write stamped PDFs, optionally combined.pdf, and index.csv |

Output goes to `bates-numbering/<project>/` in the workspace.

## Scope (v0.1)

- Password-protected PDFs need the password removed first.
- Stamps are added as page content; they don't renumber existing page labels.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `bates-numbering/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/bates-numbering/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-bates-numbering test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: pdf-lib (MIT), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
