---
name: printable-calendar
description: 打印一份已经写好节假日和你自己安排的日历。生成每月一页、格子够大可以手写的月历，以及一页看全年的年历。可以选一份日期清单——节假日、调休补班、生日、出差、截止日——也可以直接在设置里输入节假日。年份和月份、每周从周一还是周日开始、A4 或 Letter、中英文、周数和主题色都能选。在本地运行，不用设计服务，无需 API 密钥。 用户提到“打印日历 / 月历 / 年历 / 台历 / 日历 PDF”时使用。
---

# 可打印日历

1. `cal_open(inputs, settings?, project?)`：读取事件表（可选）并预览全年。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 可以不选文件：`inputs: []`。settings: {year, startMonth: 1, months: 12, weekStart: "mon", page: "A4", orientation: "auto", lang: "both", title, weekNumbers, holidays}；holidays 写“2027-01-01 元旦, 2027-02-06..2027-02-12 春节”。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `cal_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个日期事项：`set: [{row, values: {include, date, endDate, title, kind: "活动"|"假期"|"补班", color}}]`。
4. `cal_export(project, formats?)`：导出 calendar-<年份>-monthly.pdf 和 calendar-<年份>-year.pdf。把文件路径告诉用户。
5. 不要凭记忆填法定节假日；让用户提供或确认官方安排。
