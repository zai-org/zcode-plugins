# 站点地图生成

让静态网站准备好被搜索引擎收录：选网站文件夹，生成正确的 sitemap.xml 和 robots.txt，支持简洁网址、最后修改日期、更新频率和优先级，每个页面都可以单独调整。标了 noindex 或 canonical 指向别处的页面会自动排除；站内的每个链接、图片、脚本和样式表都会检查，发布前就能看到所有坏链接。在本地读取文件，不用爬虫服务，无需 API 密钥。

## 功能

- **正确的 sitemap.xml**：绝对地址并做 URL 编码（中文文件名也没问题），简洁网址去掉 .html 和 index.html，包含 lastmod、changefreq 和 priority。
- **合理的默认值**：首页 1.0，越深的页面优先级越低；日期取自 <meta name=date> 或 article:modified_time，没有时用文件日期。
- **排除不该收录的页面**：noindex 页面、404 页面，以及 canonical 指向别处的页面——需要的话也可以重新勾选。
- **坏链接检查**：相对路径、根路径和同域名绝对地址的链接、图片、脚本、样式表；文件夹链接对应 index.html，没有扩展名的链接对应 .html。
- **robots.txt**：Allow 或你设置的 Disallow 路径，再加上 Sitemap 行。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `sitemap-builder/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “给 site 文件夹生成站点地图，网址是 https://tea.example”
- “有哪些坏链接？”
- “robots.txt 里禁止抓取 /drafts/”

## 工具

| 工具 | 作用 |
|---|---|
| `sitemap_open` | 读取网站页面、规划站点地图并检查链接，并打开面板 |
| `sitemap_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `sitemap_status` | 查看当前数据、问题和汇总 |
| `sitemap_export` | 导出 sitemap.xml、robots.txt 和 link-report.csv |

导出文件写到工作区的 `sitemap-builder/<项目>/` 文件夹。

## 范围（v0.1）

- 只支持静态 HTML 文件夹；服务器或 JavaScript 路由生成的页面找不到。
- 不检查外部链接（不联网）。
- 只生成一个站点地图文件，最多 50,000 个网址；v0.1 不生成站点地图索引和图片/视频站点地图。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `sitemap-builder/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/sitemap-builder/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-sitemap-builder test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
