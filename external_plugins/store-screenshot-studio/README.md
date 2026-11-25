# Store Screenshot Studio

Turn raw app screenshots into App Store and Google Play listing images: a headline and subheadline above or below the screen, a device frame, a solid or gradient background — in several languages and every store size at once. Preview and edit each slide in the side panel.

## What it does

- **Exact store sizes**: iPhone 6.9″ 1320×2868, 6.5″ 1284×2778, 5.5″ 1242×2208, iPad 13″ 2064×2752, Google Play phone 1080×1920 and 10″ tablet 1600×2560. Exported as **opaque RGB PNGs** (the stores reject transparency).
- **Device frames**: iPhone (Dynamic Island), Android (punch-hole camera), iPad/tablet bezel, or frameless with a soft shadow; any frame colour. The frame adapts to the screenshot's aspect ratio, so nothing is cropped.
- **Text**: bold headline and optional subheadline, top or bottom, automatic black/white text colour for contrast, auto-shrink to two lines; too-long text is shortened and flagged.
- **Languages**: any number of listing languages (`zh-Hans`, `en-US`, `ja`…); each slide keeps a headline per language. Missing translations fall back to the first language and are flagged.
- **Tablet screenshots**: give a separate tablet screenshot per slide for iPad / tablet sizes; when only a phone screenshot is available, you get a warning.
- **Checks**: long headlines, missing translations, low-resolution screenshots (would look blurry), more than 10 slides (App Store) or 8 (Google Play).
- **Output**: `store-screenshots/<language>/<size>/<NN>-<name>.png`; settings in a reusable `.storeshots.json`.

## Usage

In ZCode Desktop, ask the agent:

- "Make App Store screenshots from the images in screenshots/ — write a short headline for each in Chinese and English"
- "Export the listing images for iPhone 6.9″, iPad and Google Play with a dark gradient background"
- "Change the third headline in English to “Track every order” and export just that one"

Or open "Store Screenshot Studio" from the session sidebar and tick screenshots in the order you want them.

## Tools

| Tool | Purpose |
|---|---|
| `shots_open` | Open screenshots (paths, folder or saved project) with languages, texts and sizes; check and open the panel |
| `project_save` | Save as `.storeshots.json` |
| `shots_export` | Export all, or filter by languages, sizes and slides |

## Scope (v0.1)

- Input: PNG and JPG screenshots (from the simulator, a device or a design tool).
- Not in v0.1: uploading to App Store Connect / Google Play Console (do that yourself or with fastlane), panoramic backgrounds spanning several slides, tilted 3D device mock-ups, App Preview videos, the Play feature graphic.
- The device frames are generic drawings, not Apple/Google marketing artwork.

## Privacy, network and file writes

- **Everything runs locally.** No network access, nothing is uploaded, no API keys or accounts.
- Reads the chosen screenshots and a system font; writes only inside the workspace (default `store-screenshots/`, plus the `.storeshots.json` you choose). No commands are executed and there are no hooks.

## Build and test (developers)

Source lives in `ui-plugins/store-screenshot-studio/`. From the repository root run `pnpm install --frozen-lockfile && pnpm build`, add `dist/local-marketplace` as a local source in the ZCode plugin store and install. Tests: `pnpm --filter @penova/plugin-store-screenshot-studio test` (exact sizes, opaque PNG, colours, text, tablet screenshot, warnings, project round-trip) and `test:e2e` (browser panel test; point `E2E_SCREENS` at real app screenshots).

## Third-party components and licenses

The plugin is MIT-licensed (author: Penova). Bundled dependencies: resvg-wasm (MPL-2.0, unmodified; source: https://github.com/yisibl/resvg-js), fontkit (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), the MCP SDK and ext-apps (MIT). The full list ships in `dist/THIRD_PARTY_NOTICES.txt`. The test screenshots are synthetic mock-ups of a fictional app. App Store is a trademark of Apple Inc.; Google Play is a trademark of Google LLC; this plugin is not affiliated with either.
