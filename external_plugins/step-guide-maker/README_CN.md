# 步骤教程生成

把一文件夹截图做成图文步骤教程：带编号的步骤标题和说明、高亮框、敏感信息马赛克、裁剪，导出为单文件 HTML 网页、Markdown（附图片）和 PDF。步骤可以写在截图旁边的 Markdown 文件里（`## 标题`、说明，以及可选的 `框:` / `打码:` / `裁剪:` 百分比坐标），也可以逐行填写。没有写框的步骤，可以自动框出和上一张截图相比变化的区域。会检查重复截图、步骤数和截图数对不上、没有标题的步骤、超出图片的框、没打码的登录页面和太小的截图。在本地运行，不用登录，无需 API 密钥。

## 功能

- **步骤文件**：`## 标题` / `1.` / `第1步` 分段，按文件名顺序对应截图。
- **标注**：带步骤号的高亮框、马赛克打码（不可还原）、裁剪，坐标为截图的百分比。
- **自动框**：没写框时，框出和上一张相比变化的区域（整屏都变时不框）。
- **检查**：重复截图、步骤数与截图数不符、缺标题、框超出图片、登录页没打码、图片太小。
- **导出**：单文件 HTML、Markdown + PNG 图片、PDF（A4/Letter）。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `step-guide-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 优惠券教程 的截图做一份步骤教程”
- “去掉重复的截图”
- “导出 HTML、Markdown 和 PDF”

## 工具

| 工具 | 作用 |
|---|---|
| `steps_open` | 读取截图和步骤说明并一一对应，并打开面板 |
| `steps_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `steps_status` | 查看当前数据、问题和汇总 |
| `steps_export` | 导出 guide.html、guide.md + images/ 和 guide.pdf |

导出文件写到工作区的 `step-guide-maker/<项目>/` 文件夹。

## 范围（v0.1）

- 不识别截图里的文字（不做 OCR）：框和打码的位置来自你填写、步骤文件或自动变化检测。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `step-guide-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/step-guide-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-step-guide-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
