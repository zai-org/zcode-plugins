---
name: pdf-form-batch-fill
description: 用一张名单（CSV/XLSX）批量填写同一份空白 PDF 表单（报名表、登记表、证书、申请表等），每行生成一份 PDF，检查漏填与文字超出。用户提到“批量填表 / 套打 / 按名单生成表格 / mail merge PDF”时使用。
---

# 表单批量填写

只处理 PDF 表单；名单是工作区里的 .csv / .tsv / .xlsx，第一行是表头。所有处理在本机完成。

1. **打开**：`form_open(pdf, roster, sheet?)`。返回 PDF 的可填写字段（name、label、type、page、rect）、名单列名、按名称相似度给出的字段映射建议，并打开侧栏面板。已有模板用 `form_open(template: "xxx.formfill.json")`。
2. **映射**：检查建议映射，用 `template_save(path, template)` 保存为 `<名称>.formfill.json`。
   - `source` 写 `{列名}`，可拼接：`{省}{市}{详细地址}`；固定文字直接写。虚拟列 `{序号}` 是行号（01、02…）。
   - 复选框：`{列名}` 的值是 是/√/1/yes/true 时勾选；或写条件 `{性别}=男`。
   - 单选 / 下拉：值必须等于选项之一，否则检查会报 bad_option。
   - 没有表单域的扁平 PDF：添加 `{"kind":"box","page":0,"rect":[x,y,宽,高],"source":"{姓名}"}`，单位 pt，原点在页面左上角。坐标不确定时让用户在面板里用“自由位置文字框”拖出来，比猜坐标可靠。
   - `required: true` 的字段为空时报 missing；`fontSize` 留空表示自动，`minFontSize` 是自动缩小的下限（默认 6）。
   - `output`: `{dir, fileName: "{姓名}-报名表.pdf", flatten, merged}`。flatten=true 生成不可再改的文件；merged=true 另存 `_merged.pdf` 便于打印。
3. **检查**：`form_check(template)` 不写文件，逐行报告 missing / overflow / bad_option / unknown_column。把问题告诉用户，由用户决定改名单、调字号还是改映射；不要擅自改名单内容。
4. **生成**：`form_generate(template, rows?)` 写出每行一份 PDF、`_report.csv`（每行状态）以及可选的 `_merged.pdf`。只重做部分行时传 `rows`（从 1 开始）。
5. 完成后告诉用户输出文件夹、份数和仍存在的问题行。

注意：
- 名单含个人信息，不要把整张名单贴进对话；需要时只引用行号和字段名。
- 加密 PDF 需要用户先解除密码。XFA 表单会使用其中的普通 AcroForm 字段。
- 中文需要系统中文字体；找不到时提示用户在插件设置里填写 fontPath。
