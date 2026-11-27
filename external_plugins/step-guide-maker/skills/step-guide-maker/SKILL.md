---
name: step-guide-maker
description: 把一文件夹截图做成图文步骤教程：带编号的步骤标题和说明、高亮框、敏感信息马赛克、裁剪，导出为单文件 HTML 网页、Markdown（附图片）和 PDF。步骤可以写在截图旁边的 Markdown 文件里（`## 标题`、说明，以及可选的 `框:` / `打码:` / `裁剪:` 百分比坐标），也可以逐行填写。没有写框的步骤，可以自动框出和上一张截图相比变化的区域。会检查重复截图、步骤数和截图数对不上、没有标题的步骤、超出图片的框、没打码的登录页面和太小的截图。在本地运行，不用登录，无需 API 密钥。 用户提到“截图做教程 / 步骤教程 / 操作手册 / 图文教程 / SOP”时使用。
---

# 步骤教程生成

1. `steps_open(inputs, settings?, project?)`：读取截图和步骤说明并一一对应。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传截图文件夹（里面可以有步骤 .md）；每行一步：include、file、title、text、box、blur、crop（百分比 x,y,w,h）。
   - box 留空 = 自动框（变化区域），填 none = 不框。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `steps_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改说明：`set: [{row, values: {title: "…", text: "…"}}]`；去掉重复：`values: {include: false}`；打码：`values: {blur: "37,40,26,7"}`。
4. `steps_export(project, formats?)`：导出 guide.html、guide.md + images/ 和 guide.pdf。把文件路径告诉用户。
5. 看不到截图内容时不要编造坐标；需要框或打码的位置请用户说明，或用自动框。
