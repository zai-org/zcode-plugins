---
name: certificate-maker
description: 用一张证书底图（PNG/JPG）和一份名单批量生成可打印的证书、奖状：用带 {列名} 的文字行设置位置、字号、颜色和对齐，名字太长会自动缩小。检查空名字，在面板里修改名单、预览第一张证书，导出合并的 PDF 和每人一份的 PDF。中文使用电脑上已有的字体。在本地运行，无需 API 密钥。 用户提到“做证书 / 奖状 / 荣誉证书 / 结业证书 / 批量生成证书”时使用。
---

# 证书奖状批量

1. `certificate_open(inputs, settings?, project?)`：读取底图和名单并排好文字。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传底图和名单两个文件。默认排版用 {姓名}、{奖项}、{日期}；名单列名不同就先用 status 看列名，再用 edit 改 settings.layout。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `certificate_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - “往下挪一点”就把那一行的纵向% 加 3～5；“字大一点”就把字号加 4～6。改完看预览。
4. `certificate_export(project, formats?)`：导出 certificates.pdf（每人一页）和 each/<文件名>.pdf。把文件路径告诉用户。
