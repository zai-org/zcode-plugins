# 行程单制作

把行程表变成按天排好的可打印行程单、可导入手机的日历文件和预订汇总。每个时间都按各自时区读取（Asia/Tokyo、UTC+9 或直接写“东京”），跨国航班的时长、家里时间和日历时间都对得上。会发现最容易坏事的错误：航班没写到达时区导致后面行程全错一小时、到达早于出发、安排时间重叠、航班前或换地点时间不够、某晚没有住处或订了两家酒店、住宿缺退房日期、19:3O 这类读不懂的时间、缺预订号。导出按天列出时间、地址、预订号的 PDF 行程单（附预订汇总页）、.ics 日历（住宿为全天跨天事件，航班火车前提醒）和 Excel 行程表。不用登录，无需 API 密钥，本机运行。

## 功能

- **时区**：每行按自己的时区（IANA、UTC+9 或城市名）；航班火车可写到达时区；显示家里时间。
- **检查**：缺到达时区、到达早于出发、时间重叠、换乘和机场时间不够、某晚没住处或重复订房。
- **预订**：航班、火车、住宿缺预订号会提醒；PDF 附预订汇总页。
- **导出**：按天的 PDF 行程单、带提醒的 .ics 日历、含住宿和预订的 Excel。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `travel-itinerary/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 东京大阪 的行程表做一份行程单”
- “检查行程里的时区和住宿空档”
- “导出行程单和日历文件”

## 工具

| 工具 | 作用 |
|---|---|
| `trip_open` | 读取行程表，检查时间、时区和住宿，并打开面板 |
| `trip_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `trip_status` | 查看当前数据、问题和汇总 |
| `trip_export` | 导出 itinerary.pdf、itinerary.ics 和 itinerary.xlsx |

导出文件写到工作区的 `travel-itinerary/<项目>/` 文件夹。

## 范围（v0.1）

- 时间以你填写的为准；不查实时航班动态和地图。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `travel-itinerary/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/travel-itinerary/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-travel-itinerary test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
