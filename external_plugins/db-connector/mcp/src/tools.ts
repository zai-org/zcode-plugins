/**
 * tools：MCP 工具定义与处理器（10 个，REQUIREMENTS §5）。
 * 处理顺序约定：db_query 先做只读 SQL 校验再解析连接——校验无需数据库即可测试。
 */
import {
  loadMergedConfig,
  resolveConnectionRef,
  resolveEnvPlaceholders,
  sanitizeConnectionForWrite,
  persistAddConnection,
  persistRemoveConnection,
  persistSetActiveEnvironment,
  validateIdentifier,
  maskConnection,
  MergedConfig,
} from './config';
import { validateReadOnlySql, validateMongoStages, validateMongoReadDocument } from './sqlguard';
import { sqlQuery, testConnection, listTables, describeTable, mongoFind, mongoAggregate, jsonSafe } from './drivers';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const str = (description: string) => ({ type: 'string', description });

export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    name: 'db_list_connections',
    description: '按环境分组列出所有已配置的数据库连接（凭证脱敏），标注活动环境与 protected 标记。无配置时返回创建引导。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'db_test_connection',
    description: '测试指定连接的连通性，返回服务器版本与耗时。connection 用 "连接名"（活动环境）或 "环境名/连接名"（如 prod/mysql-main）。',
    inputSchema: {
      type: 'object',
      properties: { connection: str('连接引用：连接名 或 环境名/连接名') },
      required: ['connection'],
      additionalProperties: false,
    },
  },
  {
    name: 'db_list_tables',
    description: '列出指定连接中的所有表/集合及行数估计。',
    inputSchema: {
      type: 'object',
      properties: { connection: str('连接引用：连接名 或 环境名/连接名') },
      required: ['connection'],
      additionalProperties: false,
    },
  },
  {
    name: 'db_describe_table',
    description: '查看表结构：列名/类型/可空/键/索引（MongoDB 为采样字段推断 + 索引列表）。',
    inputSchema: {
      type: 'object',
      properties: {
        connection: str('连接引用：连接名 或 环境名/连接名'),
        table: str('表名或集合名'),
      },
      required: ['connection', 'table'],
      additionalProperties: false,
    },
  },
  {
    name: 'db_query',
    description: '对 MySQL/PostgreSQL 执行只读 SQL（仅 SELECT/WITH/EXPLAIN/SHOW/DESCRIBE）。值必须通过 params 参数绑定传入：MySQL 用 ? 占位符，PostgreSQL 用 $1/$2 占位符，禁止在 SQL 文本中拼接值。',
    inputSchema: {
      type: 'object',
      properties: {
        connection: str('连接引用：连接名 或 环境名/连接名'),
        sql: str('单条只读 SQL 语句'),
        params: { type: 'array', items: {}, description: '占位符对应的值数组，按顺序绑定' },
        limit: { type: 'number', description: '本次返回行数上限（不超过配置的 maxRowLimit，缺省 1000）' },
      },
      required: ['connection', 'sql'],
      additionalProperties: false,
    },
  },
  {
    name: 'db_find',
    description: 'MongoDB 只读查询（对应 find），支持 filter/projection/sort/limit。禁止 $where 等脚本运算符。',
    inputSchema: {
      type: 'object',
      properties: {
        connection: str('连接引用：连接名 或 环境名/连接名'),
        collection: str('集合名'),
        filter: { type: 'object', description: '查询条件（MongoDB 查询文档）' },
        projection: { type: 'object', description: '字段投影' },
        sort: { type: 'object', description: '排序，如 {"field": -1}' },
        limit: { type: 'number', description: '返回文档数上限' },
      },
      required: ['connection', 'collection'],
      additionalProperties: false,
    },
  },
  {
    name: 'db_aggregate',
    description: 'MongoDB 聚合管道（只读阶段；$out/$merge/$where/$function 被拒绝）。',
    inputSchema: {
      type: 'object',
      properties: {
        connection: str('连接引用：连接名 或 环境名/连接名'),
        collection: str('集合名'),
        pipeline: { type: 'array', items: {}, description: '聚合阶段数组' },
        limit: { type: 'number', description: '返回文档数上限' },
      },
      required: ['connection', 'collection', 'pipeline'],
      additionalProperties: false,
    },
  },
  {
    name: 'db_add_connection',
    description: '新增数据库连接并持久化（会话式配置）。密码只接受环境变量名（passwordEnvVar），写入为 ${VAR} 引用，拒绝明文密码。config 含 type(mysql/postgres/mongodb) 及 host/port/user/database 或 url 等字段。scope：workspace（默认，工作区 db-connections.json）或 user（用户级全局配置）。',
    inputSchema: {
      type: 'object',
      properties: {
        environment: str('环境名，如 dev/test/prod'),
        name: str('连接名，如 mysql-main'),
        config: {
          type: 'object',
          description: '连接配置：type 必填；MySQL/PG 可给 host/port/user/password(仅${VAR}形式)/database 或 url；MongoDB 给 url(可含${VAR}) 及可选 database',
        },
        passwordEnvVar: str('密码变量名（在 .env 文件中定义），写入为 ${VAR} 引用'),
        scope: { type: 'string', enum: ['workspace', 'user'], description: '持久化位置，缺省 workspace' },
      },
      required: ['environment', 'name', 'config'],
      additionalProperties: false,
    },
  },
  {
    name: 'db_remove_connection',
    description: '删除指定环境中的连接（优先从工作区文件删除，其次用户级文件）。',
    inputSchema: {
      type: 'object',
      properties: {
        environment: str('环境名'),
        name: str('连接名'),
      },
      required: ['environment', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'db_set_active_environment',
    description: '切换活动环境（工具默认使用的环境）并持久化。',
    inputSchema: {
      type: 'object',
      properties: { environment: str('环境名，如 dev/prod') },
      required: ['environment'],
      additionalProperties: false,
    },
  },
];

function computeLimit(effective: { rowLimit: number; maxRowLimit: number; timeoutMs: number }, requested?: number): number {
  const base = typeof requested === 'number' && requested > 0 ? requested : effective.rowLimit;
  return Math.max(1, Math.min(base, effective.maxRowLimit));
}

function protectedBanner(envProtected: boolean): string | undefined {
  return envProtected ? '⚠️ 受保护环境（protected）：本查询作用于生产/受保护数据，请谨慎分享结果' : undefined;
}

/** 统一处理器：返回 JSON 文本；抛错由 server 层转为 isError 内容 */
export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  const merged: MergedConfig = loadMergedConfig();

  switch (name) {
    case 'db_list_connections': {
      const envKeys = Object.keys(merged.environments);
      if (envKeys.length === 0) {
        return {
          status: 'no_config',
          message:
            '尚未配置任何数据库连接。可用 db_add_connection 添加（提供 environment、name、config、passwordEnvVar），或手工创建 db-connections.json。',
        };
      }
      return {
        activeEnvironment: merged.activeEnvironment ?? null,
        defaults: merged.defaults,
        envSources: merged.envSources,
        workspaceConfig: merged.workspaceFile ? merged.workspacePath : null,
        userConfig: merged.userFile ? merged.userPath : null,
        environments: Object.fromEntries(
          Object.entries(merged.environments).map(([envName, env]) => [
            envName,
            {
              description: env.description ?? null,
              protected: !!env.protected,
              active: envName === merged.activeEnvironment,
              connections: Object.entries(env.connections).map(([connName, conn]) => ({
                name: connName,
                ...maskConnection(conn),
              })),
            },
          ])
        ),
      };
    }

    case 'db_test_connection': {
      const ref = resolveConnectionRef(merged, String(args.connection ?? ''));
      const cfg = resolveEnvPlaceholders(ref.config, merged.env);
      const { serverInfo, elapsedMs } = await testConnection(cfg, ref.effective.timeoutMs);
      return { connection: `${ref.environment}/${ref.name}`, serverInfo, elapsedMs, warning: protectedBanner(ref.envProtected) };
    }

    case 'db_list_tables': {
      const ref = resolveConnectionRef(merged, String(args.connection ?? ''));
      const cfg = resolveEnvPlaceholders(ref.config, merged.env);
      const outcome = await listTables(cfg, { timeoutMs: ref.effective.timeoutMs, limit: computeLimit(ref.effective) });
      return {
        connection: `${ref.environment}/${ref.name}`,
        tableCount: outcome.rows.length,
        tables: jsonSafe(outcome.rows),
        elapsedMs: outcome.elapsedMs,
        warning: protectedBanner(ref.envProtected),
      };
    }

    case 'db_describe_table': {
      const ref = resolveConnectionRef(merged, String(args.connection ?? ''));
      const cfg = resolveEnvPlaceholders(ref.config, merged.env);
      const table = String(args.table ?? '');
      if (!table.trim()) throw new Error('table 参数不能为空');
      const detail = await describeTable(cfg, table, { timeoutMs: ref.effective.timeoutMs, limit: computeLimit(ref.effective) });
      return {
        connection: `${ref.environment}/${ref.name}`,
        table,
        ...jsonSafe(detail) as object,
        warning: protectedBanner(ref.envProtected),
      };
    }

    case 'db_query': {
      const sql = validateReadOnlySql(String(args.sql ?? '')); // 先校验，无需数据库即可拒绝
      const ref = resolveConnectionRef(merged, String(args.connection ?? ''));
      if (ref.config.type === 'mongodb') {
        throw new Error('MongoDB 连接请使用 db_find / db_aggregate，不支持 SQL');
      }
      const cfg = resolveEnvPlaceholders(ref.config, merged.env);
      const params = Array.isArray(args.params) ? args.params : [];
      const limit = computeLimit(ref.effective, args.limit as number | undefined);
      const outcome = await sqlQuery(ref.config.type, cfg, sql, params, {
        timeoutMs: ref.effective.timeoutMs,
        limit,
      });
      return {
        connection: `${ref.environment}/${ref.name}`,
        rowCount: outcome.rows.length,
        truncated: outcome.truncated,
        rowLimit: limit,
        rows: jsonSafe(outcome.rows),
        elapsedMs: outcome.elapsedMs,
        warning: protectedBanner(ref.envProtected),
      };
    }

    case 'db_find': {
      const ref = resolveConnectionRef(merged, String(args.connection ?? ''));
      if (ref.config.type !== 'mongodb') throw new Error('db_find 仅用于 MongoDB 连接；SQL 数据库请使用 db_query');
      const cfg = resolveEnvPlaceholders(ref.config, merged.env);
      const collection = String(args.collection ?? '');
      if (!collection.trim()) throw new Error('collection 参数不能为空');
      const filter = (args.filter as Record<string, unknown>) ?? {};
      validateMongoReadDocument(filter, 'filter');
      const projection = args.projection as Record<string, unknown> | undefined;
      if (projection) validateMongoReadDocument(projection, 'projection');
      const sort = args.sort as Record<string, unknown> | undefined;
      if (sort) validateMongoReadDocument(sort, 'sort');
      const limit = computeLimit(ref.effective, args.limit as number | undefined);
      const outcome = await mongoFind(cfg, collection, filter, projection, sort, {
        timeoutMs: ref.effective.timeoutMs,
        limit,
      });
      return {
        connection: `${ref.environment}/${ref.name}`,
        collection,
        rowCount: outcome.rows.length,
        truncated: outcome.truncated,
        documents: jsonSafe(outcome.rows),
        elapsedMs: outcome.elapsedMs,
        warning: protectedBanner(ref.envProtected),
      };
    }

    case 'db_aggregate': {
      const ref = resolveConnectionRef(merged, String(args.connection ?? ''));
      if (ref.config.type !== 'mongodb') throw new Error('db_aggregate 仅用于 MongoDB 连接');
      const cfg = resolveEnvPlaceholders(ref.config, merged.env);
      const collection = String(args.collection ?? '');
      if (!collection.trim()) throw new Error('collection 参数不能为空');
      const pipeline = args.pipeline;
      validateMongoStages(pipeline);
      const limit = computeLimit(ref.effective, args.limit as number | undefined);
      const outcome = await mongoAggregate(cfg, collection, pipeline as unknown[], {
        timeoutMs: ref.effective.timeoutMs,
        limit,
      });
      return {
        connection: `${ref.environment}/${ref.name}`,
        collection,
        rowCount: outcome.rows.length,
        truncated: outcome.truncated,
        documents: jsonSafe(outcome.rows),
        elapsedMs: outcome.elapsedMs,
        warning: protectedBanner(ref.envProtected),
      };
    }

    case 'db_add_connection': {
      const envName = String(args.environment ?? '');
      const connName = String(args.name ?? '');
      validateIdentifier('环境名', envName);
      validateIdentifier('连接名', connName);
      const configArg = args.config;
      if (!configArg || typeof configArg !== 'object') throw new Error('config 必须是对象');
      const { config, warnings } = sanitizeConnectionForWrite(configArg as Record<string, unknown>, args.passwordEnvVar as string | undefined);
      const scope = args.scope === 'user' ? 'user' : 'workspace';
      const { file } = persistAddConnection(scope, merged, envName, connName, config);
      return { ok: true, connection: `${envName}/${connName}`, scope, file, warnings };
    }

    case 'db_remove_connection': {
      const envName = String(args.environment ?? '');
      const connName = String(args.name ?? '');
      const { file } = persistRemoveConnection(merged, envName, connName);
      return { ok: true, removed: `${envName}/${connName}`, file };
    }

    case 'db_set_active_environment': {
      const envName = String(args.environment ?? '');
      const { file } = persistSetActiveEnvironment(merged, envName);
      return { ok: true, activeEnvironment: envName, file };
    }

    default:
      throw new Error(`未知工具：${name}`);
  }
}
