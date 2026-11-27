---
name: pinyin-annotator
description: 给中文加注拼音，做儿童读物、课文和生字卡。打开文本或 Markdown 文件，每个字按词语上下文自动注音，多音字逐个列出上下文和可选读音。“还书”“朝阳”“数星星”“种花”和状语“地”这类拼音库常读错的地方会标出建议读音，确认一下就能改；也可以用自定义词语一次改掉全文同一个词。可选声调符号、数字声调或不标调，正文或田字格版式，导出注音 HTML、A4 PDF、可打印的生字卡和纯拼音文本。在本地运行，不用登录，无需 API 密钥。 用户提到“加拼音 / 注音 / 多音字 / 生字卡 / 田字格”时使用。
---

# 拼音标注

1. `pinyin_open(inputs, settings?, project?)`：注音并列出多音字。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传 .txt/.md；每行是一个多音字（context 里用【】标出），_hint 有值表示自动读音可能错了。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `pinyin_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改单个读音：`set: [{row, values: {reading: "zhāo"}}]`（也可写 zhao1）；全文统一改一个词：`settings: {custom: "还书: huan2 shu1"}`；生字卡：`settings: {cards: "朝背种数"}`；田字格：`settings: {layout: "grid"}`。
4. `pinyin_export(project, formats?)`：导出 pinyin.html、pinyin.pdf、cards.pdf 和 pinyin.txt。把文件路径告诉用户。
5. 只按提示改明显错误；没有提示的读音不要擅自改。
