---
name: docx-mail-merge
description: 用表格批量填写 Word 模板里的 {{字段}}，每行生成一份 .docx（录用通知、合同、通知书、证明等），格式、表格、页眉页脚原样保留。检查缺少的列和空值，在面板里改数据、预览第一份文档，导出全部文件和 zip 压缩包。在本地运行，无需 API 密钥。 用户提到“批量生成 Word / 套打 / 邮件合并 / mail merge / 每个人一份通知书或合同”时使用。
---

# Word 批量套打

1. `merge_open(inputs, settings?, project?)`：读取模板里的占位符和表格数据。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传两个文件：.docx 模板和 .xlsx/.csv 数据表。fileName 设置成用户想要的文件名规则。
   - 模板里没有 {{字段}} 时，告诉用户在 Word 里怎么写占位符。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `merge_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改数据：`set: [{row, values: {列名: 值}}]`。字段和列名对不上时，建议用户改表头或改模板里的占位符。
4. `merge_export(project, formats?)`：为每行生成 documents/<文件名>.docx，并导出 all-documents.zip 和 merge-log.csv。把文件路径告诉用户。
