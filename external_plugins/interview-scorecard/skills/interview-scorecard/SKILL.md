---
name: interview-scorecard
description: 把多位面试官的评分表汇总成一份公平的加权排名。用 Markdown 写一次评分维度——权重、1–5 分（或任意分制）、录用线，以及每个分数档的行为描述——再放入评分表（Excel 或 CSV，一行一位候选人 × 一位面试官；列名自动对应维度，支持别名）。它按维度和权重给每位候选人算平均分，给出 建议录用 / 待定 / 需讨论 / 不建议，并发现表格发现不了的问题：把 4.5 打成 45、漏打分、重复的评分表、同一维度面试官相差 2 分以上、“强烈推荐”却分数不及格、打了极端分却没写依据、面试官打分偏松或偏严（可选校准）。导出排名表、每位候选人一页的 PDF 评分卡（含每位面试官的分数和评语）和带评分描述的空白评分表。不用登录，无需 API 密钥，数据都在本机。 用户提到“面试评分 / 评分表汇总 / 面试官打分 / 候选人排名”时使用。
---

# 面试评分表

1. `scorecard_open(inputs, settings?, project?)`：读取评分维度和评分表，给候选人排名。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传包含评分维度 .md 和评分表 .xlsx/.csv 的文件夹；每行一份评分表：candidate、interviewer、round、c0…cN（各维度分）、verdict、comment；_avg 是该表加权分。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `scorecard_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改分：`set: [{row, values: {c1: "4.5"}}]`；去掉重复：`values: {include: false}`；改录用线：`settings: {threshold: 3.8}`；校准：`settings: {calibrate: true}`。
4. `scorecard_export(project, formats?)`：导出 ranking.xlsx、scorecards.pdf 和 blank-scorecard.pdf。把文件路径告诉用户。
5. “45” 这类超出分制的值通常是漏了小数点，先和用户确认再改。
