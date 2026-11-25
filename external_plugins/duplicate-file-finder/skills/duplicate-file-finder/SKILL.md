---
name: duplicate-file-finder
description: 找出文件夹里内容完全相同的文件——按大小和 SHA-256 内容哈希比对，不看文件名——并算出浪费了多少空间。每组自动保留一份（像原件的那个，不带“副本”“(1)”），你可以改选保留哪个，然后导出报告，或把多余副本移到待删文件夹。绝不直接删除文件，移走的文件还能放回原处。在本地运行，无需 API 密钥。 用户提到“重复文件 / 查重 / 去重 / 清理副本 / 硬盘空间”时使用。
---

# 重复文件查找

1. `dupes_open(inputs, settings?, project?)`：扫描工作区文件夹，把内容完全相同的文件分组。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传一个或多个文件夹；要优先保留某文件夹就设 settings: {keep: "folder", prefer: "合同"}（会重新扫描分组）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `dupes_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改保留：`set: [{row, values: {keep: true}}]`；每组至少保留一个。
4. `dupes_export(project, formats?)`：导出 duplicates.csv 和 duplicates.html，或把多余副本移到待删文件夹（附 moved.csv）；restore 可放回原处。把文件路径告诉用户。
5. 先导出 report 给用户看；用户明确同意后才导出 move。不要说“已删除”——文件只是移到了 review/。
