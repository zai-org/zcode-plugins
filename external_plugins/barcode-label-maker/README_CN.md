# 条码标签打印

把商品表做成条码标签：EAN-13、UPC-A 自动核对校验位，货号等其他内容用 Code 128，可带品名和价格，按常见 A4/Letter 不干胶标签纸（3×8、4×10、2×7、5×13、3×10）排版。可设每个商品打印几张、跳过半张纸上已用的标签，在面板里修正条码，导出可直接打印的 PDF 和 SVG 条码。在本地运行，无需 API 密钥。

## 功能

- **列**：货号/sku、品名/name、售价/price、条码/barcode、数量/qty（打印张数），中英文列名都能识别。
- **条码规则**：13 位数字 → EAN-13 并核对校验位；有效的 12 位 UPC-A 保持 UPC-A；其他 12 位数字自动补 EAN-13 校验位；校验位错误、含字母或条码为空（改用货号）→ Code 128。每种改动都会在问题列表里说明。
- **标签纸**：A4 3×8、4×10、2×7、5×13 和 Letter 3×10，可打印边框试打，半张用过的纸可以“跳过已用的标签”。
- **标签内容**：可选品名和价格，条码按标签大小缩放并保留两侧空白，条码下方印数字。
- **输出**：labels.pdf（按 100% 实际大小打印）、每个商品一个 SVG，以及记录编码内容的 CSV。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `barcode-label-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 店铺/products.xlsx 做条码标签，用 A4 3×8 的标签纸”
- “马克杯打 6 张，标签纸前 9 个已经用掉了，从第 10 个开始”
- “导出标签 PDF 和 SVG 条码”

## 工具

| 工具 | 作用 |
|---|---|
| `labels_open` | 读取商品表并为每个商品编码条码，并打开面板 |
| `labels_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `labels_status` | 查看当前数据、问题和汇总 |
| `labels_export` | 导出按所选标签纸排版的 labels.pdf、svg/<货号>.svg 和 barcodes.csv |

导出文件写到工作区的 `barcode-label-maker/<项目>/` 文件夹。

## 范围（v0.1）

- 只做一维条码（EAN-13、UPC-A、Code 128）；二维码请用二维码工具。v0.1 不支持 GS1-128 应用标识符。
- 不会替你注册条码号——零售上架请使用你公司拥有的号码（例如向物品编码中心/GS1 申请）。
- v0.1 只有五种预设标签纸规格。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `barcode-label-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/barcode-label-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-barcode-label-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：pdf-lib (MIT), fontkit (MIT), ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
