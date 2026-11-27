# 双语句对齐

把原文和译文逐句对齐，做成翻译记忆。选择原文和译文（文本、Markdown 或 Word），两边自动分句，再用成熟的按长度对齐算法加上数字锚点对齐，一句译成两句、两句并成一句也能对上。需要人工看一眼的行会标出来：找不到对应的句子、长度比例异常，以及两边数字不一致（常常就是真正的翻译错误）。可以改文字、合并或删除行，最后导出 Excel、Trados/memoQ/OmegaT 用的 TMX、制表符文本和左右对照 HTML。在本地运行，不用登录，无需 API 密钥。

## 功能

- **读取 .txt、.md 和 .docx**（正文段落）。
- **中英文分句**：处理引号、缩写（Dr.、e.g.）和小数。
- **Gale–Church 对齐**加数字锚点；支持 1-1、1-2、2-1、2-2 和无对应句；段落数相同时先按段落对齐。
- **质检**：无对应句、长度比例异常、数字不一致。
- **编辑**：改任一侧文字、与下一行合并、删除或新增行。
- **导出**：XLSX、TMX 1.4、TSV 和左右对照 HTML。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `bilingual-aligner/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 隐私政策.txt 和 privacy-policy-en.docx 逐句对齐”
- “修正数字不一致的那句，把标题和第一句合并”
- “导出 TMX”

## 工具

| 工具 | 作用 |
|---|---|
| `align_open` | 两边分句并对齐，并打开面板 |
| `align_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `align_status` | 查看当前数据、问题和汇总 |
| `align_export` | 导出 aligned.xlsx、aligned.tmx、aligned.tsv 和 aligned.html |

导出文件写到工作区的 `bilingual-aligner/<项目>/` 文件夹。

## 范围（v0.1）

- 一个项目对齐两个文件；多组文件请分别建项目。
- v0.1 不读取 .docx 里的表格、脚注和文本框。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `bilingual-aligner/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/bilingual-aligner/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-bilingual-aligner test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：exceljs (MIT), fflate (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
