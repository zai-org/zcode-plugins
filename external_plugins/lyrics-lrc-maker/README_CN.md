# 歌词时间轴

给歌词打时间轴，导出 LRC 和 SRT。选择歌词（纯文本每行一句，或者已有的 LRC 重新打轴）和歌曲，自动从音频里找出唱的段落，再按每句的长度对上去，一句跨两口气、几句短词挤在一段里也能对准。每一句的时间都能直接改，也可以整体偏移，加上歌名、歌手标签，导出标准 LRC、卡拉 OK 播放器用的逐字 LRC 和剪辑软件用的 SRT 字幕。没有音频时按固定间隔排好，再手动微调。在本地用 ffmpeg 运行，不用登录，无需 API 密钥。

## 功能

- **自动打轴**：从音频响度找出演唱段落，按长度匹配歌词（一句跨多段或多句共一段）。
- **重新打轴已有 LRC**，支持一行多个时间标签。
- **微调和整体偏移**：直接改开始/结束时间，或按毫秒整体偏移。
- **检查**：时间倒序、缺失或格式错误、超出歌曲时长。
- **标签**：歌名、歌手、专辑、制作人、时长。
- **导出**：LRC、逐字 LRC 和 SRT。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `lyrics-lrc-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 晚风茶馆.mp3 给 晚风茶馆.txt 打时间轴”
- ““一盏灯光”改到 00:23.40，整体延后 200 毫秒”
- “导出 LRC 和 SRT”

## 工具

| 工具 | 作用 |
|---|---|
| `lrc_open` | 读取歌词并按歌曲打轴，并打开面板 |
| `lrc_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `lrc_status` | 查看当前数据、问题和汇总 |
| `lrc_export` | 导出 <歌名>.lrc、<歌名>.enhanced.lrc 和 <歌名>.srt |

导出文件写到工作区的 `lyrics-lrc-maker/<项目>/` 文件夹。

## 范围（v0.1）

- 处理音频需要安装 ffmpeg（免费；macOS：brew install ffmpeg；Windows：winget install ffmpeg）。
- 时间按响度估计而不是语音识别：伴奏很响的歌需要多微调。v0.1 面板里不能播放音频。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `lyrics-lrc-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/lyrics-lrc-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-lyrics-lrc-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
