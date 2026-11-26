---
name: csv-cleaner
description: 一次清洗乱糟糟的 CSV 或 Excel 导出：多余和连续空格、全角数字字母、¥1,280.00 这样的金额文本、五花八门的日期格式、大写邮箱、带横线括号的电话、空行空列和重复行。自动识别列类型，每处修改都有记录，清洗不了的值会标出来。中文 Excel 导出的 GBK 编码 CSV 也能正确打开。在本地运行，无需 API 密钥。 用户提到“清洗表格 / 数据清洗 / 去重 / 统一日期格式 / 去空格 / 全角转半角”时使用。
---

# 表格数据清洗

1. `clean_open(inputs, settings?, project?)`：读取表格、识别列类型并预览所有清洗结果。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 按关键列去重：settings: {dedupe: "key", keyCols: "客户名称"}；改列类型：settings.types 写成 "金额=text"（多列用分号）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `clean_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 单元格的列键是 c0、c1……（顺序同表头），例如 `set: [{row: 5, values: {c5: "800"}}]`。
4. `clean_export(project, formats?)`：导出 cleaned.xlsx（修改处标黄，删除的行在第二个工作表）、cleaned.csv 和 changes.csv。把文件路径告诉用户。
5. 把 problems（无法转换的值）告诉用户，让用户决定怎么改。
