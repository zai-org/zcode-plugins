---
name: timetable-builder
description: 把每个班需要的课——科目、任课教师、每周课时、共用场地、固定时段、连堂——排成不冲突的班级课表和教师课表。教师限制（周三下午教研、周一前两节不排……）和场地容量（操场可同时上两个班、机房一个班）可以写在附加工作表或设置里。排课时班级、教师、场地都不会重复占用，固定课（如 班会 周五7）不动，连堂排在一起，同一科目尽量分散到一周各天，主科尽量排上午，避免某位老师一天课太满；排不下时会说明原因。改教师、课时或固定时段后课表自动重排。导出含总表、每班和每位教师课表的 Excel，以及按科目着色、横版可打印张贴的 PDF。不用登录，无需 API 密钥，本机运行。 用户提到“排课 / 课程表 / 教师课表 / 课表冲突”时使用。
---

# 排课表

1. `timetable_open(inputs, settings?, project?)`：读取课程需求并排课。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传课程需求 .xlsx/.csv；每行一个班级×科目：cls、subject、teacher、hours、room、fixed、double；_placed/_slots 显示排在哪里。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `timetable_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改固定时段：`set: [{row, values: {fixed: "周一2"}}]`；加教师限制：`settings: {avoid: "赵强: 周三下午\n何伟: 周五下午"}`；改课时：`values: {hours: 4}`。
4. `timetable_export(project, formats?)`：导出 timetables.xlsx 和 timetables.pdf。把文件路径告诉用户。
5. 固定时段冲突时，先告诉用户冲突在哪，再按用户意思改。
