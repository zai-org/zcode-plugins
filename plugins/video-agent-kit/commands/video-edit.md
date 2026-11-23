---
description: 使用 video-agent 总控处理视频理解、编辑与创作任务
argument-hint: "[任务说明]"
skills: video-agent
---

处理这个视频/音频任务。

- 默认素材位置：当前工作目录；如果任务说明指定文件或文件夹，优先使用指定路径。
- 任务说明：`$ARGUMENTS`

可用能力：

1. 需要理解语音内容时，可以调用 MCP `transcribe` 获取带时间戳转录。
2. 需要生成旁白或配音时，可以调用 MCP `tts_generate` 生成语音。
