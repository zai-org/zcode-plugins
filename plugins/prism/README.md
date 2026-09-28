# Prism

> A beam of white light enters the prism and comes out as every color of the rainbow.

**Prism** is a desktop-side customization plugin for [ZCode](https://zcode.z.ai): it gives every project in the left sidebar its own color, icon and display name, lets you recolor individual conversations, and can keep the sidebar ordered by the most recently active conversation.

## Features

- **Project colors** — all conversation rows of a project are tinted (background overlay + left accent bar), consistently across the sidebar's project / grouped / timeline views. Colors are only applied where you picked them.
- **Conversation colors** — right-click any conversation row and choose **Adjust color (this conversation)** to recolor a single conversation on top of its project color, **Cancel color (this conversation)** for an explicit transparent state, and transparent swatches in the picker for "no color" that take precedence over project colors.
- **Project icons** — 30 curated Lucide icons (extracted from ZCode's own renderer assets) replace the generic folder icon on project headers; home/remote projects keep their house/cloud semantic icons.
- **Project aliases** — rename a project inside ZCode without touching the folder on disk or the workspace association.
- **Recency ordering** — optionally keep every sidebar view ordered by last activity: conversations by their most recent message, projects/groups by the newest conversation inside them. Implemented as a display-only reorder (CSS `order`) that never writes the app's persisted manual order — toggle it off and the native order is restored verbatim.
- **Global toggles** — dim conversation titles, brighten the thinking shimmer, automatic hash-based colors for unpicked projects (off by default), and recency ordering.

## Requirements

- macOS with the ZCode desktop app installed at `/Applications/ZCode.app` (this is the only layout Prism patches; other locations are left untouched).

## Usage

| Action | Entry point |
| --- | --- |
| Project color / icon | Right-click a project header, or the header `…` menu → **Adjust color** |
| Conversation color | Right-click a conversation row → **Adjust color (this conversation)** |
| Cancel color | Right-click a conversation row / project `…` menu → **Cancel color** |
| Alias | Header `…` menu → **Rename** (display name only) |
| Global toggles | Bottom of the color picker → **Prism** |

All settings apply immediately and are stored in the renderer's `localStorage` (`zcProjectTint.*` / `zcPrism.settings.v1`). Run `/status` inside a session to check the shim's installation state.

## Side effects, permissions and safety

Read this before installing — Prism modifies the application bundle, which is the only way a plugin can restyle the desktop UI today.

- **What gets written**: the SessionStart hook (`hooks/ensure-shim.js`) extracts `/Applications/ZCode.app/Contents/Resources/app.asar`, injects a single `<script>` block (this plugin's `renderer/prism.js`) into `out/renderer/index.html`, repacks the archive, and swaps it in place. Before the first patch it keeps an untouched copy at `app.asar.pristine-backup`; run state is recorded in `~/.zcode/prism-state.json`.
- **When it runs**: only in quick mode (a hash check against the installed shim) on every session start; the full repack only happens when the shim is missing or stale, e.g. after a ZCode update. Nothing else is modified — no other files, no preferences, no launch agents.
- **Network**: none. Prism never opens a connection; everything is local file and DOM work.
- **Telemetry**: none.
- **Rollback**: restore the original bundle with
  `mv /Applications/ZCode.app/Contents/Resources/app.asar{.pristine-backup,}` (or reinstall ZCode). Disabling/uninstalling the plugin stops the hook; already-applied tinting disappears with the rollback.
- **Fail-safety**: the injected script is fully defensive — every entry point is wrapped, and any error it hits is logged to the console without affecting the app. If the app updates and breaks the shim contract, the next session re-applies the current version automatically.

## Third-party material and licensing

- This plugin's code: MIT (see `LICENSE`).
- [Lucide](https://lucide.dev) icon path data (ISC), pre-extracted from ZCode's own renderer chunks.
- `node_modules/` vendors [`@electron/asar`](https://www.npmjs.com/package/@electron/asar) (MIT) and its transitive deps (`glob`, `minimatch`, et al.) because marketplace installs do not run `npm install` and the hook needs it available locally at runtime.

## Development

Source of truth: <https://github.com/saralaaga/prism>. Rebuild the icon set or re-apply the shim manually with `node hooks/ensure-shim.js --apply`.
