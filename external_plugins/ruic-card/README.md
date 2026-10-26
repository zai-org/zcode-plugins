# RuiC Card

Generate **interactive 3D holographic collectible-card websites** from one sentence or a reference image — the shiny trading cards from a 1990s stationery shop, rebuilt in your browser. Ships with an editable Blender project, so the card is a starting point, not a dead end.

Two routes, same card:

- **Paint it** — the agent draws the four layers from your description or a reference image.
- **Photo it** — you bring a photo; the `photo-card` skill cuts the four layers out of it with rembg, can erase a watermark from the original first, and renders the animation plus MP4 / WeChat-sized GIF files.

## What it does

Given a description (or an uploaded reference), the skill produces:

1. **Four layered PNGs** on one shared canvas: subject / background / lineart / typography (plus an optional effects overlay), with real alpha where it matters.
2. **A 3D scene** built in Blender: layers separated in depth, foil / holographic materials whose rainbow phase follows the viewing angle (foil is a material, not a painting).
3. **A web viewer** (Three.js, single-file bundle): drag to tilt, flip, reset, zoom, depth sliders, finish options, mobile layout.
4. **Deliverables**: a local URL, `card.blend`, the four layers, `card-config.json`, and preview renders.

See [README_CN.md](./README_CN.md) for the full Chinese introduction and demo GIFs.

## Photo route

Ask for a card from a photo you already have ("把这张照片做成全息闪卡"), and the `photo-card` skill runs:

1. `ocr_boxes.ps1 -img <photo>` locates a watermark (Windows OCR; elsewhere pass the box yourself), then `remove_watermark.py` fills that box on the original.
2. `prepare_card_layers.py <photo> <out_dir> [x0 y0 x1 y1] [--native]` cuts `subject/background/lineart/text.png` on one shared canvas — the photo's own pixels, with the erased region as alpha.
3. The ruic-card pipeline builds `card.blend`, the GLB and the viewer.
4. `render_anim.py` (via Blender) renders 240 frames; `encode_mp4.py` and `encode_wx_gif.py` produce the full-size MP4 and the WeChat pair.

Measured acceptance, not eyeballed: the composite matches the original outside the watermark box, a rendered frame is within a few brightness levels of the photo, no bright watermark pixels remain, and the GIF stays under 10 MB and 1000 px wide. Details in `skills/photo-card/references/photo-card.md`.

## Usage

Install the plugin, then just ask, e.g.:

- 做一张全息闪卡：主体是一只柴犬，标题「柴皇」，烫金质感
- Make a holographic card of my cat, holo finish, English caption

Before delivery the skill drives the finished site in headless Chromium (drag / flip / sliders / mobile viewport / reduced motion) and reports a green/red verification summary.

## Components

- `skills/ruic-card/` — the paint route: workflow, art-direction references, Python pipeline, and the web template it copies into your output project.
- `skills/photo-card/` — the photo route: rembg layer preparation, watermark removal (with a Windows OCR locator), animation render, and the MP4 / WeChat GIF encoders.
- `assets/` — the demo GIF/MP4 files used by this README.

The viewer ships `skills/ruic-card/assets/web-template/app.bundle.js` (~1.3 MB): an **unminified, readable** single-file bundle, loaded as one file so per-module URLs cannot be blocked by ad blockers and the page still works on machines without bun/esbuild. Rebuild it with `bundle.sh` after editing `app.js`.

## Requirements & side effects

- **Executables**: Python 3 with Pillow (and, for the photo route, numpy, scipy, rembg), Node.js with npm, and Blender for the animation. Blender is **not** required beforehand — on first run the pipeline downloads an official portable Blender into the *output project's* `tools/` folder (system installation untouched).
- **Network access**: first-run Blender download (blender.org), npm dependency install for the viewer, the headless-Chromium fetch used by the verification script, and the segmentation model that rembg downloads on first use (from the rembg release assets, ~180 MB). No other hosts are contacted.
- **API keys**: none required. On the paint route the layers come from whatever image capability the host agent already has, or by hand; the photo route is offline apart from the model download.
- **File writes**: confined to the output project directory you choose, plus whatever paths you pass to the photo-route scripts. Nothing is written inside the plugin.
- **Command execution**: Python pipeline, `blender` (portable copy), `node` (viewer server + verification), and `powershell` for the Windows-only watermark locator.
- **Platform note**: the watermark locator `skills/photo-card/scripts/ocr_boxes.ps1` uses Windows OCR; on macOS/Linux supply the watermark box yourself (or skip that step).
- **No telemetry, no hooks, no MCP server.**

## Third-party code, media and services

- **RuiC-card-skill** (upstream original) — <https://github.com/HRuiCcc/RuiC-card-skill>, MIT License, Copyright (c) 2026 HRuiCcc.
  The paint-route skill workflow, Blender scene scripts, Three.js viewer template and `references/` documents come from that project (plus a few adaptation patches);
  `LICENSE` keeps the original copyright notice. The four demo files `assets/demo-before.*` and `assets/demo-after.*` also come from the upstream repository.
- **rembg** — MIT License, used by the photo route for subject segmentation; its model weights are downloaded at runtime from the rembg release assets and follow their own upstream terms (U²-Net / IS-Net).
- **imageio** and **imageio-ffmpeg** — BSD-2-Clause packages; the FFmpeg executable that `imageio-ffmpeg` installs is distributed under its own licence (GPL). Neither is bundled here.
- **Blender** — downloaded at runtime from blender.org (GPL-licensed program; this plugin ships no Blender code).
- **Three.js** — MIT License, bundled into the web template (inlined in `app.bundle.js`).
- Everything else is original code and text (MIT, see `LICENSE`). Generated artwork stays in your own project directory and is never packaged with the plugin.

## License

MIT
