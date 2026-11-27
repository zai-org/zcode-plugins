---
name: gif-maker
description: 把录屏或视频片段转成体积小的 GIF 或 WebP 动图，放进文档、聊天和问题反馈里。可以裁剪时间、设置帧率、宽度和倍速、倒放，选择颜色数和抖动方式，还能设体积上限：超过了会自动降低参数重新生成。导出前能看到开头、中间和结尾的画面。使用电脑上已安装的免费 ffmpeg，不上传，无需 API 密钥。 用户提到“视频转 GIF / 录屏做动图 / WebP 动图 / GIF 太大压缩 / 做个动图”时使用。
---

# 视频转动图

1. `gif_open(inputs, settings?, project?)`：读取视频信息并显示开头、中间、结尾画面。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 一行一段：start/end 用秒或 m:ss；fps、width、format 留空就用 settings 的默认值。
   - 需要本机已安装 ffmpeg；没装时 open 会返回安装提示，请转告用户。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `gif_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改裁剪：`set: [{row, values: {start: "2", end: "6"}}]`；同一视频再做一段：`add: [{start, end, name}]`（新行复制最后一行的视频；别的视频请重新 open）。
   - 有体积要求时设 settings.maxMB。
4. `gif_export(project, formats?)`：生成 GIF/WebP 和 gif-report.csv。把文件路径告诉用户。
5. 导出前预计体积只是粗略估计，以 gif-report.csv 里的实际大小为准。
