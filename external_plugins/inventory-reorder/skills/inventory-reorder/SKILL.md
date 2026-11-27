---
name: inventory-reorder
description: 在断货之前就知道该补什么货。把库存表和销售明细放在一起，算出每个商品的日均销量、还能卖几天，以及按交货期和安全库存得出的再订货点。需要补货的商品给出建议数量——够卖接下来几周，并按整箱和供应商起订量取整；数量可以手动改。还会提醒哪些商品在新货到之前就会断货。按供应商导出采购单 PDF 和补货计划 Excel。在本地运行，不用登录 ERP，无需 API 密钥。 用户提到“补货 / 该进多少货 / 采购单 / 安全库存 / 快断货了”时使用。
---

# 库存补货计划

1. `reorder_open(inputs, settings?, project?)`：读取库存和销量，给出补货建议。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传库存表，可再加一个销售明细表（顺序不限，自动识别）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `reorder_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改某个商品的订货数量：`set: [{row, values: {order: 120}}]`（清空 order 恢复建议值）；也可改 daily、lead、moq、pack、safety。全局参数在 settings：safetyDays、coverDays、lookback。
4. `reorder_export(project, formats?)`：导出每个供应商的采购单 PDF 和 reorder-plan.xlsx。把文件路径告诉用户。
5. 只报插件算出的数量，提醒用户结合促销、季节自行判断。
