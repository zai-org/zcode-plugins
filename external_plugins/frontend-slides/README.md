# Frontend Slides

[中文文档](./README_CN.md)

Create stunning, animation-rich HTML presentations from scratch or by converting PowerPoint files. Based on [zarazhangrui/frontend-slides](https://github.com/zarazhangrui/frontend-slides) v2.1.0 (MIT), packaged for the official ZCode plugins marketplace.

## What you get

- **Zero dependencies** — each deck is a single self-contained HTML file
- **Style discovery** — the agent shows 3 visual style previews; you pick your favorite
- **12 safe presets + 34 bold design systems** — no generic "AI slop" aesthetics
- **PPT conversion** — extract text/images from .pptx and rebuild as web slides
- **Export & share** — PDF export and Vercel deploy scripts included

## Install

After the plugin is accepted into the official marketplace, install it from **ZCode → Settings → Plugin Marketplace → zcode-plugins-official**.

## Usage

Ask naturally in chat, or type `/frontend-slides`:

- "Create a pitch deck for my AI startup"
- "Convert my presentation.pptx to a web slideshow"
- "Export the deck we just built to PDF"

The skill asks about purpose, length and content density, shows 3 style previews, then generates a fixed 16:9 (1920×1080) deck that runs in any browser.

## Requirements and side effects

- **Network access:** the generated decks load web fonts (Google Fonts / Fontshare) at view time. Optional: PPT conversion needs Python + `python-pptx` (`pip install python-pptx`); PDF export needs Node.js (Playwright installs on first run); Vercel deploy needs a Vercel account. The plugin itself makes no network calls.
- **File writes:** decks are written to your current workspace; previews live in `.frontend-slides/` and are cleaned up after delivery.
- **Command execution:** the bundled scripts run `python`/`npx` only when you explicitly ask for PPT conversion, PDF export, or deploy.
- **No hooks, no MCP servers, no telemetry.**

## Third-party material

All skill content originates from [zarazhangrui/frontend-slides](https://github.com/zarazhangrui/frontend-slides) and is included under the MIT license (see [LICENSE](./LICENSE), © Zara Zhang). Packaging for ZCode by [@tahatehran](https://github.com/tahatehran).