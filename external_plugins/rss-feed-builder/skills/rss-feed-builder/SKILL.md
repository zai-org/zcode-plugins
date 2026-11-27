---
name: rss-feed-builder
description: 让读者能订阅你的博客：把一个 Markdown 文章文件夹一次生成 RSS、Atom 和 JSON Feed 三种订阅文件。标题、日期、标签和摘要取自 front matter（没有时用标题和文件名），草稿自动排除，链接按你网站的网址格式生成。可选摘要或全文，图片和链接会转成绝对地址，在阅读器里也能正常显示。在本地运行，不用订阅服务，无需 API 密钥。 用户提到“RSS 订阅 / 生成 feed / Atom / JSON Feed / 博客订阅源”时使用。
---

# RSS 订阅源生成

1. `feed_open(inputs, settings?, project?)`：读取文章并规划订阅源。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 是文章文件夹；settings: {siteUrl, title, author, pattern: "{site}/posts/{slug}/", content: "excerpt", limit: 20, tz: "+08:00"}；content 可为 excerpt/full。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `feed_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一篇文章：`set: [{row, values: {include, title, date, slug, summary, tags}}]`；date 用 YYYY-MM-DD 或 YYYY-MM-DD HH:mm。
4. `feed_export(project, formats?)`：导出 feed.xml、atom.xml 和 feed.json。把文件路径告诉用户。
5. 没有 siteUrl 时不能导出，要问用户网站地址，不要编造。
