---
name: exam-builder
description: 用 Markdown/Excel 题库组卷：检查题库（缺答案、缺图、公式错误、重复题），按题型/章节/难度比例抽题，出多套不重复的 A/B 卷，换题，导出试卷和答案册 PDF/HTML。用户提到“组卷 / 出卷 / 试卷 / 题库 / 答案册 / A卷B卷”时使用。
---

# 题库与试卷制作

1. `exam_bank(files)`：载入 .md / .xlsx / .csv 题库，报告题量（章节 × 题型、难度）和问题（文件:行号）。
   - 有问题的题组卷时会跳过；把问题清单告诉用户，让他们改题库后再载入。不要自己改题库文件，除非用户要求。
   - 题库格式见 README：`# 章节`、`## 单选 | 易 | 5分 | id: F-01`、选项 `A. …`、`答案：`、`解析：`；公式用 `$…$`。
2. `exam_build(title, sections, difficulty?, chapters?, sets?, seed?, duration?)`：sections 按卷面顺序给出，例如 `[{type:"single",count:8,score:5},{type:"fill",count:4},{type:"short",count:2,score:12}]`。
   - 用户没给的规则（题数、分值、难度比例、套数）要先问；“A、B 卷”表示 `sets: 2`，各套之间不重复。
   - 结果里的 ⚠ 提示（某难度不够、题不够）要转告用户。
3. 用户想换某道题时用 `exam_swap(set, id)`；用户在面板里也可以直接换。
4. `exam_export()`：输出到 `exams/<标题>/`，包括每套卷的试卷 PDF、答案 PDF、两个 HTML 和 paper.json。把文件路径和页数告诉用户。
5. 全部本地处理，不联网。
