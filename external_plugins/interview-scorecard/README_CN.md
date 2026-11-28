# 面试评分表

把多位面试官的评分表汇总成一份公平的加权排名。用 Markdown 写一次评分维度——权重、1–5 分（或任意分制）、录用线，以及每个分数档的行为描述——再放入评分表（Excel 或 CSV，一行一位候选人 × 一位面试官；列名自动对应维度，支持别名）。它按维度和权重给每位候选人算平均分，给出 建议录用 / 待定 / 需讨论 / 不建议，并发现表格发现不了的问题：把 4.5 打成 45、漏打分、重复的评分表、同一维度面试官相差 2 分以上、“强烈推荐”却分数不及格、打了极端分却没写依据、面试官打分偏松或偏严（可选校准）。导出排名表、每位候选人一页的 PDF 评分卡（含每位面试官的分数和评语）和带评分描述的空白评分表。不用登录，无需 API 密钥，数据都在本机。

## 功能

- **Markdown 评分维度**：权重、分制、录用线、每档描述；可在设置里改权重。
- **合并多份表**：多个 Excel/CSV，列名自动对应维度，中英文表头均可。
- **排名**：分维度和加权平均分、每人建议、面试官结论统计。
- **检查**：超出分制的笔误、漏打分、重复、分歧、结论与分数矛盾、极端分无依据、面试官松紧。
- **导出**：排名表、每人一页 PDF 评分卡、可打印空白评分表。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `interview-scorecard/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 面试 文件夹里的评分表汇总成排名”
- “把 45 改成 4.5，去掉重复的评分表”
- “导出排名和评分卡”

## 工具

| 工具 | 作用 |
|---|---|
| `scorecard_open` | 读取评分维度和评分表，给候选人排名，并打开面板 |
| `scorecard_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `scorecard_status` | 查看当前数据、问题和汇总 |
| `scorecard_export` | 导出 ranking.xlsx、scorecards.pdf 和 blank-scorecard.pdf |

导出文件写到工作区的 `interview-scorecard/<项目>/` 文件夹。

## 范围（v0.1）

- 分数只辅助决策，不代替决策——请看评语，对有分歧的候选人当面讨论。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `interview-scorecard/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/interview-scorecard/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-interview-scorecard test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
