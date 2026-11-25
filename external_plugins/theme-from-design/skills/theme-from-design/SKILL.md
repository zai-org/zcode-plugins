---
name: theme-from-design
description: 按设计稿做 Shopify Online Store 2.0 主题：生成骨架、按设计稿写 Liquid section 和 JSON 模板、内置检查 + Shopify theme-check、样例数据预览、打包 zip。用户提到“Shopify 主题 / 店铺模板 / 设计稿转主题 / Liquid section”时使用。只做 Shopify。
---

# 设计稿转店铺主题（Shopify OS 2.0）

1. 先看设计稿（图片）：取出颜色（背景、文字、强调色、按钮文字、次要文字）、字体风格、圆角和页面宽度，再列出页面上的区块（公告栏、页眉、横幅、卖点、商品网格、订阅……）。
2. `theme_new(name, design, colors, fonts, radius, width)`：字体用 Shopify 字体名，例如 `playfair_display_n7`、`lora_n4`、`assistant_n4`、`montserrat_n5`。
   - 骨架已经有页眉、页脚、横幅、富文本、图文、精选系列和各个 main-* section。能用就改，不能用就新写。
3. 用 `theme_write({files})` 写入 section、`templates/index.json`、`assets/custom.css`，以及所有 `locales/*.json`（en.default.json 和 zh-CN.json 都要加新 key）。写 section 时：
   - 文字、图片、按钮、商品列表都做成 schema 设置或 block，不要把文案写死。
   - 只用允许的设置类型；`name` 不超过 25 个字符；要加 `presets`，商家才能在编辑器里添加。
   - 图片：`| image_url: width: … | image_tag: …`；颜色和字体用 `var(--color-…)` / `var(--font-…)`。
   - 页面上放哪些 section、按什么顺序，写在 `templates/<页面>.json` 的 `sections` + `order` 里。
4. `theme_preview(template)` 检查渲染错误；用户在面板里把预览和设计稿并排对照，按用户反馈修改。
5. `theme_check()`：内置检查 + Shopify theme-check。错误全部修完，警告告诉用户。
6. `theme_package()`：生成 `themes/<名称>.zip`。告诉用户在 Shopify 后台“在线商店 → 模板 → 添加模板 → 上传 zip 文件”上传。插件不登录、不上传。
