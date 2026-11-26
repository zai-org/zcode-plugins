# Word 转 Markdown

把 Word 文档转成干净的 Markdown，放进笔记软件、知识库、静态网站或 Git 仓库：标题、粗体斜体、列表（含多级）、表格、链接、引用和代码都会保留，文档里的图片会存到图片文件夹，并用相对路径正确链接。可以一次转换多个文件，输出文件名可改。在本地运行，不上传文件，无需 API 密钥。

## 功能

- **按样式识别结构**：标题 1–6（也认大纲级别和中文样式名），文档标题作为唯一的一级标题，引用样式转成引用块，目录域和隐藏文字自动跳过。
- **列表保持层次**：按 Word 编号或列表样式识别无序、有序列表，多级缩进正确。
- **表格**：转成 GFM 表格，合并单元格展开，换行写成 <br>，竖线自动转义。
- **图片**：图片提取到图片文件夹（文件夹名可设置），用 URL 编码的相对路径和图片说明引用。
- **行内格式干净**：粗体、斜体、删除线、链接、行内代码，以及按等宽字体或代码样式识别的代码块；正文里的 Markdown 符号会转义。可选保留 <u> 下划线和 YAML 头。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `docx-to-markdown/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 员工手册.docx 转成 Markdown”
- “把 资料 文件夹里的 Word 都转成 md，并加 YAML 标题”
- “标题层级保持和 Word 一样”

## 工具

| 工具 | 作用 |
|---|---|
| `docx2md_open` | 读取 Word 文件并预览转换后的 Markdown，并打开面板 |
| `docx2md_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `docx2md_status` | 查看当前数据、问题和汇总 |
| `docx2md_export` | 导出每个文件的 <名称>.md 和图片文件夹 <名称>_images/ |

导出文件写到工作区的 `docx-to-markdown/<项目>/` 文件夹。

## 范围（v0.1）

- 只支持 .docx，旧的 .doc 请先另存为 .docx。
- v0.1 不转换批注、脚注、修订中删除的内容、文本框和公式。
- 颜色、字体和页面版式会有意去掉——Markdown 本身不支持这些。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `docx-to-markdown/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/docx-to-markdown/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-docx-to-markdown test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：fflate (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
