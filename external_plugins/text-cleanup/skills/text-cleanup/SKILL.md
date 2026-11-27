---
name: text-cleanup
description: 清理 Markdown 和纯文本中的中文、中英混排：中文句子里的半角标点、全角字母数字、省略号和破折号、直引号、中英文和数字之间的空格、标点前后多余的空格、连续空格和多余空行。代码块、行内代码、链接地址和 front matter 不会改动。每一处修改都能对照查看，可以跳过或手动改，然后导出清洗后的文件副本、diff 和修改清单，原文件保持不变。在本地运行，不上传，无需 API 密钥。 用户提到“中文排版 / 标点全角半角 / 中英文加空格 / 清理多余空行 / 文案格式”时使用。
---

# 中文文本排版清洗

1. `cleanup_open(inputs, settings?, project?)`：读取文件并列出所有要修改的行。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 可以传文件夹；每个规则是 settings 里的一个开关（fullwidthAlnum、punct、ellipsis、quotes、spaceCjkLatin、punctSpace、collapseSpaces、repeatPunct、trailing、blankLines）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `cleanup_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 跳过某处：`set: [{row, values: {accept: false}}]`；手改：`values: {after: "…"}`。
4. `cleanup_export(project, formats?)`：导出清洗后的副本、changes.diff 和 changes.csv。把文件路径告诉用户。
5. 导出的是副本（cleaned/ 下），原文件不变；需要覆盖原文件时请用户自己替换。
