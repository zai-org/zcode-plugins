# 卡牌打印排版

把一文件夹的卡牌图片排成可直接打印的拼版页，适合桌游卡、塔罗、单词卡、名片。可选卡牌尺寸（扑克、桥牌、塔罗、迷你、名片、方形或自定义），设置出血、间距、纸张和裁切线，每张卡打几份可从数量表读取或直接修改。双面打印时每张正面页后跟一张镜像的背面页，长边/短边翻转都能对齐，每张卡也可以有自己的背面。会发现文件夹里缺的图片、按打印尺寸分辨率太低、比例不对或没有出血的卡面、开了双面却没有背面、数量写错、重复列出、尺寸放不下纸张，以及最后一页的空位。导出 print-sheets.pdf、backs.pdf 和 card-list.csv。本地运行。

## 功能

- **尺寸**：扑克、桥牌、塔罗、迷你、名片、方形或自定义 宽x高 mm；出血、间距、A4/Letter/A3、纵横向。
- **双面**：长边/短边翻转的镜像背面页；统一卡背或每张单独卡背。
- **印刷标记**：每条裁切线都有裁切标记；卡面铺满裁边或完整显示。
- **检查**：缺图、打印分辨率、比例不对或没出血、缺背面、数量错误、重复、空位。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `card-print-sheets/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 卡牌 里的卡面排成打印页”
- “用 back.png 做双面打印”
- “导出打印页”

## 工具

| 工具 | 作用 |
|---|---|
| `cards_open` | 读取卡面图片和数量表，并打开面板 |
| `cards_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `cards_status` | 查看当前数据、问题和汇总 |
| `cards_export` | 导出 print-sheets.pdf、backs.pdf 和 card-list.csv |

导出文件写到工作区的 `card-print-sheets/<项目>/` 文件夹。

## 范围（v0.1）

- 支持 PNG 和 JPEG；不做色彩管理或 CMYK 转换。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `card-print-sheets/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/card-print-sheets/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-card-print-sheets test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
