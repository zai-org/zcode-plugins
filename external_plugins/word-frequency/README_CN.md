# 词频统计词云

统计文档里出现最多的词，并生成词云图。打开文本、Markdown 文件或整个文件夹，中文按词切分、英文统一小写，自动去掉“的、了、the、and”等停用词，也可以加自己的停用词，还能统计二元、三元词组。不要的词可以去掉，同义词可以合并（“顾客”并到“客户”、“AI”并到“人工智能”），最后导出带分文件统计的词频表、CSV，以及可选形状和配色的词云 SVG 和 PNG。在本地运行，不用登录，无需 API 密钥。

## 功能

- **中英混排**：中文真正按词切分，英文统一大小写；忽略 Markdown 链接、代码块和网址。
- **停用词**：内置中英文停用词，可追加自己的；可设最短词长，可选统计数字。
- **词组**：可选二元、三元词组。
- **整理**：去掉词或合并同义词，改停用词后这些选择仍保留。
- **词云**：矩形、横幅或椭圆，四种配色，部分词竖排，背景色可选。
- **导出**：XLSX（排名 + 分文件统计）、CSV、SVG 和 PNG。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `word-frequency/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “统计 reports 文件夹的词频”
- “把“顾客”合并到“客户”，加停用词“季度””
- “导出词云图”

## 工具

| 工具 | 作用 |
|---|---|
| `wordfreq_open` | 读取文件并统计词频，并打开面板 |
| `wordfreq_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `wordfreq_status` | 查看当前数据、问题和汇总 |
| `wordfreq_export` | 导出 word-frequency.xlsx、word-frequency.csv、wordcloud.svg 和 wordcloud.png |

导出文件写到工作区的 `word-frequency/<项目>/` 文件夹。

## 范围（v0.1）

- 列表保留前 300 个词。
- 读取 .txt 和 .md；Word/PDF 请先转成文本。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `word-frequency/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/word-frequency/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-word-frequency test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：exceljs (MIT), resvg-wasm (MPL-2.0), fontkit (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
