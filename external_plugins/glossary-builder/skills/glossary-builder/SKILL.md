---
name: glossary-builder
description: 把一堆资料整理成双语术语表。打开文本、Markdown 文件或文件夹（中文、英文都行），自动找出反复出现的术语和复合词，每个附一句例句，并把被长词包含的碎片合并掉。资料里“会员积分（Loyalty Points）”这种带括号译名的写法会直接拿来当译文；如果一起选了旧术语表，也会合并进来，旧表和资料译法不一致时会提醒。去掉无关词、补全或修改译文、手动添加术语，然后导出 Excel、CSV、Markdown，以及 Trados、memoQ 等翻译软件用的 TBX。在本地运行，不用登录，无需 API 密钥。 用户提到“术语表 / 术语库 / 译名统一 / TBX / glossary”时使用。
---

# 术语表整理

1. `glossary_open(inputs, settings?, project?)`：读取资料并提取候选术语。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传资料文件夹（可以同时包含旧术语表 CSV/XLSX）；每行一个术语，translation 是译文。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `glossary_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改译文：`set: [{row, values: {translation: "…"}}]`；去掉噪声词：`values: {keep: false}`；加术语：`add: [{term: "满减", translation: "Spend-and-save"}]`；加备注：`values: {note: "…"}`。
4. `glossary_export(project, formats?)`：导出 glossary.xlsx、glossary.csv、glossary.tbx 和 glossary.md。把文件路径告诉用户。
5. 译文冲突的提示要让用户决定；不要自己编译文，没有把握就留空。
