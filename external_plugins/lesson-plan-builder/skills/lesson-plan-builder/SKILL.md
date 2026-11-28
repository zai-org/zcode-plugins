---
name: lesson-plan-builder
description: 用简单的 Markdown 写教案，得到格式规范、可打印的 Word 和 PDF 教案——并检查评课时常被扣分的地方。每课包含基本信息（学科、年级、教材、课时）、教学目标、重难点、教学准备、教学过程（环节标题下写 教师/学生/设计意图，或表格，或一行一个带分钟数的环节）、板书设计和作业。可在表格里改任何条目和环节，增加环节或作业，设置授课人、日期和上课时间（每个环节自动标出起止时刻）。会检查环节时间加起来是否等于课时，标出用“了解/理解/掌握”等模糊动词、没有可观察结果的目标，教师连续讲授很久却没有学生活动的环节，环节里用到但教学准备里没列的教具，以及缺少目标、重难点或作业。整个单元导出为一份文档——每课一页，教学过程做成 环节/时间/教师活动/学生活动/设计意图 表格，可留教学反思空行——Word、PDF 和 Markdown。不用登录，无需 API 密钥，本机运行。 用户提到“教案 / 备课 / 教学设计 / 导出 Word 教案”时使用。
---

# 教案制作

1. `lesson_open(inputs, settings?, project?)`：读取教案文件并检查。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传教案 .md 文件或文件夹；每行一个条目：lesson、kind（目标/重难点/准备/环节/板书/作业/反思）、content、minutes、teacher、students、intent。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `lesson_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改时间：`set: [{row, values: {minutes: 12}}]`；补作业：`add: [{lesson: "…", kind: "作业", content: "…"}]`；补学生活动：`values: {students: "…"}`。
4. `lesson_export(project, formats?)`：导出 lesson-plans.docx、lesson-plans.pdf 和 lesson-plans.md。把文件路径告诉用户。
5. 改教学内容前先和用户确认；时间超出时优先缩短讲授环节。
