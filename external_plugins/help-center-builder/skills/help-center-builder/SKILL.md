---
name: help-center-builder
description: 把 Markdown / HTML 文档文件夹生成静态帮助中心（分类导航、全文搜索、面包屑、目录、相关文章），支持增量构建（只重写受影响的页面并列出原因）和坏链检查。用户提到“帮助中心 / 知识库 / 文档站 / FAQ 网站 / 把这些文档做成网站”时使用。
---

# 帮助中心制作

1. 找到文档目录（通常是 docs/、help/、articles/）。先用 `hc_scan({docs})` 看分类、文章数和问题，把坏链、失效锚点、缺标题这类问题告诉用户。
2. 如果用户想定站点名称、主题色、分类顺序或说明，在文档目录里写 `help-center.json`：`{ "title", "description", "accent": "#rrggbb", "baseUrl", "footer", "categories": [{ "folder", "name", "description" }] }`。单篇文章的标题、排序、标签、相关文章写在 front matter 里（`title`、`order`、`tags`、`related`）。
3. 用 `hc_build({docs, out?})` 生成（默认输出到 help-center/）。之后用户改了文档，再调用一次就是增量构建：只重写受影响的页面，返回结果里有每个页面被重写的原因，挑重点告诉用户。改了模板或想全部重新生成时加 `full: true`。
4. 告诉用户怎么看：用浏览器打开 `help-center/index.html`（离线可用，搜索也能用）；要上线的话，把整个文件夹上传到静态托管（Cloudflare Pages、Netlify、GitHub Pages 等）。设置了 `baseUrl` 才会生成 sitemap.xml 和 canonical 链接。
5. 不在范围内的需求直接说明：反馈按钮、统计、评论、需要登录才能看的文章（需要后端）、多语言切换、代码高亮。
