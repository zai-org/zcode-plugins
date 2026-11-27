---
name: zh-convert
description: 批量把文档在简体和繁体之间转换：台湾或香港字形，也可以同时换成当地用词（软件 → 軟體、鼠标 → 滑鼠，反向也行）。支持 TXT、Markdown、SRT/VTT 字幕和 Word .docx。可以加自定义词条，列出必须保持原样的人名、品牌名，逐行审阅修改，手动改正个别选错的字，再导出转换后的副本和词条清单。使用开源 OpenCC 词典，在本地运行，不上传，无需 API 密钥。 用户提到“繁简转换 / 简体转繁体 / 繁体转简体 / 台湾用词 / 香港繁体 / 字幕繁简”时使用。
---

# 繁简转换

1. `zhconv_open(inputs, settings?, project?)`：读取文件并列出所有会转换的行。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings.direction 取 cn-tw、cn-twp（台湾用词）、cn-hk、cn-hkp、cn-t、tw-cn、twp-cn、hk-cn、hkp-cn、t-cn；默认 cn-twp。
   - settings.exclude 每行一个不转换的词；settings.custom 每行“源=目标”。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `zhconv_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 跳过某行：`set: [{row, values: {accept: false}}]`；改正：`values: {after: "…"}`。
   - 提示列里“易错字”的行值得让用户看一眼（如 干→幹/乾）。
4. `zhconv_export(project, formats?)`：导出转换后的副本、terms.csv 和 changes.csv。把文件路径告诉用户。
5. 导出的是副本（converted/ 下），原文件不变。
