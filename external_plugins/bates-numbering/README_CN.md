# 文件编号盖章

给一批 PDF 的每一页连续盖上编号（DOC-000001、DOC-000002……），像证据材料、送达文件那样跨文件接续编号。可以在每页加“副本”“COPY”“CONFIDENTIAL”等标签，在每个文件首页加“证据 1”“Exhibit A”等标签。排好文件顺序，选好前缀、位数和位置，导出盖章后的 PDF、可选的合并 PDF 和编号索引。原文件保持不变。在本地运行，不上传，无需 API 密钥。

## 功能

- **连续编号**：前缀、起始号、位数和后缀（PNV00101……），按你排定的顺序跨文件接续。
- **标签**：每页一个标签（副本、COPY、CONFIDENTIAL），首页文件标签支持 {n}、{A}、{name}，也可以逐个文件填写。
- **位置**：六个位置，可调字号、边距、颜色，并可加白底衬框，深色扫描件上也看得清。
- **旋转页面**：编号跟随页面旋转和裁剪框，在任何阅读器里都是正的。
- **中文标签**：盖章文字有中文时，嵌入本机中文字体。
- **导出**：按编号范围命名的盖章副本、可选的合并 PDF，以及记录文件、页数和编号范围的索引 CSV。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `bates-numbering/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “给 exhibits 文件夹编号，从 ABC000001 开始”
- “每页盖“副本”，每个文件标 证据 1、2、3”
- “把邮件放到最前面重新编号”

## 工具

| 工具 | 作用 |
|---|---|
| `bates_open` | 读取 PDF、统计页数并规划编号范围，并打开面板 |
| `bates_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `bates_status` | 查看当前数据、问题和汇总 |
| `bates_export` | 导出盖章后的 PDF、可选的 combined.pdf 和 index.csv |

导出文件写到工作区的 `bates-numbering/<项目>/` 文件夹。

## 范围（v0.1）

- 有密码保护的 PDF 需要先去掉密码。
- 编号作为页面内容添加，不修改 PDF 原有的页码标签。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `bates-numbering/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/bates-numbering/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-bates-numbering test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：pdf-lib (MIT), fontkit (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
