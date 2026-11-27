---
name: size-chart-maker
description: 用尺寸数据做商品详情页的尺码表图片。打开 CSV 或 Excel 尺寸表：每行一个尺码（S/M/L、160/84A、36…），每列一项尺寸（胸围、衣长、肩宽、袖长…，可写数字或 88-92 这样的范围）。会标出把 0 打成字母 O 之类的错误，以及尺码变大尺寸反而变小的可疑数据，改好后再出图。可显示厘米、英寸或两者，表头中文、英文或中英，选简洁、醒目或精品样式，高亮推荐尺码，导出清晰的 PNG、SVG、可直接贴到店铺页面的 HTML 表格和整理后的 Excel。在本地运行，不用登录，无需 API 密钥。 用户提到“尺码表 / 尺寸表 / 详情页尺码图 / size chart”时使用。
---

# 尺码表制作

1. `sizechart_open(inputs, settings?, project?)`：读取尺寸表并检查数据。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传尺寸表；每行一个尺码，尺寸列的列名就是表头原名（如 胸围、衣长）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `sizechart_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改数值：`set: [{row, values: {衣长: "70"}}]`；高亮推荐尺码：`values: {highlight: true}`；隐藏尺码：`values: {include: false}`；单位/语言/样式放在 settings。
4. `sizechart_export(project, formats?)`：导出 size-chart.png、size-chart.svg、size-chart.html 和 size-chart.xlsx。把文件路径告诉用户。
5. 报告里的错误（非数字）先修好再导出；“变小”警告需要用户确认是否是笔误，不要擅自改。
