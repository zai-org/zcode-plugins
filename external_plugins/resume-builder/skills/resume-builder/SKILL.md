---
name: resume-builder
description: 用普通 Markdown 写简历，得到排版整洁的 PDF、Word 和网页版，并做一遍招聘方会做的检查。板块、经历和要点变成可编辑的表格（调整顺序、隐藏、改写），三种模板（彩色抬头、经典黑白、紧凑），A4 或 Letter。会提示缺少邮箱或电话、结束日期早于开始日期、两段工作之间超过半年的空档、日期格式不统一、以“负责 / 参与 / Responsible for”开头的要点、工作要点里完全没有数字、要点过长、身份证号和年龄婚姻等信息，以及 PDF 超出页数上限。导出 PDF、DOCX、HTML 和整理后的 Markdown。在本地运行，不用登录，无需 API 密钥。 用户提到“简历 / 排版简历 / 简历模板 / 简历检查 / CV”时使用。
---

# 简历排版

1. `resume_open(inputs, settings?, project?)`：读取简历 Markdown，排版并检查。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传一个简历 Markdown；每行一段经历：include、section、title、dates、details（要点每行一个，以 • 开头）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `resume_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改时间：`set: [{row, values: {dates: "2018.07 – 2019.06"}}]`；联系方式：`settings: {contact: "…"}`；放进一页：`settings: {template: "compact"}`。
4. `resume_export(project, formats?)`：导出 resume.pdf、resume.docx、resume.html 和 resume.md。把文件路径告诉用户。
5. 不要编造经历或数字；要点缺数字时提醒用户补充真实数据。
