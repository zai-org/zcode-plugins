---
name: product-feed-converter
description: 把一张商品表变成网店和购物广告需要的导入文件。从一份商品和规格清单（货号、标题、描述、价格、品牌、分类、图片、库存、条码、颜色尺码）生成 Shopify 式商品导入 CSV、WooCommerce 式商品导入 CSV，以及购物广告用的 RSS/XML 商品 feed。也能读回这些店铺导出的文件，方便在格式之间搬迁商品。导出前按每种格式的必填要求逐行检查，列出需要修改的地方。在本地运行，不用登录店铺，无需 API 密钥。 用户提到“商品导入表 / 转成 Shopify 格式 / WooCommerce 导入 / 购物广告 feed / 批量上架”时使用。
---

# 商品数据格式转换

1. `feed_open(inputs, settings?, project?)`：读取商品表并检查。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传商品表，也可以是店铺导出的商品 CSV。settings.baseUrl 填店铺网址可自动生成商品链接，并把相对图片路径补成完整网址。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `feed_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改某行：`set: [{row, values: {images: "https://…", salePrice: 99}}]`；变体用 group（同组同值）和 color/size/material。settings.check 选 all/shopify/woocommerce/merchant 决定检查哪种必填项。
4. `feed_export(project, formats?)`：导出 products-shopify.csv、products-woocommerce.csv、product-feed.xml 和 issues.csv。把文件路径告诉用户。
5. 说明导出文件需要用户自己在店铺后台导入，本插件不会上传。
