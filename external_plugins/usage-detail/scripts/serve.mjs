#!/usr/bin/env node
// ZCode 用量明细 · 本地常驻面板服务
// 只读查询本地 SQLite，仅监听 127.0.0.1。页面数据一次加载 /api/data，
// 燃烧率等实时指标轻量轮询 /api/live（默认 5s），不重复拉全量。
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { queryAllVendors } from './vendor-quota.mjs';
import { providerNames, projectMap } from './lib/project-meta.mjs';

const port = Number(process.argv[2]) || 7741;
const DB = process.env.ZCODE_USAGE_DB || path.join(os.homedir(), '.zcode/cli/db/db.sqlite');
const USER_PRICE = process.env.ZCODE_USAGE_PRICES || path.join(os.homedir(), '.zcode/usage-prices.json');
const HERE = path.dirname(fs.realpathSync(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
// 版本握手：panel-server 拉起常驻面板时对比版本，不一致则重启旧进程（旧 serve 缺新路由会 404）
let PLUGIN_VERSION = 'unknown';
try { PLUGIN_VERSION = JSON.parse(fs.readFileSync(path.join(HERE, '..', '.zcode-plugin', 'plugin.json'), 'utf8')).version || 'unknown'; } catch (e) {}
const USAGE_SH = path.join(HERE, 'usage.sh');

if (!fs.existsSync(DB)) {
  console.error('未找到 ZCode 本地数据库：' + DB);
  process.exit(1);
}

// node:sqlite 只读连接（Node ≥22.5）：常驻进程内直接查询，省去每次 spawn sqlite3 CLI 的进程开销
let db;
try {
  db = new DatabaseSync(DB, { readOnly: true });
} catch (e) {
  console.error('node:sqlite 打开数据库失败（需要 Node ≥ 22.5）：' + e.message);
  process.exit(1);
}
function q(sql) {
  const row = db.prepare(sql).get();
  if (!row) return '';
  return String(row[Object.keys(row)[0]]);
}
// 多列单行查询：按列序返回值数组（q() 只取首列，liveJSON 曾误用它拆分导致实时角标长期为 0）
function qcols(sql) {
  const row = db.prepare(sql).get();
  return row ? Object.keys(row).map((k) => row[k]) : [];
}
// turn_id 是较新 ZCode 才有的列：老库直接 SELECT 会 prepare 失败，先探测再拼表达式
const TURN_EXPR = q("SELECT count(*) FROM pragma_table_info('model_usage') WHERE name='turn_id'") === '1' ? 'R.turn_id' : 'NULL';
// agent / context_exceeded 同为较新列：老库回退（agent 置空显示未知来源，ctx 置 NULL 无超限标注）
const AGENT_EXPR = q("SELECT count(*) FROM pragma_table_info('model_usage') WHERE name='agent'") === '1' ? 'mu.agent' : "''";
const CTX_EXC_EXPR = q("SELECT count(*) FROM pragma_table_info('model_usage') WHERE name='context_exceeded'") === '1' ? 'R.context_exceeded' : 'NULL';
// 子代理会话归属：session.parent_id（较新列）把子会话挂到主会话；老库无此列时留在子会话名下
const PARENT_EXPR = q("SELECT count(*) FROM pragma_table_info('session') WHERE name='parent_id'") === '1' ? 'ch.parent_id' : 'NULL';

function pricePath() {
  if (process.env.ZCODE_USAGE_PRICES && fs.existsSync(process.env.ZCODE_USAGE_PRICES)) return process.env.ZCODE_USAGE_PRICES;
  if (fs.existsSync(USER_PRICE)) return USER_PRICE;
  const d = path.join(HERE, 'default-prices.json');
  return fs.existsSync(d) ? d : null;
}

const META_SQL = (pfText, limit, disk, extraJson) => `
  WITH P AS (SELECT provider_id AS v, row_number() OVER (ORDER BY provider_id)-1 AS i FROM (SELECT DISTINCT provider_id FROM model_usage)),
       M AS (SELECT model_id AS v, row_number() OVER (ORDER BY model_id)-1 AS i FROM (SELECT DISTINCT model_id FROM model_usage)),
       S AS (SELECT session_id AS v, row_number() OVER (ORDER BY session_id)-1 AS i FROM (SELECT DISTINCT session_id FROM model_usage)),
       PJ AS (SELECT ${pfText != null ? `CAST('${pfText.replace(/'/g, "''")}' AS text)` : 'NULL'} AS pj),
       R AS (SELECT * FROM model_usage ORDER BY started_at DESC LIMIT ${limit})
  SELECT json_object(
    'providers',(SELECT json_group_array(v) FROM (SELECT v,i FROM P ORDER BY i)),
    'models',(SELECT json_group_array(v) FROM (SELECT v,i FROM M ORDER BY i)),
    'sessions',(SELECT json_group_array(coalesce(se.title,'')) FROM (SELECT v,i FROM S ORDER BY i) SI LEFT JOIN session se ON se.id=SI.v),
    'sessionIds',(SELECT json_group_array(v) FROM (SELECT v,i FROM S ORDER BY i)),
    'sessionDirs',(SELECT json_group_array(coalesce(se.directory,'')) FROM (SELECT v,i FROM S ORDER BY i) SI LEFT JOIN session se ON se.id=SI.v),
    'tools',(SELECT COALESCE(json_group_array(json_array(tool_name, c, f, d)),'[]') FROM (SELECT tool_name, count(*) AS c, sum(status<>'completed') AS f, CAST(round(avg(duration_ms)) AS int) AS d FROM tool_usage GROUP BY tool_name ORDER BY c DESC LIMIT 8)),
    'todos',(SELECT json_array(sum(CASE WHEN status='completed' THEN 1 ELSE 0 END), count(*)) FROM todo),
    'stability',(SELECT json_array(COALESCE(sum(retry_count),0), COALESCE(sum(cancelled_by_user),0), COALESCE(sum(CASE WHEN status='error' THEN 1 ELSE 0 END),0)) FROM model_usage),
    'hours',(SELECT COALESCE(json_group_object(hr, c),'{}') FROM (SELECT strftime('%H', started_at/1000,'unixepoch','localtime') AS hr, count(*) AS c FROM model_usage GROUP BY hr)),
    'compactions',(SELECT COALESCE(json_group_array(json_array(SI.i, c.cnt, c.maxpre, json(c.ts), json(c.triggers))),'[]') FROM (SELECT p.session_id AS sid, count(*) AS cnt, max(COALESCE(json_extract(p.data,'$.preCompactTokenCount'),0)) AS maxpre, json_group_array(strftime('%m-%d %H:%M', p.time_created/1000,'unixepoch','localtime')) AS ts, json_group_array(COALESCE(json_extract(p.data,'$.trigger'),'manual') || '/' || COALESCE(json_extract(p.data,'$.phase'),'')) AS triggers FROM part p WHERE json_extract(p.data,'$.type')='compaction' GROUP BY p.session_id) c LEFT JOIN S SI ON SI.v = c.sid WHERE SI.i IS NOT NULL),
        'ctxMix',(SELECT COALESCE(json_group_array(json_array(SI.i, m.t, m.b)),'[]') FROM (SELECT p.session_id AS sid, json_extract(p.data,'$.type') AS t, sum(length(p.data)) AS b FROM part p WHERE p.session_id IN (SELECT DISTINCT session_id FROM R) AND p.session_id IS NOT NULL GROUP BY p.session_id, json_extract(p.data,'$.type')) m LEFT JOIN S SI ON SI.v = m.sid WHERE SI.i IS NOT NULL),
        'sessionAgents',(SELECT COALESCE(json_group_array(json_array(SI.i, a.agent, a.c, a.tok)),'[]') FROM (SELECT COALESCE(${PARENT_EXPR}, mu.session_id) AS root_sid, COALESCE(NULLIF(${AGENT_EXPR},''),'-') AS agent, count(*) AS c, sum(mu.input_tokens+mu.output_tokens+mu.reasoning_tokens) AS tok FROM R mu LEFT JOIN session ch ON ch.id = mu.session_id WHERE mu.query_source='subagent' GROUP BY 1, 2) a LEFT JOIN S SI ON SI.v = a.root_sid WHERE SI.i IS NOT NULL),
    'sessionTools',(SELECT COALESCE(json_group_array(json_array(SI.i, t.tool, t.c, t.ms)),'[]') FROM (SELECT session_id AS sid, tool_name AS tool, count(*) AS c, CAST(sum(duration_ms) AS int) AS ms FROM tool_usage GROUP BY session_id, tool_name) t LEFT JOIN S SI ON SI.v = t.sid WHERE SI.i IS NOT NULL),
    'disk', json('${JSON.stringify(disk).replace(/'/g, "''")}'),
    'providerNames', json_extract(json('${extraJson.replace(/'/g, "''")}'),'$."providerNames"'),
    'projectMap', json_extract(json('${extraJson.replace(/'/g, "''")}'),'$."projectMap"'),
    'budgetDaily', json_extract(json('${extraJson.replace(/'/g, "''")}'),'$."budgetDaily"'),
    'userLang', json_extract(json('${extraJson.replace(/'/g, "''")}'),'$."userLang"'),
    'budgetMonthly', json_extract(json('${extraJson.replace(/'/g, "''")}'),'$."budgetMonthly"'),
    'prices',(SELECT CASE
              WHEN pj IS NULL OR NOT json_valid(pj) THEN json('{}')
              ELSE json_object('currency', COALESCE(json_extract(pj,'$.currency'),'CNY'),
                   'models', COALESCE(CASE WHEN json_type(pj,'$.models')='object'
                     THEN (SELECT json_group_object(lower(je.key), json(je.value)) FROM json_each(pj,'$.models') je
                           WHERE lower(je.key) IN (SELECT lower(v) FROM M) AND json_type(je.value)='object')
                     ELSE (SELECT json_group_object(lower(je.key), json(je.value)) FROM json_each(pj) je
                           WHERE lower(je.key) IN (SELECT lower(v) FROM M) AND json_type(je.value)='object')
                   END, json('{}')))
            END FROM PJ),
    'total',(SELECT count(*) FROM model_usage),
    'covered',(SELECT count(*) FROM R),
    'gen',(SELECT datetime('now','localtime')),
    'rows',(SELECT json_group_array(json_array(
              SI.i, R.started_at, MI.i, PI.i,
              R.input_tokens, R.output_tokens+R.reasoning_tokens, R.cache_read_input_tokens,
              R.duration_ms,
              CASE R.status WHEN 'completed' THEN 0 WHEN 'error' THEN 1 WHEN 'cancelled' THEN 2 ELSE 3 END,
              CASE R.query_source WHEN 'main_turn' THEN 0 WHEN 'subagent' THEN 1 ELSE 2 END,
              R.cache_creation_input_tokens, R.time_to_first_token_ms, R.id, R.retry_count, ${TURN_EXPR}, ${CTX_EXC_EXPR}))
            FROM R
            LEFT JOIN S SI ON SI.v = R.session_id
            LEFT JOIN M MI ON MI.v = R.model_id
            LEFT JOIN P PI ON PI.v = R.provider_id));`;

// ---------- 价格表与预算的用户设置（serve 模式的面板内管理） ----------
let pricesCache = { at: 0, v: null };
// Windows 记事本等编辑器保存的 UTF-8 文件常带 BOM，JSON.parse 会直接抛错——读取后剥除
const stripBom = (s) => String(s == null ? '' : s).replace(/^\uFEFF/, '');
// 原子写 + Windows 兜底：rename 到被占用（杀毒/并发读）的目标会 EPERM——短重试后直写保功能
function atomicWrite(file, data, mode) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (mode != null) fs.writeFileSync(tmp, data, { mode }); else fs.writeFileSync(tmp, data);
  for (let i = 0; i < 3; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i === 2) {
        try { if (mode != null) fs.writeFileSync(file, data, { mode }); else fs.writeFileSync(file, data); } catch (e2) {}
        try { fs.unlinkSync(tmp); } catch (e2) {}
        return;
      }
      const until = Date.now() + 60; while (Date.now() < until) { /* 短退避 */ }
    }
  }
}
function readPrices() {
  const pp = pricePath();
  if (!pp || !fs.existsSync(pp)) return { currency: 'CNY', usdCny: null, autoSync: true, models: {} };
  if (pricesCache.v && Date.now() - pricesCache.at < 5000) return pricesCache.v;
  let v;
  try { v = JSON.parse(stripBom(fs.readFileSync(pp, 'utf8'))); } catch (e) { v = { currency: 'CNY', models: {} }; }
  if (!v.models || typeof v.models !== 'object') v = { currency: v.currency || 'CNY', models: v };
  v.usdCny = v.usdCny != null ? v.usdCny : null;
  v.autoSync = v.autoSync !== false;
  pricesCache = { at: Date.now(), v };
  return v;
}
function writePrices(next) {
  const pp = pricePath();
  if (!pp) throw new Error('价格文件路径不可用');
  // 保留通用设置字段（usdCny/autoSync），前端提交只带 models/currency
  const prev = readPrices();
  const merged = {
    currency: next.currency || prev.currency || 'CNY',
    usdCny: next.usdCny != null ? (Number(next.usdCny) || null) : (prev.usdCny != null ? prev.usdCny : null),
    autoSync: next.autoSync != null ? next.autoSync !== false : (prev.autoSync !== false),
    models: next.models || prev.models || {},
  };
  atomicWrite(pp, JSON.stringify(merged, null, 2) + '\n');
  pricesCache = { at: 0, v: null };
  frag.html = null; // 改价后立即重算
}
function priceEntry(m) {
  const i = Number(m.in), o = Number(m.out), c = Number(m.cache);
  const e = { in: Number.isFinite(i) ? Math.max(0, i) : 0, out: Number.isFinite(o) ? Math.max(0, o) : 0, cache: Number.isFinite(c) ? Math.max(0, c) : 0 };
  if (m.ctx != null) e.ctx = Number(m.ctx) || undefined; // 上下文窗口（models.dev / 内置表），改价时保留
  const co = Number(m.ctxOverride); // 用户显式覆盖的上下文窗口（0/空 = 清除覆盖，还原自动检测）
  if (Number.isFinite(co) && co > 0) e.ctxOverride = Math.round(co);
  return e;
}

// 多厂商配额凭据（可选）：与 panel-server 同一文件同一格式，权限 0600；只回传「是否已配置」，不回明文
const VENDOR_IDS = ['deepseek', 'kimi', 'openrouter', 'minimax'];
function vendorKeysPath() { return path.join(os.homedir(), '.zcode', 'usage-vendors.json'); }
function readVendorFile() {
  try { return JSON.parse(stripBom(fs.readFileSync(vendorKeysPath(), 'utf8'))) || {}; } catch (e) { return {}; }
}
function readVendorMask() {
  const v = readVendorFile();
  return Object.fromEntries(VENDOR_IDS.map((id) => [id, { configured: !!(v[id] && (v[id].key || v[id].token)) }]));
}
function writeVendorKeys(keys) {
  const cur = readVendorFile();
  for (const id of VENDOR_IDS) {
    if (!(id in (keys || {}))) continue;
    const k = String(keys[id] || '').trim();
    if (k) cur[id] = { key: k };
    else delete cur[id]; // 空串 = 清除该厂商凭据
  }
  atomicWrite(vendorKeysPath(), JSON.stringify(cur, null, 2) + '\n', 0o600);
  return readVendorMask();
}
function budgetPath() { return path.join(os.homedir(), '.zcode', 'usage-budget.json'); }
// 界面语言持久层（usage-lang.json）：跨面板（本地面板/侧栏/生成页）权威的显式选择，''=跟随系统
const LANG_FILE = path.join(os.homedir(), '.zcode', 'usage-lang.json');
function readLangPref() {
  try {
    const v = String(JSON.parse(stripBom(fs.readFileSync(LANG_FILE, 'utf8'))).language || '');
    return v === 'zh' || v === 'en' ? v : '';
  } catch (e) { return ''; }
}
function writeLangPref(v) {
  atomicWrite(LANG_FILE, JSON.stringify({ language: v === 'zh' || v === 'en' ? v : '' }) + '\n');
}
// 上下文 Top 下钻（按会话按需查询，不随 dashboard 全量内嵌）：
// 工具字节 Top（part type=tool 按工具聚合）+ 文件字节 Top（Read/Edit/Write 的 file_path 参数聚合）。
// 口径与构成环一致（part 存储字节近似）。老库无 part 表时 prepare 抛错，返回空表。
const CTX_TOP_SQL = `WITH P AS (SELECT data, time_created AS tc, length(data) AS b, json_extract(data,'$.type') AS t FROM part WHERE session_id = ?)
  SELECT
    (SELECT COALESCE(json_group_array(json_array(t.tool, t.c, t.b)),'[]') FROM (
       SELECT json_extract(data,'$.tool') AS tool, count(*) AS c, sum(length(data)) AS b
       FROM P WHERE json_extract(data,'$.type')='tool' GROUP BY 1 ORDER BY b DESC LIMIT 8) t) AS tools,
    (SELECT COALESCE(json_group_array(json_array(f.path, f.c, f.b)),'[]') FROM (
       SELECT json_extract(data,'$.state.input.file_path') AS path, count(*) AS c, sum(length(data)) AS b
       FROM P WHERE json_extract(data,'$.type')='tool'
         AND json_extract(data,'$.tool') IN ('Read','Edit','Write')
         AND json_extract(data,'$.state.input.file_path') IS NOT NULL
       GROUP BY 1 ORDER BY b DESC LIMIT 8) f) AS files,
    (SELECT COALESCE(json_group_array(json_array(g.agent, g.started_at, g.duration_ms, g.tok, g.sid)),'[]') FROM (
       SELECT COALESCE(NULLIF(${AGENT_EXPR},''),'-') AS agent, mu.started_at AS started_at, mu.duration_ms AS duration_ms,
              mu.input_tokens+mu.output_tokens+mu.reasoning_tokens AS tok, mu.session_id AS sid
       FROM model_usage mu LEFT JOIN session ch ON ch.id = mu.session_id
       WHERE COALESCE(${PARENT_EXPR}, mu.session_id) = ? AND mu.query_source = 'subagent'
       ORDER BY mu.started_at LIMIT 500) g) AS fleet,
    (SELECT COALESCE(json_group_array(json_array(g.t, g.c, g.b, g.r1c, g.r1b)),'[]') FROM (
       SELECT t, count(*) AS c, sum(b) AS b,
              sum(CASE WHEN tc >= (strftime('%s','now') * 1000 - 3600000) THEN 1 ELSE 0 END) AS r1c,
              sum(CASE WHEN tc >= (strftime('%s','now') * 1000 - 3600000) THEN b ELSE 0 END) AS r1b
       FROM P WHERE t NOT IN ('step-start','step-finish','timeline') GROUP BY t ORDER BY b DESC) g) AS bgroups,
    (SELECT COALESCE(json_group_array(json_array(i.t, i.tc, i.b, i.sn, i.sbody)),'[]') FROM (
       SELECT t, tc, b, sn, sbody FROM (
         SELECT t, tc, b,
           CASE t WHEN 'tool' THEN json_extract(data,'$.tool') WHEN 'text' THEN substr(COALESCE(json_extract(data,'$.text'), ''), 1, 600) WHEN 'reasoning' THEN substr(COALESCE(json_extract(data,'$.text'), ''), 1, 600) WHEN 'file' THEN COALESCE(json_extract(data,'$.url'), '') WHEN 'compaction' THEN COALESCE(json_extract(data,'$.trigger'), '') || '/' || COALESCE(json_extract(data,'$.phase'), '') ELSE '' END AS sn,
           CASE t WHEN 'tool' THEN substr(COALESCE(json_extract(data,'$.state.input'), json_extract(data,'$.state.output'), ''), 1, 800) WHEN 'text' THEN substr(COALESCE(json_extract(data,'$.text'), ''), 1, 800) WHEN 'reasoning' THEN substr(COALESCE(json_extract(data,'$.text'), ''), 1, 800) ELSE '' END AS sbody,
           row_number() OVER (PARTITION BY t ORDER BY b DESC) AS rn
         FROM P WHERE t NOT IN ('step-start','step-finish','timeline')
       ) WHERE rn <= 30 ORDER BY b DESC LIMIT 150) i) AS bitems`;
function ctxTop(sid) {
  sid = String(sid || '').slice(0, 128);
  if (!sid) return { tools: [], files: [], fleet: [], bgroups: [], bitems: [] };
  try {
    const row = db.prepare(CTX_TOP_SQL).get(sid, sid);
    const j = (v) => { try { return JSON.parse(v) || []; } catch (e) { return []; } };
    return { tools: j(row && row.tools), files: j(row && row.files), fleet: j(row && row.fleet), bgroups: j(row && row.bgroups), bitems: j(row && row.bitems) };
  } catch (e) { return { tools: [], files: [], fleet: [], bgroups: [], bitems: [] }; } // 老库无 part 表
}
function readBudget() {
  try { return JSON.parse(stripBom(fs.readFileSync(budgetPath(), 'utf8'))); } catch (e) { return { daily: 0, monthly: 0 }; }
}
function writeBudget(b) {
  atomicWrite(budgetPath(), JSON.stringify({ daily: Number(b.daily) || 0, monthly: Number(b.monthly) || 0 }) + '\n');
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let t = '';
    req.on('data', function (c) { t += c; if (t.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', function () { try { resolve(JSON.parse(t || '{}')); } catch (e) { reject(e); } });
  });
}

// 通知配置聚合：turnstats 文件（off/notify/inject）+ alerts 文件（预算告警/权限提醒）
const TURNSTATS_FILE = path.join(os.homedir(), '.zcode', 'usage-turnstats.json');
const ALERTS_CFG = path.join(os.homedir(), '.zcode', 'usage-alerts.json');
function readSwitches() {
  let ts = { enabled: false, mode: 'inject' };
  try { ts = Object.assign(ts, JSON.parse(stripBom(fs.readFileSync(TURNSTATS_FILE, 'utf8')))); } catch (e) {}
  let al = {};
  try { al = JSON.parse(stripBom(fs.readFileSync(ALERTS_CFG, 'utf8'))); } catch (e) {}
  return {
    turnstats: ts.enabled === true ? (ts.mode === 'notify' ? 'notify' : 'inject') : 'off',
    budgetAlerts: al.budget !== false,
    permissionAlerts: al.permission === true,
  };
}
function writeSwitches(b) {
  if (b.turnstats === 'off' || b.turnstats === 'notify' || b.turnstats === 'inject') {
    const v = b.turnstats === 'off' ? { enabled: false } : { enabled: true, mode: b.turnstats };
    atomicWrite(TURNSTATS_FILE, JSON.stringify(v) + '\n');
  }
  const al = readSwitches();
  if (typeof b.budgetAlerts === 'boolean' || typeof b.permissionAlerts === 'boolean') {
    const next = {};
    if (typeof b.budgetAlerts === 'boolean') next.budget = b.budgetAlerts;
    if (typeof b.permissionAlerts === 'boolean') next.permission = b.permissionAlerts;
    atomicWrite(ALERTS_CFG, JSON.stringify(next) + '\n');
  }
  return readSwitches();
}

// limit 归一：未指定/非正数 = 全部（LIMIT -1），正数钳到 1-20000
function clampLimit(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return -1;
  return Math.max(1, Math.min(20000, Math.round(n)));
}

function dataJSON(limit) {
  limit = clampLimit(limit);
  // 全新环境表还不存在（ZCode 尚未写入）：直接空数据，避免 META SQL 报 no such table。
  // 注意消费方按字符串处理（res.end(dataJSON())），必须 stringify
  if (q("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('model_usage','session')") !== '2') {
    return JSON.stringify({ providers: [], models: [], sessions: [], sessionDirs: [], sessionIds: [], tools: [], todos: [0, 0], stability: [0, 0, 0], hours: {}, compactions: [], sessionTools: [], disk: diskJSON(), providerNames: {}, projectMap: {}, budgetDaily: 0, budgetMonthly: 0, userLang: readLangPref(), ctxMix: [], sessionAgents: [], prices: {}, total: 0, covered: 0, rows: [] });
  }
  // node:sqlite 没有 CLI 的 readfile()：价格文件内容在 node 侧读好后内联（单引号转义）
  const pp = pricePath();
  const pfText = pp ? stripBom(fs.readFileSync(pp, 'utf8')) : null;
  const dirs = q(`SELECT COALESCE(json_group_array(d),'[]') FROM (SELECT DISTINCT se.directory AS d FROM model_usage u LEFT JOIN session se ON se.id=u.session_id WHERE coalesce(se.directory,'')<>'')`).trim() || '[]';
  let dirsList = [];
  try { dirsList = JSON.parse(dirs); } catch (e) {}
  return q(META_SQL(pfText, limit, diskJSON(), JSON.stringify({ providerNames: providerNames(), projectMap: projectMap(dirsList), userLang: readLangPref(), budgetDaily: readBudget().daily, budgetMonthly: readBudget().monthly })));
}

function liveJSON() {
  const win = qcols(`WITH cur AS (SELECT count(*) AS req,
                       COALESCE(sum(input_tokens),0) AS inn,
                       COALESCE(sum(output_tokens+reasoning_tokens),0) AS gen,
                       min(started_at) AS st
                FROM model_usage WHERE started_at > (unixepoch()*1000 - 18000000))
         SELECT req, inn+gen AS tok,
                CAST(round((inn+gen) / max(0.1,(unixepoch()*1000 - COALESCE(st, unixepoch()*1000))/3600000.0)) AS int),
                COALESCE(st, 0)
         FROM cur;`).map(Number);
  const today = qcols(`SELECT count(*), COALESCE(sum(input_tokens+output_tokens+reasoning_tokens),0),
                          sum(CASE WHEN status<>'completed' THEN 1 ELSE 0 END)
                   FROM model_usage WHERE date(started_at/1000,'unixepoch','localtime')=date('now','localtime');`).map(Number);
  return {
    window: { req: win[0] || 0, tok: win[1] || 0, rateH: win[2] || 0, start: win[3] || 0 },
    today: { req: today[0] || 0, tok: today[1] || 0, fail: today[2] || 0 },
    gen: Date.now()
  };
}

let diskCache = { at: 0, v: {} };
function diskJSON() {
  if (Date.now() - diskCache.at < 600000) return diskCache.v;
  const dirs = {
    logs: path.join(os.homedir(), '.zcode/v2/logs'),
    rollout: path.join(os.homedir(), '.zcode/cli/rollout'),
    artifacts: path.join(os.homedir(), '.zcode/cli/artifacts'),
    db: DB
  };
  const out = {};
  for (const [k, dir] of Object.entries(dirs)) {
    try { out[k] = parseInt(execFileSync('du', ['-sm', dir], { encoding: 'utf8' }).split('\t')[0], 10) || 0; }
    catch (e) { out[k] = 0; }
  }
  diskCache = { at: Date.now(), v: out };
  return out;
}

let quotaCache = { at: 0, v: null };
async function quotaJSON() {
  if (quotaCache.v && Date.now() - quotaCache.at < 60000) return quotaCache.v;
  let v;
  try {
    v = await queryAllVendors(); // 多厂商聚合（GLM 走零密钥日志源，其余可选 Key）
  } catch (e) {
    v = { ok: false, vendors: [], error: String((e && e.message) || e).slice(0, 160) };
  }
  quotaCache = { at: Date.now(), v };
  return v;
}

function requestJSON(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return { error: '非法 id' };
  const row = q(`SELECT json_object(
    'raw_usage_json', raw_usage_json,
    'provider_metadata_json', provider_metadata_json,
    'finish_reason', finish_reason,
    'error_code', error_code,
    'error_message', error_message,
    'agent', agent,
    'variant', variant)
  FROM model_usage WHERE id = '${id}';`).trim();
  return row ? JSON.parse(row) : { error: '未找到该请求' };
}

// bash 可执行解析：Windows 的 Git for Windows 默认只把 git.exe 加入 PATH，bash.exe 常缺——
// 面板/仪表盘生成全部依赖 bash，按常见安装位置兜底查找；找到后进程内缓存
let bashCmdCache;
function resolveBash() {
  if (bashCmdCache) return bashCmdCache;
  let cmd = 'bash';
  if (process.platform === 'win32') {
    const candidates = [
      process.env.ZCODE_BASH,
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe'),
    ].filter(Boolean);
    cmd = candidates.find((c) => { try { return fs.existsSync(c); } catch (e) { return false; } }) || 'bash';
  }
  bashCmdCache = cmd;
  return cmd;
}

function renderFragment(limit, forServe) {
  // 唯一临时名：并发重建时两个 bash 写同一路径会互相读到半成品（panel-server 同类路径已加随机）
  const out = path.join(os.tmpdir(), 'zcode-usage-serve-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.html');
  const args = [USAGE_SH, 'dashboard', out];
  if (limit > 0) args.push(String(limit)); // -1（全部）走脚本默认，避免 num_arg 校验负数
  try {
    execFileSync(resolveBash(), args, { encoding: 'utf8', timeout: 120000 });
  } catch (e) {
    if (e && e.code === 'ENOENT') throw new Error('未找到 bash（Windows 需安装 Git for Windows，或设置 ZCODE_BASH 指向 bash.exe）');
    throw e;
  }
  let html = fs.readFileSync(out, 'utf8');
  try { fs.unlinkSync(out); } catch (e) {}
  // 服务模式：数据走 /api/data，由 boot 函数异步加载。
  // 导出报告（forServe=false）必须保留内嵌 DATA——自包含快照脱离本机后无 API 可拉，
  // 否则 boot 的 fetch 失败、整页只剩静态骨架（曾因无条件替换导致报告导出空数据）。
  if (forServe !== false) {
    html = html.replace(/^const DATA =\n.*$/m, "const DATA = null;\nwindow.__USAGE_DATA_URL__ = '/api/data';\nwindow.__USAGE_SERVE__ = true;\nwindow.__USAGE_LANG__ = " + JSON.stringify(readLangPref()) + ";");
    if (html.indexOf('__USAGE_DATA_URL__') < 0) throw new Error('dashboard 生成结果异常');
  // 服务态附加：刷新按钮 + 自动刷新开关（挂机监控；页签 hash 在 reload 后保留）+ 实时燃烧率角标（5s 轻轮询）
  html += `<script>
