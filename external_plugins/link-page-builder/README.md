# Link Page Builder

Make your own “link in bio” page in minutes: your name, a short bio, a round photo and a stack of link buttons, in one of six themes. Everything is in a single index.html — no scripts, no trackers, no external files — so you can upload it to any host or share it from your own domain, plus a QR code that points to it. Edit links in a table, highlight the important one, hide old ones. Runs locally; no account on a link-page service or API keys.

## Features

- **One self-contained file**: avatar cropped round and embedded, CSS inline, no JavaScript and no external requests — fast and private.
- **Six themes, three shapes**: light, dark, sunset, forest, ocean and mono; rounded, pill or square buttons; works on phones.
- **Links in a table**: emoji icon, button text, link, subtitle, highlight and show/hide; add or reorder rows.
- **Safe, fixed links**: https:// added when missing, emails become mailto:, phone numbers tel:, and javascript: links are refused.
- **QR code**: PNG and SVG of the page address, optionally shown at the bottom of the page; Open Graph tags for nice previews.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `link-page-builder/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Build my links page from links.yaml with the sunset theme"
- "Highlight the shop link and hide the 2025 page"
- "Make a QR code for https://lin.example"

## Tools

| Tool | Purpose |
|---|---|
| `linkpage_open` | Read the links file and preview the page. Opens the panel |
| `linkpage_edit` | Change settings, edit cells by row, add or remove rows |
| `linkpage_status` | Show the current rows, issues and summary |
| `linkpage_export` | Write index.html, qr.png and qr.svg |

Output goes to `link-page-builder/<project>/` in the workspace.

## Scope (v0.1)

- Builds the page file only; hosting it is up to you (any static host works).
- No click statistics — the page has no tracking by design.
- Brand logos are not included; use emoji icons.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `link-page-builder/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/link-page-builder/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-link-page-builder test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: yaml (ISC), node-qrcode (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
