# 商品数据格式转换

把一张商品表变成网店和购物广告需要的导入文件。从一份商品和规格清单（货号、标题、描述、价格、品牌、分类、图片、库存、条码、颜色尺码）生成 Shopify 式商品导入 CSV、WooCommerce 式商品导入 CSV，以及购物广告用的 RSS/XML 商品 feed。也能读回这些店铺导出的文件，方便在格式之间搬迁商品。导出前按每种格式的必填要求逐行检查，列出需要修改的地方。在本地运行，不用登录店铺，无需 API 密钥。

## 功能

- **一张表进，三种格式出**：Shopify 式导入 CSV（同一句柄多行为变体，多余图片单独成行）、WooCommerce 式导入 CSV（variable 父商品 + variation 子行），以及带 g: 字段的 RSS 2.0 购物 feed。
- **规格变体**：商品组相同的行合成一个商品；颜色、尺码、材质分别成为规格选项。
- **价格**：较低的促销价会写成各格式的“促销价/划线价”。
- **也能读店铺导出**：自动识别 Shopify 式和 WooCommerce 式商品 CSV，并整理回每个变体一行。
- **按格式检查**：缺货号、标题或价格，货号重复，促销价不低于原价，图片和链接网址，条码校验位，feed 缺描述/图片/链接/品牌，变体缺规格或规格重复。
- **问题清单**：issues.csv 列出行号、货号、字段和格式；有 feed 错误的行不会写进 XML。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `product-feed-converter/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 products.xlsx 转成各平台导入文件”
- “哪些商品进不了购物广告 feed？”
- “读取店铺导出的商品 CSV，再转成其他格式”

## 工具

| 工具 | 作用 |
|---|---|
| `feed_open` | 读取商品表并检查，并打开面板 |
| `feed_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `feed_status` | 查看当前数据、问题和汇总 |
| `feed_export` | 导出 products-shopify.csv、products-woocommerce.csv、product-feed.xml 和 issues.csv |

导出文件写到工作区的 `product-feed-converter/<项目>/` 文件夹。

## 范围（v0.1）

- 文件按公开的导入格式生成；本插件与 Shopify、WooCommerce 或任何广告平台无关，也不会上传任何内容。
- 图片需要已经放在网上（完整的 https 链接）。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `product-feed-converter/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/product-feed-converter/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-product-feed-converter test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
