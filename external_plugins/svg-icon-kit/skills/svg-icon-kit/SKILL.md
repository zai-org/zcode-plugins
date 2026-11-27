---
name: svg-icon-kit
description: 把来自不同设计师、不同软件的一堆 SVG 图标整理成一套：去掉 Inkscape、Sketch、Figma、Illustrator 留下的多余内容，删除脚本和事件属性，补上缺失的 viewBox、补成正方形，单色图标改成 currentColor，跟随文字颜色。可以改名、改颜色或保留原色，然后导出优化后的 SVG、一个 sprite.svg 雪碧图、React 组件和预览页。在本地运行，不上传，无需 API 密钥。 用户提到“SVG 图标 / 雪碧图 sprite / 图标组件 / currentColor / 图标库整理”时使用。
---

# SVG 图标库整理

1. `svgkit_open(inputs, settings?, project?)`：读取并清理图标，列出颜色和体积。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 可以传文件夹；名字默认来自文件名，非英文名会变成 icon-N，需要改名。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `svgkit_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改名：`set: [{row, values: {name: "arrow-left"}}]`；改颜色：`values: {recolor: "#2563EB"}`；保留原色：`values: {mode: "keep"}`；不导出：`values: {include: false}`。
4. `svgkit_export(project, formats?)`：导出优化后的 SVG、sprite.svg、React 组件、index.html 和 icons.csv。把文件路径告诉用户。
5. sprite 用法：`<svg><use href="sprite.svg#icon-name"/></svg>`；id 前缀在 settings.idPrefix。
