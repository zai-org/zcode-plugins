# 问卷结果报告

把问卷导出表变成一份完整报告。放入问卷工具导出的表格（每行一份回答），每道题自动识别题型（单选、多选、评分、NPS、数字、开放题），生成柱状图或饼图、人数和占比。可以改题目文字、换图表、去掉某些题，还能按一道题（如年龄段、渠道）对所有题做交叉分析。导出网页报告、A4 PDF 和 Excel（含统计、交叉表和全部文字回答）。在本地运行，不用登录问卷平台，无需 API 密钥。

## 功能

- **自动识别题型**：单选、多选（┋ , ; 、 | 分隔）、评分（1–5、1–7、1–10）、NPS（0–10）、数字、开放题；序号、时间、联系方式等列自动跳过。
- **图表**：每题柱状图或饼图；NPS 按贬损者／中立者／推荐者着色。
- **得分**：评分题平均分和高分占比，NPS 及三类人群占比，数字题平均数、中位数和范围。
- **交叉分析**：选一道单选题（如年龄段），其他所有题按它分组统计。
- **导出前可编辑**：改题目文字、换题型或图表、去掉某些题。
- **三种输出**：独立网页报告、A4 PDF、Excel（统计、交叉表、全部文字回答和原始数据）。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `survey-report/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 survey.xlsx 生成问卷报告”
- “按年龄段做交叉分析”
- “看看 NPS 和用户建议”

## 工具

| 工具 | 作用 |
|---|---|
| `survey_open` | 读取问卷数据并识别题型，并打开面板 |
| `survey_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `survey_status` | 查看当前数据、问题和汇总 |
| `survey_export` | 导出 report.html、report.pdf 和 results.xlsx |

导出文件写到工作区的 `survey-report/<项目>/` 文件夹。

## 范围（v0.1）

- 每行一份回答；矩阵题若每行一列，会作为多道题分别统计。
- 开放题原样列出，不做情感分析或 AI 总结。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `survey-report/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/survey-report/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-survey-report test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
