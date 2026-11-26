---
name: docx-to-markdown
description: 把 Word 文档转成干净的 Markdown，放进笔记软件、知识库、静态网站或 Git 仓库：标题、粗体斜体、列表（含多级）、表格、链接、引用和代码都会保留，文档里的图片会存到图片文件夹，并用相对路径正确链接。可以一次转换多个文件，输出文件名可改。在本地运行，不上传文件，无需 API 密钥。 用户提到“Word 转 Markdown / docx 转 md / 把 Word 导入笔记 / 文档转 Markdown / 提取 Word 图片”时使用。
---

# Word 转 Markdown

1. `docx2md_open(inputs, settings?, project?)`：读取 Word 文件并预览转换后的 Markdown。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings: {headings: "auto", mediaFolder: "{name}_images", frontMatter: false, underline: false}；headings 可为 auto/keep/shift。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `docx2md_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个 Word 文件：`set: [{row, values: {include, out}}]`。
4. `docx2md_export(project, formats?)`：导出每个文件的 <名称>.md 和图片文件夹 <名称>_images/。把文件路径告诉用户。
5. warn 会说明哪些内容没法转换（比如不常见的图片格式），要告诉用户。
