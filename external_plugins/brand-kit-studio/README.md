# Brand Kit Studio

Turn a brand name, a tagline and a logo into a complete, consistent set of brand assets: website icons, app icons, a social avatar, share images and platform banners. Preview every asset in the side panel, tweak layout and text one by one, and export PNG/ICO files plus editable SVG templates.

## What it does

- **Website icons**: `favicon.ico` (16/32/48), `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` (180), Android/PWA 192 and 512, a maskable 512 icon, `site.webmanifest` and a ready-to-paste `head-snippet.html`.
- **Social**: avatar 400×400 (circle-crop safe), Open Graph link image 1200×630, X/Twitter post 1200×675, Xiaohongshu cover 1080×1440.
- **Banners and covers**: WeChat article cover 900×383, X header 1500×500, LinkedIn banner 1584×396, YouTube channel banner 2560×1440. Text and logo stay inside each platform's safe area (for example YouTube's 1546×423 centre, or the part of the X/LinkedIn header not covered by the profile picture).
- **Brand colours from the logo**: primary and secondary colours are suggested from the logo when you don't give them; change them in the panel and every asset updates.
- **Smart logo placement**: transparent logos keep their colours; a one-colour logo is turned white or dark when it would disappear on the brand colour; logos without transparency (JPG) or with low contrast sit on a white rounded badge. Wide wordmarks are not repeated as a title.
- **Icons without a square mark**: uses the square mark if given, a near-square logo otherwise, or the first letter of the brand name on the brand colour.
- **Three layouts** per image: centred gradient, text + logo panel, minimal. Each asset can override title and subtitle; text that doesn't fit is shrunk and, if still too long, shortened and flagged.
- **Outputs**: `brand-kit/favicon/`, `social/`, `covers/`, `templates/<asset>.svg` (editable in Figma, Illustrator or Inkscape), `brand.json` (the project) and `index.html` (overview with colour swatches).

## Usage

In ZCode Desktop, ask the agent:

- "Make a full brand kit from logo.svg — name “Qinghe Coffee”, tagline “Fresh roasts from Yunnan”"
- "Generate favicons and a webmanifest for this site from assets/logo.png and add them to index.html"
- "Change the brand colour to #7a3e1f and redo the YouTube and X banners"

Or open "Brand Kit Studio" from the session sidebar, fill in the name and tagline, and pick a logo from the workspace.

## Tools

| Tool | Purpose |
|---|---|
| `brand_open` | Read the logo, suggest colours, check the layouts and open the panel |
| `project_save` | Save the brand as `.brandkit.json` |
| `brand_export` | Write all (or some) assets, the icons bundle, SVG templates and the overview |

## Scope (v0.1)

- Logo input: SVG (best), PNG with transparency, or JPG.
- Text uses a system Chinese font (macOS PingFang / Hiragino Sans GB, Windows Microsoft YaHei, Linux Noto Sans CJK); set the plugin's `fontPath` option to use another font. SVG templates reference the font by name, so open them on a machine that has it.
- Not in v0.1: generating a logo from scratch, custom brand fonts per asset, animated assets, print materials (business cards, letterheads).

## Privacy, network and file writes

- **Everything runs locally.** No network access, nothing is uploaded, no API keys or accounts.
- Reads the chosen logo files and the system font; writes only inside the workspace (default `brand-kit/`, plus the `.brandkit.json` you choose). No commands are executed and there are no hooks.

## Build and test (developers)

Source lives in `ui-plugins/brand-kit-studio/`. From the repository root run `pnpm install --frozen-lockfile && pnpm build`, add `dist/local-marketplace` as a local source in the ZCode plugin store and install. Tests: `pnpm --filter @penova/plugin-brand-kit-studio test` (SVG/PNG/JPG logos and a no-logo brand; checks sizes, ICO structure, colours and overflow warnings) and `test:e2e` (browser panel test).

## Third-party components and licenses

The plugin is MIT-licensed (author: Penova). Bundled dependencies: resvg-wasm (MPL-2.0, unmodified; source: https://github.com/yisibl/resvg-js), fontkit (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), the MCP SDK and ext-apps (MIT). The full list ships in `dist/THIRD_PARTY_NOTICES.txt`. The test logos are fictional brands drawn for the tests.
