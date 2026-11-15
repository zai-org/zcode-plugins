---
description: Style the ZCode chat bubbles (聊天气泡) — presets, numeric tweaks, or fully custom CSS, from a natural-language description
argument-hint: "[style description, e.g. 毛玻璃 / 渐变蓝紫 / 圆角20 左对齐 / 恢复默认]"
---

# ZCode Bubble Style

The user wants to restyle the bubbles of their own chat messages in ZCode. $ARGUMENTS

## Steps

1. **Read the current look** with the `beautify_status` MCP tool (field
   `bubbleLook`). Descriptions are often incremental ("再圆一点", "颜色淡一点") —
   start from the current values and adjust.
2. **Map the description to parameters.** Send only the fields the description
   implies; omitted fields keep their current value.
   - Presets: `accent` 主题色染色 / `glass` 毛玻璃半透明 / `outline` 透明描边 /
     `flat` 扁平无框 / `default` 原生（恢复默认）.
   - `tint` 0-100 染色强度 (default 28), `radius` 4-24 圆角 px (default 12),
     `width` 40-90 气泡最大宽度 % (default 70), `align` `left`/`right`
     (default right; left mirrors the 2px tail corner).
3. **Anything the presets cannot express** — a specific color, gradient,
   glow or shadow, border style, padding — goes into custom CSS:
   - write it against the friendly selectors `.zb-bubble` (the user message
     bubble) and `.zb-bubble-row` (its conversation row); they are rewritten to
     ZCode's real selectors at injection time;
   - suffix declarations with `!important` (ZCode's own styles are aggressive);
   - prefer the live theme tokens `var(--color-primary)`, `var(--color-surface)`,
     `var(--color-on-primary)` over hard-coded colors, so a Monet re-theme
     restyles the bubble automatically;
   - CSS only: `@import`, `javascript:` and `</style>` are stripped; keep it
     under 8000 characters. The `radius`/`width`/`align` values from step 2
     still apply as base rules — custom CSS may override them.
4. **Apply with the `apply_options` MCP tool**, `bubble` object:
   `{ preset: "custom", custom_css: "<css>" }` for custom styles, otherwise
   `{ preset, tint, radius, width, align }`. Nothing else about the appearance
   changes; the style persists across ZCode restarts.
5. **Report** what was applied and offer to fine-tune. The settings panel's
   气泡样式编辑器 (✏️ 编辑样式) previews the current style live and can save it
   into the reusable 我的样式 library.
6. **On a CDP/port error**, the running ZCode lacks the debug port. Tell the
   user to run `node <plugin-root>/bundle/cli.js launch`, then retry.
