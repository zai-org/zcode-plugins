---
name: variant-sku-builder
description: 列出商品的规格（颜色、尺码、材质），几秒钟生成全部变体，以及规范的 SKU 编码、价格和库存。给每个规格值一个简短编码，还可以加价（+10 或 +5%）或设库存；选一个 SKU 模式（如 TEE01-BK-XL），不卖的组合可以关掉。任何一个变体的 SKU、价格、库存都能手动改，之后再改规格或模式，手动改的内容会保留。会提示 SKU 重复、SKU 含中文或空格、条码位数不对。导出变体表 Excel 和 CSV。在本地运行，不用登录店铺，无需 API 密钥。 用户提到“生成 SKU / 颜色尺码组合 / 规格表 / 商品编码 / 变体”时使用。
---

# 规格 SKU 生成

1. `variants_open(inputs, settings?, project?)`：读取规格并生成全部变体。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 可以不选文件：`inputs: []` + `settings.options` 直接写规格；不写则用示例。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `variants_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 规则在 settings：product、base、pattern、price、stock、options、exclude、upper（改了会重新生成，手动修改保留）。单个变体：`set: [{row, values: {enabled: false, sku, price, stock, barcode, weight}}]`。
4. `variants_export(project, formats?)`：导出 variants.xlsx 和 variants.csv。把文件路径告诉用户。
5. SKU 建议只用字母、数字和 -。
