---
name: ics-calendar-builder
description: 把活动表格变成 Apple 日历、Google 日历、Outlook 和手机都能导入的日历文件。选上写有标题、日期和时间的表格，就能得到标准的 .ics 文件：时区处理正确（包括夏令时），支持全天和跨多天的活动、提前 15 分钟或 1 天等提醒，以及每周、每两周、每周一三五、工作日、每月、每年等重复规则，可设次数或截止日期。还能给每个活动单独导出 .ics 方便转发，并生成可打印的日程表。在本地运行，不用登录日历账号，无需 API 密钥。 用户提到“生成日历 / ics 文件 / 导入日历 / 表格转日历 / 日程提醒”时使用。
---

# 表格转日历

1. `ics_open(inputs, settings?, project?)`：读取活动表并检查每个活动。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings: {calName, timezone: "Asia/Shanghai", duration: 60, reminder}。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `ics_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个活动：`set: [{row, values: {include, title, date, start, end, endDate, allDay, location, repeat, repeatEnd, reminder, category, desc}}]`；repeat 用“每周二”“工作日”这样的写法，repeatEnd 写“10次”或日期。
4. `ics_export(project, formats?)`：导出 <日历名>.ics、events/*.ics 和 schedule.html。把文件路径告诉用户。
5. 不要猜时区；用户没说时用默认值并告诉用户。
