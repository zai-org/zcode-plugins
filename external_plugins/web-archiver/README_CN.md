# 网页资料归档

给自己留一份网页的离线副本：正文、图片、来源和时间，以及和上次相比改了什么。

## 功能

- **采集**：粘贴一个或多个网址（http/https）。
  - 用 Readability 提取正文，去掉导航、广告、脚本和表单。
  - 懒加载、响应式图片会换成真正的（最大的）那张。
- **每次采集**保存在 `web-archive/<网站>/<页面>/<UTC 时间>/`：
  - `article.html`：单文件离线版，图片内嵌；顶部注明来源网址、采集时间、作者、发布日期和网站。
  - `article.md`：带头信息（标题、来源、采集时间、作者、发布时间）的 Markdown，图片在 `assets/`。
  - `source.html`：下载到的原始网页。`text.json`：正文段落。`meta.json`：元数据，含图片下载失败的记录。
  - `screenshot.png`（可选）：用本机 Chrome、Edge 或 Chromium 的无头模式截的整页图，使用临时配置。
  - `web-archive/index.json` 和 `index.md` 列出所有网页和每次采集。
- **变化对比**：再次采集同一网址时，与上一次的正文比较。
  - 列出新增、删除和修改的段落；修改处逐词（中文逐字）标出。
  - 结果保存为 `changes.html`；没有变化时显示“正文无变化”。
- **编码**：支持 UTF-8、GBK/GB18030、Big5 等在响应头或 `<meta charset>` 里声明的编码。
- **面板**：粘贴网址采集，按网页和采集时间浏览，阅读离线副本，查看变化和截图。

## 使用方法

在 ZCode Desktop 里对 Agent 说：

- “把这三篇文章存档到资料库，顺便截图”
- “再采集一次价格页面，告诉我跟上次比改了什么”
- “读一下存档的维基百科文章，帮我总结要点”

## 工具

| 工具 | 用途 |
|---|---|
| `archive_capture` | 采集网址（正文、图片、离线 HTML、Markdown、可选截图），并与上次对比 |
| `archive_list` | 已存档的网页和每次采集 |
| `archive_diff` | 对比某个网址的两次采集，写 `changes.html` |
| `archive_read` | 读取某次采集的 Markdown |

## 范围（v0.1）

- 不支持需要登录的页面、付费墙和无限滚动。
- 内容由脚本动态生成的页面，正文可能提取不全；截图仍是渲染后的样子。
- 不保存视频、内嵌框架和字体，也不会继续抓取页面里的链接。

## 隐私、网络与文件

- **联网**：只下载你给的网址以及这些文章里的图片，有超时和大小限制。不连接其他服务，不需要 API 密钥或账号。
- 截图时用一个全新的临时配置启动本机浏览器（没有 Cookie 和登录状态），用完即删。可用环境变量 `WEB_ARCHIVER_BROWSER` 指定浏览器。
- 只写入工作区里的 `web-archive/`。没有 hooks。

## 构建与测试（开发者）

- 源码：`ui-plugins/web-archiver/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-web-archiver test`（使用本地测试服务器）。`WEB_SAMPLES` 指向保存好的真实网页，用于正文提取测试。`test:e2e` 需要 Chrome 和网络。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：@mozilla/readability（Apache-2.0）、linkedom（ISC）、turndown 与 turndown-plugin-gfm（MIT）、domino（BSD-2-Clause）、jsdiff（BSD-3-Clause）、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
