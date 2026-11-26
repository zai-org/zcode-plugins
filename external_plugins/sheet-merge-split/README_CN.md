# 表格合并拆分

把很多个 Excel/CSV 文件——连同工作簿里的每个工作表——合并成一张表，列名不一样也能对齐（日期/Date、金额/Amount (元)），并加一列记录每行来自哪里。也可以把一张表按门店、地区、负责人等任意列拆成多个工作表或多个文件。缺少的列会提示，数字保持数字格式。在本地运行，无需 API 密钥。

## 功能

- **合并**：最多 30 个文件及其所有工作表；按列名对齐，忽略大小写、空格和单位——内置日期、门店、数量、金额、单价、商品、客户、备注的同义词，也可以自己加规则（营业额=Revenue）。
- **缺什么一目了然**：列出每个来源的行数和缺少的列；“来源”列记录文件和工作表。
- **拆分**：按任意列（自动选或你指定）拆成一个工作簿多个工作表，或每个值一个 .xlsx/.csv 文件（同时打包成 zip）。
- **输出干净**：数字保持数字，工作表名和文件名自动处理成安全且不重复的名字。
- **导出前可改**：在表格里修改或新增行。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `sheet-merge-split/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 门店销售-2026Q4.xlsx（所有工作表）和 线上订单-11月.csv 合并成一张表”
- “营业额和 Revenue 算同一列”
- “按门店拆分，每个门店一个文件”

## 工具

| 工具 | 作用 |
|---|---|
| `sheets_open` | 读取表格、对齐列名并预览合并或拆分结果，并打开面板 |
| `sheets_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `sheets_status` | 查看当前数据、问题和汇总 |
| `sheets_export` | 合并：merged.xlsx（含来源工作表）和 merged.csv。拆分：by-<列名>.xlsx（每个值一个工作表），或 split/ 里每个值一个文件并打包 split.zip |

导出文件写到工作区的 `sheet-merge-split/<项目>/` 文件夹。

## 范围（v0.1）

- 每个工作表的第一行必须是表头；合并单元格和公式按值读取。
- 最多 30 个文件；不做表间查找/关联（那是另一类工作）。
- .xls 请先另存为 .xlsx。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `sheet-merge-split/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/sheet-merge-split/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-sheet-merge-split test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), fflate (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
