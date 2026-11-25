---
name: contact-list-cleaner
description: 把多个 Excel/CSV 客户名单合并整理成一份：字段映射、规范手机号/邮箱/公司名、去重合并（确定重复自动合并，可能重复请用户确认）、导出 Excel/CSV 和合并日志。用户提到“客户名单 / 通讯录 / 联系人去重 / 合并表格 / 整理手机号”时使用。
---

# 客户名单整理

1. `contacts_load(files, mappings?, region?)`：读 CSV/TSV/XLSX（中文 Excel 导出的 GBK CSV 自动识别），按表头和内容猜字段映射；`region` 是没写国家码的号码默认国家（默认 CN）。
   - 把每个文件的映射告诉用户；明显猜错的用 `contacts_map(file, mapping)` 改（`first`/`last` 表示名/姓分列，`""` 表示忽略）。
2. 确定重复（电话或邮箱相同且姓名相容，或电话和邮箱都相同）已自动合并；多出来的电话/邮箱放到“电话2/邮箱2”，其他冲突写进备注和合并日志。
3. 可能重复（电话相同但姓名不同、同名同公司、同名且号码后 8 位相同等）要问用户，不要自己猜；用户说了以后用 `contacts_decide([{pair, merge}])` 记录。面板里用户也可以直接点。
4. 无效值（号码位数不对、邮箱格式错、缺姓名、没有任何联系方式）会列出来，告诉用户哪些需要人工补。
5. `contacts_export(format?, output?)`：默认 `cleaned/contacts-clean.xlsx`（联系人、合并日志、问题、待确认四个工作表）；`csv` 输出联系人和合并日志两个 CSV；`vcf` 输出 `contacts-clean.vcf`（vCard 3.0，UTF-8，可导入手机/Outlook/Google 通讯录）。
6. 不联网查重或补全信息；不修改原始文件。
