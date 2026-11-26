# Markdown 转 Word

把 Markdown 笔记和文档转成同事能直接打开、编辑的 Word 文档：标题变成 Word 的标题样式（导航窗格和目录都能用），列表、表格、代码块、引用、链接和本地图片都会保留。中文和英文字体可以分开设置，可加目录和页码，可以逐个转换，也可以合并成一个文档。在本地运行，不用在线转换服务，无需 API 密钥。

## 功能

- **真正的 Word 样式**：标题 1–4、引用、代码、题注、列表段落，导航窗格、大纲视图和目录都能用，一键就能换整篇样式。
- **内容完整保留**：粗体、斜体、删除线、行内代码、链接，无序、有序、多级和任务列表，GFM 表格（表头底色、列对齐、跨页重复表头），代码块、引用和分隔线。
- **本地图片**：.md 旁边的 PNG、JPEG 会嵌入文档并缩放到页宽，图片说明作为题注。
- **字体与版式**：中文字体（微软雅黑、宋体、黑体、楷体……）和英文字体分开设置，正文字号、A4 或 Letter、页边距、页脚页码，可选目录。
- **合并或逐个转换**：多个文件合并成一个文档，每个文件从新页开始；也可以给每个文件单独设标题和输出文件名。写 `<!-- pagebreak -->` 可以强制分页。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `markdown-to-docx/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 产品说明书.md 转成 Word，开头加目录”
- “中文用宋体，正文 12 号”
- “把 docs 里的 md 文件合并成一个 Word 文档”

## 工具

| 工具 | 作用 |
|---|---|
| `md2docx_open` | 读取 Markdown 文件并预览每个文档的大纲，并打开面板 |
| `md2docx_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `md2docx_status` | 查看当前数据、问题和汇总 |
| `md2docx_export` | 导出每个文件的 <名称>.docx，或合并成一个 .docx |

导出文件写到工作区的 `markdown-to-docx/<项目>/` 文件夹。

## 范围（v0.1）

- 不下载网络图片（http 链接），请先把图片保存到 .md 文件旁边。
- 目录是 Word 域：打开文件时 Word 会填充（或右键 → 更新域）。
- v0.1 不支持数学公式、脚注和 Mermaid 图；原始 HTML 只保留文字。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `markdown-to-docx/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/markdown-to-docx/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-markdown-to-docx test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：fflate (MIT), marked (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
