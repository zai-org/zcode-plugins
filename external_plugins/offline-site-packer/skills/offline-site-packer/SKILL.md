---
name: offline-site-packer
description: 把构建好的静态网站做成双击 index.html 就能看的离线版（改相对链接、收集资源、离线全文搜索、坏链与外链报告、输出文件夹 + zip）。用户提到“网站离线 / 离线文档 / 打包网站 / 检查坏链 / 不联网也能看”时使用。
---

# 网站离线打包

1. 找到构建好的网站目录（含 index.html，常见的是 `dist/`、`public/`、`build/`、`_site/`）。如果只有源码，先运行项目的构建命令。
2. 先用 `site_check({dir, baseUrl?})` 检查。如果知道网站的线上地址，就填到 `baseUrl`，这样指向线上站点的绝对链接会按站内链接处理。
3. 把报告里的问题告诉用户：坏链（在哪个页面、指向哪里）、缺失的文件、外部链接（离线时打不开）、没被链接的页面、用了 fetch() 的脚本。用户想修就修改源站，再重新构建。
4. 用 `site_pack({dir, baseUrl?, out?, includeUnlinked?, search?})` 生成 `<网站>-offline/` 文件夹和 zip。
5. 告诉用户：直接双击 `<网站>-offline/index.html` 就能浏览，按 ⌘K / Ctrl+K 搜索；要分享的话，发 zip 文件即可。
