# 表格转 SQL

不用手写 SQL 就能把表格导入数据库：生成可以直接运行的 SQLite、MySQL 或 PostgreSQL 脚本，包含按数据推断列类型的 CREATE TABLE、建议的主键，以及把引号、换行、空值都正确转义的 INSERT 语句。导出前可以在表格里检查和修改表结构——列名、类型、是否可空、主键、导入哪些列。在本地运行，不连接数据库，无需 API 密钥。

## 功能

- **类型推断**：INTEGER、BIGINT、DECIMAL、BOOLEAN（true/false、yes/no、是/否）、DATE、TIMESTAMP、VARCHAR(n)、TEXT——手机号这类长数字串保留为文本，开头的 0 不会丢。
- **三种数据库**：SQLite、MySQL/MariaDB（utf8mb4、反引号、TINYINT(1)）和 PostgreSQL（换行用 E'' 字符串），也可以一次生成三种。
- **转义正确**：单引号、反斜杠、换行、中文，空单元格写成 NULL。
- **表结构可改**：改列名（建议 snake_case，中文列名保留并加引号）、改类型、是否可空、主键，或不导入某些列。
- **导出前检查**：按所选类型会变成 NULL 的值、NOT NULL 列里的空值、主键重复、列名重复。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `csv-to-sql/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 会员名单.csv 生成 PostgreSQL 导入脚本”
- “表名叫 members，会员编号做主键”
- “备注列不要导入”

## 工具

| 工具 | 作用 |
|---|---|
| `csvsql_open` | 读取表格、推断 SQL 表结构并预览脚本，并打开面板 |
| `csvsql_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `csvsql_status` | 查看当前数据、问题和汇总 |
| `csvsql_export` | 导出 <表名>.<数据库>.sql（建表 + INSERT）和 <表名>.schema.sql |

导出文件写到工作区的 `csv-to-sql/<项目>/` 文件夹。

## 范围（v0.1）

- 只生成 SQL 文件，从不连接数据库。
- 每个项目一张表；v0.1 除主键外不生成外键和索引。
- 日期须已是 YYYY-MM-DD 格式才会识别为 DATE（可先用“表格数据清洗”）。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `csv-to-sql/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/csv-to-sql/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-csv-to-sql test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
