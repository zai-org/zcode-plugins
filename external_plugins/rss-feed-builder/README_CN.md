# RSS 订阅源生成

让读者能订阅你的博客：把一个 Markdown 文章文件夹一次生成 RSS、Atom 和 JSON Feed 三种订阅文件。标题、日期、标签和摘要取自 front matter（没有时用标题和文件名），草稿自动排除，链接按你网站的网址格式生成。可选摘要或全文，图片和链接会转成绝对地址，在阅读器里也能正常显示。在本地运行，不用订阅服务，无需 API 密钥。

## 功能

- **三种格式**：带 content:encoded 和 dc:creator 的 RSS 2.0、Atom 1.0 和 JSON Feed 1.1，一份清单同时生成。
- **读取文章信息**：YAML front matter（title、date、description、tags、slug、author、draft），没有时用第一个标题、文件名里的日期或文件日期。
- **链接格式自定**：比如 {site}/posts/{slug}/ 或 {site}/{yyyy}/{mm}/{slug}.html，重复的链接会被找出来。
- **摘要或全文**：摘要截到 <!-- more --> 或第一段；Markdown 转成 HTML，相对路径的图片和链接改成绝对地址。
- **导出前检查**：缺少网站地址、日期读不出、标题或网址名为空；没写时区的日期按你设定的时区。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `rss-feed-builder/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “给 posts 文件夹生成 RSS，网站是 https://tea.example”
- “用全文，只要最新 10 篇”
- “链接格式改成 {site}/{yyyy}/{slug}.html”

## 工具

| 工具 | 作用 |
|---|---|
| `feed_open` | 读取文章并规划订阅源，并打开面板 |
| `feed_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `feed_status` | 查看当前数据、问题和汇总 |
| `feed_export` | 导出 feed.xml、atom.xml 和 feed.json |

导出文件写到工作区的 `rss-feed-builder/<项目>/` 文件夹。

## 范围（v0.1）

- 只读 Markdown 文章；v0.1 不支持纯 HTML 网站。
- 不负责上传，请把生成的文件放到网站上。
- Hugo/Jekyll 主题的短代码会原样当作文字。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `rss-feed-builder/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/rss-feed-builder/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-rss-feed-builder test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：marked (MIT), yaml (ISC)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
