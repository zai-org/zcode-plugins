# 表格转日历

把活动表格变成 Apple 日历、Google 日历、Outlook 和手机都能导入的日历文件。选上写有标题、日期和时间的表格，就能得到标准的 .ics 文件：时区处理正确（包括夏令时），支持全天和跨多天的活动、提前 15 分钟或 1 天等提醒，以及每周、每两周、每周一三五、工作日、每月、每年等重复规则，可设次数或截止日期。还能给每个活动单独导出 .ics 方便转发，并生成可打印的日程表。在本地运行，不用登录日历账号，无需 API 密钥。

## 功能

- **直接用表格**：识别 标题、日期、开始、结束、结束日期、全天、地点、说明、重复、重复截止、提醒、分类 以及英文列名；一个格子里写“14:00-16:00”也可以。
- **时区正确**：任意 IANA 时区，按真实的夏令时切换生成 VTIMEZONE。
- **全天、跨多天、跨零点**的活动都支持。
- **用大白话写重复**：每周、每两周、每周一三五、工作日、每月、每年、weekly、every 2 weeks……可设次数或截止日期。
- **提醒**：15分钟、1小时、1天，或同时设多个；可以给所有活动设默认提醒。
- **输出**：一个日历文件、每个活动一个 .ics，以及按月排列的可打印日程表。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `ics-calendar-builder/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 events.xlsx 做一个日历文件，名字叫 青禾 12 月日程”
- “每个活动都加提前 10 分钟提醒”
- “每个活动单独导出 .ics，再出一份可打印的日程表”

## 工具

| 工具 | 作用 |
|---|---|
| `ics_open` | 读取活动表并检查每个活动，并打开面板 |
| `ics_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `ics_status` | 查看当前数据、问题和汇总 |
| `ics_export` | 导出 <日历名>.ics、events/*.ics 和 schedule.html |

导出文件写到工作区的 `ics-calendar-builder/<项目>/` 文件夹。

## 范围（v0.1）

- 只生成导入用的文件，不会同步或写入你的在线日历。
- v0.1 不支持邀请参会人。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `ics-calendar-builder/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/ics-calendar-builder/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-ics-calendar-builder test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
