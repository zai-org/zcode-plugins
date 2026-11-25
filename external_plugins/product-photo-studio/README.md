# Product Photo Studio

Turn a batch of product photos into listing-ready images: remove plain backgrounds, make every product the same size and position, add a shadow, and export white-background main images, transparent PNGs and marketplace sizes in one go. Tweak any photo on its own in the side panel.

## What it does

- **Batch background removal**: removes plain, light or gradient studio backgrounds connected to the photo edge while keeping white labels inside the product; PNGs that already have transparency are used as-is. Edges are softened and de-fringed.
- **Consistent size and position**: crops to the product and places it by "product size" (fraction of the canvas), centred or bottom-aligned, so every product looks the same size.
- **Shadows**: soft ground ellipse or silhouette drop shadow with adjustable strength.
- **Multi-size export**: white 800×800 (Taobao/Tmall/JD), 1000×1000 (Pinduoduo/Douyin), Amazon 2000×2000, Shopify 2048×2048, social 1080×1080, Xiaohongshu 1080×1440, transparent PNG 1600×1600, plus custom sizes.
- **Per-photo tweaks**: select any photo in the panel and change tolerance, size, position, shadow or background for that photo only, then re-export just that one.
- **Warnings**: busy backgrounds, little background removed, product touching the edge, tolerance too high — flagged on the thumbnails.
- **Reusable settings**: save the batch as `.photostudio.json` and apply the same look to the next batch.

## Usage

In ZCode Desktop, ask the agent:

- "Turn every photo in products/ into 800×800 white-background main images and transparent PNGs"
- "Make all product photos the same size with a soft shadow, Amazon 2000×2000"
- "The perfume photo sits too high — lower it and export just that one again"

Or open "Product Photo Studio" from the session sidebar and tick images in the workspace. Global settings and output sizes are on the left, thumbnails in the middle; click one to adjust it below, then "Export all".

## Tools

| Tool | Purpose |
|---|---|
| `photos_open` | Open a batch (folder, paths or saved project), check it and open the panel |
| `project_save` | Save the settings as `.photostudio.json` |
| `photos_export` | Export all or some photos in the chosen sizes |

## Scope (v0.1)

- Input: JPG (auto-rotated by EXIF orientation) and PNG (with alpha).
- Background removal targets plain, light or gradient studio backdrops. **Busy backgrounds** (tables, outdoors, lifestyle shots), hair and clear glass are out of scope for v0.1: the thumbnail says "busy background", and the photo should be cut out with another tool first.
- Not yet: WebP/HEIC input, brush refinement, scene backgrounds.

## Privacy, network and file writes

- **Everything runs locally.** No network access, nothing is uploaded, no API keys or accounts.
- Reads and writes only inside the workspace: originals are never modified; results go to the output folder (default `product-photos-output/<size>/`), settings to the `.photostudio.json` you choose. No commands are executed and there are no hooks.

## Build and test (developers)

Source lives in `ui-plugins/product-photo-studio/`. From the repository root run `pnpm install --frozen-lockfile && pnpm build`, add `dist/local-marketplace` as a local source in the ZCode plugin store and install. Tests: `pnpm --filter @penova/plugin-product-photo-studio test` (real product photos plus synthetic samples; checks product fraction, centring, pure-white background and transparency) and `test:e2e` (browser panel test; point `E2E_PHOTOS` at your own photos).

## Third-party components and licenses

The plugin is MIT-licensed (author: Penova). Bundled dependencies: pngjs (MIT), jpeg-js (BSD-3-Clause), the MCP SDK and ext-apps (MIT). The full list ships in `dist/THIRD_PARTY_NOTICES.txt`. Test photo sources are listed in `ui-plugins/product-photo-studio/test/fixtures/SOURCES.md` (CC0 / public domain) and are not part of the installed package.
