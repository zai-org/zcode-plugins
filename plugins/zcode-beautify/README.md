# zcode-beautify — Wallpaper & Material Design 3 theming for ZCode

[简体中文](./README_CN.md)

Set an image or a Wallpaper Engine scene/video as the ZCode desktop background,
adapt all UI colors with Material Design 3 (Monet) dynamic color, and tune
blur, dim, framing, chat-area masks and wallpaper rotation from a live in-app
panel — all driven locally over the Chrome DevTools Protocol, without touching
ZCode's installation files.

## Platform support

Developed and validated on **Windows** with the ZCode desktop client, and
requires `node` in `PATH` (the ZCode client provides Node.js for bundled MCP
servers). The static-image wallpaper + Monet theming path uses only Node.js and
CDP and is not Windows-specific. **Dynamic wallpapers** (Wallpaper Engine
scenes and videos) additionally require Windows plus Wallpaper Engine and
ffmpeg ≥ 5.0 on `PATH`; both are auto-detected and the panel shows install
guidance when missing.

## Included capabilities

- `/beautify` command and the `beautify` skill — agent-driven wallpaper setup,
  scene import and tuning.
- A `zcode-beautify` stdio MCP server exposing six tools:

  | Tool | Purpose |
  |---|---|
  | `set_background` | Set an image, video, or Wallpaper Engine scene as the wallpaper and adapt colors |
  | `import_scene_wallpaper` | Import a scene as a seamless animated wallpaper (render → record → loop → cache) |
  | `apply_options` | Tune blur / dim / Monet / wallpaper visibility / framing without re-applying |
  | `refresh_theme` | Re-inject the stored theme after a ZCode restart |
  | `reset_appearance` | Remove wallpaper and color overrides |
  | `beautify_status` | Report the stored configuration |

- A **live draggable settings panel** inside ZCode: blur / dim sliders, Monet
  and wallpaper-visibility toggles, three framing modes (`cover`, `contain`,
  `smart`), an image library and a scene library (rename / two-step delete),
  batch scene import with progress, recording-resolution options, chat-area
  masks (dim / edge gradients / frost), image easing, per-library row counts,
  rotation playlists (sequence / random / daily schedule, per-plan transition
  effects and time windows), recent-use history, and config export/import.
- Scenes and videos are rendered through Wallpaper Engine, recorded, processed
  into a perfectly seamless loop (first frame == last frame), cached
  content-addressed and streamed to the renderer over local HTTP.

## Installation

Open **Settings → Plugins** in ZCode, search for **zcode-beautify**, and
install it from the official marketplace. Start a **new task** after
installing, enabling or updating the plugin — ZCode snapshots plugin MCP
configuration at task startup.

## First run

Theme injection needs ZCode to run with its remote-debugging port
(`9222`) enabled. If a tool reports a CDP/port error, run once (from the plugin
directory):

```bash
node dist/cli.js launch
```

This restarts ZCode once with `--remote-debugging-port=9222` and writes the
flag into the ZCode shortcuts, so later launches keep it. ZCode sessions are
persisted; unsaved work in other applications is not affected. The plugin's
MCP server starts the background `serve` service (and the settings panel)
automatically with the plugin — no manual service management is needed.

## Basic verification

1. Run `/beautify <absolute image path>`: the wallpaper and the Monet palette
   apply, and the settings panel appears in the corner of the ZCode window.
2. Drag the blur / dim sliders in the panel: changes preview live and persist
   across restarts.
3. (Optional, Windows) Import a Wallpaper Engine scene from the panel's scene
   tab: it renders, records, loops and caches — re-imports are instant. Then
   add it to a rotation playlist and confirm the wallpaper switches on
   schedule.

## Side effects and security notes

- **Local processes**: the MCP server starts one background Node service
  (`serve`) — a localhost-only HTTP API on `127.0.0.1:9223` protected by a
  random per-start token. Scene/video imports additionally launch Wallpaper
  Engine and ffmpeg; the panel's file picker runs a PowerShell dialog on
  Windows.
- **Writes**: all runtime data (config, imported wallpaper copies, poster /
  thumbnail cache, scene loop cache — capped at 10 GB) lives in ZCode's plugin
  data directory. The plugin never writes back into its installed directory
  and never modifies ZCode's installation files; `reset` restores the stock
  look.
- **Injection**: DOM/CSS overlays are injected into the ZCode renderer over CDP
  on `127.0.0.1:9222` — an unofficial mechanism; ZCode upgrades may require the
  plugin to adapt.
- **Network**: no external network access at runtime; everything is local.
- **Third-party code**: the `dist/` bundles embed the following npm
  dependencies — `@modelcontextprotocol/sdk` (MIT),
  `@material/material-color-utilities` (Apache-2.0), `jimp` (MIT). Wallpaper
  Engine and ffmpeg are optional external programs and are not bundled.

## License

MIT — see [LICENSE](./LICENSE).

Based on the original [zcode-beautify](https://github.com/Logocceai/zcode-beautify)
by Logocceai; this package is the maintained fork
([Mc-GrowlR/zcode-beautify-for-wallpaper-engine](https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine))
at version 0.4.0, adding rotation playlists, the Wallpaper Engine library
browser, the hardened import pipeline and the redesigned three-tab panel.
