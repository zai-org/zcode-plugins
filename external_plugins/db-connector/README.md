# db-connector

English | [简体中文](README_CN.md)

A ZCode plugin that lets the AI safely connect to databases in the session for **read-only** queries and schema browsing.

- Databases: **MySQL / MariaDB, PostgreSQL, MongoDB**
- Composition: MCP server (10 tools) + a Skill with usage guidance
- Multi-environment, multi-connection: group connections by environment (dev/test/prod...), mixing database types freely
- Security: strict read-only statement whitelist, mandatory parameter binding, passwords stored only as environment-variable references, row/time limits
- Self-contained: the MCP server ships as a single bundled file — no `npm install` needed after installation

## Installation

Install via the plugin marketplace (requires Node.js ≥ 18; ZCode launches it as an MCP server).

## Quick Start

Just talk to the AI after installation, for example:

> "Use db-connector to add a MySQL connection: environment dev, name mysql-main, database shop, password in the DB_DEV_PW environment variable."
>
> "List all tables in the dev environment."
>
> "Count daily orders for last month."

## Connection Configuration

### Option 1: conversational setup (recommended)

The AI calls `db_add_connection` for you. Passwords accept a **variable name only** (written as a `${VAR}` reference; plaintext passwords are rejected). Variables are defined in `.env` files (system environment variables are never read):

```bash
# Location: workspace .env or user-level ~/.zcode/db-connector/.env
DB_DEV_PW=your-password
DB_PROD_PW="quote passwords containing spaces or # characters"
```

`${VAR}` resolution order: **workspace `.env` > user-level `.env`**. The `.env` files are re-read on every tool call — saving is enough, no restart needed. Remember to gitignore the workspace `.env`.

### Option 2: edit the config file directly

Workspace-level `<workspace>/db-connections.json` (per project) or user-level `~/.zcode/db-connector/connections.json` (across projects). Both may coexist; they are merged by "environment name + connection name" with the workspace taking precedence:

```json
{
  "configVersion": 1,
  "activeEnvironment": "dev",
  "defaults": { "rowLimit": 200, "maxRowLimit": 1000, "timeoutMs": 10000 },
  "environments": {
    "dev": {
      "description": "local development",
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
      "description": "production",
      "protected": true,
      "connections": {
        "mysql-main": { "type": "mysql", "host": "10.0.0.2", "user": "ro_user",
          "password": "${DB_PROD_PW}", "database": "shop" }
      }
    }
  }
}
```

- Connection references: `"mysql-main"` (active environment) or `"prod/mysql-main"` (explicit cross-environment)
- Queries against `protected: true` environments carry a prominent protected-environment banner
- Password `${VAR}` resolution order: workspace `.env` > `~/.zcode/db-connector/.env` (system environment variables are not read)

## MCP Tools

| Category | Tool | Description |
|----------|------|-------------|
| Config | `db_list_connections` | List connections by environment (masked) |
| Config | `db_add_connection` | Add a connection (password accepts a variable name only) |
| Config | `db_remove_connection` | Remove a connection |
| Config | `db_set_active_environment` | Switch the active environment |
| Query | `db_test_connection` | Connectivity test |
| Query | `db_list_tables` | Table/collection listing with row estimates |
| Query | `db_describe_table` | Columns/types/keys/indexes (inferred by sampling for Mongo) |
| Query | `db_query` | Read-only SQL (MySQL `?` / PG `$1` parameter binding) |
| Query | `db_find` | MongoDB read-only queries |
| Query | `db_aggregate` | MongoDB aggregation ($out/$merge rejected) |

## Security Model

1. **Read-only whitelist**: only single `SELECT / WITH / EXPLAIN / SHOW / DESCRIBE / DESC` statements pass; write/DDL keywords, multi-statements, locking clauses and dangerous functions (file access/delays/cross-database execution) are rejected even inside subqueries or comments
2. **Mandatory parameter binding**: query values go through `params` only; the server never concatenates values into SQL
3. **No secrets at rest**: configs store only `${ENV_VAR}` references; tool output and logs are masked throughout
4. **Resource protection**: row limits and timeouts are configurable at three levels (`defaults` → connection → query parameter), with a hard `maxRowLimit` ceiling
5. For best results, use **read-only database accounts** for every environment

## Row Limit & Timeout Configuration

| Level | Location | Default |
|-------|----------|---------|
| Global default | `defaults.rowLimit` / `defaults.timeoutMs` | 200 / 10000ms |
| Connection override | `rowLimit` / `timeoutMs` in a connection object | inherits global |
| Per-query | tool parameter `limit` | capped by `maxRowLimit` (default 1000) |

## Known Limitations

- Query-only by design; no write/DDL capability at all
- The keyword whitelist may occasionally reject a legitimate query whose column names contain reserved words (e.g. a column named `set`); quote/alias the column and retry
- Large result sets are buffered by the driver then truncated; `timeoutMs` is the final backstop

## Disclosure

- **Network**: outbound connections are made only to the database hosts the user configures (MySQL/PostgreSQL/MongoDB ports); the plugin makes no other network calls
- **Process**: ZCode starts one MCP server process via `node mcp/dist/db-connect-server.bundle.cjs` (stdio)
- **File writes**: only `~/.zcode/db-connector/connections.json`, `~/.zcode/db-connector/.env`, and the workspace-level `db-connections.json` / `.env`; nothing else is written
- **Secrets**: passwords are never stored in plaintext — only `${ENV_VAR}` references resolved from `.env` files at call time
- **Third-party code**: the bundle embeds [mysql2](https://github.com/sidorares/node-mysql2) (MIT), [node-postgres](https://github.com/brianc/node-postgres) (MIT) and the [MongoDB Node driver](https://github.com/mongodb/node-mongodb-native) (Apache-2.0); their license notices are kept inline in the bundled file

## Development

```bash
cd mcp
npm install
npm run build    # tsc compile to dist/
npm run bundle   # rebuild the self-contained dist/db-connect-server.bundle.cjs
npm test         # smoke tests (no real database needed)
```

## License

[Apache-2.0](LICENSE)
