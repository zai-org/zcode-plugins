---
name: word-count-report
description: 批量统计一整个文件夹的稿件字数（Word、Markdown、纯文本、PDF），按中文编辑和译者的口径：中文字符、中文标点、英文单词分开统计，“字数”合计与 Word 一致。每个文件按标题或“第一章 / Chapter 1”分章，给出阅读时长，还可以按千字单价算稿费。可以排除代码块、表格、参考文献和自定义规则匹配的段落，也可以关掉某个章节。导出 Excel 或 CSV 报告。在本地运行，不上传文件，无需账号或 API 密钥。 用户提到“字数统计 / 统计字数 / 稿费 / 千字 / 每章多少字”时使用。
---

# 字数统计

1. `wordcount_open(inputs, settings?, project?)`：读取文档并按章节统计字数。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 可以传文件夹：`inputs: ["manuscripts"]`；`settings.split` 为 chapter 或 file。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `wordcount_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 关掉某章：`set: [{row, values: {include: false}}]`；排除规则写在 `settings.exclude`（每行一条文字或 /正则/）；`settings.stopAt` 控制从哪个标题起不计。
4. `wordcount_export(project, formats?)`：导出 word-count.xlsx 和 word-count.csv。把文件路径告诉用户。
5. “字数”= 中文字符 + 中文标点 + 其他单词，和 Word 的“字数”一致；需要“字符数（不含空格）”时看 chars 列。
