---
name: video-frame-grabber
description: 从视频里截取画面并做成小样图。可以按场景变化截取（每次换镜头或换幻灯片取一张，拍摄素材、幻灯片和录屏都能调），也可以每隔 N 秒截一张，或者平均截 N 张。每一帧是一行，改时间就能挪位置，可以加标签、取消勾选，或者在指定时间点加一帧。淡入淡出时的黑帧、几乎重复的帧、超出视频结尾的时间都会提示。导出 JPG 或 PNG 图片（按视频名、序号、时间和标签命名）、带时间码的小样图 PNG，以及 CSV 帧列表。在本地用 ffmpeg 运行，不用登录，无需 API 密钥。 用户提到“视频截帧 / 视频截图 / 截取画面 / 小样图 / 每隔几秒截一张”时使用。
---

# 视频截帧

1. `frames_open(inputs, settings?, project?)`：读取视频并找出要截的画面。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传视频；settings 可带 mode（scene/interval/count）、sceneThreshold（默认 0.1，幻灯片/录屏用 0.03）、interval、count。
   - 每行一帧：include、video、time（mm:ss.xx）、label。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `frames_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改灵敏度：`settings: {sceneThreshold: 0.03}`（会重新检测）；加帧：`add: [{time: "00:40.00"}]`；标签：`set: [{row, values: {label: "封面"}}]`。
4. `frames_export(project, formats?)`：导出 frames/、contact-sheet.png 和 frames.csv。把文件路径告诉用户。
5. 用户没说的帧不要改；超出结尾的帧要删掉或改时间。
