---
name: i18n-sheet
description: 把应用的所有语言文案放在一起看：打开各语言的文案文件（JSON 或 YAML），每个键一行、每种语言一列。缺失和空着的文案、对不上的占位符（{name}、%s、{{count}}……）、改动了的 HTML 标签、还没翻译的文字都会标出来。直接在表格里修改，导出 Excel 交给翻译，翻译好的表格再导回来，最后按原格式写回文案文件。在本地运行，不用翻译服务，无需 API 密钥。 用户提到“多语言文案 / i18n / 翻译缺失 / 语言包对比 / 导出给翻译 / 占位符检查”时使用。
---

# 多语言文案表

1. `i18n_open(inputs, settings?, project?)`：把各语言文件读成一张表并检查。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 是各语言文件（可再加一份翻译回来的 .xlsx/.csv，需有 key 列和语言代码列）；settings: {base: "en", missing: "omit", sort: false}；missing 可为 omit/base/empty。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `i18n_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 列 key 是键，l0、l1… 依次对应 open 返回的语言（见列标题）：`set: [{row, values: {l1: "…"}}]`；新增键用 `add: [{key, l0, l1}]`。
4. `i18n_export(project, formats?)`：写回各语言文件，并导出 translations.xlsx。把文件路径告诉用户。
5. 占位符不一致是 error，必须先改；保留原文中的占位符名称，不要翻译占位符。
