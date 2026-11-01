---
name: data-studio
description: >-
  Query and explore the user's databases through the data_studio__* MCP tools:
  70+ SQL databases (PostgreSQL, MySQL, SQL Server, Oracle, SQLite, DuckDB,
  ClickHouse, Snowflake and more) via SqlKit, plus Elasticsearch, OpenSearch,
  MongoDB and DynamoDB via DocKit. Use when the user asks to list tables or
  schemas, run SQL or queries, inspect indexes/mappings/collections, analyze or
  visualize stored data, troubleshoot slow queries, or mentions
  数据库/查询/表结构/索引/集合. Credentials stay inside the desktop apps; tools
  take a connection_id only. Requires dockit and/or sqlkit running locally with
  the MCP bridge enabled.
---

# Data Studio

MCP tools prefixed `data_studio__*` route to the user's local [dockit](https://github.com/geek-fun/dockit) (NoSQL) and [sqlkit](https://github.com/geek-fun/sqlkit) (SQL) desktop apps over a localhost-only bridge (127.0.0.1). This skill explains how to use them well.

## Prerequisites

- dockit and/or sqlkit installed and running, with at least one database connection added.
- **Settings → MCP Bridge → Auto-start** enabled in the desktop apps (on by default).

If tools fail to connect, tell the user to launch the desktop apps and check Settings → MCP Bridge. Never ask the user for credentials: real credentials are resolved inside the apps, and tools only ever accept an opaque `connection_id`.

## Workflow

1. Start with `data_studio__list_connections` (or `data_studio__get_status`) to discover running backends and connection IDs. These two tools have no app segment; all others are four-segment names.
2. Route by app + backend; tool names follow `data_studio__{app}__{backend}__{action}`:
   - SQL databases: `data_studio__sqlkit__sqlkit__*` (e.g. `data_studio__sqlkit__sqlkit__execute_query`)
   - Elasticsearch/OpenSearch: `data_studio__dockit__es__*`
   - MongoDB: `data_studio__dockit__mongo__*`
   - DynamoDB: `data_studio__dockit__dynamo__*`
3. Explore before querying: `list_databases` → `list_tables` / `cat_indices` / `list_collections` → `describe_table` / `get_mapping` → then `execute_query` / `search` / `find`.
4. Reference connections strictly by a `connection_id` returned by the listing tools; never fabricate IDs.
5. Show the user every statement executed, with row/record counts and a short interpretation.

## Permission tiers

| Tier | Examples | Behavior |
|---|---|---|
| Safe (Read Only) | schema reads, `execute_query`, `search`, `find` | run freely under the default Read Only mode |
| Elevated | `execute_write`, index/mapping/alias changes, `insert_*`, `update_*` | allowed only when the app is in Data Read-Write mode |
| Destructive | `execute_delete`, `execute_ddl`, `drop_*`, `delete_*`, `truncate_*` | require Full Access AND explicit user confirmation in the client |

Before any destructive call, state exactly what will be deleted or dropped and wait for the user's confirmation. Never chain destructive operations into batch scripts. If a call is rejected by the policy, explain which permission mode it requires instead of retrying.

## Conventions

- The documented matrix is 117 tools; the runtime set depends on the apps' permission mode and configured connections. Prefer the most specific tool: `explain_query` for plan analysis, `get_slow_queries` for performance troubleshooting, `es__count` before broad `search` calls.
- Results are capped. Use limit/pagination arguments for large datasets instead of unbounded scans.
- Prefer read-only tools unless the user explicitly asks for changes.
