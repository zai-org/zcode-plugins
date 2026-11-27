# 字数统计

批量统计一整个文件夹的稿件字数（Word、Markdown、纯文本、PDF），按中文编辑和译者的口径：中文字符、中文标点、英文单词分开统计，“字数”合计与 Word 一致。每个文件按标题或“第一章 / Chapter 1”分章，给出阅读时长，还可以按千字单价算稿费。可以排除代码块、表格、参考文献和自定义规则匹配的段落，也可以关掉某个章节。导出 Excel 或 CSV 报告。在本地运行，不上传文件，无需账号或 API 密钥。

## 功能

- **中文口径**：中文字符、中文标点、其他单词分开统计；“字数”为三者之和，与 Word 一致；日文、韩文按字符计。
- **多种格式一起统计**：.docx、.md、.txt 和有文字层的 .pdf，单个文件或整个文件夹。
- **分章**：DOCX 标题样式、Markdown 的 # / ##、文本和 PDF 中的“第一章 / 序章 / Chapter 1”。
- **排除内容**：代码块、表格、标题、“参考文献 / References”之后的部分、匹配文字或 /正则/ 的段落，或关掉任意章节。
- **阅读时长和稿费**：中英文阅读速度可调；按千字、千字符或千个英文单词计费。
- **报告**：Excel 含按章节、按文件和汇总三张表，另附 CSV。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `word-count-report/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “统计 manuscripts 文件夹每章字数”
- “不算参考文献和代码”
- “按千字 120 元算稿费”

## 工具

| 工具 | 作用 |
|---|---|
| `wordcount_open` | 读取文档并按章节统计字数，并打开面板 |
| `wordcount_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `wordcount_status` | 查看当前数据、问题和汇总 |
| `wordcount_export` | 导出 word-count.xlsx 和 word-count.csv |

导出文件写到工作区的 `word-count-report/<项目>/` 文件夹。

## 范围（v0.1）

- 扫描版 PDF 没有文字层，计为 0（不做 OCR）。
- DOCX 的脚注、批注、页眉页脚不计入。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `word-count-report/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/word-count-report/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-word-count-report test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), fflate (MIT), PDF.js (Apache-2.0)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
