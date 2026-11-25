# 截图转邮件模板

把邮件截图或设计稿做成响应式 HTML 邮件。Agent 用 **MJML** 写模板，插件把它编译成主流邮箱都能正常显示的 HTML，做检查，与设计稿并排预览，最后导出 HTML 和纯文本版。**不发送任何邮件。**

## 默认设定（v0.1）

- **模板语言：MJML**（`mjml` 5，MIT）。MJML 生成表格布局、内联样式并带手机断点，Outlook、Gmail、Apple Mail 都能正确显示。
- **变量**：`{{name}}` 占位符原样保留在导出的 HTML 里，由你的邮件服务（Mailchimp、SendGrid、Customer.io 等）替换；`data.json` 里的样例值只用于预览。
- **预览**：不联网。远程图片显示为占位块，导出的 HTML 保留真实地址。深色模式会启用模板里 `prefers-color-scheme: dark` 的样式；如果模板没有这类样式，就模拟邮箱客户端的自动反色。
- **发送**：不做。不需要邮件服务账号，也不需要 API 密钥。

## 功能

- **新建模板**（`email_new`）：生成 `emails/<slug>/<slug>.mjml`、`data.json`，并关联设计稿图片。起始模板已带预览行、深色模式样式和退订链接。
- **写入**（`email_write`）：Agent 写入 MJML 和/或样例数据，每次写入都会编译并检查。
- **检查**（`email_check`）：
  - MJML 错误，带行号。
  - 正文宽度超过 600 px，或图片比正文宽。
  - 缺少预览行（`mj-preview`），缺少深色模式样式。
  - 图片缺少替代文字；图片用本地路径（错误）或 `http:` 地址。
  - 空链接或 `#` 链接；文字对比度低于 4.5:1。
  - 没有退订链接。
  - 体积：超过 80 KB 提醒，超过 **102 KB** 报错（Gmail 会截断邮件）。
  - 变量缺少样例值。
- **面板**：
  - 设计稿与预览并排；收件箱行显示标题和预览行；可切换桌面 / 手机（375 px）/ 深色模式。
  - 体积条、问题列表、可编辑的变量表，以及纯文本和 MJML 源码标签页。
  - 导出按钮。
- **导出**（`email_export`）：
  - `export/<slug>.html`：保留 `{{变量}}`。
  - `export/<slug>.txt`：纯文本版，链接写在方括号里。
  - `export/<slug>.preview.html`：用样例数据填好的预览。
  - 有错误时不导出。

## 用法

在 ZCode Desktop 里对 Agent 说：

- “照这张截图做一个邮件模板”
- “检查这封邮件会不会被 Gmail 截断、深色模式下好不好看”
- “导出 HTML 和纯文本版”

## 工具

| 工具 | 作用 |
|---|---|
| `email_new` | 新建模板（起始 MJML + 样例数据），关联设计稿 |
| `email_write` | 写入 MJML 和/或样例数据，编译并检查 |
| `email_check` | 编译并列出问题 |
| `email_export` | 导出 HTML、纯文本和填好数据的预览 |

## 范围（v0.1）

- 只支持 MJML，不提供拖拽编辑器，也没有块结构 JSON 格式。
- 不发送、不上传，也不连接邮件服务。请自己把导出的 HTML 上传到邮件服务。
- 预览是 Chrome 渲染编译后的 HTML 的结果。Windows 版 Outlook 等客户端的精确效果需要用 Litmus、Email on Acid 这类测试服务确认。
- 不托管图片。请使用公开的 https 地址，例如邮件服务的文件管理器或 CDN。

## 隐私、网络和文件

- 本地运行，不联网，不需要 API 密钥。
- 只写工作区里的 `emails/<slug>/` 和 `.email-builder/project.json`。
