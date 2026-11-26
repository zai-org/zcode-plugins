---
name: json-table-converter
description: 把 JSON 或 JSON Lines 格式的接口返回、导出文件、日志打开成普通表格——嵌套字段变成 customer.city 这样的列，列表可以连接或保留，订单明细这样的列表还能展开成每项一行——编辑后存成 Excel 或 CSV。反过来也行：带 spec.weight 这类列名的表格可以转成正确嵌套的 JSON，数字和 true/false 都是真正的类型。在本地运行，无需 API 密钥。 用户提到“JSON 转 Excel / JSON 转表格 / 表格转 JSON / 接口返回转 CSV / JSONL”时使用。
---

# JSON 表格互转

1. `jsontable_open(inputs, settings?, project?)`：读取 JSON/JSONL 或表格，显示成可编辑的表格。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 记录路径不对时设 settings.path（如 "data.orders"）；订单明细展开：settings.explode: "items"。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `jsontable_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 列键是 c0、c1……（顺序同表头）；表格转 JSON 时要拆成数组的列写 settings.arrayCols。
4. `jsontable_export(project, formats?)`：导出 table.xlsx、table.csv、data.json 和 data.jsonl。把文件路径告诉用户。
5. info 里提示“列表对象”时，问用户要不要展开成多行。
