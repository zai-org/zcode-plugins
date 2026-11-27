---
name: flashcard-maker
description: 把词表变成可以双面打印的单词卡，以及可以导入背诵软件的文件。可以用表格（单词、音标/拼音、释义、例句、标签），也可以用纯文本词表。每页 8、9、10、12、18 或 24 张，背面自动镜像排版，双面打印（长边或短边翻转）后正反面对齐。文字自动缩放，带裁切虚线和卡片编号；也可以反向制作（看释义想单词）。可以修改或跳过个别卡片，然后导出打印 PDF、带标签的 Anki 导入文件和通用 CSV（Quizlet 等）。在本地运行，不用登录任何 App，无需 API 密钥。 用户提到“单词卡 / 背单词卡片 / 闪卡 / 导入 Anki / 打印生词卡”时使用。
---

# 单词卡制作

1. `flashcards_open(inputs, settings?, project?)`：读取词表并排版单词卡。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 表格或 .txt 都可以；打开后每行一张卡。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `flashcards_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改卡：`set: [{row, values: {front, reading, back, example, tags, include}}]`；版式：`settings: {grid: "3x3", flip: "long", reading: "back", reverse: true}`。
4. `flashcards_export(project, formats?)`：导出 flashcards.pdf、anki.tsv 和 cards.csv。把文件路径告诉用户。
5. 提醒用户打印时选“实际大小 / 100%”和对应的双面翻转方式。
