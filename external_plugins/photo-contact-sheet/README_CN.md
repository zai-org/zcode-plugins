# 照片小样表

把一文件夹的照片排成可打印的小样表：整齐的缩略图网格，下面是文件名或自己写的说明，带页码和可选标题。可以选纸张、方向、每行张数和每页行数，照片完整显示或填满格子，白底或黑底。调整顺序、去掉不要的照片，然后导出 PDF 打印或发给客户选片，每页另有一张 JPG。在本地运行，不上传，无需 API 密钥。

## 功能

- **网格**：A4、A3、Letter、Legal，纵向或横向；每行 1–12 张、每页 1–15 行；页边距和间距以毫米计。
- **缩放**：完整显示，或填满格子裁切；横竖照片可以混排。
- **说明文字**：模板里可用编号、文件名、尺寸或每张照片自己的说明；也可以不要。
- **顺序**：按文件名自然排序（IMG_2 在 IMG_10 前），可用顺序列调整，或去掉照片。
- **输出**：体积小的 PDF（缩略图 200 dpi）、每页一张 JPG，以及照片在第几页的 CSV 清单。
- **外观**：可选标题、页码、白底或黑底。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `photo-contact-sheet/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 shoot 文件夹做成每行 5 张的小样表”
- “这些照片排在 A4 横向，每张下面写文件名”
- “去掉 IMG_0413，把竖拍的那张放第一”

## 工具

| 工具 | 作用 |
|---|---|
| `contact_open` | 列出照片并预览第 1 页，并打开面板 |
| `contact_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `contact_status` | 查看当前数据、问题和汇总 |
| `contact_export` | 导出 contact-sheet.pdf、每页 JPG 和 contact-sheet.csv |

导出文件写到工作区的 `photo-contact-sheet/<项目>/` 文件夹。

## 范围（v0.1）

- 只支持 JPEG 和 PNG（HEIC/RAW 请先转换）。
- 说明文字只有一行，太长会用 … 截断。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `photo-contact-sheet/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/photo-contact-sheet/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-photo-contact-sheet test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：pdf-lib (MIT), fontkit (MIT), resvg (MPL-2.0), pngjs (MIT), jpeg-js (BSD-3-Clause)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
