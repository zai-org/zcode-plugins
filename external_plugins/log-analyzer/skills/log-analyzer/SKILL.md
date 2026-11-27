---
name: log-analyzer
description: 不用搭建统计系统，也能看懂网站服务器的访问日志。打开 Nginx 或 Apache 日志（common 或 combined 格式，普通或 .gz 压缩，可以多个滚动日志或整个文件夹），查看请求数、独立访客、按小时和按天的流量、热门页面、404、服务器错误、状态码、来源和流量。自动识别爬虫和机器人并默认排除；可以按日期、路径或静态文件筛选，也可以去掉单个网址。导出 HTML 报告和 CSV 表格。在本地运行，日志不离开你的电脑。 用户提到“访问日志 / nginx 日志 / apache 日志 / 网站流量 / 404 统计 / 哪些页面访问多”时使用。
---

# 访问日志分析

1. `logs_open(inputs, settings?, project?)`：读取访问日志，汇总流量、错误和来源。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 可以传日志文件夹（如 `["logs"]`），会读取里面的 .log、.log.1、.gz 文件。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `logs_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 筛选用 settings：`{from: "2026-11-26", to: "…", bots: true, staticFiles: false, path: "/blog"}`；去掉某个网址：`set: [{row, values: {include: false}}]`。
4. `logs_export(project, formats?)`：导出 access-report.html，以及 pages.csv、hourly.csv、daily.csv、errors.csv、referrers.csv。把文件路径告诉用户。
5. 报告里的数字以插件结果为准，不要自己估算。
