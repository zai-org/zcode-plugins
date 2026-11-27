---
name: pdf-form-collector
description: 把一批填好的 PDF 表单汇总成一张表：文本框、复选框、单选、下拉框和签名字段都变成列，列名用表单上的提示文字。必填项没填、同意框没勾、邮箱或手机号格式不对、重复提交、不能填写的 PDF（扫描件或已压平）都会标出来。在表格里修正后，导出带颜色和批注的 Excel 或 CSV。在本地运行，不上传，无需 API 密钥。 用户提到“PDF 表单汇总 / 报名表统计 / 表单数据导出 Excel / 收回的表单”时使用。
---

# PDF 表单汇总

1. `formcollect_open(inputs, settings?, project?)`：读取每个 PDF 的表单字段，每份表单一行。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 传文件夹即可；字段列的 key 是 f0、f1…，顺序同表单，列名是字段提示文字。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `formcollect_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 修正值：`set: [{row, values: {f1: "lina@example.com"}}]`；去掉旧提交：`values: {include: false}`；复选框用 true/false。
4. `formcollect_export(project, formats?)`：导出 responses.xlsx（问题单元格标色）和 responses.csv。把文件路径告诉用户。
5. 额外必填字段写在 settings.required（字段名或列名）；重复判断字段在 settings.keyField。
