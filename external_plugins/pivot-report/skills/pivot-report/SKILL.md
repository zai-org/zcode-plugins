---
name: pivot-report
description: 像 Excel 数据透视表一样把明细表变成汇总报表——按门店、品类、销售员或任意字段分组，把月份或季度横向展开，对数值求和、计数或求平均——不用再折腾 Excel 的透视表菜单。支持百分比、前 N 名和条形图；可导出整洁的 Excel 报表、CSV 或可打印的 HTML 页面。在本地运行，无需 API 密钥。 用户提到“透视表 / 汇总统计 / 按门店按月统计 / 分组求和 / 销售月报”时使用。
---

# 透视汇总报表

1. `pivot_open(inputs, settings?, project?)`：读取明细表，按建议字段生成透视汇总。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 行字段用列名，逗号分隔：settings: {rows: "门店,品类", col: "订单日期", value: "金额", agg: "sum", dateGroup: "month"}。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `pivot_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 百分比：settings.percent（row/col/total）；前 N：settings.topN。
4. `pivot_export(project, formats?)`：导出 pivot.xlsx（透视、百分比和原始数据工作表）、pivot.csv 和带条形图的 pivot.html。把文件路径告诉用户。
5. 回答“哪个最多/占比多少”时直接读 _status 返回的汇总数字。
