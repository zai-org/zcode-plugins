# 长音频切分

把长录音切成多段：讲座按章节、播客按段落、现场录音按歌曲。打开音频（或视频的声音），可以按停顿自动切、按固定时长切，或者按章节表里的时间切；再给一份只有标题的清单，就按顺序给每段命名。太短的片段会并到相邻段，太长的会在最长的停顿处再切一刀。每个切点都能改，可以改名或跳过某段，最后导出带序号的音频文件（不重新编码直接复制，或转成 MP3、M4A、WAV，并写入标题、音轨号、专辑标签）、分段清单 CSV、YouTube 章节时间戳和 CUE 文件。在本地用 ffmpeg 运行，不用登录，无需 API 密钥。

## 功能

- **三种切法**：按静音（阈值和最短停顿）、按固定时长、按章节表时间。
- **合理分段**：太短的合并，太长的在最长停顿处再切，首尾静音可去掉。
- **标题**来自纯标题清单或带时间的章节表；文件名按 {n}、{title}、{album} 模板生成。
- **检查**：时间格式错误或重叠、文件名重复、标题数和段数不符。
- **输出**：无损复制，或转 MP3/M4A/WAV，写入标题、音轨号、专辑、作者标签。
- **清单**：tracks.csv、YouTube 章节 chapters.txt 和 CUE 文件。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `audio-splitter/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 茶艺讲座.mp3 按停顿切开，用 章节.txt 命名”
- “第 3 段从 00:30 开始，最后一段改名“问答””
- “导出音频和章节清单”

## 工具

| 工具 | 作用 |
|---|---|
| `split_open` | 找出录音的切分点，并打开面板 |
| `split_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `split_status` | 查看当前数据、问题和汇总 |
| `split_export` | 导出 tracks/序号 标题.扩展名、tracks.csv、chapters.txt 和 album.cue |

导出文件写到工作区的 `audio-splitter/<项目>/` 文件夹。

## 范围（v0.1）

- 需要安装 ffmpeg（免费；macOS：brew install ffmpeg；Windows：winget install ffmpeg）。
- 原格式复制按最近的音频帧切；需要精确到采样点请选择重新编码格式。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `audio-splitter/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/audio-splitter/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-audio-splitter test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
