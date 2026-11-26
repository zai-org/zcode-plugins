# JSON 表格互转

把 JSON 或 JSON Lines 格式的接口返回、导出文件、日志打开成普通表格——嵌套字段变成 customer.city 这样的列，列表可以连接或保留，订单明细这样的列表还能展开成每项一行——编辑后存成 Excel 或 CSV。反过来也行：带 spec.weight 这类列名的表格可以转成正确嵌套的 JSON，数字和 true/false 都是真正的类型。在本地运行，无需 API 密钥。

## 功能

- **自动找到记录**：自动挑出最大的对象数组（如 data.orders），也可以指定路径。
- **压平**：嵌套对象变成带点号的列；值数组可以连接（tags → “老客户; 包邮”）或保留 JSON；可把一个对象数组展开成每项一行。
- **JSON Lines**：也能读取 .jsonl/.ndjson 和逐行 JSON 日志。
- **转回 JSON**：点号列名还原嵌套，数字和 true/false 变成真正的类型（手机号这类长数字保留为文本），列表列拆成数组，空单元格可省略或为 null。
- **中间可编辑**：导出前修改值或新增行。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `json-table-converter/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 orders-api.json 转成 Excel 表格”
- “items 里每个商品一行”
- “把 产品表.csv 转成嵌套 JSON，tags 变成数组”

## 工具

| 工具 | 作用 |
|---|---|
| `jsontable_open` | 读取 JSON/JSONL 或表格，显示成可编辑的表格，并打开面板 |
| `jsontable_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `jsontable_status` | 查看当前数据、问题和汇总 |
| `jsontable_export` | 导出 table.xlsx、table.csv、data.json 和 data.jsonl |

导出文件写到工作区的 `json-table-converter/<项目>/` 文件夹。

## 范围（v0.1）

- 文件最大约 50 MB；一次只能展开一个数组。
- v0.1 不做 JSON Schema 校验和 JSONPath 筛选。
- 展开后的行导出 JSON 时是各自独立的记录。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `json-table-converter/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/json-table-converter/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-json-table-converter test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
