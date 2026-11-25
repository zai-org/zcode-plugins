---
name: batch-file-renamer
description: 按规则批量重命名整个文件夹：查找替换或正则、带序号/日期/文件夹名的命名模板、大小写和空格整理、扩展名统一小写，也可逐个手动指定新名。改名前就能看到每个文件的“原名 → 新名”和所有冲突，安全执行（互换名字、只改大小写也没问题），留下改名记录，还能撤销上一次改名。在本地运行，无需 API 密钥。 用户提到“批量改名 / 重命名 / 改文件名 / 文件名加序号 / 撤销改名”时使用。
---

# 批量重命名

1. `rename_open(inputs, settings?, project?)`：列出工作区文件夹里的文件并预览新文件名。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传文件夹路径；只改某类文件用 settings.only（如 "jpg,png"）；要子文件夹设 recursive: true。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `rename_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 规则写在 settings（find/replace/regex/template/start/pad/case/spaces/extCase/sort）；单个文件用 `set: [{row, values: {override: "新名"}}]`。
4. `rename_export(project, formats?)`：导出改名清单 rename-plan.csv、实际改名（附 rename-log-*.csv），或撤销上次改名。把文件路径告诉用户。
5. 先 `rename_export` 用 formats ["plan"] 给用户看清单；用户确认后再 formats ["rename"]。撤销用 formats ["undo"]。有 error 时不要尝试改名。
