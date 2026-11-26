---
name: attendance-report
description: 把考勤机或打卡应用导出的原始打卡记录，变成每月的考勤统计。选上导出文件，设置上下班时间、迟到宽限、弹性上班、午休、加班规则、休息日和节假日，就能看到每个人每天的首末次打卡、迟到、早退、缺卡、缺勤和加班。忘打卡的可以直接在表里补，请假、出差也在表里标注，然后导出汇总表和每人一份的明细给本人核对。在本地运行，不用人事系统，无需 API 密钥。 用户提到“考勤统计 / 打卡记录 / 迟到早退 / 加班统计 / 缺卡 / 月度考勤”时使用。
---

# 考勤统计

1. `attend_open(inputs, settings?, project?)`：读取打卡记录并逐日计算。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings: {month: "2026-11", start: "09:00", end: "18:00", grace: 5, elastic: 0, lunch: 60, otAfter: 30, otMin: 30, weekend: "sat-sun", holidays, workdays}；weekend 可为 sat-sun/sun/none。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `attend_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个人的一天：`set: [{row, values: {in: "08:55", out, note: "请假"}}]`；date 不可改。
4. `attend_export(project, formats?)`：导出 attendance-<月份>.xlsx 和 people/<姓名>-<月份>.xlsx。把文件路径告诉用户。
5. 不要替用户编造请假记录；只标注用户明确说过的。
