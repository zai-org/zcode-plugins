---
name: audio-splitter
description: 把长录音切成多段：讲座按章节、播客按段落、现场录音按歌曲。打开音频（或视频的声音），可以按停顿自动切、按固定时长切，或者按章节表里的时间切；再给一份只有标题的清单，就按顺序给每段命名。太短的片段会并到相邻段，太长的会在最长的停顿处再切一刀。每个切点都能改，可以改名或跳过某段，最后导出带序号的音频文件（不重新编码直接复制，或转成 MP3、M4A、WAV，并写入标题、音轨号、专辑标签）、分段清单 CSV、YouTube 章节时间戳和 CUE 文件。在本地用 ffmpeg 运行，不用登录，无需 API 密钥。 用户提到“切分音频 / 分割录音 / 按静音切 / 讲座分章节 / 播客分段”时使用。
---

# 长音频切分

1. `split_open(inputs, settings?, project?)`：找出录音的切分点。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传音频，可再传一个章节/标题清单 .txt；每行一段，start/end 是时间。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `split_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 移动切点：`set: [{row, values: {start: "00:30.00"}}]`（相邻段的 end 也要一起改）；改名：`values: {title: "…"}`；跳过：`values: {include: false}`；静音参数：`settings: {noise: -40, minSilence: 0.8}`。
4. `split_export(project, formats?)`：导出 tracks/序号 标题.扩展名、tracks.csv、chapters.txt 和 album.cue。把文件路径告诉用户。
5. 切分数和标题数不一致时先告诉用户，不要乱配标题。
