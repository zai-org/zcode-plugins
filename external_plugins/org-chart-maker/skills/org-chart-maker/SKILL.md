---
name: org-chart-maker
description: 把一份员工名单变成清晰的组织架构图。每人只需要姓名、职位、部门和直属上级，自动排版，按部门或层级配色，人数多的小组会整齐竖排。可以折叠某个分支显示“+N”、限制显示的层数，在“上级”列里改汇报关系——找不到的上级、循环汇报和重名都会标出来。导出 SVG、高清 PNG 和一页 PDF。在本地运行，不用登录，无需 API 密钥。 用户提到“组织架构图 / 架构图 / 组织结构 / 汇报关系 / 部门结构图”时使用。
---

# 组织架构图

1. `orgchart_open(inputs, settings?, project?)`：读取员工名单并建立汇报关系树。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 名单列：姓名、职位、部门、上级（上级的姓名）。也可以 `inputs: []` 空白开始再用 add 添加。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `orgchart_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改汇报关系：`set: [{row, values: {manager: "陈总"}}]`；折叠团队：`values: {collapsed: true}`；只显示两层：`settings: {depth: 2}`；新增：`add: [{name, title, dept, manager}]`。
4. `orgchart_export(project, formats?)`：导出 org-chart.svg、org-chart.png 和 org-chart.pdf。把文件路径告诉用户。
5. 上级找不到或有循环时要提醒用户。
