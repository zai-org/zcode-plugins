---
name: subtitle-editor
description: 修正跑偏或读不过来的字幕：打开 SRT、WebVTT 或 ASS 文件，整体平移几秒、换算帧率，或者用两个同步点对齐。可以直接改每条字幕的文字和时间，拆开过长的、合并过短的；重叠、读速过快、单行过长和一闪而过的字幕都会按新时间标出来。导出 SRT、VTT、ASS 和检查报告。在本地运行，不上传，无需 API 密钥。 用户提到“字幕平移 / 字幕时间轴 / SRT 转 ASS / VTT 字幕 / 字幕重叠 / 帧率换算”时使用。
---

# 字幕校对转换

1. `subtitle_open(inputs, settings?, project?)`：读取字幕并列出每一条。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings.offset 用秒（-1.5）或时间（00:00:02,000）；settings.sync 每行“字幕时间 = 正确时间”，有同步点时忽略平移和帧率。
   - settings.fps 取 23.976>25、25>23.976、24>25、25>24、23.976>24、24>23.976、29.97>25、25>29.97。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `subtitle_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行 action：keep / merge（与下一条合并）/ split（在“|”、换行或中间拆开）/ delete。
   - 改文字：`set: [{row, values: {text: "第一行\n第二行"}}]`。
4. `subtitle_export(project, formats?)`：导出 SRT、VTT、ASS 和检查报告。把文件路径告诉用户。
5. 导出 <name>.srt / .vtt / .ass；settings.name 可改文件名。
