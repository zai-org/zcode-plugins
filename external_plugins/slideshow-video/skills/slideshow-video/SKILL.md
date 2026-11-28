---
name: slideshow-video
description: 用一个文件夹的照片和一首歌做幻灯片视频（音乐放在同一个文件夹里，或一起选择）。照片按拍摄时间（EXIF）排好，每张加上缓慢推拉或平移的镜头效果（Ken Burns），之间用转场衔接；手机照片会自动转正。可以设置每张停留几秒、转场样式、照片怎么放进画面（铺满裁切，或者完整显示叠在模糊背景上），加字幕，还能按音乐长度自动调整时长让视频和音乐一起结束。渲染前会提示分辨率太低、重复的照片、读不出来的文件，以及时长比转场还短的照片。导出 1080p MP4（横屏、方形或竖屏）和一张标出每张照片时间的故事板 PNG。在本地用 ffmpeg 运行，不用登录，无需 API 密钥。 用户提到“幻灯片视频 / 照片做成视频 / 电子相册 / 相册视频 / slideshow”时使用。
---

# 图片幻灯片视频

1. `slideshow_open(inputs, settings?, project?)`：读取照片和音乐，排好幻灯片。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传照片文件或文件夹，再加一首音乐（可选）；settings 可带 title、format（landscape/square/vertical）、perPhoto、transition、fit（cover/blur/contain）。
   - 每行一张照片：include、order、seconds（空=默认）、motion、caption。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `slideshow_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 去掉照片：`set: [{row, values: {include: false}}]`；加字幕：`values: {caption: "…"}`；按音乐对齐：`settings: {fitToMusic: true}`。
4. `slideshow_export(project, formats?)`：导出 <标题>.mp4 和 <标题>-storyboard.png。把文件路径告诉用户。
5. 用户没说的照片不要改；导出视频要几十秒。
