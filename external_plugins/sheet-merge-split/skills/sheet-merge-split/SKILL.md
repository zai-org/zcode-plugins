---
name: sheet-merge-split
description: 把很多个 Excel/CSV 文件——连同工作簿里的每个工作表——合并成一张表，列名不一样也能对齐（日期/Date、金额/Amount (元)），并加一列记录每行来自哪里。也可以把一张表按门店、地区、负责人等任意列拆成多个工作表或多个文件。缺少的列会提示，数字保持数字格式。在本地运行，无需 API 密钥。 用户提到“合并表格 / 多个 Excel 合成一个 / 汇总工作表 / 拆分表格 / 按门店拆成多个文件”时使用。
---

# 表格合并拆分

1. `sheets_open(inputs, settings?, project?)`：读取表格、对齐列名并预览合并或拆分结果。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 多个文件就是合并；一个文件要拆分时设 settings: {mode: "split", splitBy: "门店"}。列名不同但含义相同：settings.same 写 "营业额=Revenue"。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `sheets_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 列键是 c0、c1……（顺序同合并后的表头）；拆成文件：settings: {splitTo: "files", format: "csv"}。
4. `sheets_export(project, formats?)`：合并：merged.xlsx（含来源工作表）和 merged.csv。拆分：by-<列名>.xlsx（每个值一个工作表），或 split/ 里每个值一个文件并打包 split.zip。把文件路径告诉用户。
5. 合并后把 info 里“缺少的列”告诉用户，问是否其实是同一列。
