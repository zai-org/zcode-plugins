---
name: price-list-updater
description: 一次改完整张价目表：饮料涨 5%、某个供应商的商品加 1 元、单个 SKU 改成 12.9，或者按进价加成定价，再统一取尾数（12.9、12.99、19 这样）。每行显示原价、新价、涨跌和毛利率；单个价格可以手动改，之后调规则也会保留。会提示毛利率过低、低于进价、涨跌幅过大和没有匹配到商品的规则。导出新价目表（保留原表所有列，改动的价格标色、批注原价）和改价对照 CSV。在本地运行，不用登录店铺，无需 API 密钥。 用户提到“批量调价 / 涨价 5% / 价目表改价 / 尾数 .9 / 按进价加成”时使用。
---

# 批量调价

1. `prices_open(inputs, settings?, project?)`：读取价目表并按规则调价。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 规则写在 settings.rules（每行一条，第一条匹配的生效）；取整 settings.rounding（none/0.01/0.1/1/0.5/0.99/0.9/0.8/9）与 direction（up/down/nearest）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `prices_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 单个改价：`set: [{row, values: {new: 12.5}}]`（标记为手动，改规则后保留）。改规则、取整会重新计算其余商品。
4. `prices_export(project, formats?)`：导出 updated-prices.xlsx 和 price-changes.csv。把文件路径告诉用户。
5. 导出前先把报错（规则写错、新价无效）处理掉；提醒（毛利率、涨跌幅）不影响导出。
