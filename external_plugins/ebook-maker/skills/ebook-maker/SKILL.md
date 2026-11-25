---
name: ebook-maker
description: 把文件夹里的 Markdown 章节 + 图片 + 封面做成 EPUB 3 和 PDF（目录页码、脚注、书签），并检查漏图、坏链接、脚注和书籍信息。用户提到“电子书 / EPUB / 把书稿排成 PDF / 出书 / 检查书稿”时使用。
---

# 电子书制作

1. 书稿约定：一章一个 `.md` 文件，开头是 `# 章标题`；图片路径相对章节文件；脚注写 `[^1]`，定义写 `[^1]: 内容`；章节之间链接写 `[文字](02-xxx.md#标题)`。
   - 没有 book.json 时按文件名排序（`01-`、`02-` 前缀），README.md 不算章节。
2. `ebook_open(dir)`：列出章节和检查结果，打开面板。
   - 错误（✗）：漏图、坏的内部链接或锚点、未定义的脚注、封面不存在。
   - 提醒（!）：未使用的脚注、GIF/SVG/WebP 只进 EPUB、缺书名/作者/封面。
   - 先把错误告诉用户，能改的直接改 Markdown（例如修正图片路径），再重新 `ebook_open`。
3. `ebook_save(dir, meta?, chapters?)`：书名、副标题、作者、语言（如 zh-CN、zh-Hant、en）、出版方、日期、简介、封面（JPEG/PNG）、目录深度（1 或 2）、PDF 开本（A5/B6/A4）和字号；`chapters` 是完整的章节顺序。
4. `ebook_check(dir)`：完整问题列表和全部外部链接（发布前让用户确认）。
5. `ebook_export(dir, formats?)`：写到 `<dir>/export/<书名>.epub` 和 `.pdf`，告诉用户路径、大小、页数，以及还没解决的问题。
6. 不支持：多栏、浮动图文混排、Kindle 专有格式（KF8/AZW3）、数学公式排版。PDF 需要系统里的中文字体（macOS、Windows 自带）。
