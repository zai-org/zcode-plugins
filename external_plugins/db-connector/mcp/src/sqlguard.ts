/**
 * sqlguard：只读 SQL 白名单校验。
 * 硬性规则（对应 REQUIREMENTS §6）：
 *  1. 仅放行单条 SELECT / WITH / EXPLAIN / SHOW / DESCRIBE / DESC 语句；
 *  2. 拒绝多语句（任何分号）；
 *  3. 对原始文本做写/DDL 关键词与危险函数扫描——即使出现在子查询或注释中同样拒绝；
 *  4. 锁定子句（FOR UPDATE / FOR SHARE 等）与文件/锁/延时类函数拒绝。
 */
export class SqlRejectedError extends Error {
  constructor(reason: string) {
    super(`SQL 被只读校验拒绝：${reason}`);
    this.name = 'SqlRejectedError';
  }
}

/** 语句必须以这些关键词之一开头 */
const ALLOWED_STARTERS = /^\s*(select|with|explain(\s+analyze|\s+analyse)?|show|describe|desc)\b/i;

/** 原文全词扫描的写/DDL/会话类关键词（含子查询与注释中出现的情况） */
const FORBIDDEN_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate',
  'grant', 'revoke', 'replace', 'merge', 'call', 'execute', 'exec',
  'lock', 'unlock', 'load', 'rename', 'use', 'set', 'into', 'outfile',
  'dumpfile', 'prepare', 'handler', 'do', 'copy', 'vacuum', 'reindex',
  'cluster', 'listen', 'notify', 'refresh', 'attach', 'detach',
  'checkpoint', 'kill', 'reset', 'flush', 'optimize', 'repair',
  'shutdown', 'purge', 'start', 'begin', 'commit', 'rollback', 'savepoint',
];

/** 危险函数（服务端文件读写 / 锁 / 延时 / 跨库执行 / 终止会话） */
const FORBIDDEN_FUNCTIONS = [
  'load_file', 'get_lock', 'release_lock', 'benchmark', 'sleep',
  'sys_eval', 'sys_exec',
  'pg_sleep', 'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir',
  'pg_stat_file', 'pg_terminate_backend', 'pg_cancel_backend',
  'dblink', 'lo_import', 'lo_export', 'pg_switch_wal', 'pg_ls_waldir',
];

/** 行级锁子句 */
const LOCK_CLAUSE = /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const forbiddenKeywordRegex = FORBIDDEN_KEYWORDS.map(
  (w) => new RegExp(`(^|[^a-zA-Z0-9_])${escapeRegExp(w)}([^a-zA-Z0-9_]|$)`, 'i')
);
const forbiddenFunctionRegex = FORBIDDEN_FUNCTIONS.map(
  (w) => new RegExp(`(^|[^a-zA-Z0-9_])${escapeRegExp(w)}\\s*\\(`, 'i')
);

/** 校验入口：合法返回清理后的 SQL，非法抛 SqlRejectedError */
export function validateReadOnlySql(rawSql: string): string {
  if (typeof rawSql !== 'string') {
    throw new SqlRejectedError('sql 必须是字符串');
  }
  const trimmed = rawSql.trim();
  // 去掉末尾多余分号后必须非空
  const stripped = trimmed.replace(/;+\s*$/, '');
  if (!stripped) {
    throw new SqlRejectedError('SQL 为空');
  }
  // 多语句拒绝：任何残留分号（包括注释里藏语句的写法）
  if (stripped.includes(';')) {
    throw new SqlRejectedError('不允许一次执行多条语句（检测到分号）');
  }
  // 语句类型白名单
  if (!ALLOWED_STARTERS.test(stripped)) {
    throw new SqlRejectedError(
      '仅允许 SELECT / WITH / EXPLAIN / SHOW / DESCRIBE / DESC 开头的单条只读语句'
    );
  }
  // 写/DDL 关键词全词扫描（含子查询、注释）
  for (let i = 0; i < FORBIDDEN_KEYWORDS.length; i++) {
    if (forbiddenKeywordRegex[i].test(stripped)) {
      throw new SqlRejectedError(
        `检测到禁止的关键词 "${FORBIDDEN_KEYWORDS[i].toUpperCase()}"（含子查询/注释中的出现）`
      );
    }
  }
  // 危险函数扫描
  for (let i = 0; i < FORBIDDEN_FUNCTIONS.length; i++) {
    if (forbiddenFunctionRegex[i].test(stripped)) {
      throw new SqlRejectedError(`检测到禁止的函数 "${FORBIDDEN_FUNCTIONS[i]}"`);
    }
  }
  // 行级锁子句
  if (LOCK_CLAUSE.test(stripped)) {
    throw new SqlRejectedError('检测到锁定子句（FOR UPDATE/FOR SHARE 等），只读模式不允许');
  }
  return stripped;
}

/** MongoDB 校验：拒绝 $out/$merge/$load 等写阶段与 $where/$function 等脚本执行 */
const FORBIDDEN_MONGO_KEYS = [
  '$out', '$merge', '$load', '$where', '$function', '$accumulator', '$db', '$eval',
];

export function validateMongoStages(pipeline: unknown): void {
  if (!Array.isArray(pipeline)) {
    throw new SqlRejectedError('pipeline 必须是数组');
  }
  for (const stage of pipeline) {
    scanMongoObject(stage, 'pipeline 阶段');
  }
}

export function validateMongoReadDocument(doc: unknown, what: string): void {
  scanMongoObject(doc, what);
}

function scanMongoObject(value: unknown, where: string, depth = 0): void {
  if (depth > 30) {
    throw new SqlRejectedError(`${where} 嵌套过深`);
  }
  if (value === null || value === undefined) return;
  if (typeof value === 'function') {
    throw new SqlRejectedError(`${where} 不允许包含函数`);
  }
  if (Array.isArray(value)) {
    for (const item of value) scanMongoObject(item, where, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (FORBIDDEN_MONGO_KEYS.includes(key)) {
        throw new SqlRejectedError(`${where} 检测到禁止的运算符 "${key}"`);
      }
      scanMongoObject((value as Record<string, unknown>)[key], where, depth + 1);
    }
  }
}
