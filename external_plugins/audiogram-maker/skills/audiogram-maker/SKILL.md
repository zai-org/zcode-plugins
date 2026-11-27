---
name: audiogram-maker
description: 把播客或音频片段做成发社交平台的短视频：动态波形、封面图、标题和副标题、进度条，以及烧录进画面的字幕。选择音频，可加封面图和字幕（SRT、LRC，或每行一句的纯文本，按长度自动分配到片段里）。用片段开始/结束从一整期节目里截一段，选方形、竖屏或横屏，设置颜色和波形样式，在表格里改字幕时间；时间倒置、字幕重叠、字幕太长放不下都会在渲染前提示。导出 MP4（H.264 + AAC）、做缩略图用的封面 PNG，以及按片段重新计时的 SRT。在本地用 ffmpeg 运行，不用登录，无需 API 密钥。 用户提到“音频波形视频 / audiogram / 播客短视频 / 音频转视频 / 波形视频”时使用。
---

# 音频波形视频

1. `audiogram_open(inputs, settings?, project?)`：读取音频、封面和字幕，排好视频版面。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传音频，可加封面图（png/jpg/webp）和字幕（.srt/.lrc/.txt）；settings 可带 format（square/vertical/landscape）、clipStart/clipEnd（mm:ss）、title、subtitle。
   - 每行一条字幕，start/end 是原音频里的时间 mm:ss.xx，不是片段内时间。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `audiogram_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改字幕时间：`set: [{row, values: {end: "00:14.80"}}]`；改片段：`settings: {clipStart: "00:04", clipEnd: "00:22"}`；换颜色：`settings: {accent: "#f59e0b"}`。
4. `audiogram_export(project, formats?)`：导出 <标题>.mp4、<标题>-poster.png 和 <标题>.srt。把文件路径告诉用户。
5. 用户没说的字幕不要改；导出 MP4 需要几秒到几十秒。
