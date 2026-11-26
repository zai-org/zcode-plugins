---
name: csv-to-sql
description: 不用手写 SQL 就能把表格导入数据库：生成可以直接运行的 SQLite、MySQL 或 PostgreSQL 脚本，包含按数据推断列类型的 CREATE TABLE、建议的主键，以及把引号、换行、空值都正确转义的 INSERT 语句。导出前可以在表格里检查和修改表结构——列名、类型、是否可空、主键、导入哪些列。在本地运行，不连接数据库，无需 API 密钥。 用户提到“表格转 SQL / CSV 导入数据库 / 生成 INSERT 语句 / 建表语句 / 导入 MySQL / 导入 PostgreSQL”时使用。
---

# 表格转 SQL

1. `csvsql_open(inputs, settings?, project?)`：读取表格、推断 SQL 表结构并预览脚本。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings: {dialect: "postgres", table: "members"}；dialect 可为 sqlite/mysql/postgres/all。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `csvsql_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 表格每行是一列的定义：`set: [{row, values: {name, type, nullable, pk, include}}]`。
4. `csvsql_export(project, formats?)`：导出 <表名>.<数据库>.sql（建表 + INSERT）和 <表名>.schema.sql。把文件路径告诉用户。
5. 有 error 时导出会失败，先按提示改；warn 说明会有值变成 NULL，要问用户。
