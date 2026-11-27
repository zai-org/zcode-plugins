---
name: outline-mindmap
description: 把现成的笔记一键变成思维导图。打开 Markdown 大纲（标题加多级列表）、缩进文本或 OPML 文件，自动排出中心主题、主分支和子主题，可以左右展开或只向右展开，每个分支一种颜色。可以改节点文字或层级、隐藏节点、新增节点、给分支换颜色，然后导出清晰的 SVG 和 PNG，以及能在其他思维导图软件里继续编辑的 OPML 和 FreeMind（.mm）文件，还有整理后的 Markdown 大纲。在本地运行，不用登录，无需 API 密钥。 用户提到“思维导图 / 脑图 / 大纲转导图 / 把笔记做成导图 / OPML”时使用。
---

# 大纲转思维导图

1. `mindmap_open(inputs, settings?, project?)`：读取大纲并排出思维导图。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传 .md / .txt / .opml；每行一个节点，level 0 是中心主题，1 是主分支，2 以上是子主题，顺序就是大纲顺序。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `mindmap_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改文字：`set: [{row, values: {text: "…"}}]`；隐藏：`values: {include: false}`；新分支加在末尾：`add: [{level: 1, text: "风险"}, {level: 2, text: "…"}]`；分支颜色：在 level 1 的行写 `color`。
4. `mindmap_export(project, formats?)`：导出 mindmap.svg、mindmap.png、mindmap.opml、mindmap.mm 和 outline.md。把文件路径告诉用户。
5. 节点很多时只简述主分支，不要逐条念。
