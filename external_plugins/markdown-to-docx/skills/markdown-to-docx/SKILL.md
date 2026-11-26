---
name: markdown-to-docx
description: 把 Markdown 笔记和文档转成同事能直接打开、编辑的 Word 文档：标题变成 Word 的标题样式（导航窗格和目录都能用），列表、表格、代码块、引用、链接和本地图片都会保留。中文和英文字体可以分开设置，可加目录和页码，可以逐个转换，也可以合并成一个文档。在本地运行，不用在线转换服务，无需 API 密钥。 用户提到“Markdown 转 Word / md 转 docx / 把笔记转成 Word / 生成 Word 文档 / 合并 md 文件”时使用。
---

# Markdown 转 Word

1. `md2docx_open(inputs, settings?, project?)`：读取 Markdown 文件并预览每个文档的大纲。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings: {toc: true, cjk: "SimSun", latin: "Times New Roman", size: 12, merge: false}；cjk 可为 Microsoft YaHei/SimSun/SimHei/KaiTi/PingFang SC/Noto Sans CJK SC。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `md2docx_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个 Markdown 文件：`set: [{row, values: {include, title, out}}]`；合并时用 settings.mergedName 作文件名。
4. `md2docx_export(project, formats?)`：导出每个文件的 <名称>.docx，或合并成一个 .docx。把文件路径告诉用户。
5. 导出结果的 note 会列出找不到的图片，要告诉用户。
