---
name: brand-kit-studio
description: 根据品牌名、标语和 logo 生成整套品牌素材：favicon/网站图标与 webmanifest、App 图标、社媒头像、分享图（OG）、X/小红书配图、公众号/X/LinkedIn/YouTube 横幅，以及可编辑 SVG 模板。用户提到“品牌素材 / favicon / 社媒头像 / 封面横幅 / OG 图 / 品牌套装”时使用。
---

# 品牌素材套装

全部在本机生成，不联网。

1. **打开**：`brand_open(name, tagline?, logo?, mark?, colors?)`，或 `brand_open(project: "xxx.brandkit.json")`。logo 用工作区里的 SVG（最好）/ 透明 PNG / JPG；`mark` 是可选的方形标志（用于 favicon、头像）。没给 `colors` 时会从 logo 推荐主色、辅色——把推荐的颜色告诉用户确认。返回排版警告并打开侧栏面板。
2. **素材 id**：`favicon`、`apple-touch-icon`、`android-chrome-192`、`android-chrome-512`、`maskable-512`、`avatar`、`og-image`、`x-post`、`xiaohongshu`、`wechat-cover`、`x-header`、`linkedin-banner`、`youtube-banner`。
3. **调整**：`project.brand` 有 `name`、`tagline`、`colors{primary, secondary, background, text}`、`logoTone`（auto/original/white/dark）。单个素材写在 `project.assets[id]`：`enabled`（false 不导出）、`layout`（hero 居中渐变 / split 左文右标 / minimal 简洁）、`title`、`subtitle`（覆盖品牌名和标语，例如活动标题）。警告“title/subtitle is too long”表示文字被截断，建议缩短或换版式。用 `project_save(path, project)` 保存为 `.brandkit.json`。
4. **导出**：`brand_export(project, assets?)` 写到 `brand-kit/`（`outputDir` 可改）：`favicon/`（含 `site.webmanifest`、`head-snippet.html`）、`social/`、`covers/`、`templates/*.svg`、`brand.json`、`index.html`。只重做几张时传 `assets`。
5. **接入网站**（用户要求时）：把 `favicon/` 里的文件复制到网站静态根目录，把 `head-snippet.html` 的标签加入页面 `<head>`；`og:image` 若需要绝对地址，改成站点完整 URL。

不要修改用户的原始 logo 文件。
