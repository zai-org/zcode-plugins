# 尺码表制作

用尺寸数据做商品详情页的尺码表图片。打开 CSV 或 Excel 尺寸表：每行一个尺码（S/M/L、160/84A、36…），每列一项尺寸（胸围、衣长、肩宽、袖长…，可写数字或 88-92 这样的范围）。会标出把 0 打成字母 O 之类的错误，以及尺码变大尺寸反而变小的可疑数据，改好后再出图。可显示厘米、英寸或两者，表头中文、英文或中英，选简洁、醒目或精品样式，高亮推荐尺码，导出清晰的 PNG、SVG、可直接贴到店铺页面的 HTML 表格和整理后的 Excel。在本地运行，不用登录，无需 API 密钥。

## 功能

- **适用各种服装**：第一列是尺码，其余每个表头都是一项尺寸；单元格里的数字、范围和单位都能识别。
- **数据检查**：非数字（如 7O）、空单元格、重复尺码、尺码变大尺寸变小。
- **单位**：厘米、英寸或两者，按表格原单位自动换算；体重、鞋码列保持原样。
- **中英表头**：常见尺寸名自动配英文（胸围 Chest、衣长 Length…）。
- **三种样式**，可选主色并高亮推荐尺码。
- **导出**：2 倍 PNG、SVG、可直接粘贴的 HTML 表格和整理后的 XLSX。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `size-chart-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 sizes.csv 做一张尺码表”
- “显示厘米和英寸，表头中英双语”
- “高亮 L 码，导出 PNG”

## 工具

| 工具 | 作用 |
|---|---|
| `sizechart_open` | 读取尺寸表并检查数据，并打开面板 |
| `sizechart_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `sizechart_status` | 查看当前数据、问题和汇总 |
| `sizechart_export` | 导出 size-chart.png、size-chart.svg、size-chart.html 和 size-chart.xlsx |

导出文件写到工作区的 `size-chart-maker/<项目>/` 文件夹。

## 范围（v0.1）

- 尺寸列来自表格表头；要加列或改名，请改表格后重新打开。
- v0.1 不做中/欧/美尺码互换。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `size-chart-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/size-chart-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-size-chart-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：exceljs (MIT), resvg-wasm (MPL-2.0), fontkit (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
