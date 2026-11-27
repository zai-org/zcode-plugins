# 字幕校对转换

修正跑偏或读不过来的字幕：打开 SRT、WebVTT 或 ASS 文件，整体平移几秒、换算帧率，或者用两个同步点对齐。可以直接改每条字幕的文字和时间，拆开过长的、合并过短的；重叠、读速过快、单行过长和一闪而过的字幕都会按新时间标出来。导出 SRT、VTT、ASS 和检查报告。在本地运行，不上传，无需 API 密钥。

## 功能

- **改时间**：按秒（或时间）整体平移，23.976 / 24 / 25 / 29.97 帧率换算，或者给同步点：一个点平移，两个以上分段拉伸。
- **校对**：逐格改文字和时间；在“|”处、行与行之间或中间附近拆分；与下一条合并；删除。
- **检查**：重叠、读速（每秒字符，中文算 2）、单行宽度、行数和显示过短，带时间轴预览。
- **自动修正重叠**，最小间隔可设。
- **格式互转**：SRT ⇄ WebVTT ⇄ ASS；输入是 ASS 时保留样式，<i>/<b> 会转成 ASS 标签。
- **报告**：所有问题字幕导出成 CSV，方便下一轮校对。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `subtitle-editor/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 episode.srt 整体延后 1.5 秒”
- “把这个 ASS 字幕转成 SRT 和 VTT”
- “检查字幕有没有重叠和读不过来的地方”

## 工具

| 工具 | 作用 |
|---|---|
| `subtitle_open` | 读取字幕并列出每一条，并打开面板 |
| `subtitle_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `subtitle_status` | 查看当前数据、问题和汇总 |
| `subtitle_export` | 导出 SRT、VTT、ASS 和检查报告 |

导出文件写到工作区的 `subtitle-editor/<项目>/` 文件夹。

## 范围（v0.1）

- 一次一个 UTF-8 字幕文件；不预览视频，不做语音识别。
- ASS 的特效标签只在未改动的字幕上保留。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `subtitle-editor/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/subtitle-editor/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-subtitle-editor test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
