# 可打印日历

打印一份已经写好节假日和你自己安排的日历。生成每月一页、格子够大可以手写的月历，以及一页看全年的年历。可以选一份日期清单——节假日、调休补班、生日、出差、截止日——也可以直接在设置里输入节假日。年份和月份、每周从周一还是周日开始、A4 或 Letter、中英文、周数和主题色都能选。在本地运行，不用设计服务，无需 API 密钥。

## 功能

- **月历**：格子大，写好你的安排，周末和假期加底色，带“休/班”标记，放不下会提示。
- **全年一页**：12 个月在一页，假期高亮、有安排的日子加标记，下方列出日期清单。
- **你的日期**：选一份含 日期、结束日期、事项、类型（活动/假期/补班）、颜色 的表格，或直接在设置里输入节假日。
- **任意时段**：选年份、起始月份，最多 24 个月。
- **打印选项**：A4 或 Letter，横向或纵向，周一或周日开始，ISO 周数，中英文，主题色。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `printable-calendar/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 events.csv 做 2027 年日历，标题 青禾 2027”
- “每周从周日开始，英文，Letter 纸”
- “加上 2027-06-09 端午假期，显示周数”

## 工具

| 工具 | 作用 |
|---|---|
| `cal_open` | 读取事件表（可选）并预览全年，并打开面板 |
| `cal_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `cal_status` | 查看当前数据、问题和汇总 |
| `cal_export` | 导出 calendar-<年份>-monthly.pdf 和 calendar-<年份>-year.pdf |

导出文件写到工作区的 `printable-calendar/<项目>/` 文件夹。

## 范围（v0.1）

- 不内置法定节假日——请按官方通知填写（样例里的是示例）。
- v0.1 不显示农历。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `printable-calendar/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/printable-calendar/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-printable-calendar test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
