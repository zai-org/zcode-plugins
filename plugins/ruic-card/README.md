# RuiC Card

Generate **interactive 3D holographic collectible-card websites** from one sentence or a reference image — the shiny trading cards from a 1990s stationery shop, rebuilt in your browser. Ships with an editable Blender project, so the card is a starting point, not a dead end.

## What it does

Given a description (or an uploaded reference), the skill produces:

1. **Four layered PNGs** on one shared canvas: subject / background / lineart / typography (plus an optional effects overlay), with real alpha where it matters.
2. **A 3D scene** built in Blender: layers separated in depth, foil / holographic materials whose rainbow phase follows the viewing angle (foil is a material, not a painting).
3. **A web viewer** (Three.js, single-file bundle): drag to tilt, flip, reset, zoom, depth sliders, finish options, mobile layout.
4. **Deliverables**: a local URL, `card.blend`, the four layers, `card-config.json`, and preview renders.

See [README_CN.md](./README_CN.md) for the full Chinese introduction and demo GIFs.

## Usage

Install the plugin, then just ask, e.g.:

- 做一张全息闪卡：主体是一只柴犬，标题「柴皇」，烫金质感
- Make a holographic card of my cat, holo finish, English caption

Before delivery the skill drives the finished site in headless Chromium (drag / flip / sliders / mobile viewport / reduced motion) and reports a green/red verification summary.

## Components

- `skills/ruic-card/` — the skill itself: workflow, art-direction references, Python pipeline, and the web template it copies into your output project.
- `assets/` — the demo GIF/MP4 files used by this README.

The viewer ships `skills/ruic-card/assets/web-template/app.bundle.js` (~1.3 MB): an **unminified, readable** single-file bundle, loaded as one file so per-module URLs cannot be blocked by ad blockers and the page still works on machines without bun/esbuild. Rebuild it with `bundle.sh` after editing `app.js`.

## Requirements & side effects

- **Executables**: Python 3 with Pillow, Node.js with npm. Blender is **not** required beforehand — on first run the pipeline downloads an official portable Blender into the *output project's* `tools/` folder (system installation untouched).
- **Network access**: first-run Blender download (blender.org), npm dependency install for the viewer, and the headless-Chromium fetch used by the verification script. No other hosts are contacted.
- **API keys**: none required. Image layers are produced with whatever image capability the host agent already has, or by hand.
- **File writes**: confined to the output project directory you choose. The skill itself stays read-only at runtime.
- **Command execution**: Python pipeline, `blender` (portable copy), `node` (viewer server + verification).
- **No telemetry, no hooks, no MCP server.**

## Third-party code, media and services

- **RuiC-card-skill** (upstream original) — <https://github.com/HRuiCcc/RuiC-card-skill>, MIT License, Copyright (c) 2026 HRuiCcc.
  The skill workflow, Blender scene scripts, Three.js viewer template and `references/` documents come from that project (plus a few adaptation patches);
  `LICENSE` keeps the original copyright notice. The four demo files `assets/demo-before.*` and `assets/demo-after.*` also come from the upstream repository.
- **Blender** — downloaded at runtime from blender.org (GPL-licensed program; this plugin ships no Blender code).
- **Three.js** — MIT License, bundled into the web template (inlined in `app.bundle.js`).
- Everything else is original code and text (MIT, see `LICENSE`). Generated artwork stays in your own project directory and is never packaged with the plugin.

## License

MIT
