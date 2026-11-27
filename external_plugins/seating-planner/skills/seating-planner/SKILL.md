---
name: seating-planner
description: 几秒钟排好考场、教室或宴会的座位。打开名单，选择“几排 × 每排几座”或圆桌；考试时同班同学不相邻，指定的人分开坐，好朋友坐一起，需要靠前的人排在前排，宴会可以按亲友或部门尽量同桌。输入座位即可固定，改随机种子重新排其余的人，排不下或冲突的规则都会列出来。导出可打印的座位表 PDF（附按姓名查座位的清单）和 Excel。在本地运行，不用登录，无需 API 密钥。 用户提到“排座位 / 座位表 / 考场座位 / 教室座位 / 宴会排桌 / 婚礼座位”时使用。
---

# 座位编排

1. `seats_open(inputs, settings?, project?)`：读取名单并按规则分配座位。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 名单列：姓名、班级/分组、前排（是/否）、分开（姓名，逗号分隔）、一起（姓名）、座位（可选，写了就固定）。布局用 settings：`{layout: "grid", rows: 6, cols: 8}` 或 `{layout: "tables", tables: 4, tableSize: 10}`。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `seats_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 固定座位：`set: [{row, values: {seat: "R6C8"}}]`（自动设为固定）；取消固定：`values: {locked: false}`；重新打乱：`settings: {seed: "新的种子"}`。
4. `seats_export(project, formats?)`：导出 seating-chart.pdf 和 seating.xlsx。把文件路径告诉用户。
5. 座位以插件结果为准；有冲突时告诉用户是哪几个人。
