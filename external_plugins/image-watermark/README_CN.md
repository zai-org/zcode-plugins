# 图片批量水印

一次给整个文件夹的照片加上统一的文字或 Logo 水印。可以选角落位置或者整张平铺，设大小、不透明度、颜色和边距；大小按每张照片自动换算，横图竖图看起来一致。单张照片可以微调位置、缩放或跳过，先预览再导出 JPEG 或 PNG 副本，原图不动。在本地运行，不上传，无需 API 密钥。

## 功能

- **文字、Logo 或两者**：任意文字（\n 换行），粗体，可加阴影；任意带透明的 PNG Logo。
- **九个位置或平铺**：四角、四边或正中；也可以旋转交错铺满整张图。
- **相对大小**：文字大小和边距按照片短边换算，Logo 宽度按图宽换算。
- **逐张调整**：跳过、改位置、按百分比微调、缩放或改不透明度。
- **预览**：导出前在面板里看到前几张的效果。
- **导出副本不覆盖**：按原目录结构放在 watermarked/ 下，JPEG 或 PNG，附 CSV 报告。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `image-watermark/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “给 photos 里每张照片右下角加上“© 2026 我的工作室””
- “把 logo.png 以 50% 透明度加到所有产品图上”
- “给这些图片加满屏的淡水印”

## 工具

| 工具 | 作用 |
|---|---|
| `watermark_open` | 列出照片、找到 Logo 并预览前几张，并打开面板 |
| `watermark_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `watermark_status` | 查看当前数据、问题和汇总 |
| `watermark_export` | 导出加水印的副本和 watermark-report.csv |

导出文件写到工作区的 `image-watermark/<项目>/` 文件夹。

## 范围（v0.1）

- 只支持 JPEG 和 PNG（HEIC/WebP 请先转换）；输出不保留 EXIF 信息。
- 只加可见水印，不做隐形水印。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `image-watermark/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/image-watermark/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-image-watermark test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：resvg (MPL-2.0), fontkit (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
