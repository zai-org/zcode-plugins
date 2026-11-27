---
name: lyrics-lrc-maker
description: 给歌词打时间轴，导出 LRC 和 SRT。选择歌词（纯文本每行一句，或者已有的 LRC 重新打轴）和歌曲，自动从音频里找出唱的段落，再按每句的长度对上去，一句跨两口气、几句短词挤在一段里也能对准。每一句的时间都能直接改，也可以整体偏移，加上歌名、歌手标签，导出标准 LRC、卡拉 OK 播放器用的逐字 LRC 和剪辑软件用的 SRT 字幕。没有音频时按固定间隔排好，再手动微调。在本地用 ffmpeg 运行，不用登录，无需 API 密钥。 用户提到“歌词时间轴 / 打轴 / LRC / 逐字歌词 / 歌词字幕”时使用。
---

# 歌词时间轴

1. `lrc_open(inputs, settings?, project?)`：读取歌词并按歌曲打轴。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传歌词 .txt/.lrc 和歌曲音频；每行一句，start/end 是 mm:ss.xx。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `lrc_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改某句时间：`set: [{row, values: {start: "00:23.40"}}]`；整体偏移：`settings: {offset: 200}`（毫秒，正数延后）；按音频重打：`settings: {retime: "audio"}`。
4. `lrc_export(project, formats?)`：导出 <歌名>.lrc、<歌名>.enhanced.lrc 和 <歌名>.srt。把文件路径告诉用户。
5. 时间要单调递增；用户没说的行不要改。
