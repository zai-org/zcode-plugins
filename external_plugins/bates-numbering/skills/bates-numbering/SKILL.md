---
name: bates-numbering
description: 给一批 PDF 的每一页连续盖上编号（DOC-000001、DOC-000002……），像证据材料、送达文件那样跨文件接续编号。可以在每页加“副本”“COPY”“CONFIDENTIAL”等标签，在每个文件首页加“证据 1”“Exhibit A”等标签。排好文件顺序，选好前缀、位数和位置，导出盖章后的 PDF、可选的合并 PDF 和编号索引。原文件保持不变。在本地运行，不上传，无需 API 密钥。 用户提到“Bates 编号 / 证据编号 / PDF 每页盖编号 / 副本章 / 卷宗页码”时使用。
---

# 文件编号盖章

1. `bates_open(inputs, settings?, project?)`：读取 PDF、统计页数并规划编号范围。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 传文件夹即可；默认按文件名排序，order 列是 10、20、30……，改 order 即可调整顺序。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `bates_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 调整顺序：`set: [{row, values: {order: 5}}]`；单个文件标签：`values: {label: "证据 1"}`；跳过文件：`values: {include: false}`。
4. `bates_export(project, formats?)`：导出盖章后的 PDF、可选的 combined.pdf 和 index.csv。把文件路径告诉用户。
5. 前缀、起始号、位数在 settings.prefix / start / digits；settings.merged 为 true 时另外输出 combined.pdf。
