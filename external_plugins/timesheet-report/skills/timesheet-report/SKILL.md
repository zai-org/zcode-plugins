---
name: timesheet-report
description: 把工时记录整理成给客户的结算单：打开计时工具导出的 CSV / Excel 或自己记的表格，按客户、项目和成员汇总工时，套用小时费率和取整规则，内部工作不计费，并提示重复记录、时间段重叠和没有费率的条目。导出 Excel 汇总和每个客户一份结算单 PDF，可以和发票一起发。在本地运行，不上传，无需 API 密钥。 用户提到“工时统计 / 工时表 / 计费工时 / 按客户结算 / 时薪结算单”时使用。
---

# 工时统计

1. `timesheet_open(inputs, settings?, project?)`：读取工时记录并按客户和项目汇总。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 可以传多个工时文件或文件夹；费率在 settings.rates 里按行写；用 settings.from / to 限定结算期间。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `timesheet_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改为不计费：`set: [{row, values: {billable: false}}]`；单条费率：`values: {rate: 500}`；删除重复：`remove: [行号]`。
4. `timesheet_export(project, formats?)`：导出 timesheet.xlsx、每个客户的结算单 PDF 和 summary.csv。把文件路径告诉用户。
5. 取整按每条记录进行（settings.rounding）；结算单编号 = 前缀 + 年月 + 序号。
