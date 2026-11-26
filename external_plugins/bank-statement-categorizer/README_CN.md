# 账单自动分类

把银行卡、信用卡、支付软件导出的流水（.csv/.xlsx，中英文都行）按可编辑的关键词规则自动分类，可逐笔手动改分类，标出未分类和可能重复计入的交易，按分类和月份汇总收支。导出分类后的 Excel、CSV 和 HTML 报告，规则可以下个月继续用。在本地运行，不需要登录银行，无需 API 密钥。

## 功能

- **输入**：一个或多个 CSV/XLSX 导出文件，表格上方的说明文字会自动跳过。能识别中英文列名：交易时间/date、交易对方/payee、摘要/商品说明/description，带正负号的金额、金额加“收/支”列，或分开的借方/贷方列。GBK 编码的 CSV 也能读。
- **规则**：一行一条，`关键词|另一个关键词 => 分类`，不区分大小写，第一条命中的规则生效。自带一套常见中英文商户的规则（餐饮、买菜、交通、购物、订阅、生活缴费、住房、收入、储蓄）。
- **手动分类**：在表格里改的分类优先于规则，改规则后也保留。
- **检查**：未分类的交易、无法识别的日期或金额，以及两个不同文件里日期、金额、说明都相同的交易（可能重复计入）。
- **汇总**：收入和支出合计、每个分类一条柱形、按月×分类的汇总表，面板和报告里都有。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `bank-statement-categorizer/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 账单/bank-2026-10.csv 和 账单/支付宝-2026-11.csv 分类，告诉我每个月钱花在哪了”
- “把 UNKNOWN MERCHANT 8831 归到餐饮，再加一条规则：小店算购物”
- “导出分类后的 Excel 和月度报告”

## 工具

| 工具 | 作用 |
|---|---|
| `statement_open` | 读取账单导出文件并给每笔交易分类，并打开面板 |
| `statement_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `statement_status` | 查看当前数据、问题和汇总 |
| `statement_export` | 导出 categorised.xlsx（交易明细、月份×分类汇总、规则）、categorised.csv、report.html 和 rules.txt |

导出文件写到工作区的 `bank-statement-categorizer/<项目>/` 文件夹。

## 范围（v0.1）

- 只读取导出的文件，不连接银行或支付软件。
- 每个项目一种币种（不做汇率换算）。PDF 账单请先在银行导出 CSV/XLSX。
- 规则是关键词匹配，不是机器学习；未分类的交易可以让助手帮你补规则。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `bank-statement-categorizer/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/bank-statement-categorizer/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-bank-statement-categorizer test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
