# 双语字幕合并

把两种语言的字幕（比如中文和英文）按时间合并成一条双语字幕。两种语言断句不同的地方会自动拼在一起，没配上的字幕会单独列出，方便挪动或删掉；导出前可以改任何文字和时间，然后导出双语 SRT、WebVTT，或者上下两种字号颜色的 ASS。在本地运行，不上传，无需 API 密钥。

## 功能

- **按时间配对**：下面一条的每句归到重叠最多的上面那句，重叠比例可调。
- **断句不同也能配**：两句英文对应一句中文时自动拼成一行。
- **上下顺序**：自动把中日韩文字放上面，也可以指定。
- **时间轴**：按上面一条，或者覆盖两条。
- **手动修正**：没配上的会标出来；可以改文字、改时间或删掉。
- **ASS 样式**：两种语言各自字号和颜色；也能导出 SRT 和 WebVTT。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `bilingual-subtitles/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 en.srt 和 zh.srt 合成双语字幕”
- “做一个 ASS：中文在上白色，英文在下黄色”
- “列出没对上的字幕”

## 工具

| 工具 | 作用 |
|---|---|
| `bilingual_open` | 读取两个文件并按时间配对，并打开面板 |
| `bilingual_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `bilingual_status` | 查看当前数据、问题和汇总 |
| `bilingual_export` | 导出双语 SRT、VTT、ASS 和 pairs.csv |

导出文件写到工作区的 `bilingual-subtitles/<项目>/` 文件夹。

## 范围（v0.1）

- 一次两个 UTF-8 字幕文件；不做翻译。
- 只按时间配对，不理解内容。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `bilingual-subtitles/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/bilingual-subtitles/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-bilingual-subtitles test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
