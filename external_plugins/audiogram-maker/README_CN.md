# 音频波形视频

把播客或音频片段做成发社交平台的短视频：动态波形、封面图、标题和副标题、进度条，以及烧录进画面的字幕。选择音频，可加封面图和字幕（SRT、LRC，或每行一句的纯文本，按长度自动分配到片段里）。用片段开始/结束从一整期节目里截一段，选方形、竖屏或横屏，设置颜色和波形样式，在表格里改字幕时间；时间倒置、字幕重叠、字幕太长放不下都会在渲染前提示。导出 MP4（H.264 + AAC）、做缩略图用的封面 PNG，以及按片段重新计时的 SRT。在本地用 ffmpeg 运行，不用登录，无需 API 密钥。

## 功能

- **动态波形**：按音频绘制，四种样式，带进度条。
- **封面、标题、副标题**：方形（1080×1080）、竖屏（1080×1920）、横屏（1920×1080）三种版面。
- **字幕**：读取 SRT、LRC 或纯文本，烧录进画面，可选底框、描边或强调色。
- **截取片段**：从整期节目里截一段，片段外的字幕自动跳过，SRT 重新计时。
- **检查**：时间格式错误或倒置、字幕重叠、超过 3 行、片段超过 90 秒、片段结束超出音频。
- **导出**：MP4（H.264 + AAC，淡入淡出）、封面 PNG 和片段 SRT。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `audiogram-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 茶馆夜话-第12期.mp3、cover.jpg 和 字幕.srt 做方形音频视频，截 00:04–00:22”
- “修好第 4 条字幕的结束时间和后面的重叠”
- “导出 MP4 和封面图”

## 工具

| 工具 | 作用 |
|---|---|
| `audiogram_open` | 读取音频、封面和字幕，排好视频版面，并打开面板 |
| `audiogram_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `audiogram_status` | 查看当前数据、问题和汇总 |
| `audiogram_export` | 导出 <标题>.mp4、<标题>-poster.png 和 <标题>.srt |

导出文件写到工作区的 `audiogram-maker/<项目>/` 文件夹。

## 范围（v0.1）

- 需要安装 ffmpeg（免费；macOS：brew install ffmpeg；Windows：winget install ffmpeg）。
- 不会自动语音转写，需要提供 SRT/LRC/文本字幕。v0.1 面板里不能播放，只显示封面帧预览。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `audiogram-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/audiogram-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-audiogram-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
