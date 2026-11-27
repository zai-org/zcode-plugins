---
name: image-watermark
description: 一次给整个文件夹的照片加上统一的文字或 Logo 水印。可以选角落位置或者整张平铺，设大小、不透明度、颜色和边距；大小按每张照片自动换算，横图竖图看起来一致。单张照片可以微调位置、缩放或跳过，先预览再导出 JPEG 或 PNG 副本，原图不动。在本地运行，不上传，无需 API 密钥。 用户提到“加水印 / 批量水印 / 照片打 Logo / 版权水印 / 平铺水印”时使用。
---

# 图片批量水印

1. `watermark_open(inputs, settings?, project?)`：列出照片、找到 Logo 并预览前几张。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 里名字带 logo 的 PNG 会当作 Logo，不加水印；也可以设 settings.logo。
   - settings.position 可用英文（bottom-right、tile…），中文“右下”“平铺”也认。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `watermark_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 单张微调：`set: [{row, values: {position: "top-left", dx: 2, dy: -1, scale: 80}}]`（dx/dy 为短边百分比）；跳过：`values: {use: false}`。
4. `watermark_export(project, formats?)`：导出加水印的副本和 watermark-report.csv。把文件路径告诉用户。
5. 导出到 watermarked/ 下，原图不动；不保留 EXIF。
