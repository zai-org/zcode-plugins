---
name: packing-slip-maker
description: 把从店铺后台导出的订单表变成可以打印的发货单和一张拣货单。订单号相同的行合成一张发货单：收件人、打码后的电话、地址、配送方式、每件商品的勾选框、礼品留言框，以及可以扫描的订单号条码。拣货单把所有订单的同一商品汇总，并按库位排序，走一趟货架就能拣完。还会提示缺少地址、数量不对、同一订单信息不一致。导出发货单 PDF 和拣货单 Excel。在本地运行，不用登录店铺后台，无需 API 密钥。 用户提到“发货单 / 拣货单 / 打包单 / 配货单 / 礼品留言卡”时使用。
---

# 发货单拣货单

1. `slips_open(inputs, settings?, project?)`：读取订单并按订单号分组。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传订单表（每行一个商品）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `slips_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改某行：`set: [{row, values: {address: "…", qty: 2}}]`（也可直接用列名，如 收货地址）；纸张、打码、金额在 settings：paper "A4"|"A5"、maskPhone、showPrices。
4. `slips_export(project, formats?)`：导出 packing-slips.pdf 和 picking-list.xlsx/.csv。把文件路径告诉用户。
5. 不要在回复里完整显示客户电话。
