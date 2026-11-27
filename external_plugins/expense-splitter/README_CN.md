# AA 分账

多人旅行、聚餐、合租的花费一起算：谁付了多少（可以多人一起付），每笔由谁分摊——全部人、除某人以外、按份数（如“A*2”）、某人正好承担多少、或在平分之外多承担一些。立即看到每人已付、应摊和差额，以及最少几笔转账就能结清。导出结算 Excel 和一张可以直接发到群里的结算图片。在本地运行，不用登录，无需 API 密钥。

## 功能

- **多人付款**：两个人一起付的账写成“小李:900; 阿珍:500”。
- **灵活分摊**：全部、名单、“全部, -Tom”（除了 Tom）、按份数“小王*2”、正好多少“Tom:80, 小王, 小李”、或多承担“Tom+80, 全部”（Tom 多出 80，其余所有人平分）。
- **精确到分**：按“分”计算，除不尽的零头依次分配，每笔合计分毫不差。
- **最少转账**：把能互相抵消的人分成小组，转账笔数尽可能少。
- **自动检查**：付款金额对不上总额、没人分摊、同一个人名字写法不一致、成员名单外的名字。
- **导出**：包含转账、余额和每笔分摊明细的 Excel，以及一张可以发到群里的 PNG 结算图。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `expense-splitter/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 expenses.csv 里的花费 AA 一下”
- “骑行那笔 Tom 没去，别算他”
- “谁该转给谁？导出一张图发群里”

## 工具

| 工具 | 作用 |
|---|---|
| `split_open` | 读取花费并算出谁该转给谁，并打开面板 |
| `split_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `split_status` | 查看当前数据、问题和汇总 |
| `split_export` | 导出 settlement.xlsx 和 settlement.png |

导出文件写到工作区的 `expense-splitter/<项目>/` 文件夹。

## 范围（v0.1）

- v0.1 每个项目只用一种货币，外币花费请先换算。
- 退款请作为单独一笔记录：由收到退款的人“付款”。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `expense-splitter/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/expense-splitter/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-expense-splitter test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), resvg-wasm (MPL-2.0), fontkit (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
