# 大纲转思维导图

把现成的笔记一键变成思维导图。打开 Markdown 大纲（标题加多级列表）、缩进文本或 OPML 文件，自动排出中心主题、主分支和子主题，可以左右展开或只向右展开，每个分支一种颜色。可以改节点文字或层级、隐藏节点、新增节点、给分支换颜色，然后导出清晰的 SVG 和 PNG，以及能在其他思维导图软件里继续编辑的 OPML 和 FreeMind（.mm）文件，还有整理后的 Markdown 大纲。在本地运行，不用登录，无需 API 密钥。

## 功能

- **读取真实笔记**：Markdown 标题与多级列表（-、*、1.）、缩进文本、OPML；自动去掉加粗、链接、代码标记，跳过 front matter 和代码块。
- **自动排版**：分支左右平衡或全部向右，彩色曲线连接，按层级区分大小。
- **可编辑**：改文字或层级、隐藏节点、新增节点、给主分支换颜色。
- **配色**：鲜艳、沉稳或单色，背景色可选。
- **导出**：SVG、2 倍 PNG、OPML、FreeMind .mm（保留左右位置和分支颜色），以及整理后的 Markdown 大纲。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `outline-mindmap/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 开店计划.md 做成思维导图”
- “把“竞争对手”改成“竞品调研”，再加一个“风险”分支”
- “导出 PNG 和 OPML 文件”

## 工具

| 工具 | 作用 |
|---|---|
| `mindmap_open` | 读取大纲并排出思维导图，并打开面板 |
| `mindmap_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `mindmap_status` | 查看当前数据、问题和汇总 |
| `mindmap_export` | 导出 mindmap.svg、mindmap.png、mindmap.opml、mindmap.mm 和 outline.md |

导出文件写到工作区的 `outline-mindmap/<项目>/` 文件夹。

## 范围（v0.1）

- v0.1 节点只有文字（不支持图片、链接或备注）。
- 新增节点加在大纲末尾，用层级决定挂在最后一个分支下。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `outline-mindmap/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/outline-mindmap/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-outline-mindmap test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：resvg-wasm (MPL-2.0), fontkit (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
