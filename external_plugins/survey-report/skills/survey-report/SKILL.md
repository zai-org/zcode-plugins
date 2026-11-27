---
name: survey-report
description: 把问卷导出表变成一份完整报告。放入问卷工具导出的表格（每行一份回答），每道题自动识别题型（单选、多选、评分、NPS、数字、开放题），生成柱状图或饼图、人数和占比。可以改题目文字、换图表、去掉某些题，还能按一道题（如年龄段、渠道）对所有题做交叉分析。导出网页报告、A4 PDF 和 Excel（含统计、交叉表和全部文字回答）。在本地运行，不用登录问卷平台，无需 API 密钥。 用户提到“问卷结果 / 调查报告 / 问卷星导出 / NPS / 交叉分析”时使用。
---

# 问卷结果报告

1. `survey_open(inputs, settings?, project?)`：读取问卷数据并识别题型。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 每行一份回答、每列一道题；打开后网格的每一行是一道题。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `survey_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改题：`set: [{row, values: {label, type: single|multi|rating|nps|number|text|skip, chart: bar|pie|none, include}}]`；交叉分析：`settings: {crossBy: "Q1"}`（单选题题号或题目文字）。
4. `survey_export(project, formats?)`：导出 report.html、report.pdf 和 results.xlsx。把文件路径告诉用户。
5. 开放题不会被总结，只原样列出；如需要，可以读 results.xlsx 的“开放题”表再自己归纳。
