---
name: bilingual-subtitles
description: 把两种语言的字幕（比如中文和英文）按时间合并成一条双语字幕。两种语言断句不同的地方会自动拼在一起，没配上的字幕会单独列出，方便挪动或删掉；导出前可以改任何文字和时间，然后导出双语 SRT、WebVTT，或者上下两种字号颜色的 ASS。在本地运行，不上传，无需 API 密钥。 用户提到“双语字幕 / 中英字幕合并 / 两个字幕合成一个 / 上下双语 / ASS 双语样式”时使用。
---

# 双语字幕合并

1. `bilingual_open(inputs, settings?, project?)`：读取两个文件并按时间配对。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 正好两个文件；settings.order 取 auto / first / second；timing 取 top / union。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `bilingual_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改下行：`set: [{row, values: {bottom: "…"}}]`；去掉一行：`values: {keep: false}`。
   - match 为“仅上行/仅下行”的行通常需要挪文字或删掉。
4. `bilingual_export(project, formats?)`：导出双语 SRT、VTT、ASS 和 pairs.csv。把文件路径告诉用户。
5. 导出 <name>.srt / .vtt / .ass 和 pairs.csv，settings.name 默认 bilingual。
