---
name: course-video-packager
description: 把整段课程录像按内容分章，生成章节视频、每章字幕、封面、课程目录和 zip 发布包。用户提到“课程录像分章 / 录播课整理 / 课程发布包 / 按章节切视频”时使用。
---

# 课程视频整理

需要用户电脑上有 ffmpeg；找不到时把安装提示告诉用户。

1. `course_open(video, subtitles?)`：同名 .srt/.vtt 会自动带上。读返回的文字稿和停顿位置。
2. 按内容规划章节（一般 3–15 分钟一章），开始时间尽量放在停顿或字幕空隙处；写简短标题和一句简介。`course_save(project: {video, subtitles, title, author, chapters: [{title, start, summary}], output?})`。`start` 用秒或 "mm:ss"。
3. 把章节表告诉用户，可在面板里调整；确认后 `course_build(project)`（或传 `<output>/course.json`）。
4. 告诉用户输出文件夹、zip 位置、每章时长；没有字幕时说明没有每章字幕。默认精确切分；用户要快可设 `mode: "copy"`。
