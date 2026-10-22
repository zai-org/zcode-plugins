# Prism

> A beam of white light enters the prism and comes out as every color of the rainbow.

**Prism** is a desktop-side customization plugin for [ZCode](https://zcode.z.ai): it gives every project in the left sidebar its own color, icon and display name, lets you recolor individual conversations and automation cards, and can keep the sidebar ordered by the most recently active conversation.

> ⚠️ **Experimental, opt-in (0.6.0+)**: Prism restyles the desktop UI by injecting a renderer script into the ZCode.app bundle, which goes beyond the official plugin API. It therefore modifies **nothing by default** — create `~/.zcode/prism-opt-in` to enable it; remove the marker and the original bundle is restored automatically on the next session start. See [Opt-in](#opt-in) and the safety notes below.

## Features

- **Project colors** — all conversation rows of a project are tinted (background overlay + left accent bar), consistently across the sidebar's project / grouped / timeline views. Colors are only applied where you picked them.
- **Conversation colors** — right-click any conversation row and choose **Adjust color (this conversation)** to recolor a single conversation on top of its project color, **Cancel color (this conversation)** for an explicit transparent state, and transparent swatches in the picker for "no color" that take precedence over project colors.
- **Automation colors** — every card on the Automations page follows its project's color by default (the page is rendered per project); right-click a card, or use its `…` menu → **Adjust color (this automation)**, to override a single automation, with the same explicit transparent / follow-project states.
- **Project icons** — 30 curated Lucide icons (extracted from ZCode's own renderer assets) replace the generic folder icon on project headers, and the picked icon also appears at the far left of each conversation row in the grouped view (before the title, tinted with the project color); home/remote projects keep their house/cloud semantic icons.
- **Project aliases** — rename a project inside ZCode without touching the folder on disk or the workspace association.
- **Recency ordering** — optionally keep every sidebar view ordered by last activity: conversations by their most recent message, projects/groups by the newest conversation inside them. Implemented as a display-only reorder (CSS `order`) that never writes the app's persisted manual order — toggle it off and the native order is restored verbatim.
- **Global toggles** — dim conversation titles, brighten the thinking shimmer, automatic hash-based colors for unpicked projects (off by default), and recency ordering.

## Requirements

- macOS with the ZCode desktop app installed at `/Applications/ZCode.app` (this is the only layout Prism patches; other locations are left untouched).

## Opt-in

Installing the plugin changes nothing on disk. To enable the renderer shim, create the marker file and start a new session (or restart ZCode):

```sh
mkdir -p ~/.zcode && touch ~/.zcode/prism-opt-in
```

From then on a SessionStart hook installs and maintains the shim (and re-applies it after app updates). Without the marker the hook stays inert, and any previously applied patch is automatically stripped, restoring the original `app.asar` and refreshing the pristine backup. `$ZCODE_PLUGIN_DATA/opt-in` is honored as an alternative marker location.

## Usage

| Action | Entry point |
| --- | --- |
| Project color / icon | Right-click a project header, or the header `…` menu → **Adjust color** |
| Conversation color | Right-click a conversation row → **Adjust color (this conversation)** |
| Automation color | Right-click an automation card on the Automations page → **Adjust color (this automation)** (defaults to its project's color) |
| Cancel color | Right-click a conversation row / project `…` menu → **Cancel color** |
| Alias | Header `…` menu → **Rename** (display name only) |
| Global toggles | Bottom of the color picker → **Prism** |

All settings apply immediately and are stored in the renderer's `localStorage` (`zcProjectTint.*` / `zcPrism.settings.v1`). Run `/status` inside a session to check the shim's installation state.

## Settings

Prism declares four global toggles through the manifest's `userConfig`, so they appear in ZCode's plugin settings page (Plugin management → Prism → Configure):

| Setting | Default | Meaning |
| --- | --- | --- |
| Dim conversation titles | on | Titles render at 60% opacity |
| Brighten thinking shimmer | on | Improve shimmer visibility on dark themes |
| Auto colors for unpicked projects | off | Hash-based hue for projects without a manual pick |
| Order sidebar by recent activity | on | Display-only recency ordering, never touches manual drag order |

The plugin settings page provides the defaults and is applied when a session starts; the toggles inside the color picker are immediate overrides stored per client and win over the settings page.


## Side effects, permissions and safety

Read this before installing — Prism modifies the application bundle, which is the only way a plugin can restyle the desktop UI today.

- **What gets written**: the SessionStart hook (`hooks/ensure-shim.js`) extracts `/Applications/ZCode.app/Contents/Resources/app.asar`, injects a single `<script>` block (this plugin's `renderer/prism.js`) into `out/renderer/index.html`, repacks the archive, and swaps it in place. Before the first patch it keeps an untouched copy at `app.asar.pristine-backup`; run state is recorded in `~/.zcode/prism-state.json`.
- **When it runs**: only in quick mode (a hash check against the installed shim) on every session start, and only while the opt-in marker exists. The full repack happens only when the shim is missing or stale (e.g. after a ZCode update); without the marker no write to the bundle ever happens, and a legacy patch found without the marker is stripped instead. Nothing else is modified — no other files, no preferences, no launch agents.
- **Network**: none. Prism never opens a connection; everything is local file and DOM work.
- **Telemetry**: none.
- **Rollback**: remove the marker (`rm ~/.zcode/prism-opt-in`) and start a new session — the hook strips the shim, restores the unpatched `app.asar` and refreshes `app.asar.pristine-backup`. Manual alternatives: `node hooks/ensure-shim.js --rollback`, or `mv /Applications/ZCode.app/Contents/Resources/app.asar{.pristine-backup,}` (or reinstall ZCode). Disabling/uninstalling the plugin stops the hook; already-applied tinting disappears with the rollback.
- **Fail-safety**: the injected script is fully defensive — every entry point is wrapped, and any error it hits is logged to the console without affecting the app. If the app updates and breaks the shim contract, the next session re-applies the current version automatically.

## Third-party material and licensing

- This plugin's code: MIT (see `LICENSE`).
- [Lucide](https://lucide.dev) icon path data (ISC), pre-extracted from ZCode's own renderer chunks.
- The hook reads and repacks the app archive using [`@electron/asar`](https://www.npmjs.com/package/@electron/asar) (MIT) when available. Marketplace installs ship no `node_modules`, so the hook falls back to `hooks/asar-lite.js` — a bundled, dependency-free implementation of exactly the archive subset the hook needs (pickle framing, integrity hashes, unpacked sidecars), byte-verified against the library on the real application archive. No `npm install` is required.

## Development

Source of truth: <https://github.com/saralaaga/prism>. Rebuild the icon set with the tools there, or converge the shim manually: `node hooks/ensure-shim.js --apply` (follows the opt-in marker; strips only when it is absent) and `node hooks/ensure-shim.js --rollback` (strips unconditionally).
