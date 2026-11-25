---
name: podcast-studio
description: 用主持人和嘉宾的多轨录音制作播客成片：自动对齐、同步剪辑、降噪、响度统一到 -16 LUFS、加片头片尾，导出 MP3/WAV 和可再编辑的工程。用户提到“播客剪辑 / 多轨对齐 / 响度统一 / 片头片尾 / 导出节目”时使用。
---

# 播客制作台

需要用户电脑上有 ffmpeg；找不到时把安装提示告诉用户。

1. `podcast_open(tracks: [主持人, 嘉宾…], title?, intro?, outro?)`，或用 `project: "podcast/xx.podcast.json"` 打开已有工程。
   - 看对齐结果：某轨 "no reliable match" 时，告诉用户在面板里对着波形微调偏移，下次录音开头拍一下手。
2. 按用户说的修改工程，然后 `podcast_save(project)`：
   - 剪辑：`cuts: [{start: "12:30", end: "14:05", note}]`。时间是原始录音时间轴上的时间，所有音轨同步剪。
   - 音量：`tracks[i].gain`（dB）。
   - 降噪：`denoise`。
   - 响度：`loudness`，默认 -16。
   - 格式：`format`（mp3 / wav / both）。
   - 只有用户要求时才缩短停顿；缩短时把停顿两端各留约 0.5 秒。
3. 用户确认后调用 `podcast_render(project)`。告诉用户输出文件、成片时长、实测 LUFS 和真峰值，以及 `.cuts.md` 剪辑清单的位置。
