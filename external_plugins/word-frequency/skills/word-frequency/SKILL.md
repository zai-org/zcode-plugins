---
name: word-frequency
description: 统计文档里出现最多的词，并生成词云图。打开文本、Markdown 文件或整个文件夹，中文按词切分、英文统一小写，自动去掉“的、了、the、and”等停用词，也可以加自己的停用词，还能统计二元、三元词组。不要的词可以去掉，同义词可以合并（“顾客”并到“客户”、“AI”并到“人工智能”），最后导出带分文件统计的词频表、CSV，以及可选形状和配色的词云 SVG 和 PNG。在本地运行，不用登录，无需 API 密钥。 用户提到“词频 / 词云 / 高频词 / 关键词统计”时使用。
---

# 词频统计词云

1. `wordfreq_open(inputs, settings?, project?)`：读取文件并统计词频。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 可以传文件夹；每行一个词，count 是次数，files 是分文件次数。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `wordfreq_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 去掉词：`set: [{row, values: {include: false}}]`；合并同义词：`values: {mergeInto: "客户"}`；加停用词：`settings: {stopwords: "季度 本季度"}`（会重新统计，保留之前的取舍）；词组：`settings: {ngram: "2"}`。
4. `wordfreq_export(project, formats?)`：导出 word-frequency.xlsx、word-frequency.csv、wordcloud.svg 和 wordcloud.png。把文件路径告诉用户。
5. 回答时列出前 10 个词和次数即可。
