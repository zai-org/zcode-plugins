---
name: video-compressor
description: 把一整个文件夹的视频压小，方便分享、上传或存档。每个文件可以选画质方案或指定大小，限制最大分辨率，决定声音怎么处理，开始前就能看到预计大小。每个视频都会转成到处都能播放、可以边下边播的 H.264 MP4；如果压不小就保留原文件。报告里列出压缩前后的大小。使用电脑上已安装的免费 ffmpeg，不上传，无需 API 密钥。 用户提到“压缩视频 / 视频太大 / 批量压缩 / 压到多少 MB / 转成 MP4 / 降低分辨率”时使用。
---

# 视频批量压缩

1. `vcompress_open(inputs, settings?, project?)`：读取视频信息并估算压缩后大小。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 可以传文件夹；需要本机已安装 ffmpeg，没装时 open 会返回安装提示，请转告用户。
   - 预计大小只是粗略估计（指定大小方案除外）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `vcompress_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 某个文件压到指定大小：`set: [{row, values: {preset: "target", targetMB: 25}}]`；maxHeight 取 keep/2160/1440/1080/720/540/480/360。
4. `vcompress_export(project, formats?)`：逐个压缩成 MP4 并生成 compress-report.csv。把文件路径告诉用户。
5. 导出到 compressed/ 下，原文件不变；大文件编码较慢，开始前告诉用户大概要等一会儿。
