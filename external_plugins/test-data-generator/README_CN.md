# 测试数据生成

为演示、测试和培训生成逼真的假数据——中英文姓名、手机号、邮箱、城市和地址、公司名、日期、金额、按你想要的比例分布的会员等级、编号、UUID 和 ORD-1234-AB 这样的代码。在小表格里描述各列（或载入字段定义表），选好行数，导出 CSV、Excel、JSON 或 SQL。所有数据都是编造的，相同的随机种子永远生成相同的数据。在本地运行，无需 API 密钥。

## 功能

- **21 种列类型**：序号（C{0000}）、姓名/名/姓、手机、邮箱、城市、地址、公司、日期、日期时间、整数和小数范围、按概率的布尔值、带权重的选项、UUID、文本、模式（#=数字，?=字母）、常量、网址、IP。
- **中文或英文**：中文姓名、11 位手机号、中国城市/地址/公司名——或英文版本。
- **控制分布**：带权重的选项（普通*6|银卡*3|金卡*1）、每列的空值比例、唯一列（范围太小时会提醒）。
- **可复现**：相同的种子和设置永远生成完全相同的数据；换个种子就是新数据。
- **安全**：所有数据都是编造的——邮箱用 example.com 等测试域名——不涉及任何真实个人信息。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `test-data-generator/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “生成 500 个假客户：姓名、手机、邮箱、城市、注册日期”
- “会员等级 70% 普通、25% 银卡、5% 金卡”
- “导出成 customers 表的 SQL INSERT”

## 工具

| 工具 | 作用 |
|---|---|
| `fakedata_open` | 从模板或字段定义表开始，预览生成的数据，并打开面板 |
| `fakedata_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `fakedata_status` | 查看当前数据、问题和汇总 |
| `fakedata_export` | 导出 test-data.csv、test-data.xlsx、test-data.json 和 test-data.sql |

导出文件写到工作区的 `test-data-generator/<项目>/` 文件夹。

## 范围（v0.1）

- 每次导出最多 100,000 行。
- 各列相互独立（不做表间外键或列间公式，英文姓名生成邮箱除外）。
- 手机号格式正确但是随机生成的，不要用来联系任何人。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `test-data-generator/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/test-data-generator/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-test-data-generator test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
