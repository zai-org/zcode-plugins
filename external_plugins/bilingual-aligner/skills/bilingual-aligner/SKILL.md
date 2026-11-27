---
name: bilingual-aligner
description: 把原文和译文逐句对齐，做成翻译记忆。选择原文和译文（文本、Markdown 或 Word），两边自动分句，再用成熟的按长度对齐算法加上数字锚点对齐，一句译成两句、两句并成一句也能对上。需要人工看一眼的行会标出来：找不到对应的句子、长度比例异常，以及两边数字不一致（常常就是真正的翻译错误）。可以改文字、合并或删除行，最后导出 Excel、Trados/memoQ/OmegaT 用的 TMX、制表符文本和左右对照 HTML。在本地运行，不用登录，无需 API 密钥。 用户提到“双语对齐 / 句对齐 / 翻译记忆 / TMX / 原文译文对照”时使用。
---

# 双语句对齐

1. `align_open(inputs, settings?, project?)`：两边分句并对齐。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传两个文件：第一个是原文，第二个是译文；每行一个句对。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `align_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改译文：`set: [{row, values: {tgt: "…"}}]`；与下一行合并：`values: {merge: true}`；删除：`values: {include: false}`。
4. `align_export(project, formats?)`：导出 aligned.xlsx、aligned.tmx、aligned.tsv 和 aligned.html。把文件路径告诉用户。
5. 数字不一致的提示要先确认哪边错了；只改明显的数字错误，不要润色译文。
