---
name: sheet-diff
description: 对比同一张表格的两个版本——上个月和这个月的价目表、两次导出的客户名单——准确看出新增了哪些行、删除了哪些行、哪些单元格改了，旧值新值并排显示。按货号这类编号列匹配行，排序变了也不会误报；可以忽略细小的数字差异和多余空格。可导出标色的 Excel、变化清单和报告。在本地运行，无需 API 密钥。 用户提到“对比两个表格 / 两版 Excel 有什么不同 / 找出改动 / 价目表变化 / 名单差异”时使用。
---

# 表格对比

1. `sheetdiff_open(inputs, settings?, project?)`：对比两张表，列出新增、删除和修改的行。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 顺序：先旧后新；关键列用 settings.key（多列逗号分隔）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `sheetdiff_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 加备注：`set: [{row, values: {note: "…"}}]`；容差：settings.tolerance。
4. `sheetdiff_export(project, formats?)`：导出 diff.xlsx（新版本标色、删除的行、变化清单）、changes.csv 和 diff.html。把文件路径告诉用户。
5. 向用户汇报时先说新增/删除/修改的数量，再列重点变化（如单价）。