(function () {
  var t = setInterval(function () {
    var c = document.querySelector('.viz-controls');
    if (!c || !window.__usageBootDone) return;
    clearInterval(t);
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.style.margin = '0'; b.style.fontSize = '12px'; b.style.padding = '2px 10px';
    b.textContent = tr('同步数据');
    // 手动同步：拉新快照交给页面闭包的 __udRefreshData 重绘——骨架、筛选、展开态与滚动全部保留；
    // 老片段没有该入口时回退整页刷新。30s 超时兜底：服务挂起时 fetch 永不落定会让按钮无限「同步中」
    function doRefresh() {
      if (b.disabled) return;
      b.disabled = true; b.textContent = tr('同步中…');
      var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 30000) : null;
      fetch('/api/data', ctl ? { signal: ctl.signal } : {}).then(function (r) { return r.json(); }).then(function (j) {
        if (!(window.__udRefreshData && window.__udRefreshData(j))) location.reload();
        else { b.textContent = tr('同步数据'); b.disabled = false; }
      }).catch(function () {
        b.textContent = tr('同步失败');
        setTimeout(function () { b.textContent = tr('同步数据'); b.disabled = false; }, 2000);
      }).then(function () { if (timer) clearTimeout(timer); });
    }
    b.addEventListener('click', function () { doRefresh(); });
    c.appendChild(b);
    // 自动刷新：按钮上显示下次同步倒计时（Auto 47s），到点走同一局部刷新；开关记忆在 localStorage
    var auto = document.createElement('button');
    auto.type = 'button'; auto.className = 'ud-toggle'; auto.style.margin = '0'; auto.style.fontSize = '12px';
    var on = false, left = 60;
    try { on = localStorage.getItem('ud-autorefresh') === '1'; } catch (e) {}
    // 「自动刷新」「关」是独立 i18n 键——「自动」已被压缩事件触发方式映射为小写 auto，同名会被覆盖
    function paint() { auto.textContent = on ? tr('自动刷新') + ' ' + left + 's' : tr('自动刷新') + ' ' + tr('关'); auto.setAttribute('aria-pressed', String(on)); }
    setInterval(function () {
      if (!on) return;
      left--;
      if (left <= 0) {
        // 手动同步进行中到点：顺延 5s 再试（整页重置会让该轮自动刷新被静默跳过）
        if (b.disabled) { left = 5; return; }
        left = 60; doRefresh();
      }
      paint();
    }, 1000);
    auto.addEventListener('click', function () {
      on = !on; left = 60;
      try { localStorage.setItem('ud-autorefresh', on ? '1' : '0'); } catch (e) {}
      paint();
      if (on) doRefresh();
    });
    paint();
    c.appendChild(auto);
    var badge = document.createElement('span');
    badge.id = 'ud-live-badge'; badge.className = 'text-small text-muted';
    c.appendChild(badge);
    // 本段在页面全局作用域（fmt/fmtI 在 __usageBoot 内不可见），自带紧凑格式化
    var EN = document.documentElement.lang === 'en';
    function compact(n) {
      n = Number(n) || 0;
      if (EN) return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
      return n >= 1e8 ? (n / 1e8).toFixed(2) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(Math.round(n));
    }
    function tick() {
      fetch('/api/live').then(function (r) { return r.json(); }).then(function (j) {
        // 紧凑单位（2187 万 token/h）：每小时原值可达八九位数
        badge.textContent = '● ' + tr('实时') + ' · ' + tr('燃烧率') + ' ' + compact(j.window.rateH) + ' token/h · ' + tr('近 5h') + ' ' + compact(j.window.tok) + ' tok · ' + tr('今日') + ' ' + Number(j.today.req || 0).toLocaleString('zh-CN') + ' ' + tr('次') + '';
        badge.title = Number(j.window.rateH || 0).toLocaleString('zh-CN') + ' token/h · ' + Number(j.window.tok || 0).toLocaleString('zh-CN') + ' tok';
      }).catch(function () {});
    }
    tick();
    setInterval(tick, 5000);
  }, 200);
})();
</script>`;
  }
  return html;
}


// 独立页面样式壳：Gen UI 宿主不在浏览器里，工具类与主题变量由本壳提供（明暗随系统）
const { SHELL_CSS, TAB_JS } = await import('./shell.mjs');


let frag = { html: null, limit: 0, at: 0 };
function getFragment(limit) {
  limit = clampLimit(limit);
  if (!frag.html || frag.limit !== limit || Date.now() - frag.at > 30000) {
    frag = { html: renderFragment(limit), limit, at: Date.now() };
  }
  return frag.html;
}

// 启动时价格表每日自动同步一次（与 dashboard 口径一致，可 env 关闭；尊重价格表 autoSync:false 的用户 opt-out）
try {
  if (process.env.ZCODE_USAGE_NO_AUTOSYNC !== '1') {
    let stale = !fs.existsSync(USER_PRICE);
    if (!stale) stale = Date.now() - fs.statSync(USER_PRICE).mtimeMs >= 86400e3;
    let autoOff = false;
    try { autoOff = /"autoSync"[: ]*false/.test(stripBom(fs.readFileSync(USER_PRICE, 'utf8'))); } catch (e) {}
    if (stale && !autoOff) {
      spawn(resolveBash(), [USAGE_SH, 'prices', 'sync'], { detached: true, stdio: 'ignore' }).unref();
    }
  }
} catch (e) {}

// ---------- 预算 / 燃烧告警（macOS 本地通知，零模型开销；本服务常驻时生效）----------
// 成本按模型均价折算（不含分时 tariff，告警用途足够）；token = 输入 + 生成。
// 开关 ~/.zcode/usage-alerts.json {"budget":true}（缺省开）；当日提醒状态 ~/.zcode/usage-alerts-state.json
const ALERTS_FILE = path.join(os.homedir(), '.zcode', 'usage-alerts.json');
const ALERTS_STATE = path.join(os.homedir(), '.zcode', 'usage-alerts-state.json');
const nn = (v) => Number(v) || 0;
function alertsEnabled() {
  try { return JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8')).budget !== false; } catch (e) { return true; }
}
function notifyMac(sub, msg) {
  // 统一经 notify.mjs 分发（macOS / Windows / Linux），失败静默
  try {
    spawn(process.execPath, [path.join(HERE, 'notify.mjs'), 'ZCode 用量', sub, msg], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {}
}
function alertOnce(key, sub, msg) {
  const today = new Date().toISOString().slice(0, 10);
  let st = {};
  try { st = JSON.parse(fs.readFileSync(ALERTS_STATE, 'utf8')); } catch (e) {}
  if (st.date !== today) st = { date: today };
  if (st[key]) return;
  st[key] = true;
  try { fs.writeFileSync(ALERTS_STATE, JSON.stringify(st)); } catch (e) {}
  notifyMac(sub, msg);
}
function fmtK(n) { return n >= 1e8 ? (n / 1e8).toFixed(2) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(Math.round(n)); }
function budgetWatchTick() {
  try {
    if (!alertsEnabled()) return;
  let budget = { daily: 0, monthly: 0 };
  try { budget = readBudget() || budget; } catch (e) {}
  const D = dataJSON(-1);
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const w0 = t0.getTime() - 7 * 86400000;
  const PR = (D.prices && D.prices.models) || {};
  const sym = ((D.prices && D.prices.currency) || 'CNY') === 'CNY' ? '¥' : '$';
  let tok = 0, cost = 0, base = 0;
  for (const r of (D.rows || [])) {           // rows 按时间降序，越界即断
    if (r[1] < w0) break;
    const t = nn(r[4]) + nn(r[5]);
    if (r[1] >= t0.getTime()) {
      tok += t;
      const pj = PR[String(D.models[r[2]] || '').toLowerCase()];
      if (pj && Number(pj.in) >= 0) {
        const miss = Math.max(0, nn(r[4]) - nn(r[6])); // input 含缓存命中，命中段按 cache 价（与前端 rowCost 同口径）
        cost += (miss * nn(pj.in) + nn(r[5]) * nn(pj.out) + nn(r[6]) * nn(pj.cache)) / 1e6;
      }
    } else base += t;
  }
  const daily = nn(budget.daily);
  if (daily > 0 && cost > 0) {
    const pct = Math.round(cost / daily * 100);
    if (pct >= 100) alertOnce('b100', '日预算已超出', '今日折算 ' + sym + cost.toFixed(2) + '，已超日预算 ' + sym + daily.toFixed(2));
    else if (pct >= 80) alertOnce('b80', '日预算 80%', '今日折算 ' + sym + cost.toFixed(2) + ' / ' + sym + daily.toFixed(2) + '（' + pct + '%）');
  }
  const avg7 = base / 7;
  if (avg7 > 0 && tok > avg7 * 1.5 && tok > 100000) {
    alertOnce('burn', '今日用量偏高', fmtK(tok) + ' token，已达近 7 天日均的 ' + Math.round(tok / avg7 * 100) + '%');
  }
  } catch (e) { /* 告警失败静默：不能影响常驻服务 */ }
}

const server = http.createServer(async function (req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  try {
    // 防 DNS rebinding 与跨站写（CSRF）：Host 必须为本机；带 Origin 的写请求必须同源。
    // Origin 缺失（curl/地址栏导航）放行——浏览器发起的跨站 fetch 一定带 Origin。
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== '127.0.0.1:' + listenPort && host !== 'localhost:' + listenPort) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    if (req.method === 'POST') {
      const origin = String(req.headers.origin || '');
      if (origin && origin !== 'http://127.0.0.1:' + listenPort && origin !== 'http://localhost:' + listenPort) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
    }
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      const limit = u.searchParams.get('limit');
      const fragHtml = getFragment(limit);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZCode 用量面板</title><style>' + SHELL_CSS + '</style></head><body>' + fragHtml + '<script>' + TAB_JS + '</scr' + 'ipt></body></html>');
    } else if (req.method === 'GET' && u.pathname === '/api/data') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(dataJSON(u.searchParams.get('limit')));
    } else if (req.method === 'GET' && u.pathname === '/api/ctx') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(ctxTop(u.searchParams.get('session'))));
    } else if (req.method === 'GET' && u.pathname === '/api/quota') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(await quotaJSON()));
    } else if (req.method === 'GET' && u.pathname === '/api/request') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(requestJSON(u.searchParams.get('id') || '')));
    } else if (req.method === 'GET' && u.pathname === '/api/live') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(Object.assign({ v: PLUGIN_VERSION }, liveJSON())));
    } else if (req.method === 'GET' && u.pathname === '/api/turn') {
      // 「本轮」横幅的浏览器轮询端点（侧栏面板走 MCP 资源订阅，不经此）
      let text = '';
      try {
        text = execFileSync(process.execPath, [path.join(HERE, 'turn-stats.mjs'), '--turn', '--current'], { encoding: 'utf8', timeout: 15000 }).trim();
      } catch (e) { /* 静默：无数据即空 */ }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ text }));
    } else if (req.method === 'GET' && u.pathname === '/api/prices') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readPrices()));
    } else if (req.method === 'POST' && u.pathname === '/api/prices/set') {
      const b = await readBody(req);
      const model = String(b.model || '').trim();
      if (!model) throw new Error('模型名不能为空');
      const next = readPrices();
      const prev = next.models[model] || {};
      // ctxOverride 显式传空串 = 清除覆盖；未传 = 保留原值
      next.models[model] = priceEntry({
        ...b,
        ctx: prev.ctx ?? b.ctx,
        ctxOverride: b.ctxOverride !== undefined ? b.ctxOverride : prev.ctxOverride,
      });
      writePrices(next);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, model: model }));
    } else if (req.method === 'POST' && u.pathname === '/api/prices/general') {
      const b = await readBody(req);
      const next = readPrices();
      if (b.currency) next.currency = String(b.currency);
      if ('usdCny' in b) next.usdCny = Number(b.usdCny) || null; // 空值=还原默认 7.2
      if (b.autoSync != null) next.autoSync = b.autoSync !== false;
      writePrices(next);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.method === 'POST' && u.pathname === '/api/vendors/set') {
      const b = await readBody(req);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, vendors: writeVendorKeys(b) }));
    } else if (req.method === 'GET' && u.pathname === '/api/vendors') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(readVendorMask()));
    } else if (req.method === 'POST' && u.pathname === '/api/prices/remove') {
      const b = await readBody(req);
      const next = readPrices();
      delete next.models[String(b.model || '')];
      writePrices(next);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.method === 'GET' && u.pathname === '/api/budget') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readBudget()));
    } else if (req.method === 'POST' && u.pathname === '/api/budget') {
      const b = await readBody(req);
      writeBudget(b);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.method === 'POST' && u.pathname === '/api/lang') {
      const b = await readBody(req);
      writeLangPref(b && b.language);
      frag.html = null; // 片段缓存失效：下次页面生成烧入新语言
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, language: readLangPref() }));
    } else if (req.method === 'GET' && u.pathname === '/api/switches') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readSwitches()));
    } else if (req.method === 'POST' && u.pathname === '/api/switches') {
      const b = await readBody(req);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(writeSwitches(b)));
    } else if (req.method === 'GET' && (u.pathname === '/report.html' || u.pathname === '/report')) {
      // 自包含报表：内嵌全部数据的一次性快照（供存档/分享/打印）
      const html = renderFragment(-1, false); // 自包含快照：保留内嵌 DATA、不注入刷新与轮询
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="zcode-usage-report.html"' });
      res.end(html);
    } else if (req.method === 'POST' && u.pathname === '/api/sync-prices') {
      const out = execFileSync(resolveBash(), [USAGE_SH, 'prices', 'sync'], { encoding: 'utf8', timeout: 90000 });
      frag.html = null;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, message: out.trim().split('\n').pop() }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    }
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('错误：' + (e.message || e));
  }
});

// 端口策略：默认端口被占（EADDRINUSE）自动顺延 7742-7749，实际端口写入 usage-serve.json
// （panel-server 的 open_full_panel 以该文件为准返回真实地址）；用户显式指定端口被占则报错退出
const PORT_BASE = port === 7741; // 未显式指定时 argv[2] 缺省回退 7741
let listenPort = port;
server.on('error', function (e) {
  if (e && e.code === 'EADDRINUSE') {
    if (PORT_BASE && listenPort < 7749) {
      listenPort++;
      server.listen(listenPort, '127.0.0.1');
      return;
    }
    console.error(PORT_BASE
      ? '7741-7749 端口均被占用，无法启动本地面板'
      : `端口 ${port} 已被占用（你显式指定了该端口），换一个端口再试：usage.sh serve <端口>`);
    process.exit(1);
  }
  throw e;
});

server.listen(port, '127.0.0.1', function () {
  const url = 'http://127.0.0.1:' + listenPort;
  console.log('ZCode 用量面板已启动：' + url + (listenPort !== port ? `（${port} 被占，已顺延）` : '') + '  （Ctrl-C 退出，仅监听本机，v' + PLUGIN_VERSION + '）');
  try { fs.writeFileSync(path.join(os.homedir(), '.zcode', 'usage-serve.json'), JSON.stringify({ pid: process.pid, version: PLUGIN_VERSION, port: listenPort })); } catch (e) {}
  setInterval(budgetWatchTick, 60000).unref(); // 预算/燃烧告警：每分钟检查，当日每档最多提醒一次
  if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  else if (process.platform === 'linux') spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
});
