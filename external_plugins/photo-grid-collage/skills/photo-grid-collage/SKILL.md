---
name: photo-grid-collage
description: 把多张照片拼成拼图或海报：3×3 九宫格、2×2 四宫格、一张大图配几张小图、自动均匀网格、不裁切的瀑布拼接，或者竖条。可以选画布（方形、4:5 帖子、竖屏、横版、A4 海报或自定义尺寸），调间距、外边距、圆角、背景色，加标题和底部文字，给任意一张加说明。每张照片可以设顺序（放在哪个格子）和裁切焦点，人脸和商品不会被切掉。导出前会提示：固定格数的版式有空格或多出来的照片、小图放进大格子会糊、裁切掉了大半张照片、哪些文件读不出来。导出 PNG 和 JPG。在本地运行，不用登录，无需 API 密钥。 用户提到“拼图 / 九宫格 / 照片拼接 / 拼贴海报 / collage”时使用。
---

# 拼图海报

1. `collage_open(inputs, settings?, project?)`：读取照片并排好拼图。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传照片或文件夹；settings 可带 template（auto/grid-2x2/grid-3x3/hero-2/hero-3/hero-4/mosaic/strip）、size、title、footer。
   - 每行一张照片：include、order、focus、caption；固定格数的版式按 order 填格子。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `collage_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 不用某张：`set: [{row, values: {include: false}}]`；加说明：`values: {caption: "…"}`；换版式：`settings: {template: "auto"}`。
4. `collage_export(project, formats?)`：导出 <标题>.png 和 <标题>.jpg。把文件路径告诉用户。
5. 用户没说的照片不要改顺序。
