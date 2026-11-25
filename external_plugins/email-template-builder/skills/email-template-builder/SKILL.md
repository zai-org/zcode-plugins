---
name: email-template-builder
description: 照截图/设计稿做 HTML 邮件模板：Agent 写 MJML，插件编译成邮箱兼容的 HTML，检查宽度、替代文字、图片地址、链接、对比度、预览行、深色模式、退订链接和 102 KB 体积，并排预览，导出 HTML + 纯文本。用户提到“邮件模板 / HTML 邮件 / EDM / newsletter / 截图转邮件”时使用。不发送邮件。
---

# 截图转邮件模板（MJML）

1. 先看截图：取出宽度（通常 600 px）、背景色、品牌色、字体、各区块（页眉、主标题、按钮、商品/订单表、页脚）以及会变化的内容（姓名、订单号、链接）。
2. `email_new(name, design)` 新建模板，返回起始 MJML 和样例数据。
3. 用 `email_write({ mjml, data })` 写完整的 MJML 和样例数据：
   - 结构：`mj-section` > `mj-column` > `mj-text` / `mj-button` / `mj-image` / `mj-table` / `mj-divider` / `mj-spacer`。宽度用 `<mj-body width="600px">`。
   - 会变化的内容写成 `{{变量}}`，并在 `data` 里给每个变量一个样例值。
   - 必须有 `<mj-preview>`（收件箱预览行）和 `<mj-title>`。
   - 在 `<mj-style>` 里加 `@media (prefers-color-scheme: dark)`。给需要变深的 section 和文字加 `css-class`：背景要同时覆盖 `.x`、`.x > table` 和 `.x td`；文字用 `.y div`。
   - 图片必须是公开的 https 地址，并写 `alt`。截图里的图片如果没有地址，就先用占位地址，并告诉用户要换成自己的。
   - 页脚放退订链接 `{{unsubscribe_url}}`，以及公司名和地址。
   - 文字对比度至少 4.5:1；按钮用真实链接或变量，不要用 `#`。
4. 看 `email_write` / `email_check` 返回的问题：错误必须修完，提醒能修就修。用户在面板里对照设计稿，并检查手机版和深色模式。
5. `email_export()` 导出 `emails/<slug>/export/` 下的 `.html`（保留变量）、`.txt` 和 `.preview.html`。告诉用户把 HTML 和纯文本上传到自己的邮件服务。插件不发送邮件。
