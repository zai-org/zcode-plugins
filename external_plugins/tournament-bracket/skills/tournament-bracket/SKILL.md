---
name: tournament-bracket
description: 用一份参赛名单办公司或学校比赛：生成单循环（或主客双循环），或按种子排位、高种子轮空的淘汰赛（可加三四名决赛），给每轮排日期，边比赛边录比分，实时得到积分榜或填好的对阵图。已经打完的比分可以从表格导入。积分榜按积分（胜/平/负积分可设）排名，再看相互战绩、净胜分、总得分；淘汰赛胜者自动晋级，平局需要写决胜分如 2(4):2(3)。会发现比分和队名的笔误、重复的队伍和种子、对阵还没确定就录了比分、同一队同一天被排两场，以及需要抽签或加赛的同分。导出含赛程和交叉表的积分榜 Excel、可发群里的对阵图/积分榜 SVG 和 PNG，以及带比分格的可打印赛程表。不用登录，无需 API 密钥，本机运行。 用户提到“赛程 / 对阵表 / 循环赛 / 淘汰赛 / 积分榜 / 录比分”时使用。
---

# 赛程对阵

1. `bracket_open(inputs, settings?, project?)`：读取参赛名单并生成赛程。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传参赛名单 .csv/.xlsx（或含名单和已赛比分的文件夹）；每行一场：id、round、_home、score、_away、_date、venue、_winner。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `bracket_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 录比分：`set: [{row, values: {score: "21:15"}}]`（顺序是 主:客）；改赛制：`settings: {format: "knockout"}`；排日期：`settings: {start: "2026-12-05", every: 7}`。
4. `bracket_export(project, formats?)`：导出 standings.xlsx、bracket.svg、bracket.png 和 schedule.pdf。把文件路径告诉用户。
5. 录比分前核对行号对应的对阵（_home / _away），比分顺序按 主:客。
