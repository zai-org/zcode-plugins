# 二维码批量生成

用一张表批量生成二维码：网址、文字、WiFi 连接、电子名片（vCard）、邮箱、电话和短信，可设置颜色、中间 Logo 和名称标签。自动标出内容为空、网址缺少 https://、码太密、颜色对比不够等问题；在面板里修改清单、预览二维码，导出 PNG（含 zip）、SVG 矢量和 A4 打印页 PDF。在本地运行，无需 API 密钥。

## 功能

- **类型**：url、text、wifi（`名称;密码;WPA`）、vcard（`姓名;电话;邮箱;公司;职位;网址`）、email、phone、sms（`号码;短信内容`）。类型为空时按内容自动判断。
- **样式**：码颜色和背景色、留白、PNG 尺寸、容错级别 L/M/Q/H，以及放在中间白底上的 PNG/JPG Logo。
- **检查**：内容为空、网址缺少 https://（会自动补上）、内容太长装不进二维码、码太密、颜色对比不够或深浅颠倒、加了 Logo 但容错不是 H。
- **输出**：每个码一张 PNG（另有 zip）、可带名称的 SVG 矢量、记录每个码内容的 CSV，以及带名称、方便打印裁切的 A4 PDF。
- **名称**用作文件名；重名会自动加 -2、-3……
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `qr-batch-studio/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 门店/qr-list.xlsx 里的内容都做成二维码，中间放 门店/logo.png”
- “最后一行改成 https://penova.example/survey”
- “导出 PNG 和一张每行 3 个的 A4 打印页”

## 工具

| 工具 | 作用 |
|---|---|
| `qr_open` | 读取二维码清单（和可选的 Logo）并逐个检查，并打开面板 |
| `qr_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `qr_status` | 查看当前数据、问题和汇总 |
| `qr_export` | 导出 png/*.png 和 qr-png.zip、svg/*.svg 和 qr-list.csv，以及 qr-sheet.pdf |

导出文件写到工作区的 `qr-batch-studio/<项目>/` 文件夹。

## 范围（v0.1）

- 只生成静态二维码（不含统计链接或可改指向的动态码）。
- v0.1 只有方块码点，没有艺术码点或渐变色；SVG 文件不带 Logo。
- 不包含条形码（EAN、Code 128）。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `qr-batch-studio/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/qr-batch-studio/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-qr-batch-studio test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：node-qrcode (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), pdf-lib (MIT), fontkit (MIT), fflate (MIT), ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
