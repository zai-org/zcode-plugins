---
name: font-subsetter
description: 把网页字体裁到只剩网站真正用到的字——一个 10–20 MB 的中文字体通常只剩几十 KB。选择网站或项目文件夹：自动找到字体（.ttf、.otf、.ttc、.woff、.woff2）和页面文件（HTML、Vue/Svelte、JS/TS、CSS、Markdown、JSON、YAML、字幕等），收集真正会显示的字（代码注释和 HTML 标记不算），用 HarfBuzz 裁剪每个字体，保留 OpenType 特性和可变字体轴。标题字体可以只保留标题里的字。会提示字体里缺的字（带文件和行号）、许可标记禁止嵌入的字体、裁完仍然偏大的字体。导出 WOFF2/WOFF（可选 TTF/OTF）、可直接引用的 fonts.css、chars.txt、体积报告，以及用裁好的字体本身画出的预览图。在本地运行，不用登录，无需 API 密钥。 用户提到“字体子集 / 字体瘦身 / 字体压缩 / 网页字体太大 / fontmin / woff2”时使用。
---

# 网页字体瘦身

1. `fontsub_open(inputs, settings?, project?)`：找到字体和页面，收集用到的字并裁剪每个字体。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传网站或项目文件夹（字体和页面在里面）；也可以传字体文件加页面文件。
   - 每行一个字体（.ttc 每个字重一行）：include、family（CSS 名）、weight、style、use（all/headings/extra）、extra、output。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `fontsub_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 标题字体：`set: [{row, values: {use: "headings"}}]`；不要某个字体：`values: {include: false}`；补字：`settings: {extra: "…"}` 或行的 extra。
   - 只要 WOFF2：`settings: {formats: "woff2"}`。
4. `fontsub_export(project, formats?)`：导出 <名称>.woff2/.woff、fonts.css、chars.txt、report.md 和 preview.png。把文件路径告诉用户。
5. 有缺字时告诉用户是哪些字、在哪个文件哪一行，建议换字体或加回退字体，不要自己删掉文字。
6. 提到许可标记禁止嵌入时提醒用户确认字体授权。
