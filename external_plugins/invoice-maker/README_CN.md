# 批量开发票

把一张明细表（.xlsx/.csv）批量做成带编号的 PDF 发票：按发票号或客户自动分组，计算金额、税额和合计，标出数字错误、缺少客户等问题。在面板里直接改单元格、预览发票，导出每张一个 PDF，另附 Excel/CSV 开票台账。在本地运行，无需 API 密钥。

## 功能

- **输入**：每行一个收费项目。自动识别中英文列名（发票号、客户、地址、项目、数量、单价、税率），能读懂 `¥26,000`、`$320.00` 这样的金额和“一”这样的数量。
- **分组与编号**：发票号相同的行合成一张发票；没有发票号的按客户分组，并按前缀和起始编号自动编号（如 INV-0001）。
- **检查**：数量或单价不是数字、税率不在 0–100、缺少客户、同一发票号对应两个客户、缺少地址、行数太多放不下一页。
- **PDF**：开票方名称和信息、客户信息、项目表、小计、税额、合计、付款期限和备注；中文、英文或双语；A4 或 Letter；可选主题色。中文使用电脑上已有的字体。
- **台账**：invoices.xlsx（汇总表和明细表）、invoices.csv 和 HTML 清单。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `invoice-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 账单/invoices-2026-11.xlsx 开发票，税率 6%，开票方 Penova Labs，30 天内付款”
- “把 Northwind 的支持工时改成 5 小时，发票改成美元、英文”
- “导出 PDF 发票和开票台账”

## 工具

| 工具 | 作用 |
|---|---|
| `invoice_open` | 读取明细表，分组成发票并检查，并打开面板 |
| `invoice_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `invoice_status` | 查看当前数据、问题和汇总 |
| `invoice_export` | 导出每张发票的 PDF、合并的 all-invoices.pdf、invoices.xlsx/.csv 和 HTML 清单 |

导出文件写到工作区的 `invoice-maker/<项目>/` 文件夹。

## 范围（v0.1）

- 每个项目一种币种；税额按每行税率计算（不含复合税、代扣税）。
- 每张发票一页（约 20 行）。不是官方税务发票（如增值税发票、欧盟电子发票），也不会通过邮件发送。
- 旧版 .xls 请先另存为 .xlsx。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `invoice-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/invoice-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-invoice-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：pdf-lib (MIT), fontkit (MIT), ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
