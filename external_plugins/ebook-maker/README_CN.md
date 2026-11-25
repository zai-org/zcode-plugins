# 电子书制作

把一个文件夹里的 Markdown 章节做成 EPUB 电子书和可以直接打印的 PDF，发布前先检查一遍。

## 功能

- **输入**：一个文件夹，每章一个 Markdown 文件，另有图片和封面。
  - 章节按文件名排序（`01-…`、`02-…`），或按 `book.json` 里保存的顺序。
  - 支持标准 Markdown，以及表格、脚注（`[^1]` / `[^1]: …`）、代码块、引用、嵌套列表和章节之间的链接（`02-next.md#标题`）。
- **EPUB 3**：
  - 封面、扉页、导航目录（另附 `toc.ncx`，兼容旧阅读器）、每章一个 XHTML、样式表和图片。
  - 脚注变成每章末尾可点击跳转的注释。
  - 章节之间、标题之间的链接在阅读器里可以点。所有文件都检查是否为合法 XML。
- **PDF**（默认 A5，也可选 B6、A4）：
  - 封面、扉页和带页码的目录。
  - 页眉（书名 / 章名）、页码，每章从新页开始。
  - 脚注排成每章末尾的编号注释。
  - 中文断行（标点不出现在行首），两端对齐；图片按版心缩放。
  - 每章都有书签；目录条目、脚注编号和链接都可以点击。
  - 使用系统中文字体（macOS 的苹方/冬青黑体，Windows 的微软雅黑/黑体，Linux 的 Noto CJK）。
- **检查**：
  - 漏图；章节之间的坏链接和不存在的标题锚点；用了但没定义的脚注，以及定义了没用的脚注。
  - PDF 不能使用的图片格式；缺少书名、作者或封面。
  - 列出全部外部链接，附章节和行号。
- **面板**：
  - 编辑书籍信息：书名、副标题、作者、语言、出版方、日期、简介、封面、目录深度、PDF 开本和字号。
  - 调整章节顺序、预览章节、查看检查结果，导出后逐页查看 PDF。

## 使用方法

在 ZCode Desktop 里对 Agent 说：

- “把 书稿/ 里的章节做成 EPUB 和 PDF”
- “检查书稿里有没有漏图和坏链接，再把所有外部链接列出来”
- “设置书名、作者和封面，把前言放到第一章，然后导出 A5 的 PDF”

## 工具

| 工具 | 用途 |
|---|---|
| `ebook_open` | 读取书稿文件夹，列出章节和问题，打开面板 |
| `ebook_save` | 把书籍信息、章节顺序和 PDF 选项保存到 `book.json` |
| `ebook_check` | 列出每个问题（文件:行号）和全部外部链接 |
| `ebook_export` | 写出 `export/<书名>.epub` 和/或 `.pdf` |

## 范围（v0.1）

- 不做多栏、浮动图文混排和自定义版式模板。
- 不生成 Kindle 专有格式（KF8/AZW3）；多数 Kindle 应用和“发送到 Kindle”都接受 EPUB。
- 不排数学公式。GIF、SVG、WebP 图片只放进 EPUB，PDF 里显示图片说明文字。
- 不下载远程图片（http 链接）。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的书稿文件夹；只在里面写 `book.json` 和 `export/`。没有 hooks。

## 构建与测试（开发者）

- 源码：`ui-plugins/ebook-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-ebook-maker test` 和 `test:e2e`。
- `EBOOK_SAMPLES` 指向示例书稿：魯迅《吶喊》中的三篇和《爱丽丝漫游奇境》前两章，均为公有领域作品。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：marked（MIT）、pdf-lib（MIT）、fontkit（MIT）、fflate（MIT）、fast-xml-parser（MIT）、pdf.js（Apache-2.0，含 CMaps 和标准字体，用于面板里的 PDF 查看）、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
