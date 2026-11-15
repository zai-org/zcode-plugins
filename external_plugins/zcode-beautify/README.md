# zcode-beautify (fork)

[English](README.md) | [中文](README.zh-CN.md)

Fork of [Logocceai/zcode-beautify](https://github.com/Logocceai/zcode-beautify), actively maintained by [Mc-GrowlR](https://github.com/Mc-GrowlR) — this is where the feature development continues (see [CHANGES.md](CHANGES.md) for the full 0.3.0 → 6.1.x history).

Beautify the **ZCode desktop client**: use any image — or any **video / Wallpaper Engine scene wallpaper** — as a background wallpaper and adapt the whole UI with Material Design 3 (Monet) dynamic color; restyle the chat area (message bubbles, conversation-column width & drag handles, a large-session smooth mode, the working-row loading icon, composer transparency) — plus a live settings panel for real-time tuning. On top of the upstream base this fork adds: dynamic wallpapers (WE scene / video import with seamless loops), the local Wallpaper Engine library browser, scheduled rotation playlists, the full chat-area restyling suite, ZCode 3.18 support, and dual-client coverage (ZCode + WorkBuddy).

> 🧩 **Since 0.5.0 the same plugin also targets the WorkBuddy desktop client.** Pass `--target workbuddy` (or install it through the bundled `.codebuddy-plugin` manifest, which sets `BEAUTIFY_TARGET=workbuddy`): the wallpaper layer and Monet palette are re-mapped onto WorkBuddy's `--wb-*` design tokens. Ports (9222/9333 CDP, 9223/9334 API), data dirs and launcher entries are isolated per client, so both can run at once. Chat-area extras stay ZCode-only — they bind to ZCode's DOM, and the panel hides those tabs automatically under WorkBuddy.

> 📷 Screenshot welcome — PRs adding one to `docs/screenshot.png` are appreciated.

## Features

### Wallpapers & theming

- **Dynamic wallpapers** — import a Wallpaper Engine **scene** (`.pkg` or workshop directory) or a plain **video** (`.mp4`/`.webm`): scenes are rendered in a dedicated Wallpaper Engine window, captured through Desktop Duplication and processed into a perfectly seamless loop (first frame == last frame); long videos are trimmed to a middle segment. Loops are cached content-addressed (LRU) and streamed to the renderer over HTTP — motion with no interaction and no sound.
- **Wallpaper Engine library browser** — browse your local WE wallpapers (Steam workshop subscriptions + your own projects, across multiple Steam libraries) right inside the panel: type or folder views, search, multi-select batch import with progress, hover previews (video wallpapers play their own clip; scenes get a real rendered preview), imported badges, and real WE titles.
- **Scheduled rotation** — multiple named playlists, each with its own order mode (**sequential / shuffle without repeating the same item twice / daily at a fixed time**), a transition effect (fade / slide / zoom / blur / none), and an optional time window (overnight windows supported). Rotation survives serve restarts and resumes from where it stopped; switching wallpapers manually auto-pauses it.
- **Static wallpapers** — any local image becomes a fixed background layer behind the UI, with three framing modes: `cover` (fill and crop), `contain` (letterboxed over a blurred backdrop of the same picture), and `smart` — a local AI-style analysis that finds the salient subject and picks the best framing and focus point automatically. Optional Ken Burns easing for image changes.
- **Monet theming** — a source color is extracted from the wallpaper with Google's official MD3 algorithm; light/dark palettes are mapped onto ZCode's semantic CSS variables (35+ tokens). Functional colors (success/warning/destructive) are intentionally left untouched.

### Chat-area restyling

- **Chat bubbles** — five presets for your own message bubbles (`accent` tint, `glass` blur, `outline`, `flat`, or stock `default`), plus tint strength, corner radius, width and alignment controls, a bubble style editor with a saved personal style library, and custom CSS support. Colors reference live theme tokens, so a Monet re-theme restyles the bubbles too.
- **Bubble Studio** (气泡工坊, ZCode 3.16+) — an interactive gallery page built on ZCode's MCP Apps UI: whenever the agent changes your bubble look, the tool result opens an in-conversation studio where every recipe previews side by side; click one to try it on (the live chat restyles instantly), fine-tune tint / radius / width / alignment / custom CSS, and save your own named recipes (kept in `bubble-recipes.json`, up to 50). It is also available as a persistent side-pane surface; on hosts without UI-plugin support everything gracefully falls back to the plain text card.
- **Conversation width** — widen or narrow the message column: stock / wide tiers / three narrow tiers / fully custom (cap + inset in rem). Injected as a **formula** (rem cap + `calc()` inset) rather than a fixed width, so it keeps following window resizes exactly like the native layout and never overflows into the input bar.
- **Drag-to-resize handles** (off by default) — two hidden vertical strips hugging the conversation column edges: hover reveals a 3px accent line, dragging resizes the column symmetrically (DeepSeek-style), double-click resets to the width tier, Esc cancels a drag. The dragged width persists locally and outranks the tiers; before the first drag the layout is pixel-identical to stock.
- **Large-session smooth mode** (off by default) — message rows far outside the viewport are measured first, then skipped for layout and painting (`content-visibility:auto` with accurate `contain-intrinsic-size`). On a 51 MB session clone this cut first-open time by **~41%** with zero scrollbar distortion; long chats scroll smoother.
- **Elapsed-time decimal trim** (off by default) — the working-row elapsed time under the conversation drops its fractional seconds ("53.4 秒" → "53 秒"), rewritten live; toggling off restores stock.
- **Conversation-footer loading icon** — ZCode 3.18 replaced the working row's leading icon with a brand-colored orbit glyph; switch back to the **pre-3.18 3×3 pixel-wave dots** (rebuilt in pure CSS, colors follow the wallpaper palette) or replace it with a **custom picture / animated GIF** (optional rotation, 10-28px).
- **Composer transparency** — fade the chat input box's background (0 = solid, 100 = fully transparent, 50 ≈ the stock half-tint) so the wallpaper shows through underneath; text, border and focus ring stay untouched, and the light/dark theme plus Monet palette keep working.

### Panel & service

- **Live settings panel** — a draggable panel inside ZCode with three tabs: **Wallpaper** (grouped library, import with progress and dependency guidance, current look), **Rotation** (playlists), and **Settings** — blur/dim sliders, framing modes, Monet and wallpaper-visibility toggles, chat-area masks (dim / gradient / veil), day-night eye care, recording resolution, config export/import, recent history, and reset. Changes preview instantly and persist.
- **Zero-touch serve** — the MCP server starts the background service automatically when ZCode launches, so the panel is simply always there.
- **Self-healing launch entries** — while `serve` runs, every ZCode launch entry (desktop / start-menu / taskbar shortcuts — OneDrive-redirected folders included — plus the `zcode://` protocol handler and Explorer context-menu verbs) is kept carrying `--remote-debugging-port` automatically, so the theme survives ZCode restarts *and* updater-rebuilt shortcuts. `repair-launchers` scans and fixes them on demand with a structured report (machine-wide entries are reported, not modified). The theme itself also survives renderer reloads, and the last look is cached in `localStorage` as a fallback.
- **Conversation control** — bundled slash commands `/beautify` and `/bubble`, plus MCP tools (`set_background`, `import_scene_wallpaper`, `apply_options`, `repair_launchers`, …), let the ZCode agent set the wallpaper, tune the theme, or restyle your chat bubbles from a plain-language description — bubble changes additionally open the interactive Bubble Studio gallery on ZCode 3.16+.

## How it works

ZCode is an Electron app whose UI theming is driven by Tailwind v4 `--color-*` CSS custom properties, and production builds start **without** a debug port. This plugin:

1. starts ZCode with `--remote-debugging-port=9222` (one-time `launch`; launch entries are then kept fixed automatically);
2. connects over the Chrome DevTools Protocol and injects CSS/JS into the renderer:
   - a fixed-position wallpaper layer (images embedded as data URI, video loops streamed over localhost HTTP),
   - translucent background variables so the wallpaper shows through,
   - MD3 light/dark palettes overriding ZCode's semantic tokens,
   - optional chat-look layers: bubble styles, conversation-width formula, off-screen row skipping;
3. keeps the injection sessions open (`serve`) so the theme, the settings panel, and rotation survive renderer reloads.

It never modifies ZCode's installation files, so ZCode upgrades are unaffected.

### WorkBuddy component tuning

WorkBuddy paints a few shell containers with literal colors the `--wb-*` tokens cannot reach — the conversation sidebar and composer are `rgb(31,31,31)`, the composer outline `#333`, the menu-bar labels `rgba(228,228,228,.37)` — and its message renderer keeps a separate `--cr-*` text family that does not follow the design system. The panel's **组件 (Components)** tab (WorkBuddy only) exposes that gap as a small set of switches: sidebar surface, menu-bar label strength, composer radius/surface/outline, tool-card radius, a `--cr-*` → `--wb-*` bridge, plus shared control and modal radii. The master switch is off by default (zero injection) and every color is derived with `color-mix(in srgb, var(--wb-*) N%, transparent)`, so light/dark themes and wallpaper palettes are followed automatically.

## Requirements

- Node.js ≥ 20 available on your PATH.
- **ZCode** or **WorkBuddy** desktop client (Windows / macOS / Linux). Pass `--target workbuddy` to switch; ZCode is the default.
- For dynamic wallpapers (optional): **Wallpaper Engine** (Steam) and **ffmpeg ≥ 5.0** on PATH — both are auto-detected, and the panel shows install guidance when missing. Capture uses the Desktop Duplication API, so dynamic import is **Windows-only**; static image wallpapers work everywhere.

## Two packages, both installable by handing an AI the link

Give your AI agent just <https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine> — it
clones the repo and follows the instructions inside. Pick the right one:

| | **Plugin package** (`INSTALL-FOR-AI.md`) | **Skill pack** (`skill-pack/SKILL.md`) |
|---|---|---|
| Target | The **ZCode desktop client** | **Any** Electron app |
| AI's role | Installer — sets up the ready-made plugin | Developer — builds the tool from scratch |
| You say | "Install this beautify plugin in my ZCode" | "Build wallpaper/color beautification for my XX app" |
| Result | Working `/beautify` + `/bubble` commands and MCP tools | A new local beautify tool |

Copy-paste prompt for the plugin:

```text
https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine
Install this beautify plugin into my ZCode desktop client. Follow
INSTALL-FOR-AI.md in the repository.
```

Offline? Both packages are attached to the
[releases page](https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine/releases) as zips.

## Install (manual paths)

### Option A — ZCode plugin marketplace (recommended)

1. Open ZCode → **Settings → Plugin Management → Discover**.
2. Click **+** and add this repository (GitHub URL or a local clone path).
3. Click **Get** on the *zcode-beautify* card. The `/beautify` and `/bubble` commands and MCP tools are available immediately.

The published repo ships prebuilt single-file bundles in `dist/`, so no build step is needed on your machine. (The marketplace package ships the same bundles under `bundle/` — the marketplace packaging contract reserves `dist/` for in-repo builds.)

### Option B — clone and run

```bash
git clone https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine.git
cd zcode-beautify-for-wallpaper-engine
node bundle/cli.js --help        # prebuilt bundle, zero install
```

## Quick start

```bash
# 1) Opt in to the experimental CDP injection (off by default — see the
#    section below for what this exposes and how to undo it).
node bundle/cli.js enable

# 2) Quit ZCode completely, then start it with the CDP debug port (one-time).
node bundle/cli.js launch

# 3) Set a wallpaper with Monet adaptation
node bundle/cli.js apply "D:\pictures\wallpaper.jpg" --blur 6 --dim 30

# 4) (Recommended) Keep the theme alive + get the live settings panel.
#    --detach backgrounds it, so the panel keeps working after this shell
#    (or the agent session that started it) is gone.
node bundle/cli.js serve --detach
```

With `serve` running, a 🎨 button appears in the bottom-right corner of ZCode. The panel has three tabs — **Wallpaper** (library, imports, current look), **Rotation** (playlists), and **Settings** — plus a chat-area section for bubble presets and sliders, conversation-width tiers, and the large-session smooth mode. Everything previews instantly and is saved automatically. If the service is not running, the panel shows an explicit ⚠ offline banner instead of a zeroed configuration.

You can also just type `/beautify <image path>` in ZCode and let the agent do it, then say things like "make it blurrier" — or type `/bubble glass with a bigger radius` to restyle your chat bubbles conversationally.

## CLI reference

| Command | Purpose |
|---|---|
| `--target zcode\|workbuddy\|auto` | Global flag: pick the client to beautify (default `zcode`, `auto` detects the installed one); same as the `BEAUTIFY_TARGET` env var |
| `enable` | Opt in to the experimental CDP injection: records consent, adds the CDP flag to the launch entries, starts the local service |
| `disable [--keep-launchers]` | Opt out and roll back: clears the injected theme (incl. the renderer's cached copy), stops the service, strips the flag from the launch entries (`--keep-launchers` keeps it) |
| `launch [--port N]` | Start the client with `--remote-debugging-port` (quit it first); 9222 for ZCode, 9333 for WorkBuddy |
| `apply <image> [--blur] [--dim] [--fit] [--no-monet]` | Set wallpaper + adapt colors (`--fit cover\|contain\|smart`) |
| `apply-scene <pkg-or-dir>` | Import a Wallpaper Engine scene / video wallpaper end-to-end |
| `colors` | Re-apply the stored theme without changing the image |
| `serve [--detach] [--api-port M]` | Watch mode + settings panel + local control API (default API port 9223); `--detach` survives the shell that started it |
| `watch` | Headless watch mode: re-inject whenever ZCode restarts |
| `repair-launchers [--dry-run] [--remove]` | Scan/fix every launch entry so ZCode always starts with the CDP port; `--remove` strips the flag from every entry instead (the rollback) |
| `reset` | Remove wallpaper and color overrides |
| `status` | Show CDP reachability and renderer targets |

## MCP tools

| Tool | Purpose |
|---|---|
| `set_background` | Set wallpaper (image or scene) + Monet colors |
| `import_scene_wallpaper` | Import a WE scene / video wallpaper end-to-end |
| `apply_options` | Tune blur/dim/monet/visibility/framing, chat width, bubble look — without re-sending the image. Bubble changes open the Bubble Studio gallery (ZCode 3.16+) |
| `bubble_studio_state` | Snapshot for the Bubble Studio page: active look, matching recipe id, built-in presets, saved recipes |
| `save_bubble_recipe` | Save (or update) a named bubble recipe — defaults to the currently applied look |
| `delete_bubble_recipe` | Delete a saved recipe by id (built-ins are protected) |
| `refresh_theme` | Re-inject the stored theme after a restart |
| `reset_appearance` | Remove wallpaper and overrides |
| `beautify_status` | Show the stored config |
| `enable_experimental` | Opt in to the experimental CDP injection (records consent, repairs launch entries, starts the service) |
| `disable_experimental` | Opt out: live teardown + strip the flag from launch entries (`clean_launchers=false` keeps it) |
| `repair_launchers` | Scan/fix launch entries (`action: "add"` default, `"remove"` strips the flag; structured report) |

## Project structure

```
├─ src/
│  ├─ cli.ts                 # CLI entry: launch / apply / apply-scene / colors / reset / status / watch / serve / repair-launchers
│  ├─ core/
│  │  ├─ cdp.ts              # Minimal Chrome DevTools Protocol client + injection scripts
│  │  ├─ inject.ts           # Assembles the injected payload (wallpaper layer + token overrides + chat look)
│  │  ├─ launch.ts           # Config persistence + ZCode launcher (single-instance aware)
│  │  ├─ launchers.ts        # Launch-entry repair: shortcuts + registry handlers keep the CDP port
│  │  ├─ monet.ts            # Image decode, MD3 source-color extraction, smart-fit analysis
│  │  ├─ tokens.ts           # MD3 schemes → ZCode's Tailwind v4 --color-* variables
│  │  ├─ session.ts          # Shared apply/reset operations used by CLI and MCP
│  │  ├─ wallpaperType.ts    # Input type detection (image / scene / video / web)
│  │  ├─ dependencyCheck.ts  # Wallpaper Engine + ffmpeg detection with install guidance
│  │  ├─ weLauncher.ts       # WE window control (open/close wallpaper in a dedicated window)
│  │  ├─ weLibrary.ts        # Local WE wallpaper library browsing (workshop + my projects)
│  │  ├─ recorder.ts         # Desktop Duplication capture of the WE window
│  │  ├─ loopProcessor.ts    # Seamless-loop construction (first frame == last frame)
│  │  ├─ scenePipeline.ts    # End-to-end import pipeline (detect → deps → record → loop → cache)
│  │  ├─ cacheManager.ts     # Content-addressed scene cache (LRU)
│  │  ├─ media.ts            # HTTP media endpoints (Range requests) for scene loops
│  │  ├─ bubbleRecipes.ts    # Chat-bubble preset styles
│  │  └─ server.ts           # `serve` mode: control API + rotation scheduler + persistent injection sessions
│  ├─ panel/panelScript.ts   # The injected settings panel (3 tabs: wallpaper / rotation / settings)
│  └─ mcp/server.ts          # MCP server exposing tools to the ZCode agent
├─ commands/beautify.md      # /beautify slash command
├─ commands/bubble.md        # /bubble slash command (restyle bubbles from a description)
├─ skills/beautify/SKILL.md  # Agent-facing workflow documentation
├─ .zcode-plugin/plugin.json # ZCode plugin manifest (commands, skills, MCP server)
├─ marketplace.json          # Marketplace index so the repo is discoverable in ZCode
├─ scripts/                  # bundle (dist/), package (release zips), record-install
└─ dist/                     # Prebuilt cli.js + mcp/server.js — no build step needed
```

User data lives in `~/.zcode/cli/plugins/data/zcode-beautify/`: `config.json`
(live configuration), `config.backup.json` (what 还原/Reset remembers for
restore), `wallpaper.*` (a copy of your image so the theme survives the
original file moving or being deleted), and `scenes/` (the content-addressed
dynamic-wallpaper cache, LRU-capped).

## Development

```bash
npm install
npm run build    # type-check + compile to dist/
npm run bundle   # prebuilt single-file bundles (what the repo ships)
```

`dist/` is committed so users never need to build. If you change `src/`, run `npm run bundle` and commit the updated bundles.

## Skill pack (`skill-pack/`)

`skill-pack/` is a self-contained, platform-agnostic skill for AI coding agents
(Claude, DeepSeek, Codex, Doubao, …): hand the folder to any agent and it can
rebuild this beautify capability for **any** Electron app — the CDP plumbing,
MD3 color extraction, injection templates, live-tuning API, and the pitfall
list gathered from production. Versioned together with this repo. Grab it from
the [releases page](https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine/releases) as a
zip, or read [`skill-pack/SKILL.md`](skill-pack/SKILL.md) directly.

## Experimental opt-in (CDP injection)

The injection mechanism is **experimental** and **off by default** (since 0.6.0): until you opt in, the plugin starts no background service, writes nothing to your launch entries, and the agent-side tools answer with guidance instead of acting. It bypasses the plugin UI API by design — there is no supported desktop-client extension point yet — which is exactly why it stays behind an explicit gate.

**What opting in does** (`enable_experimental`, or `zcode-beautify enable`):

- Adds `--remote-debugging-port=9222` to the client's launch entries (your desktop / Start Menu / pinned-taskbar shortcuts, the `zcode://` handler, Explorer context-menu verbs) so ZCode opens a local CDP port. Machine-wide entries that need administrator rights are reported, never modified.
- Starts the local service and re-enables the self-heal that keeps those entries carrying the flag across client updates.
- Records consent (timestamp + plugin version) in the plugin's config. Installations that predate 0.6.0 keep working once, marked as migrated; the panel shows the state with a one-click opt-out.

**What that exposes:** the CDP port binds to `127.0.0.1` (loopback only) but is **unauthenticated** — any process running as your user can attach to the renderer while the port is open. The plugin's own control API is additionally token-gated, but the CDP port itself is Chromium behavior outside this plugin's control. Don't enable it on a machine with untrusted local users or software.

**Recovery / uninstall:**

- `disable_experimental` (MCP) or `zcode-beautify disable` stops the service, clears the injected theme including the renderer's cached copy, and strips the flag from the launch entries again (`--keep-launchers` keeps it). Fully quit and restart ZCode afterwards. Stored wallpaper settings are kept, so re-enabling later restores the look.
- `zcode-beautify repair-launchers --remove` only strips the flag — the rollback for what pre-0.6.0 versions wrote automatically, without touching anything else.
- Uninstalling the plugin: run `node <plugin>/bundle/cli.js disable` (or `repair-launchers --remove`) first, then remove the plugin.
- Upgrades: ZCode's updater rebuilds the Start Menu shortcut without the flag; while enabled, the self-heal re-adds it on the next ZCode start — while disabled, nothing is ever re-added.

## Risks & limitations

- Injection happens over CDP — an **unofficial** mechanism, **experimental and opt-in** (see the section above). Updates to ZCode may break it; `reset` always restores the default look.
- `launch` restarts ZCode once. Without `serve`/`watch` running, the theme is lost on every ZCode restart (CDP sessions are scoped to the connection). No manual edits needed: while the experimental mode is enabled, the MCP server keeps every ZCode launch entry (shortcuts, protocol handler, context-menu verbs) carrying ` --remote-debugging-port=9222` automatically, so the theme survives every restart as long as `serve` runs. Start it with `serve --detach`: a foreground `serve` dies with the terminal (or agent session) that spawned it, and the panel then reports itself offline.
- Chat restyling hooks (`[data-v4-user-input-bubble]`, `conversation:max-w-*` container queries) are tied to ZCode's current DOM; a ZCode redesign may need selector updates.
- The control API binds to `127.0.0.1` only and authenticates with a per-launch random token; media URLs carry the token as a query parameter. The CDP port itself is unauthenticated — see the opt-in section above.
- Dynamic import (scene capture) is Windows-only (Desktop Duplication API); everything else is cross-platform.

## License

MIT
