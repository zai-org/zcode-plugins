# 数据库结构图

直接从 SQL 建表脚本画出数据库 ER 图并生成数据字典。打开 MySQL、PostgreSQL 或 SQLite 写法的 CREATE TABLE 脚本，自动读取表、字段、类型、主键、外键（字段内、表级或 ALTER TABLE）和注释（COMMENT '…' 或 COMMENT ON）。可以在表格里补上缺少的关系或字段说明、隐藏不想画的字段，然后导出 SVG 和 PNG 结构图，以及 Excel 和 Markdown 数据字典。在本地运行，不连接数据库，无需 API 密钥。

## 功能

- **读取真实建表脚本**：MySQL 反引号、PostgreSQL 模式名和 COMMENT ON、SQLite；DECIMAL(10,2)、ENUM 类型、联合主键、字段内 REFERENCES、CONSTRAINT … FOREIGN KEY 以及 ALTER TABLE … ADD FOREIGN KEY。
- **自动检查**：外键指向不存在的表或字段、没有主键的表、没有说明的字段。
- **可编辑**：在外键格子里写 `表.字段` 就能补上关系；也可以改类型、写说明、隐藏字段。
- **结构图**：按网格排布，关联最多的表排在前面；标出 PK/FK、非空星号和关系连线；导出 SVG 和 2 倍清晰度 PNG。
- **数据字典**：Excel（表清单 + 字段明细两张表）和按表分节的 Markdown。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `sql-er-diagram/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 db/shop-schema.sql 画一张 ER 图”
- “products.category_id 关联 categories.id，把这条关系补上”
- “导出结构图和数据字典”

## 工具

| 工具 | 作用 |
|---|---|
| `erd_open` | 读取建表语句，列出每个字段及其主键、外键，并打开面板 |
| `erd_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `erd_status` | 查看当前数据、问题和汇总 |
| `erd_export` | 导出 er-diagram.svg、er-diagram.png、data-dictionary.xlsx 和 data-dictionary.md |

导出文件写到工作区的 `sql-er-diagram/<项目>/` 文件夹。

## 范围（v0.1）

- 读取 .sql 建表脚本；v0.1 不连接数据库，也不直接打开 SQLite .db 文件——请先导出结构（如 `sqlite3 app.db .schema > schema.sql`）。
- 自动网格布局；v0.1 不能拖动表格位置，可调整“每行几张表”。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `sql-er-diagram/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/sql-er-diagram/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-sql-er-diagram test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), resvg-wasm (MPL-2.0), fontkit (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
