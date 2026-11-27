---
name: code-stats
description: 统计一个项目的代码量：40 多种语言的代码行、注释行、空行，按文件夹汇总，并列出最大的文件。遵守项目的 .gitignore，跳过 node_modules、.git 和构建目录，并提示压缩或自动生成的文件，避免把数字撑大。可以排除文件夹或规则、取消单个文件，然后导出带柱状图的 HTML 报告、Excel 明细和 CSV 汇总。在本地运行，不上传，无需 API 密钥。 用户提到“代码统计 / 多少行代码 / 代码量 / 各语言占比 / cloc / LOC”时使用。
---

# 代码统计报告

1. `codestats_open(inputs, settings?, project?)`：扫描项目文件夹，按文件和语言统计行数。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传项目文件夹（如 `["tea-shop"]`）；也可以传几个文件。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `codestats_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 排除文件夹或规则用 `settings: {exclude: "scripts/, *.min.js"}`；取消单个文件用 `set: [{row, values: {include: false}}]`。
4. `codestats_export(project, formats?)`：导出 code-stats.html、code-stats.xlsx 和 languages.csv。把文件路径告诉用户。
5. 只报告插件统计出的数字，不要自己估算。
