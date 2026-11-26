---
name: sheet-validator
description: 在导入系统、提交或发出表格之前先把错误数据揪出来：漏填、编号重复、手机号和邮箱写错、2025-13-01 这样不存在的日期、数字超出范围、不在可选值里、格式不对。规则用一行一句的大白话写，比如“工号: required, unique”——打开时会根据数据自动生成一份初始规则——然后直接在表格里改正标出的单元格，导出标注好的 Excel 和问题清单。在本地运行，无需 API 密钥。 用户提到“检查表格 / 数据校验 / 导入前检查 / 找出填错的 / 必填项检查”时使用。
---

# 表格数据校验

1. `validate_open(inputs, settings?, project?)`：读取表格、建议校验规则并列出所有不合格的单元格。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 规则写在 settings.rules，每行“列名: 规则, 规则”；不写则自动建议，先把建议规则给用户确认。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `validate_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改单元格：列键 c0、c1……（顺序同表头），例如 `set: [{row: 1, values: {c0: "E004"}}]`。
4. `validate_export(project, formats?)`：导出 checked.xlsx（问题单元格标红并加批注，附问题工作表）、errors.csv、valid-rows.csv 和 invalid-rows.csv。把文件路径告诉用户。
5. 汇报时按列说明问题数量，再举几个例子。
