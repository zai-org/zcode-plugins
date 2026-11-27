---
name: sales-commission
description: 从销售明细表算出每位销售的提成，并生成清楚的个人提成单。设置阶梯比例——超额累进（像个税一样每档只算该档部分）或全额阶梯（达到哪档全部按哪档）；配件、服务等品类可以单独设比例；退货、取消的订单自动扣回提成。可以只算某个月，每一行的比例和提成都看得到，还会提示重复订单、退货记错人、同一个人名字写法不一致。导出提成汇总 Excel 和每人一页的 PDF 提成单。在本地运行，不用登录 CRM，无需 API 密钥。 用户提到“算提成 / 销售提成 / 阶梯提成 / 提成单 / 退货扣提成”时使用。
---

# 销售提成计算

1. `commission_open(inputs, settings?, project?)`：读取销售明细并计算提成。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 可在 open 时直接传 settings：`{period: "2026-10", tiers: "0-5万:3%; 5万-10万:5%; 10万+:8%", mode: "progressive"|"whole", special: "配件:8%; 服务:12%"}`。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `commission_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改规则用 settings；改某行用 `set: [{row, values: {date, person, order, product, category, amount, status}}]`，status 写“退货”表示扣回。
4. `commission_export(project, formats?)`：导出 commission.xlsx 和每人一份 PDF 提成单。把文件路径告诉用户。
5. 只报插件算出的金额；提醒用户以公司正式规则为准。
