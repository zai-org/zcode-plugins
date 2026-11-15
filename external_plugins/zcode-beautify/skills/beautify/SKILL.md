---
name: beautify
description: Beautify the ZCode or WorkBuddy desktop client — import a background wallpaper image and adapt all UI colors with Material Design 3 (Monet) dynamic color. Use when the user asks to set a background, wallpaper, theme, or re-color the client UI (--target picks the client; the WorkBuddy plugin manifest presets it).
---

# Desktop Beautify (ZCode / WorkBuddy)

This plugin themes a **desktop client** (Electron app) by injecting a
wallpaper layer and Monet-derived CSS variable overrides over CDP. It never
modifies the client's installation files.

## Targets

Two clients are supported since 0.5.0:

| Client | Selection | CDP / API port | Token family |
|---|---|---|---|
| ZCode (default) | nothing to add | 9222 / 9223 | `--color-*` |
| WorkBuddy | `--target workbuddy` or `BEAUTIFY_TARGET=workbuddy` | 9333 / 9334 | `--wb-*` |

When this plugin is installed through `.codebuddy-plugin/` (WorkBuddy), the
target is already set for the MCP server — do not pass `--target` to MCP tools.
Chat-area extras (bubbles, column width, spinner icons, elapsed-time tweak) are
ZCode-only; under WorkBuddy the MCP/panel accept the parameters but skip them.

## When to use

- "把这张图设为 ZCode 背景" / "set this image as the ZCode background"
- "换个主题颜色" / "make the UI match my wallpaper"
- "恢复默认外观" / "reset the appearance"
- "把聊天气泡改成毛玻璃" / style the chat bubbles → use the `/bubble` command
  (it maps the description to presets or custom CSS via `apply_options`)
- "把消息流调宽一点" / widen the conversation column → `apply_options` with
  `chat_width_cap_rem` (0 = stock; 84 ≈ wide, 90 ≈ wider, 100 ≈ near full width
  on large windows) and optionally `chat_width_inset_rem` (side inset, stock 24,
  default 12). Formula-based, so the column still tracks window resizes. The
  same gears also live in the in-app panel's 聊天区 tab (消息流宽度).
- "我想手动拖拽调宽度" / drag to resize the column → the 聊天区 tab's
  两侧拖拽调宽 toggle, or `apply_options` with `chat_drag_resize: true`.
  Two hidden strips hug the conversation column edges: hover shows a 3px
  accent line, dragging resizes symmetrically, double-click resets to the
  tier, Esc cancels. The dragged width persists locally and outranks
  `chat_width_cap_rem` until double-clicked away.
- "大会话打开/滚动卡" / large sessions feel slow → the 聊天区 tab's
  大会话流畅模式 toggle (chatLook.perfSmooth). Off-screen rows skip
  paint+layout via per-row content-visibility with their REAL height baked in
  (measured ~40% faster session open on a 51MB session, scrollbar exact).
  Toggle it via the panel or POST /api/config `chatLook.perfSmooth: 0|1`.
- "耗时秒数别带小数" / hide the decimal in the working-row elapsed time
  ("53.4 秒" → "53 秒") → the 聊天区 tab's 耗时秒数去小数 toggle, or
  `apply_options` with `chat_hide_elapsed_decimal: true` (false = stock).
  The decimal is baked into one aria-hidden text span by the renderer
  (toFixed(1)), so the bootstrap rewrites the text via MutationObserver —
  finished/history durations are integer-only already and stay untouched.
- "把会话列表的转圈图标换成图片/GIF" / replace the sidebar running-indicator
  spinner → `apply_options` with `spinner: { mode: "image", image_path,
  spin, size }` (`spin: false` for animated GIFs, `mode: "default"` to go
  back to stock). The panel's 聊天 tab (运行中图标) does the same with a file
  picker + preview.

## Workflow

1. **Get an image path from the user.** Only absolute local paths are accepted.
2. **Call the `set_background` tool** with `image_path` (plus optional `blur`,
   `dim`). The tool copies the image into the plugin data dir, extracts the MD3
   source color, generates light/dark schemes, and injects everything into the
   running ZCode renderer.
3. **On CDP/port errors**, first check the opt-in gate (`beautify_status` →
   `experimental.enabled`). When it is `false` (default since 0.6.0), the
   injection tools refuse to act: ask the user to consent, then call
   `enable_experimental` (records consent, repairs the launch entries, starts
   the service). When it is `true` and the port is still unreachable, the
   ZCode instance is running without the debug port: instruct the user to quit
   ZCode completely and start it via `node <plugin-root>/bundle/cli.js launch`,
   or via watch mode: `node <plugin-root>/bundle/cli.js watch` (keeps
   re-injecting across restarts).
4. **Fine-tune with `apply_options`** (blur / dim / monet / wallpaper_visible /
   fit) when the user wants adjustments — it does not need the image path
   again. `fit` picks the framing: `cover` fills and crops, `contain`
   letterboxes over a blurred backdrop, `smart` analyzes the picture locally
   and picks framing + focus automatically.
5. **After ZCode restarts**, the injected theme is gone until re-injected — use
   the `refresh_theme` tool or run watch mode.
6. **To undo everything**, use `reset_appearance`.
7. **Recommend `node <plugin-root>/bundle/cli.js serve --detach`** for an
   interactive experience: it keeps the theme alive and shows a draggable
   settings panel inside ZCode (blur/dim sliders, Monet toggle, wallpaper swap,
   reset). `--detach` matters — a foreground `serve` is reaped with the shell or
   agent session that spawned it, and the panel then shows its ⚠ offline banner.
   Never start a second `serve`: it refuses to start and names the pid holding
   the port. If the panel reports itself offline, run `serve --detach` rather
   than assuming the stored config is empty — an offline panel deliberately
   zeroes its controls.

## Tools

| Tool | Purpose |
|---|---|
| `set_background` | Set wallpaper + Monet colors |
| `apply_options` | Tune blur/dim/monet/wallpaper visibility/framing, the chat bubble look, the conversation column width (`chat_width_cap_rem`/`chat_width_inset_rem`), the drag-to-resize handles (`chat_drag_resize`), and the sidebar running-indicator icon (`spinner`) without changing the image |
| `refresh_theme` | Re-inject stored theme after a restart |
| `reset_appearance` | Remove wallpaper and overrides |
| `beautify_status` | Show stored config |
| `enable_experimental` | One-time opt-in to the experimental CDP injection (off by default): records consent, adds the CDP flag to launch entries, starts the service |
| `disable_experimental` | Opt out and roll back: clears the injected theme (incl. the renderer cache), stops the service, strips the flag (`clean_launchers: false` keeps it) |

## Constraints

- The experimental CDP injection is **off by default** (0.6.0+): `set_background`
  / `apply_options` / `refresh_theme` return guidance until `enable_experimental`
  is called once (with the user's consent — see the README security notes).
- ZCode must be running (or startable) with `--remote-debugging-port=9222`.
- Themes live in CDP sessions: they are wiped when ZCode restarts. Watch mode
  makes re-injection automatic.
- Functional colors (success/warning/destructive) are intentionally preserved.
