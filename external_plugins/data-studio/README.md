# Data Studio — ZCode Plugin

**Let your AI coding agent securely access all your databases, in plain language.**

A ZCode plugin that bundles the [Data Studio MCP server](https://www.npmjs.com/package/@geek-fun/data-studio-mcp) (`data_studio__*` tools, 117 total) with agent usage guidance.

- **SQL** (via [sqlkit](https://github.com/geek-fun/sqlkit)): 70+ databases (PostgreSQL, MySQL, SQL Server, Oracle, SQLite, DuckDB, ClickHouse, Snowflake, BigQuery, and more).
- **NoSQL** (via [dockit](https://github.com/geek-fun/dockit)): Elasticsearch, OpenSearch, MongoDB, DynamoDB.

简体中文说明见 [README_CN.md](README_CN.md)。

## Prerequisites

1. Install and launch [dockit](https://github.com/geek-fun/dockit) and/or [sqlkit](https://github.com/geek-fun/sqlkit); add a database connection.
2. Keep **Settings → MCP Bridge → Auto-start** enabled in the desktop apps (on by default).
3. Node.js ≥ 18 on PATH (the MCP server is started via `npx -y @geek-fun/data-studio-mcp@0.1.12`).

## Disclosure

| Item | Detail |
|---|---|
| MCP server | One stdio server: `npx -y @geek-fun/data-studio-mcp@0.1.12` (npm package `@geek-fun/data-studio-mcp`) |
| Network access | `127.0.0.1` only: talks to the dockit/sqlkit local bridges (ports 9120/9121). npm registry access during the first `npx` download. No other endpoints; no telemetry. |
| Credentials | Never collected, stored, or transmitted. The LLM only sees opaque `connection_id`s; real credentials are resolved inside the desktop apps. |
| Command execution | Spawns the MCP server process (Node.js). No shell scripts, no hooks. |
| File writes | None by the plugin itself. |
| External services | None. |

## Security model

- Credentials never leave the desktop apps: tools accept `connection_id` only.
- Three-tier permissions, configured in dockit/sqlkit: Read Only / Data Read-Write / Full Access.
- Destructive operations (DELETE, DROP, TRUNCATE) always surface an explicit confirmation prompt in the client.

## License

Apache 2.0. See [LICENSE](../../LICENSE) in the repository root.
