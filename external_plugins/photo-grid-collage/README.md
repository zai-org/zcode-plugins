# Photo Grid Collage

Arrange photos into a collage or grid poster: a 3×3 nine-grid, 2×2, one big photo with smaller ones around it, an even auto grid, a justified mosaic that never crops, or a vertical strip. Choose the canvas (square, 4:5 post, story, landscape, A4 poster or a custom size), gap, margin, rounded corners, background, a title and a footer, and put a caption on any photo. Each photo has an order (which slot it gets) and a crop focus, so faces and products stay in frame. Before you export you are told when a fixed grid has empty or unused slots, when a small photo will look blurry in a big cell, when a crop cuts away most of a photo, and which files can't be read. Exports PNG and JPG. Runs locally; no account or API keys.

## Features

- **Templates**: 3×3 nine-grid, 2×2, hero + 2/3/4, auto grid, justified mosaic (no crop), strip.
- **Canvas presets**: square, 4:5, story, landscape, A4 poster at 300 dpi, or custom.
- **Per photo**: order (slot), crop focus (top/upper/bottom/left/right/center), caption.
- **Style**: gap, margin, rounded corners, background, title and footer.
- **Checks**: empty or unused slots, blurry photos, heavy crops, unreadable or unsupported files.
- **Exports**: PNG and JPG at full size.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `photo-grid-collage/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a 3×3 grid of the 新品茶具 folder titled 新品茶具 · 秋季上新"
- "Drop the tiny photo, caption the first one 青瓷茶壶 ¥268 and switch to the auto grid"
- "Export PNG and JPG"

## Tools

| Tool | Purpose |
|---|---|
| `collage_open` | Read the photos and lay out the collage. Opens the panel |
| `collage_edit` | Change settings, edit cells by row, add or remove rows |
| `collage_status` | Show the current rows, issues and summary |
| `collage_export` | Write <title>.png and <title>.jpg |

Output goes to `photo-grid-collage/<project>/` in the workspace.

## Scope (v0.1)

- Reads JPEG and PNG (WebP/HEIC need converting first). No automatic face detection — set the focus per photo.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `photo-grid-collage/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/photo-grid-collage/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-photo-grid-collage test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
