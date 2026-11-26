# 证书奖状批量

用一张证书底图（PNG/JPG）和一份名单批量生成可打印的证书、奖状：用带 {列名} 的文字行设置位置、字号、颜色和对齐，名字太长会自动缩小。检查空名字，在面板里修改名单、预览第一张证书，导出合并的 PDF 和每人一份的 PDF。中文使用电脑上已有的字体。在本地运行，无需 API 密钥。

## 功能

- **输入**：一张底图（不含名字的证书设计稿，宽 2000 像素以上打印更清楚）和一份 .xlsx/.csv 名单。
- **排版**：每段文字一行——`文字 | 横向% | 纵向% | 字号 | 颜色 | left/center/right | bold | 最大宽度%`。文字可以把固定内容和 `{列名}` 混写，比如 `{姓名}`、`兹授予 {姓名}`。
- **自动缩字**：超过最大宽度的文字逐步缩小（最小到 45%），仍放不下的会标出来。
- **检查**：排版用到的字段表格里没有、字段为空（会阻止导出）、底图分辨率太低。
- **输出**：按底图比例（A4 宽度）的合并 PDF，以及可选的每人一份 PDF，文件名可自定义。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `certificate-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 颁奖/certificate-bg.png 给 颁奖/winners.xlsx 里的每个人做证书”
- “最后一行没有名字，应该是宋雨桐”
- “奖项那一行往下挪一点，然后导出 PDF”

## 工具

| 工具 | 作用 |
|---|---|
| `certificate_open` | 读取底图和名单并排好文字，并打开面板 |
| `certificate_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `certificate_status` | 查看当前数据、问题和汇总 |
| `certificate_export` | 导出 certificates.pdf（每人一页）和 each/<文件名>.pdf |

导出文件写到工作区的 `certificate-maker/<项目>/` 文件夹。

## 范围（v0.1）

- v0.1 用排版文字里的百分比设置位置（不能拖动），每次修改后预览会更新。
- 底图需为 PNG 或 JPG（PDF/AI 设计稿请先导出 PNG）。只用一种字体（系统中文字体的常规和粗体）。
- 不含电子签名、二维码验真或邮件发送。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `certificate-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/certificate-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-certificate-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：pdf-lib (MIT), fontkit (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
