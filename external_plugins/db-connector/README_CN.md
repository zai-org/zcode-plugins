# db-connector

[English](README.md) | 简体中文

ZCode 插件：让 AI 在会话中安全连接数据库，执行**只读**查询与结构浏览。

- 支持数据库：**MySQL / MariaDB、PostgreSQL、MongoDB**
- 插件形式：MCP 服务器（10 个工具）+ Skill 使用指导
- 多环境多连接：dev/test/prod 等环境分组，每个环境可混合多种数据库
- 安全：严格只读白名单校验、参数绑定强制、密码仅环境变量引用、行数/超时上限
- 自包含：MCP 服务器以单文件 bundle 分发，安装后**无需 npm install**

## 安装

通过插件市场安装本插件（依赖 Node.js ≥ 18，由 ZCode 作为 MCP 服务器启动）。

## 快速开始

安装后直接对话即可，例如：

> "用 db-connector 帮我添加一个 MySQL 连接：环境 dev、名字 mysql-main、库 shop，密码放环境变量 DB_DEV_PW。"
>
> "列出 dev 环境所有的表。"
>
> "统计上个月每天的订单量。"

## 连接配置

### 方式一：对话配置（推荐）

AI 调用 `db_add_connection` 完成配置。密码只接受**变量名**（写入为 `${VAR}` 引用，插件拒绝明文密码），变量统一在 `.env` 文件中定义（系统环境变量不参与解析）：

```bash
# 位置：工作区 .env 或用户级 ~/.zcode/db-connector/.env
DB_DEV_PW=你的密码
DB_PROD_PW="带空格 或 #符号 的密码请加引号"
```

`${VAR}` 解析优先级：**工作区 `.env` > 用户级 `.env`**。`.env` 每次工具调用都会重新读取、保存即生效；工作区 `.env` 记得加入 `.gitignore`。

### 方式二：直接编辑配置文件

工作区级 `<workspace>/db-connections.json`（项目相关）或用户级 `~/.zcode/db-connector/connections.json`（跨项目），两者可并存，按"环境名+连接名"合并，工作区优先：

```json
{
  "configVersion": 1,
  "activeEnvironment": "dev",
  "defaults": { "rowLimit": 200, "maxRowLimit": 1000, "timeoutMs": 10000 },
  "environments": {
    "dev": {
      "description": "本地开发",
      "connections": {
        "mysql-main": {
          "type": "mysql", "host": "localhost", "port": 3306,
          "user": "root", "password": "${DB_DEV_PW}", "database": "shop"
        },
        "pg-analytics": {
          "type": "postgres",
          "url": "postgresql://report:${DB_PG_PW}@10.0.0.8:5432/analytics"
        },
        "logs-mongo": {
          "type": "mongodb",
          "url": "mongodb://user:${DB_MONGO_PW}@host:27017/logs"
        }
      }
    },
    "prod": {
      "description": "生产环境",
      "protected": true,
      "connections": {
        "mysql-main": { "type": "mysql", "host": "10.0.0.2", "user": "ro_user",
          "password": "${DB_PROD_PW}", "database": "shop" }
      }
    }
  }
}
```

- 工具的连接引用：`"mysql-main"`（活动环境）或 `"prod/mysql-main"`（显式跨环境）
- `protected: true` 环境的查询结果会附带醒目的受保护环境提示
- 密码 `${VAR}` 引用的解析优先级：工作区 `.env` > `~/.zcode/db-connector/.env`（不读取系统环境变量）

## MCP 工具

| 类别 | 工具 | 说明 |
|------|------|------|
| 配置 | `db_list_connections` | 按环境列出连接（脱敏） |
| 配置 | `db_add_connection` | 新增连接（密码只收环境变量名） |
| 配置 | `db_remove_connection` | 删除连接 |
| 配置 | `db_set_active_environment` | 切换活动环境 |
| 查询 | `db_test_connection` | 连通性测试 |
| 查询 | `db_list_tables` | 表/集合列表与行数估计 |
| 查询 | `db_describe_table` | 列/类型/键/索引（Mongo 采样推断） |
| 查询 | `db_query` | 只读 SQL（MySQL `?` / PG `$1` 参数绑定） |
| 查询 | `db_find` | MongoDB 只读查询 |
| 查询 | `db_aggregate` | MongoDB 聚合（拒绝 $out/$merge） |

## 安全模型

1. **只读白名单**：仅放行单条 `SELECT / WITH / EXPLAIN / SHOW / DESCRIBE / DESC`；写/DDL 关键词、多语句、锁定子句、危险函数（文件读写/延时/跨库执行）即使出现在子查询或注释中也被拒绝
2. **参数绑定强制**：查询值只能经 `params` 传入，服务器代码不做任何 SQL 值拼接
3. **凭证不落盘**：配置只存 `${ENV_VAR}` 引用；工具输出与日志全程脱敏
4. **资源保护**：行数与超时三层可配置（`defaults` → 连接级 → 查询参数），`maxRowLimit` 硬上限
5. 建议为每个环境使用**只读数据库账号**，效果最佳

## 行数与超时配置

| 层级 | 位置 | 缺省 |
|------|------|------|
| 全局默认 | `defaults.rowLimit` / `defaults.timeoutMs` | 200 / 10000ms |
| 连接覆盖 | 连接对象内 `rowLimit` / `timeoutMs` | 继承全局 |
| 查询临时 | 工具参数 `limit` | 受 `maxRowLimit`（缺省 1000）封顶 |

## 已知限制

- 仅查询数据，不含任何写入/DDL 能力（设计如此）
- 关键词白名单可能误伤个别含保留词列名的合法查询（如名为 `set` 的列），可给列名加引号别名后重试
- 大结果集会在驱动层缓冲后截断，超时由 `timeoutMs` 兜底

## 副作用披露

- **网络**：仅向用户配置的数据库地址（MySQL/PostgreSQL/MongoDB 端口）发起出站连接，不访问任何其他网络
- **进程**：ZCode 通过 `node mcp/dist/db-connect-server.bundle.cjs` 启动一个 MCP 服务器进程（stdio）
- **文件写入**：仅写入 `~/.zcode/db-connector/connections.json`、`~/.zcode/db-connector/.env` 及工作区级 `db-connections.json` / `.env`，不写其他任何文件
- **凭证**：密码永不以明文存储——仅存 `${ENV_VAR}` 引用，调用时从 `.env` 解析
- **第三方代码**：bundle 内联了 [mysql2](https://github.com/sidorares/node-mysql2)（MIT）、[node-postgres](https://github.com/brianc/node-postgres)（MIT）与 [MongoDB Node 驱动](https://github.com/mongodb/node-mongodb-native)（Apache-2.0），许可证声明保留在 bundle 文件内

## 开发

```bash
cd mcp
npm install
npm run build    # tsc 编译到 dist/
npm run bundle   # 重新生成自包含的 dist/db-connect-server.bundle.cjs
npm test         # 冒烟测试（无需真实数据库）
```

## 许可

[Apache-2.0](LICENSE)
