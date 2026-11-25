# Changelog

## 0.11.0

- Replaced the footer's fixed "每 10 秒自动刷新" text with a refresh-frequency dropdown: 5 / 10 / 30 / 60 seconds, default 10 seconds.
- The dropdown opens upward from the footer button, marks the active interval, and persists the choice in `localStorage["turnlens.pollMs"]`.
- Added a 统计频率 label before the refresh button.
- Tightened the panel section gap to 11px, gave the footer a 5px bottom inset, and restored a comfortable 24px refresh button height, so the control is neither clipped nor cramped at 1000px height.
- The footer status area now only appears for transient states and errors, so the refresh control stays compact.

## 0.10.3

- Increased the column-popover hint's info icon from 13px to 15px.
- Extended the summary card language to the rest of the panel: the four metric rows, the time-share section, the turns table, and the setting card are now borderless rounded cards with a softer section shadow.
- Added a slightly lighter `--surface` color in dark and contrast themes so section cards remain distinguishable from the page without relying on borders.

## 0.10.2

- Added a soft card shadow to the two borderless summary cards, with stronger values for dark and contrast themes.
- Added an info icon before "拖动表头边界可调整列宽" in the column popover.
- Detected promoted guided inputs (`session_input.delivery = 'guide'`): a guided turn keeps one row, gets a 引导 badge, and its user-input estimate now includes the guided message text.
- The model-time tooltip now explains that model time is the union of all main-turn request intervals and, for guided turns, also shows ZCode's latest segment work time (`lastSegmentMs`). This explains why turn 19 shows 22分10秒 here while ZCode's segment shows 19分14秒.
- Let the status badge row wrap so 当前 / 压缩 / 引导 can coexist at the default 70px width.

## 0.10.1

- Removed the borders from both summary cards; the panel's outer scrollbar is gone and only the turn table scrolls.
- Increased the summary typography: the meta line, card labels, values, and input/output/cache lines are larger, with more room around the split and progress bars.
- Replaced the cache card's redundant input total with uncached reads; the tooltip now lists cache reads, uncached reads, and the uncached formula.
- Fixed per-turn cache hit-rate colors not applying to string rates.
- Merged each table cell's tooltip into one bullet list; child lines no longer have their own tooltips, and every tooltip uses 万/亿 for large token values.
- Added more padding to the 当前 and 压缩 badges.
- Widened the column popover to 312px, halved its vertical padding, made all of its text 13px, and gave "恢复默认列宽" a warning color; the 列设置 button is now 14px.
- Alignment now applies to 轮次 and 状态 as well, with left as the default.
- Thickened the column-resize indicator to 2px and reduced the logo to 42px.

## 0.10.0

- Replaced the hero and five summary cards with a compact meta line and two large cards: total consumed tokens (input/output split) and average cache hit rate (progress bar). Main-turn requests moved into the meta line; input/output/requests cards were removed.
- Added a 压缩 badge for turns whose context delta is negative, on the same badge row as 当前.
- Reduced the bottom single-turn card's vertical padding to 2px.
- Made every column, including 轮次 and 状态, toggleable in 列设置; all columns default to equal 70px widths.
- Added left/center/right alignment for data columns; 轮次 and 状态 stay left-aligned.
- Added draggable header boundaries for column widths with localStorage persistence and a reset button.
- Finished the paired-header design D: muted second line, no separator.
- Added graded colors to per-turn cache hit rate.
- Replaced native tooltip list markers with contained custom dots; left and right padding now match, and every multi-line tooltip is rendered as a bullet list.

## 0.9.0

- Added two summary cards: cumulative consumed tokens (input + output) and average cache hit rate (session cache-read tokens ÷ session input tokens).
- Each summary card now has exactly one tooltip; multi-point content is merged into a bullet list.
- Tooltips use hanging-indent bullets with a smaller left inset; parentheses were removed from tooltip copy.
- Left-aligned the turn column.
- Header labels no longer wrap; column widths follow the header text, and the table scrolls horizontally when the pane is narrower than 625px (8 columns) or 558px (7 columns).
- Replaced the dashed paired-header separator with a muted second header line by default.

## 0.8.0

- Added per-turn context length (peak model input), context delta versus the previous turn, and cache hit rate.
- Context length and delta share one column; cache hit rate is a second line under the turn number.
- When no context delta is available, context length is merged into the user-input column instead.
- Renamed headers: 工具步数 / 模型用时 / 模型输入 / 模型输出 / 模型请求次数 / 工具请求错误.
- Paired headers now use distinct labels with a dashed separator and bullet-style tooltips.
- Turn and status columns are narrower to make room for the new data.
- Reduced the vertical margins around the footer timestamp and refresh note.

## 0.7.0

- Restored a colored halo on every turn-status dot (green/blue/red/orange).
- All seven turns-table columns, including 轮次, now share equal width; the status dot is part of the status cell.
- Added a theme button right of refresh with four modes: follow ZCode, white light, dark, and high-contrast dark. The choice is remembered locally.
- The panel title follows the host locale: 会话统计 in Chinese, Session Stats in English; the bilingual title is gone.
- Fixed the top four summary rows being clipped when the side pane is short: fixed sections no longer flex-shrink, and the panel scrolls if needed.
- Moved tooltips onto the panel's active theme variables so they match every theme mode.

## 0.6.0

- Renamed the plugin to **TurnLens** (`turn-lens`) and added a bilingual README.
- Fixed light-theme colors: the accent is now a real blue instead of ZCode's near-black `--color-text-info`; the hero bar uses the same background as the page body.
- Added a separate **用户输入** column to the turns table; the input/output column now shows model context input plus output.
- Added thousands separators to compact and exact numbers (for example `2,801.93万`, `1,234,567`).
- Header font size now matches the table body; tooltips are left-aligned and larger; the status dot no longer has a halo.
- Long metric labels can wrap instead of being clipped.
- Removed the time-share bar from the single-turn card and added a mini-card illustration to the panel's bottom setting card.
- The **单轮统计卡** switch is now a global preference shared by the panel and the Stop hook, so disabling it actually stops cards in every session.
- Fixed the Stop hook missing workspace opt-out markers when its cwd was a subdirectory.

## 0.5.0

- Panel and tooltip now follow the ZCode theme (background, text, border, accent, speed colors, scrollbar).
- Turns table uses equal-width data columns; the status badge wraps below the status text.
- Added per-turn TTFT/TPS, user-input token estimate, output tokens, requests, and tool errors.
- Added a 万/亿 number format (max 2 decimals, no thousands separators) across the panel and card.
- Replaced native hover tooltips with a custom bubble; long explanations break into short lines.
- The single-turn card includes a model/tool time bar and an estimated user-input row.
- Added author/contact metadata, MIT license file, privacy notes, and publishing material.

## 0.4.0

- Added per-turn TTFT/TPS, input/output tokens, requests, and tool errors to the turns table.
- Added 5-level speed colors, custom tooltips, styled scrollbars, and a wrapped current badge.
- Added `preferredDisplayMode: "fullscreen"` so the panel opens in the side pane.
- Panel HTML is re-read on each request; the panel reloads when the plugin version changes.
- Added hot panel reload support and versioned installation.

## 0.3.0

- Added the MCP Apps side panel with live polling.
- Added session totals, time-share bar, per-turn list, and the single-turn card switch.
- Added the `open_session_stats` tool and `/session-stats-panel` command.

## 0.2.0

- Added the automatic single-turn card via a Stop hook.
- Added the panel switch and local opt-out markers.

## 0.1.0

- Initial session statistics card and `/session-stats` command.
