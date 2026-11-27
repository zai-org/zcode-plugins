# WhiteBackground (白底图)

Create a pure #FFFFFF PNG canvas, or open WhiteBackground’s free local photo editor for white backgrounds, transparent cutouts, PNG-to-white composition, square padding, Shopify sizing or local enlargement. Photos are chosen in the official editor; this plugin does not upload them or spend credits. No WhiteBackground account or API key.

This is not [Product Photo Studio](https://github.com/zai-org/zcode-plugins/blob/main/external_plugins/product-photo-studio) (`product-photo-studio`): that plugin stays entirely offline and only removes plain or light studio backdrops, then batch-exports marketplace sizes. Use WhiteBackground when the background is a real scene and you need the official AI cutout editor.

## Features

- **Blank white canvas**: ask for a size (each side 1–8192 px, at most 32 million pixels). The plugin calls the official public canvas API, saves a PNG in the workspace (`whitebackground/white-{width}x{height}.png` by default) and shows a preview in the side panel. Existing files are not overwritten.
- **Six official local editors**: white background, transparent PNG, existing transparent PNG onto white, square without cropping, Shopify sizing, and local 2×/4× enlargement. The panel (or the agent) opens the official site; you choose the photo, inspect Original and Result, and download there.
- **Pricing link only**: single-photo local editing stays free. Pro, batch, 4K export and high-quality cloud credits are described on [the pricing page](https://whitebackground.app/pricing). This plugin never buys a plan or spends credits for you.

## Usage

Ask the agent in ZCode Desktop:

- “Create a 2048 × 2048 pure white PNG”
- “Open the WhiteBackground editor so I can put a product photo on a white background”
- “Open the square editor; I want to keep the whole photo without cropping”

You can also open the **WhiteBackground / 白底图** side panel, set a canvas size, or press **Open editor** on a workflow.

## Tools

| Tool | Purpose |
|---|---|
| `canvas_create` | Fetch a pure white PNG from the official public API, save it in the workspace, and open the panel |
| `editor_open` | Open one official local editor (`white`, `transparent`, `png_to_white`, `square`, `shopify`, `enhance`) and show its URL |
| `panel_open` | Open the side panel |

## Scope (v0.1)

- The free path **does not accept** chat attachments, workspace file paths, or base64 photos. You must choose the photo in the official editor.
- Free background-editor exports are capped at 2200 px on the longest edge and do not enlarge the subject. The separate enhancer supports 2× up to 2200 px or 4× up to 4096 px for compatible inputs; inspect lettering before use.
- Cloud / OAuth high-quality processing is not included in this version.
- The plugin does not re-implement background removal or ship the ~220 MB on-device model; that stays in the official browser editor.

## Privacy, network and files

- **Network**: the plugin contacts `https://whitebackground.app` to create blank canvases (`/api/mcp/canvas`) and to open official editor pages. No API key is sent.
- **Photos**: on the free path, photos stay in your browser in the official editor. This plugin does not upload them.
- **Writes**: canvas PNGs are written only under the path you choose in the current workspace (default folder `whitebackground/`). Originals are never modified. No hooks and no shell commands.
- Paid Cloud processing, if you later use it on the website, follows WhiteBackground’s own privacy policy (uploads after your confirmation; their storage and provider retention are described on the site).

## Build and test (developers)

Source lives in `ui-plugins/whitebackground/`. From the repository root: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source. Tests: `pnpm --filter @penova/plugin-whitebackground test` and `test:e2e` (needs Chrome). Unit tests mock the canvas API; one test may call the official 16×16 public canvas (no account, no credits) and skips if the network is unreachable.

## Third-party components and licenses

The plugin is MIT licensed (author: Penova). The product site is [WhiteBackground.app](https://whitebackground.app). Bundled with the install package: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`. The official on-device remover (BEN2 / Transformers.js) is not bundled.
