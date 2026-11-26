---
name: sitemap-builder
description: 让静态网站准备好被搜索引擎收录：选网站文件夹，生成正确的 sitemap.xml 和 robots.txt，支持简洁网址、最后修改日期、更新频率和优先级，每个页面都可以单独调整。标了 noindex 或 canonical 指向别处的页面会自动排除；站内的每个链接、图片、脚本和样式表都会检查，发布前就能看到所有坏链接。在本地读取文件，不用爬虫服务，无需 API 密钥。 用户提到“站点地图 / sitemap.xml / robots.txt / 检查死链 / 坏链接 / 网站提交搜索引擎”时使用。
---

# 站点地图生成

1. `sitemap_open(inputs, settings?, project?)`：读取网站页面、规划站点地图并检查链接。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 是网站文件夹；settings: {baseUrl: "https://example.com", cleanUrls: true, lastmod: true, disallow: "/drafts/"}。没有 baseUrl 不能导出 sitemap。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `sitemap_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个页面：`set: [{row, values: {include, lastmod, changefreq, priority}}]`；changefreq 取 always/hourly/daily/weekly/monthly/yearly/never 或空，priority 0–1。
4. `sitemap_export(project, formats?)`：导出 sitemap.xml、robots.txt 和 link-report.csv。把文件路径告诉用户。
5. 坏链接在 issues 里逐条列出，导出 link-report.csv 可以得到完整清单。
