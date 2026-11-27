# 视频批量压缩

把一整个文件夹的视频压小，方便分享、上传或存档。每个文件可以选画质方案或指定大小，限制最大分辨率，决定声音怎么处理，开始前就能看到预计大小。每个视频都会转成到处都能播放、可以边下边播的 H.264 MP4；如果压不小就保留原文件。报告里列出压缩前后的大小。使用电脑上已安装的免费 ffmpeg，不上传，无需 API 密钥。

## 功能

- **方案**：高画质（CRF 20）、均衡（CRF 23）、小体积（CRF 28），或两遍编码压到指定大小。
- **逐个设置**：每行可以改方案、目标大小、最大高度、音频和文件名；留空用默认值。
- **限制分辨率**：2160p 到 360p，只缩小不放大。
- **音频**：AAC 64–160 kbps、保持原样或去掉。
- **安全**：原文件不动；压不小的直接保留原文件；目标太小会提醒。
- **报告**：CSV 里列出每个文件压缩前后大小、节省比例和耗时。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `video-compressor/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 videos 文件夹里的视频都压到 720p”
- “把 demo.mov 压到 25MB 以内好发邮件”
- “压缩这些录屏，声音保持原样”

## 工具

| 工具 | 作用 |
|---|---|
| `vcompress_open` | 读取视频信息并估算压缩后大小，并打开面板 |
| `vcompress_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `vcompress_status` | 查看当前数据、问题和汇总 |
| `vcompress_export` | 逐个压缩成 MP4 并生成 compress-report.csv |

导出文件写到工作区的 `video-compressor/<项目>/` 文件夹。

## 范围（v0.1）

- 需要先安装免费的 ffmpeg（macOS：brew install ffmpeg；Windows：winget install ffmpeg）。
- 输出 H.264/AAC 的 MP4；不裁剪、不加字幕，不输出 HEVC/AV1。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `video-compressor/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/video-compressor/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-video-compressor test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：Uses the user's installed ffmpeg (LGPL/GPL, not bundled)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
