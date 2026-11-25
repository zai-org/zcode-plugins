---
name: demo-video-maker
description: 用产品录屏制作演示视频（分段、放大、说明文字、字幕、片头），产品更新时替换某一段。用户提到“产品演示视频 / 录屏做成视频 / demo video / 换掉其中一段”时使用。
---

# 产品演示视频制作

需要用户电脑上有 ffmpeg；找不到时把工具返回的安装提示告诉用户。

1. **打开**：`demo_open(recordings: [...])`（按演示顺序）或 `demo_open(project: "xxx.demovideo.json")`。
2. **编排**：根据用户描述和录屏内容写工程，`demo_save(path, project)`：
   - 每个演示步骤一段（`start`/`end` 剪掉等待和误操作；同一录屏可切多段）。
   - `zooms`：放大到正在操作的控件，`x,y,w,h` 是相对输出画面的 0–1 比例，`w` 一般 0.3–0.5，持续 2–4 秒；位置不确定时先给出估计，并请用户在面板画面上拖框调整。
   - `callouts`：每步一句短说明（≤ 20 字）；`subtitles`：口播或解说文字，每条 ≤ 2 行。
   - `intro`：标题和副标题；`size`：横屏 1920x1080，竖屏 1080x1920。
   - 把 `warnings`（被修正的时间等）告诉用户。
3. **渲染**：`demo_render(path)` → MP4 + SRT。告诉用户文件位置、时长，以及哪些段重新渲染、哪些复用了缓存。
4. **产品更新**：`demo_replace_segment(path, segment, source, start?, end?, clear?)`，再 `demo_render`。新录屏时长不同时，提醒用户检查该段的放大和说明时间。
