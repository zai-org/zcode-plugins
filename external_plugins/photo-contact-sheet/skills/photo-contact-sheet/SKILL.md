---
name: photo-contact-sheet
description: 把一文件夹的照片排成可打印的小样表：整齐的缩略图网格，下面是文件名或自己写的说明，带页码和可选标题。可以选纸张、方向、每行张数和每页行数，照片完整显示或填满格子，白底或黑底。调整顺序、去掉不要的照片，然后导出 PDF 打印或发给客户选片，每页另有一张 JPG。在本地运行，不上传，无需 API 密钥。 用户提到“照片小样表 / 选片表 / 缩略图 PDF / 照片目录 / contact sheet”时使用。
---

# 照片小样表

1. `contact_open(inputs, settings?, project?)`：列出照片并预览第 1 页。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings.cols × settings.rows 决定每页张数；caption 模板留空就不显示说明。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `contact_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 调顺序：`set: [{row, values: {order: 0}}]`（数字小的在前）；去掉：`values: {include: false}`；单张说明：`values: {caption: "…"}` 配合模板里的 {caption}。
4. `contact_export(project, formats?)`：导出 contact-sheet.pdf、每页 JPG 和 contact-sheet.csv。把文件路径告诉用户。
5. 导出 PDF、每页 JPG 和 CSV 清单。
