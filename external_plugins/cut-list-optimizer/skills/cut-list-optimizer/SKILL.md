---
name: cut-list-optimizer
description: 把家具、柜体的零件排到板材上，得到可打印的开料图、要买几张板和封边总长。读取零件清单（名称、长、宽、数量、材料、纹理、封边）和板材尺寸单价，按断头锯方式排版（每一刀都是通切，适合推台锯），大件优先，计入锯缝和修边，有纹理的零件不旋转。会发现比板材还大或只能横纹放下的零件、没有对应板材的材料（提示相近的名称）、读不懂的尺寸、数量和封边写法，以及几乎空着的最后一张板。导出每张板一页、零件带标注的开料图 PDF，全部板材的 SVG，以及开料单 Excel（每个零件在哪张板、位置坐标，各材料的张数、利用率、金额和封边米数）。不用登录，无需 API 密钥，本机运行。 用户提到“开料 / 开料图 / 板材排版 / 要几张板 / 封边”时使用。
---

# 板材开料优化

1. `cut_open(inputs, settings?, project?)`：读取零件清单并排版。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传零件清单 .csv/.xlsx（或含零件清单和板材表的文件夹）；每行一个零件：name、length、width、qty、material、grain、edge。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `cut_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改尺寸：`set: [{row, values: {length: 1200}}]`；改材料：`values: {material: "9mm 背板"}`；加板材：`settings: {stock: "18mm 颗粒板=2440x1220@168"}`；锯缝：`settings: {kerf: 3}`。
4. `cut_export(project, formats?)`：导出 cutting-diagrams.pdf、cutting-diagrams.svg 和 cut-list.xlsx。把文件路径告诉用户。
5. 零件比板材大时，按用途判断是写错了尺寸还是要拆成两块。
