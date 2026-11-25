---
name: web-archiver
description: 把用户给的网址存成离线资料（正文、本地图片、来源和采集时间、Markdown、可选整页截图），再次采集时对比正文变化。用户提到“存档 / 剪藏 / 保存网页 / 离线保存 / 网页改了什么 / 监测页面变化”时使用。
---

# 网页资料归档

1. `archive_capture(urls, images?, screenshot?)`：一次最多 50 个网址，只能是 http/https。
   - 结果写在 `web-archive/<网站>/<页面>/<UTC 时间>/`：
     - `article.html`：单文件离线版，图片已内嵌。
     - `article.md`：Markdown，图片在 `assets/`。
     - `source.html`：原始网页。
     - `meta.json`：元数据。
   - 同一网址之前采集过时，自动对比正文，写 `changes.html`，并给出 `+新增 −删除 ~修改` 的段落数。
   - `screenshot: true` 用本机 Chrome/Edge 的无头模式截整页图；找不到浏览器就跳过。
2. 把每个网址的结果告诉用户：标题、保存位置、图片数；失败的说明原因（404、不是网页、超时等）。
3. `archive_list(query?)`：查看已存档的网页和每次采集。
4. `archive_diff(url, from?, to?)`：对比两次采集（默认最近两次）；向用户说明改了哪些段落。
5. `archive_read(dir)`：读取某次采集的 Markdown，用来引用或总结；引用时注明来源网址和采集时间。
6. 不支持：需要登录的页面、无限滚动、主要内容由脚本动态生成的页面（这类页面可以截图，但提取的正文可能不全）。只访问用户给出的网址；不要自己去抓链接里的其他页面。
