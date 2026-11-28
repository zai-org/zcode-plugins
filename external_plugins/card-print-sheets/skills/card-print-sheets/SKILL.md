---
name: card-print-sheets
description: 把一文件夹的卡牌图片排成可直接打印的拼版页，适合桌游卡、塔罗、单词卡、名片。可选卡牌尺寸（扑克、桥牌、塔罗、迷你、名片、方形或自定义），设置出血、间距、纸张和裁切线，每张卡打几份可从数量表读取或直接修改。双面打印时每张正面页后跟一张镜像的背面页，长边/短边翻转都能对齐，每张卡也可以有自己的背面。会发现文件夹里缺的图片、按打印尺寸分辨率太低、比例不对或没有出血的卡面、开了双面却没有背面、数量写错、重复列出、尺寸放不下纸张，以及最后一页的空位。导出 print-sheets.pdf、backs.pdf 和 card-list.csv。本地运行。 用户提到“卡牌打印 / 桌游卡 / 拼版 / 出血 / 裁切线 / 卡背 / 双面打印”时使用。
---

# 卡牌打印排版

1. `cards_open(inputs, settings?, project?)`：读取卡面图片和数量表。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传卡面图片文件夹（可带数量表 .csv/.xlsx：文件、数量、背面；背面图如 back.png 放在旁边）；每行一张卡面：file、title、count、back、include。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `cards_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改数量：`set: [{row, values: {count: 3}}]`；缺图的行：`remove: [row]` 或改 file；设置卡背：`settings: {back: "back.png"}`；双面：`settings: {duplex: "long"}`；尺寸：`settings: {size: "tarot"}` 或 `{size: "custom", custom: "60x90"}`。
4. `cards_export(project, formats?)`：导出 print-sheets.pdf、backs.pdf 和 card-list.csv。把文件路径告诉用户。
5. 分辨率低的卡面只能提醒用户换高清图，不要假装修好。
