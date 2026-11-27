# 访问日志分析

不用搭建统计系统，也能看懂网站服务器的访问日志。打开 Nginx 或 Apache 日志（common 或 combined 格式，普通或 .gz 压缩，可以多个滚动日志或整个文件夹），查看请求数、独立访客、按小时和按天的流量、热门页面、404、服务器错误、状态码、来源和流量。自动识别爬虫和机器人并默认排除；可以按日期、路径或静态文件筛选，也可以去掉单个网址。导出 HTML 报告和 CSV 表格。在本地运行，日志不离开你的电脑。

## 功能

- **Nginx/Apache 日志**：common 和 combined 格式、.gz 滚动日志、整个文件夹一起读；读不懂的行只计数不报错。
- **流量**：请求数、独立访客 IP、流量、每小时柱状图和每日表格（时间按日志里写的时间）。
- **问题**：404 最多的路径、5xx 错误次数，所有 4xx/5xx 请求明细写进 errors.csv。
- **爬虫**：按 User-Agent 识别 Googlebot、Bingbot、curl、python-requests 等，默认不计入。
- **筛选**：日期范围、路径前缀、是否包含静态文件，也可以在表格里取消单个网址。
- **来源**按域名汇总，本站来源显示为“(internal)”。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `log-analyzer/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “分析一下 logs 文件夹：哪些页面访问最多，哪些返回 404？”
- “只看 11 月 26 日，把爬虫也算上”
- “导出报告和错误清单”

## 工具

| 工具 | 作用 |
|---|---|
| `logs_open` | 读取访问日志，汇总流量、错误和来源，并打开面板 |
| `logs_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `logs_status` | 查看当前数据、问题和汇总 |
| `logs_export` | 导出 access-report.html，以及 pages.csv、hourly.csv、daily.csv、errors.csv、referrers.csv |

导出文件写到工作区的 `log-analyzer/<项目>/` 文件夹。

## 范围（v0.1）

- v0.1 只支持 common 和 combined 格式（不支持自定义 log_format、JSON 日志或 IIS W3C 日志）。
- 每个项目最多 30 万条请求；时间按日志原样使用（不换算时区）。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `log-analyzer/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/log-analyzer/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-log-analyzer test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
