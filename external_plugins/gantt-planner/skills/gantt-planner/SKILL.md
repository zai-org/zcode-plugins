---
name: gantt-planner
description: 把一张简单的任务清单变成带真实工作日日期的甘特图。写上任务、工期（工作日）、负责人和前置任务，插件会让每个任务在前置任务完成后的下一个工作日开始，跳过周末和你列出的节假日，标出里程碑，并高亮关键路径——决定完工日期的那条任务链。指定开始日期、改工期或改依赖，所有日期自动跟着变。导出 SVG 和 PNG 甘特图、Excel 排期表和网页。在本地运行，不用登录，无需 API 密钥。 用户提到“甘特图 / 项目计划 / 排期 / 关键路径 / 什么时候能完工 / 进度计划”时使用。
---

# 甘特图计划

1. `gantt_open(inputs, settings?, project?)`：读取任务，按工作日和依赖关系排期。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 任务表列：编号、任务、负责人、开始（可选）、工期（工作日）或结束日期、前置（编号，逗号分隔）、进度。也可以 `inputs: []` 空白开始，再用 add 添加任务。节假日用 `settings: {holidays: "2026-12-25, 2027-01-01"}`。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `gantt_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改工期：`set: [{row, values: {duration: 12}}]`；改依赖：`values: {depends: "4,5"}`；新增任务：`add: [{id: "9", task: "…", duration: 3, depends: "6"}]`。
4. `gantt_export(project, formats?)`：导出 gantt.svg、gantt.png、schedule.xlsx 和 gantt.html。把文件路径告诉用户。
5. 完工日期和关键路径以插件结果为准，不要自己推算。
