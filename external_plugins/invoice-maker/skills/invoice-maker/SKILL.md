---
name: invoice-maker
description: 把一张明细表（.xlsx/.csv）批量做成带编号的 PDF 发票：按发票号或客户自动分组，计算金额、税额和合计，标出数字错误、缺少客户等问题。在面板里直接改单元格、预览发票，导出每张一个 PDF，另附 Excel/CSV 开票台账。在本地运行，无需 API 密钥。 用户提到“开发票 / 批量出账单 / invoice / 账单 PDF / 给客户开票”时使用。
---

# 批量开发票

1. `invoice_open(inputs, settings?, project?)`：读取明细表，分组成发票并检查。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 设置里先填开票方名称（seller）、默认税率（taxRate）、币种（currency）；用户没说的就问一句或用默认值。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `invoice_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改金额：`set: [{row: 3, values: {qty: 5}}]`；改币种语言：`settings: {currency: "USD", lang: "en"}`。
4. `invoice_export(project, formats?)`：导出每张发票的 PDF、合并的 all-invoices.pdf、invoices.xlsx/.csv 和 HTML 清单。把文件路径告诉用户。
5. 有错误（error）时 PDF 不能导出，先告诉用户哪一行有问题并帮他改好。
