# 规格 SKU 生成

列出商品的规格（颜色、尺码、材质），几秒钟生成全部变体，以及规范的 SKU 编码、价格和库存。给每个规格值一个简短编码，还可以加价（+10 或 +5%）或设库存；选一个 SKU 模式（如 TEE01-BK-XL），不卖的组合可以关掉。任何一个变体的 SKU、价格、库存都能手动改，之后再改规格或模式，手动改的内容会保留。会提示 SKU 重复、SKU 含中文或空格、条码位数不对。导出变体表 Excel 和 CSV。在本地运行，不用登录店铺，无需 API 密钥。

## 功能

- **一行写一个规格**：“颜色: 黑色=BK, 白色=WH; 尺码: S, M, L, XL(+10)”；也可以用规格表（规格名、规格值、编码、加价、库存）。
- **SKU 模式**：{base} 款号，{1}{2}{3} 规格编码，{尺码} 按规格名，{n} 序号；可选全部大写。
- **价格和库存规则**：每个规格值可加价（+10、-5、+5%）或设库存（取最小值）。
- **跳过组合**：“白色+XXL; 燕麦+S”自动关闭；也可以手动勾选每个变体。
- **手动修改会保留**：改过的 SKU、价格、库存、名称、条码和重量，在调整规格或规则后仍然保留。
- **检查**：SKU 重复、含中文或过长、模式里有未知占位符、价格为 0、条码位数不对。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `variant-sku-builder/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 options.xlsx 生成全部规格”
- “SKU 用 {base}-{1}-{2}，白色不要 XXL”
- “XL 加 10 元，XXL 加 20 元”

## 工具

| 工具 | 作用 |
|---|---|
| `variants_open` | 读取规格并生成全部变体，并打开面板 |
| `variants_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `variants_status` | 查看当前数据、问题和汇总 |
| `variants_export` | 导出 variants.xlsx 和 variants.csv |

导出文件写到工作区的 `variant-sku-builder/<项目>/` 文件夹。

## 范围（v0.1）

- 每个商品最多 3 个规格（多数店铺的上限）。
- 每个项目一个商品。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `variant-sku-builder/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/variant-sku-builder/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-variant-sku-builder test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
