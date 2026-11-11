---
name: db-connector
description: 只读连接 MySQL/PostgreSQL/MongoDB 数据库：查询数据、浏览表结构、多环境连接配置管理。当用户提到查数据、看表结构/字段/索引、连接数据库、配置数据库连接、对比 dev/prod 数据、统计/分析库中数据时使用。
---

# db-connector 数据库只读访问

通过 MCP 工具安全访问用户的数据库（MySQL/MariaDB、PostgreSQL、MongoDB），**严格只读**，支持多环境（dev/test/prod…）多连接配置。

## 工具总览

**配置管理**：`db_list_connections` / `db_add_connection` / `db_remove_connection` / `db_set_active_environment`
**查询浏览**：`db_test_connection` / `db_list_tables` / `db_describe_table` / `db_query` / `db_find` / `db_aggregate`

## 标准查询流程

1. `db_list_connections` —— 确认连接名与环境（返回 `status: "no_config"` 时走下方首次配置流程）
2. 跨环境查询用限定名 `"环境名/连接名"`（如 `prod/mysql-main`）；同环境可用裸连接名
3. 不熟悉结构先 `db_list_tables` → `db_describe_table`，再写查询
4. SQL 数据库用 `db_query`；MongoDB 用 `db_find` / `db_aggregate`

## 硬性安全规范

- **值必须走 `params` 参数绑定**：MySQL 用 `?`，PostgreSQL 用 `$1`，禁止把值拼进 SQL 文本
- 只读白名单外的一切语句（UPDATE/DELETE/DROP/INSERT/注释中藏关键词/多语句/锁定子句）都会被服务器拒绝——不要尝试绕过
- 大结果集主动传较小的 `limit`（如 50），默认上限受 `maxRowLimit` 封顶
- `protected: true` 环境（通常是生产）的查询结果必须向用户明示来源环境
- 建议用户为每个环境配置只读数据库账号

## 首次配置流程（会话式配置）

无配置时引导用户提供：环境名（如 dev）、连接名（如 mysql-main）、数据库类型、地址/端口/库名，以及**存放密码的环境变量名**。然后：

```
db_add_connection(
  environment="dev", name="mysql-main",
  config={type:"mysql", host:"localhost", port:3306, user:"root", database:"shop"},
  passwordEnvVar="DB_DEV_PW"   # 密码只接受环境变量名，写入为 ${DB_DEV_PW}
)
→ db_test_connection(connection="dev/mysql-main") 验证
```

密码明文会被拒绝——先让用户把密码写入 `.env` 文件（工作区 `.env` 或 `~/.zcode/db-connector/.env`，保存即生效无需重启；系统环境变量不参与解析），再传入变量名。`db_list_connections` 返回的 `envSources` 会显示当前生效的 `.env` 文件。

## 配置文件（高级用法/直接编辑）

- 工作区：`<workspace>/db-connections.json`（项目相关，可提交 git）
- 用户级：`~/.zcode/db-connector/connections.json`（跨项目）
- 两文件按"环境名+连接名"合并，工作区优先；`activeEnvironment` 决定裸连接名解析到哪个环境
- 行数/超时三层可配置：`defaults.rowLimit`（缺省 200）→ 连接级 `rowLimit` → 查询参数 `limit`，生效值受 `maxRowLimit`（缺省 1000）封顶

## 错误处理

- 连接失败/环境变量缺失：向用户**复述缺失项**（哪个变量、哪个地址），不要盲目重试
- 工具返回 `isError: true` 时读失败原因，属于校验拒绝的改写查询，属于配置问题的引导用户修正
