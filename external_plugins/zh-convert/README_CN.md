# 繁简转换

批量把文档在简体和繁体之间转换：台湾或香港字形，也可以同时换成当地用词（软件 → 軟體、鼠标 → 滑鼠，反向也行）。支持 TXT、Markdown、SRT/VTT 字幕和 Word .docx。可以加自定义词条，列出必须保持原样的人名、品牌名，逐行审阅修改，手动改正个别选错的字，再导出转换后的副本和词条清单。使用开源 OpenCC 词典，在本地运行，不上传，无需 API 密钥。

## 功能

- **十种方向**：简体 → 繁体（台湾、香港或 OpenCC 标准）及反向，每种都可选是否换成地区用词。
- **地区用词**：软件/軟體、鼠标/滑鼠、打印机/印表機、网络/網路等 OpenCC 词表里的上千条，按次数列出。
- **自定义词典**：每行 源=目标，优先于内置词典；排除列表里的人名、品牌名保持不变。
- **多种格式**：TXT、Markdown（代码、行内代码和链接地址不动）、SRT/VTT 字幕（时间轴不动）、Word .docx（正文、页眉页脚、脚注，保留文字格式）。
- **先审阅**：每行前后对照，可以跳过或改正；不在词组里的一简多繁字会提示确认。
- **导出副本不覆盖**：转换后的文件单独存放（可同时转换文件名），另附 terms.csv 和 changes.csv。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `zh-convert/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 docs 文件夹转成台湾繁体用词”
- “把这份繁体字幕转成简体”
- “转成繁体，但品牌名“云帆”保持不变”

## 工具

| 工具 | 作用 |
|---|---|
| `zhconv_open` | 读取文件并列出所有会转换的行，并打开面板 |
| `zhconv_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `zhconv_status` | 查看当前数据、问题和汇总 |
| `zhconv_export` | 导出转换后的副本、terms.csv 和 changes.csv |

导出文件写到工作区的 `zh-convert/<项目>/` 文件夹。

## 范围（v0.1）

- UTF-8 文本文件和 Word .docx（不支持 .doc）；不转换 PDF 和图片。
- 基于词典的转换，准确率很高但不是百分之百，请检查提示的行。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `zh-convert/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/zh-convert/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-zh-convert test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：opencc-js (MIT; OpenCC dictionaries Apache-2.0), fflate (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
