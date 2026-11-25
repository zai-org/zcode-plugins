---
name: barcode-label-maker
description: 把商品表做成条码标签：EAN-13、UPC-A 自动核对校验位，货号等其他内容用 Code 128，可带品名和价格，按常见 A4/Letter 不干胶标签纸（3×8、4×10、2×7、5×13、3×10）排版。可设每个商品打印几张、跳过半张纸上已用的标签，在面板里修正条码，导出可直接打印的 PDF 和 SVG 条码。在本地运行，无需 API 密钥。 用户提到“条码 / 条形码 / 打印标签 / 价签 / EAN / 货号标签”时使用。
---

# 条码标签打印

1. `labels_open(inputs, settings?, project?)`：读取商品表并为每个商品编码条码。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 用户说了标签纸规格就设 settings.sheet（a4-3x8、a4-4x10、a4-2x7、a4-5x13、letter-3x10）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `labels_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改张数：`set: [{row, values: {qty: 6}}]`；半张纸：`settings: {skip: 9}`（跳过前 9 个）。
4. `labels_export(project, formats?)`：导出按所选标签纸排版的 labels.pdf、svg/<货号>.svg 和 barcodes.csv。把文件路径告诉用户。
5. 提醒用户打印时选“实际大小 / 100%”，不要“适合页面”。
