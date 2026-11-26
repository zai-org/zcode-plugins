---
name: todo-collector
description: 把代码里所有的 TODO、FIXME、HACK、BUG 注释汇总成一张清单：从 TODO(名字) 读出负责人，从 !!! 或“紧急”判断优先级；在 git 仓库里还能看到每条是谁、什么时候写的，放了很久被遗忘的一眼就能看出来。在表格里设好优先级和负责人，再导出可以导入任务系统的 CSV，或者按优先级、负责人、文件分组的 TODO.md 清单。在本地运行，不需要任务系统账号或 API 密钥。 用户提到“汇总 TODO / 代码待办 / FIXME 清单 / 技术债清单 / 找出代码里的 TODO”时使用。
---

# 代码待办汇总

1. `todos_open(inputs, settings?, project?)`：扫描文件夹里源代码的 TODO 类注释。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 是代码文件夹（工作区根用 "."）；settings: {tags: "TODO,FIXME,HACK,XXX,BUG", blame: true, groupBy: "priority", staleDays: 180}；groupBy 可为 priority/owner/file。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `todos_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一条待办：`set: [{row, values: {include, priority, owner, text}}]`；priority 取 high/normal/low。改 tags 会重新扫描，已改的优先级和负责人会保留。
4. `todos_export(project, formats?)`：导出 todos.csv 和 TODO.md。把文件路径告诉用户。
5. 没有 git 历史时作者、日期为空，这是正常的。
