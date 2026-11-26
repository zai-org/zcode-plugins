# 网页 SEO 检查

检查网站每个页面里搜索引擎最看重的基础项——标题、描述、H1 标题、图片 alt 文字、语言和移动端标签，并直接在表格里修改标题和描述。长度按搜索结果的显示宽度计算（中文字符算两个），页面之间重复的标题和描述也会被找出来，还能预览页面在搜索结果里的样子。可以保存修改后的副本，也可以直接改原网页（自动备份，一键撤销）。在本地处理文件，不用 SEO 服务，无需 API 密钥。

## 功能

- **标题和描述检查**：缺失、按显示宽度过短或过长（中文算两个），以及页面之间重复。
- **页面基础项**：H1 数量、没有 alt 的图片、<html lang>、viewport 标签和 Open Graph 标签。
- **在表格里修改**：编辑标题和描述，实时显示长度和搜索结果预览。
- **谨慎改写**：只改标题、描述，以及可选的 og:title/og:description 和 lang，其余 HTML 一个字节都不动。
- **副本或直接修改**：导出修改后的副本，或直接改原网页（有备份可撤销）；audit.csv 列出所有问题。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `seo-meta-audit/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “检查 site 文件夹里网页的 SEO”
- “重写“关于我们”页的标题和描述”
- “把修改应用到原网页，并加上 lang=zh-CN”

## 工具

| 工具 | 作用 |
|---|---|
| `seo_open` | 读取每个页面的标签并检查，并打开面板 |
| `seo_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `seo_status` | 查看当前数据、问题和汇总 |
| `seo_export` | 导出修改后的页面副本和 audit.csv（可按需直接改原网页或撤销） |

导出文件写到工作区的 `seo-meta-audit/<项目>/` 文件夹。

## 范围（v0.1）

- 只处理静态 HTML 文件；JavaScript 或 CMS 渲染的页面读不到。
- v0.1 只报告缺少的 alt 文字，不支持修改。
- 不查询排名，也不抓取线上网站。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `seo-meta-audit/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/seo-meta-audit/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-seo-meta-audit test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
