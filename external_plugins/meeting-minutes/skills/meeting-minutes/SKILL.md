---
name: meeting-minutes
description: 把零散的会议笔记或逐字稿整理成规范的会议纪要：识别日期、参会人、议程、决定、待定问题和行动项，找出每个行动项的负责人和截止日期（“周五前”“下周一”“by Friday”等按会议日期换算），没有负责人或截止日期的会提示出来。在表格里修改后，导出 Word 纪要、Markdown 和日历文件（每个截止日期一条提醒）。在本地运行，不上传，无需 API 密钥。 用户提到“会议纪要 / 会议记录整理 / 行动项 / 待办负责人 / 截止日期提醒”时使用。
---

# 会议纪要整理

1. `minutes_open(inputs, settings?, project?)`：读取会议记录，分成议程、决定、行动项和问题。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 多个文件会合并成一次会议；会议日期没识别出来时，在 settings.date 里填写，相对日期会重新计算。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `minutes_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改负责人和日期：`set: [{row, values: {owner: "李娜", due: "2026-11-24"}}]`；新增行动项：`add: [{kind: "action", text, owner, due}]`；改类型：`values: {kind: "decision"}`。
4. `minutes_export(project, formats?)`：导出 minutes.docx、minutes.md、actions.ics 和 actions.csv。把文件路径告诉用户。
5. actions.ics 默认是全天事件；settings.icsTime 填 09:00 会变成带 15 分钟提醒的定时事件。
