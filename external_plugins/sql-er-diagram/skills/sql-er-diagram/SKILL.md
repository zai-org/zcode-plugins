---
name: sql-er-diagram
description: 直接从 SQL 建表脚本画出数据库 ER 图并生成数据字典。打开 MySQL、PostgreSQL 或 SQLite 写法的 CREATE TABLE 脚本，自动读取表、字段、类型、主键、外键（字段内、表级或 ALTER TABLE）和注释（COMMENT '…' 或 COMMENT ON）。可以在表格里补上缺少的关系或字段说明、隐藏不想画的字段，然后导出 SVG 和 PNG 结构图，以及 Excel 和 Markdown 数据字典。在本地运行，不连接数据库，无需 API 密钥。 用户提到“ER 图 / 数据库结构图 / 表关系图 / 数据字典 / 建表语句画图”时使用。
---

# 数据库结构图

1. `erd_open(inputs, settings?, project?)`：读取建表语句，列出每个字段及其主键、外键。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传 .sql 文件；结果里每行是一个字段（表、字段、类型、主键、外键、说明）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `erd_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 补关系：`set: [{row, values: {fk: "categories.id"}}]`；写说明：`values: {comment: "…"}`；隐藏字段：`values: {include: false}`；每行几张表：`settings: {perRow: 2}`。
4. `erd_export(project, formats?)`：导出 er-diagram.svg、er-diagram.png、data-dictionary.xlsx 和 data-dictionary.md。把文件路径告诉用户。
5. 外键指向不存在的表时要提醒用户确认。
