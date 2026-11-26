# 照片隐私信息清除

分享照片前，先看看照片里藏了什么——GPS 位置、手机或相机型号、拍摄时间、软件、备注、XMP/IPTC 和 PNG 文本——然后导出清除了这些信息（或只清除位置）的副本。JPEG、PNG、WebP 不重新压缩，画质不变、颜色不变，竖拍照片也不会变横。原图绝不改动。在本地运行，无需 API 密钥。

## 功能

- **看清风险**：每张照片的 GPS 坐标、相机品牌型号、拍摄时间、软件、备注、XMP/IPTC 和 PNG 文本一目了然，摘要统计有多少张会暴露位置。
- **两种模式**：清除全部元数据，或只清除 GPS 位置（相机和时间保留）。
- **无损**：直接去掉元数据块，不重新压缩——图像数据一个字节都不变；保留 ICC 颜色配置和旋转方向。
- **安全输出**：清理后的副本按原目录结构放进插件输出文件夹，或放在原图旁边命名为 文件名-clean.jpg；原图绝不改动。
- **报告**：privacy-report.csv 列出每张照片原有的信息和清除了什么；不想处理的照片取消勾选即可。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `exif-privacy-cleaner/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “分享/ 里哪些照片会暴露拍摄地点？”
- “发出去之前把这些照片的元数据都清掉”
- “只去掉 GPS 位置，相机信息保留”

## 工具

| 工具 | 作用 |
|---|---|
| `exifclean_open` | 扫描照片里的位置、相机、时间等隐藏信息，并打开面板 |
| `exifclean_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `exifclean_status` | 查看当前数据、问题和汇总 |
| `exifclean_export` | 导出清理后的副本（插件输出文件夹，或原图旁边的 文件名-clean.jpg）和 privacy-report.csv |

导出文件写到工作区的 `exif-privacy-cleaner/<项目>/` 文件夹。

## 范围（v0.1）

- 支持清理 JPEG、PNG、WebP；v0.1 只扫描、不清理 HEIC 和 TIFF（请先导出为 JPEG）。
- 不识别画面里看得见的内容（人脸、路牌、屏幕），只处理隐藏的元数据。
- v0.1 不支持视频。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `exif-privacy-cleaner/` 文件夹；选择“原图旁边”时会在照片旁边写入 文件名-clean 副本（不会覆盖原图）。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/exif-privacy-cleaner/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-exif-privacy-cleaner test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
