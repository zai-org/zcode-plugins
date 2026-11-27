# 会议纪要整理

把零散的会议笔记或逐字稿整理成规范的会议纪要：识别日期、参会人、议程、决定、待定问题和行动项，找出每个行动项的负责人和截止日期（“周五前”“下周一”“by Friday”等按会议日期换算），没有负责人或截止日期的会提示出来。在表格里修改后，导出 Word 纪要、Markdown 和日历文件（每个截止日期一条提醒）。在本地运行，不上传，无需 API 密钥。

## 功能

- **笔记或逐字稿**：Markdown / 纯文本笔记、“名字：内容”格式的逐字稿（可带 [00:01:02] 时间戳）、SRT/VTT 字幕。
- **会议信息**：从“参会人：”“Attendees:”等行和逐字稿说话人识别会议名称、日期、时间、地点、参会人和记录人。
- **自动分类**：按章节标题（议程、决定、行动项、Agenda、Decisions…）和措辞（决定/同意/agreed、TODO/[ ]/负责/我来/can you、问号）分成议程、决定、行动项、待定问题和讨论要点。
- **负责人和截止日期**：@名字、“负责人：”、行里提到的参会人，或说“我来 / I'll”的发言人；日期支持 周五前、下周一、11月22日、月底、三天内、by Friday、next Monday、tomorrow、Dec 3。
- **检查**：行动项缺负责人或日期、负责人不在参会名单、截止日期早于会议日期。
- **导出**：带行动项表格的 Word 纪要、Markdown、.ics 日历文件（全天或定时提醒）和行动项 CSV。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `meeting-minutes/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把今天的会议记录整理成纪要”
- “列出行动项、负责人和截止日期”
- “把截止日期做成日历提醒”

## 工具

| 工具 | 作用 |
|---|---|
| `minutes_open` | 读取会议记录，分成议程、决定、行动项和问题，并打开面板 |
| `minutes_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `minutes_status` | 查看当前数据、问题和汇总 |
| `minutes_export` | 导出 minutes.docx、minutes.md、actions.ics 和 actions.csv |

导出文件写到工作区的 `meeting-minutes/<项目>/` 文件夹。

## 范围（v0.1）

- 处理文字：录音需要先转成文字。
- 分类依据标题和措辞，不做 AI 总结——发出前请检查表格。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `meeting-minutes/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/meeting-minutes/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-meeting-minutes test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：docx (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
