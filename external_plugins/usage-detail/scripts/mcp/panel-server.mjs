#!/usr/bin/env node
// ZCode 用量明细 · 会话侧栏面板的 MCP 服务（零依赖，手写最小 MCP stdio 协议）
//
// 与宿主的会话：
//   initialize → tools/list → tools/call / resources/read（newline-delimited JSON-RPC）
// 页面（ui/panel.html）通过 window.zcode 兼容层 callTool('usage_summary') 取数渲染。
// 只读数据库：node:sqlite 只读连接 + 配额日志尾随；仅按页面操作写 ~/.zcode 下的插件配置文件，不联网。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB = process.env.ZCODE_USAGE_DB || path.join(os.homedir(), '.zcode/cli/db/db.sqlite');
const USER_PRICE = process.env.ZCODE_USAGE_PRICES || path.join(os.homedir(), '.zcode/usage-prices.json');
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DEFAULT_LIMIT = process.env.ZCODE_USAGE_LIMIT && Number(process.env.ZCODE_USAGE_LIMIT)
  ? Math.max(1, Math.min(20000, Number(process.env.ZCODE_USAGE_LIMIT)))
  : -1; // 默认全部

let db = null;
function openDb() {
  if (db) return db;
  db = new DatabaseSync(DB, { readOnly: true });
  return db;
}
// 单行单值查询（与 usage.sh 的 qr 语义一致）
function q1(sql) {
  const row = openDb().prepare(sql).get();
  if (!row) return '';
  return String(row[Object.keys(row)[0]]);
}
// turn_id 是较新 ZCode 才有的列：老库直接 SELECT 会 prepare 失败，先探测再拼表达式
let turnExprCache = null;
function turnExpr() {
  if (turnExprCache == null) {
    try { turnExprCache = q1("SELECT count(*) FROM pragma_table_info('model_usage') WHERE name='turn_id'") === '1' ? 'R.turn_id' : 'NULL'; }
    catch (e) { turnExprCache = 'NULL'; }
  }
  return turnExprCache;
}
// agent / context_exceeded 同为较新列：老库回退（agent 置空显示未知来源，ctx 置 NULL 无超限标注）
let agExprCache = null;
function agentExpr() {
  if (agExprCache == null) {
    try { agExprCache = q1("SELECT count(*) FROM pragma_table_info('model_usage') WHERE name='agent'") === '1' ? 'mu.agent' : "''"; }
    catch (e) { agExprCache = "''"; }
  }
  return agExprCache;
}
// 子代理会话归属：session.parent_id（较新列）把子会话挂到主会话；老库无此列时留在子会话名下
let parentExprCache = null;
function parentExpr() {
  if (parentExprCache == null) {
    try { parentExprCache = q1("SELECT count(*) FROM pragma_table_info('session') WHERE name='parent_id'") === '1' ? 'ch.parent_id' : 'NULL'; }
    catch (e) { parentExprCache = 'NULL'; }
  }
  return parentExprCache;
}
let ctxExcCache = null;
function ctxExcExpr() {
  if (ctxExcCache == null) {
    try { ctxExcCache = q1("SELECT count(*) FROM pragma_table_info('model_usage') WHERE name='context_exceeded'") === '1' ? 'R.context_exceeded' : 'NULL'; }
    catch (e) { ctxExcCache = 'NULL'; }
  }
  return ctxExcCache;
}

function priceText() {
  const p = USER_PRICE;
  try { return fs.existsSync(p) ? stripBom(fs.readFileSync(p, 'utf8')) : null; } catch (e) { return null; }
}

// 全量 META（与 serve.mjs 同一形状：行数组 + 索引映射，前端聚合）
function metaSQL(limit, disk, extraJson) {
  const pt = priceText();
  const PJ = pt != null ? `CAST('${pt.replace(/'/g, "''")}' AS text)` : 'NULL';
  return `
  WITH P AS (SELECT provider_id AS v, row_number() OVER (ORDER BY provider_id)-1 AS i FROM (SELECT DISTINCT provider_id FROM model_usage)),
       M AS (SELECT model_id AS v, row_number() OVER (ORDER BY model_id)-1 AS i FROM (SELECT DISTINCT model_id FROM model_usage)),
       S AS (SELECT session_id AS v, row_number() OVER (ORDER BY session_id)-1 AS i FROM (SELECT DISTINCT session_id FROM model_usage)),
       PJ AS (SELECT ${PJ} AS pj),
       R AS (SELECT * FROM model_usage ORDER BY started_at DESC, id DESC LIMIT ${limit})
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
        'sessionAgents',(SELECT COALESCE(json_group_array(json_array(SI.i, a.agent, a.c, a.tok)),'[]') FROM (SELECT COALESCE(${parentExpr()}, mu.session_id) AS root_sid, COALESCE(NULLIF(${agentExpr()},''),'-') AS agent, count(*) AS c, sum(mu.input_tokens+mu.output_tokens+mu.reasoning_tokens) AS tok FROM R mu LEFT JOIN session ch ON ch.id = mu.session_id WHERE mu.query_source='subagent' GROUP BY 1, 2) a LEFT JOIN S SI ON SI.v = a.root_sid WHERE SI.i IS NOT NULL),
    'sessionTools',(SELECT COALESCE(json_group_array(json_array(SI.i, t.tool, t.c, t.ms)),'[]') FROM (SELECT session_id AS sid, tool_name AS tool, count(*) AS c, CAST(sum(duration_ms) AS int) AS ms FROM tool_usage GROUP BY session_id, tool_name) t LEFT JOIN S SI ON SI.v = t.sid WHERE SI.i IS NOT NULL),
    'disk', json('${JSON.stringify(disk).replace(/'/g, "''")}'),
    'providerNames', json_extract(json('${extraJson.replace(/'/g, "''")}'),'$."providerNames"'),
    'projectMap', json_extract(json('${extraJson.replace(/'/g, "''")}'),'$."projectMap"'),
    'budgetDaily', json_extract(json('${extraJson.replace(/'/g, "''")}'),'$."budgetDaily"'),
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
              R.cache_creation_input_tokens, R.time_to_first_token_ms, R.id, R.retry_count, ${turnExpr()}, ${ctxExcExpr()}))
            FROM R
            LEFT JOIN S SI ON SI.v = R.session_id
            LEFT JOIN M MI ON MI.v = R.model_id
            LEFT JOIN P PI ON PI.v = R.provider_id));`;
}

let metaCache = { at: 0, v: null };
function dataJSON(limit) {
  // -1 = 全部（LIMIT -1），0/空 = 默认，其余钳到 1-20000
  if (limit == null || Number(limit) === 0) limit = DEFAULT_LIMIT;
  else if (Number(limit) > 0) limit = Math.max(1, Math.min(20000, Number(limit)));
  if (metaCache.v && metaCache.v.limit === limit && Date.now() - metaCache.at < 15000) return metaCache.v.data;
  const disk = { logs: duMB(path.join(os.homedir(), '.zcode/v2/logs')), rollout: duMB(path.join(os.homedir(), '.zcode/cli/rollout')), artifacts: duMB(path.join(os.homedir(), '.zcode/cli/artifacts')), db: duMB(DB) };
  // 全新环境表还不存在（ZCode 尚未写入）：直接空数据，避免 META SQL 报 no such table
  if (q1("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('model_usage','session')") !== '2') {
    return { providers: [], models: [], sessions: [], sessionDirs: [], sessionIds: [], tools: [], todos: [0, 0], stability: [0, 0, 0], hours: {}, compactions: [], sessionTools: [], disk, providerNames: {}, projectMap: {}, budgetDaily: 0, budgetMonthly: 0, ctxMix: [], sessionAgents: [], prices: {}, total: 0, covered: 0, rows: [] };
  }
  let dirsList = [];
  try { dirsList = JSON.parse(q1(`SELECT COALESCE(json_group_array(d),'[]') FROM (SELECT DISTINCT se.directory AS d FROM model_usage u LEFT JOIN session se ON se.id=u.session_id WHERE coalesce(se.directory,'')<>'')`) || '[]'); } catch (e) {}
  const bg = readBudgetCfg();
  const extra = JSON.stringify({ providerNames: vendorDisplayNames(), projectMap: buildProjectMap(dirsList), budgetDaily: Number(bg && bg.daily) || 0, budgetMonthly: Number(bg && bg.monthly) || 0 });
  const data = JSON.parse(q1(metaSQL(limit, disk, extra)));
  metaCache = { at: Date.now(), v: { limit, data } };
  return data;
}

let duCache = {};
function duMB(dir) {
  if (duCache[dir] && Date.now() - duCache[dir].at < 600000) return duCache[dir].v;
  let v = 0;
  try { v = parseInt(execDu(dir), 10) || 0; } catch (e) {}
  duCache[dir] = { at: Date.now(), v };
  return v;
}
import { execFileSync } from 'node:child_process';
function execDu(dir) { return execFileSync('du', ['-sm', dir], { encoding: 'utf8' }).split('\t')[0]; }

// 时间范围 → [fromMs, toMs]（today/yesterday/7d/30d/month/last_month/all 或 from/to ISO 日期）
function rangeToSpan(a) {
  const now = new Date();
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  let from = null, to = null;
  const range = a && a.range || '7d';
  if (a && a.from) from = new Date(a.from + 'T00:00:00').getTime();
  if (a && a.to) to = new Date(a.to + 'T00:00:00').getTime() + 86400000;
  if (from || to) return [from || 0, to || Date.now() + 86400000];
  switch (range) {
    case 'today': return [d0.getTime(), Date.now()];
    case 'yesterday': return [addDays(d0, -1).getTime(), d0.getTime()];
    case '7d': return [addDays(d0, -6).getTime(), Date.now()];
    case '30d': return [addDays(d0, -29).getTime(), Date.now()];
    case 'month': return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), Date.now()];
    case 'last_month': return [new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), new Date(now.getFullYear(), now.getMonth(), 1).getTime()];
    default: return [0, Date.now() + 86400000];
  }
}

// 按时间范围聚合：KPI/每日/时段/来源/模型（rows 内存聚合，行来自全量 META 缓存）
function buildTrend(a) {
  const [from, to] = rangeToSpan(a);
  const D = dataJSON(-1);
  const R = (D.rows || []).filter((r) => r[1] >= from && r[1] < to);
  const MD = D.models || [], PV = D.providers || [];
  let inn = 0, out = 0, ca = 0, genMs = 0, gen = 0;
  const dayMap = {}, hourMap = {}, pvMap = {}, mdMap = {};
  const states = { completed: 0, error: 0, cancelled: 0 };
  for (const r of R) {
    inn += r[4]; out += r[5]; ca += r[6];
    if (r[8] === 0) { states.completed++; gen += r[5]; genMs += Math.max(1, r[7] - (r[11] || 0)); }
    else if (r[8] === 1) states.error++; else if (r[8] === 2) states.cancelled++;
    const d = new Date(r[1]);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    dayMap[key] = (dayMap[key] || 0) + r[4] + r[5];
    hourMap[d.getHours()] = (hourMap[d.getHours()] || 0) + 1;
    pvMap[PV[r[3]] || '?'] = (pvMap[PV[r[3]] || '?'] || 0) + r[4] + r[5];
    mdMap[MD[r[2]] || '?'] = (mdMap[MD[r[2]] || '?'] || 0) + r[4] + r[5];
  }
  const pct = (m) => Object.keys(m).map((k) => ({ name: k, tokens: m[k], pct: Math.round(m[k] / (inn + out) * 1000) / 10 })).sort((x, y) => y.tokens - x.tokens);
  const dayKeys = Object.keys(dayMap).sort();
  return {
    range: (a && a.range) || (a && (a.from || a.to) ? 'custom' : '7d'),
    from: dayKeys[0] || null, to: dayKeys[dayKeys.length - 1] || null,
    kpi: { requests: R.length, inTokens: inn, outTokens: out, cacheRead: ca, cacheRate: inn ? Math.round(ca / inn * 100) : null, avgTps: genMs ? Math.round(gen / genMs * 1000) : null, ...states },
    daily: dayKeys.map((k) => ({ day: k.slice(5), tokens: dayMap[k] })),
    hours: Object.keys(hourMap).map((h) => ({ h: Number(h), req: hourMap[h] })).sort((x, y) => x.h - y.h),
    providers: pct(pvMap).slice(0, 6),
    models: pct(mdMap).slice(0, 8),
  };
}

// 会话列表（真 session_id，按 token Top N，可按时间范围过滤）
function buildSessions(a) {
  const [from, to] = rangeToSpan(a);
  const rows = openDb().prepare(`
    SELECT m.session_id AS sid, MAX(s.title) AS title, MAX(s.directory) AS dir,
           COUNT(*) AS req, SUM(m.input_tokens) AS inn,
           SUM(m.output_tokens + m.reasoning_tokens) AS out,
           SUM(m.cache_read_input_tokens) AS ca,
           MAX(m.started_at) AS last
    FROM model_usage m LEFT JOIN session s ON s.id = m.session_id
    WHERE m.started_at >= ? AND m.started_at < ? AND m.session_id IS NOT NULL AND m.session_id <> ''
    GROUP BY m.session_id ORDER BY SUM(m.input_tokens + m.output_tokens + m.reasoning_tokens) DESC LIMIT 20
  `).all(from, to);
  return rows.map((r) => ({
    id: r.sid, title: r.title || '（无标题）', dir: r.dir || null,
    req: r.req, tokens: (r.inn || 0) + (r.out || 0),
    cacheRate: r.inn ? Math.round((r.ca || 0) / r.inn * 100) : null, last: r.last,
  }));
}

// 单会话详情：元信息 + 聚合 + 最近 15 条请求 + 压缩/模型切换事件
function buildSessionDetail(id) {
  if (!id) return { error: '缺少会话 id' };
  const db = openDb();
  const meta = db.prepare(`SELECT id, title, directory, time_created FROM session WHERE id = ?`).get(id) || { id, title: '（无标题）', directory: null, time_created: null };
  const agg = db.prepare(`
    SELECT COUNT(*) AS req,
           COALESCE(SUM(input_tokens),0) AS inn,
           COALESCE(SUM(output_tokens+reasoning_tokens),0) AS out,
           COALESCE(SUM(cache_read_input_tokens),0) AS ca,
           MIN(started_at) AS first, MAX(started_at) AS last,
           SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors
    FROM model_usage WHERE session_id = ?`).get(id);
  const perf = db.prepare(`
    SELECT COALESCE(SUM(output_tokens+reasoning_tokens),0) AS gen,
           COALESCE(SUM(max(duration_ms - COALESCE(time_to_first_token_ms, 0), 1)), 0) AS ms
    FROM model_usage WHERE session_id = ? AND status='completed'`).get(id);
  const models = db.prepare(`SELECT model_id AS name, SUM(input_tokens+output_tokens+reasoning_tokens) AS tokens FROM model_usage WHERE session_id = ? GROUP BY model_id ORDER BY tokens DESC`).all(id);
  const providers = db.prepare(`SELECT provider_id AS name, COUNT(*) AS req FROM model_usage WHERE session_id = ? GROUP BY provider_id ORDER BY req DESC`).all(id);
  const tools = db.prepare(`SELECT tool_name AS name, COUNT(*) AS req FROM tool_usage WHERE session_id = ? GROUP BY tool_name ORDER BY req DESC LIMIT 6`).all(id);
  const compactions = db.prepare(`SELECT COUNT(*) AS cnt, MAX(COALESCE(json_extract(data,'$.preCompactTokenCount'),0)) AS pre FROM part WHERE session_id = ? AND json_extract(data,'$.type')='compaction'`).get(id);
  const recent = db.prepare(`
    SELECT datetime(started_at/1000,'unixepoch','localtime') AS t, model_id AS model,
           input_tokens AS inTok, output_tokens+reasoning_tokens AS outTok,
           duration_ms AS dur, time_to_first_token_ms AS ttft,
           CASE status WHEN 'completed' THEN 0 WHEN 'error' THEN 1 WHEN 'cancelled' THEN 2 ELSE 3 END AS status
    FROM model_usage WHERE session_id = ? ORDER BY started_at DESC LIMIT 15`).all(id);
  let avgTps = null;
  if (perf && perf.ms > 0) avgTps = Math.round(perf.gen / perf.ms * 1000);
  return {
    id, title: meta.title, dir: meta.directory,
    created: meta.time_created, requests: agg.req,
    inTokens: agg.inn, outTokens: agg.out,
    cacheRate: agg.inn ? Math.round(agg.ca / agg.inn * 100) : null,
    avgTps, first: agg.first, last: agg.last, errors: agg.errors || 0,
    models, providers, tools,
    compactions: compactions && compactions.cnt ? { cnt: compactions.cnt, pre: compactions.pre } : null,
    recent,
  };
}

// ---- 侧栏面板摘要：服务端预聚合（侧栏窄、结构化输出须 ≤64KiB，不做全行下发）----
function buildSummary() {
  const D = dataJSON(DEFAULT_LIMIT);
  const R = D.rows || [], MD = D.models || [], PV = D.providers || [], TL = D.sessions || [];
  const PVN = D.providerNames || {}; // BYOK 真实供应商名（provider_config.json，只取名映射）
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  let inn = 0, out = 0, ca = 0, todayReq = 0;
  const pvAgg = {}, mdAgg = {};
  const sessAgg = {};
  for (const r of R) {
    inn += r[4]; out += r[5]; ca += r[6];
    if (r[1] >= today0.getTime()) todayReq++;
    const pv = PVN[PV[r[3]]] || PV[r[3]] || '?', md = MD[r[2]] || '?';
    pvAgg[pv] = (pvAgg[pv] || 0) + r[4] + r[5];
    mdAgg[md] = (mdAgg[md] || 0) + r[4] + r[5];
    const s = sessAgg[r[0]] || (sessAgg[r[0]] = { title: TL[r[0]] || '（无标题）', req: 0, tot: 0, last: 0 });
    s.req++; s.tot += r[4] + r[5]; if (r[1] > s.last) s.last = r[1];
  }
  const pct = (m) => Object.keys(m).map((k) => ({ name: k, tokens: m[k], pct: Math.round(m[k] / (inn + out) * 1000) / 10 }))
    .sort((a, b) => b.tokens - a.tokens);
  // 近 14 天每日 token（供面板 sparkline）
  const dayMap = {};
  for (const r of R) {
    const d = new Date(r[1]);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    dayMap[key] = (dayMap[key] || 0) + r[4] + r[5];
  }
  const daily = Object.keys(dayMap).sort().slice(-14).map((k) => ({ day: k.slice(5), tokens: dayMap[k] }));
  const hourMap = D.hours || {};
  const hours = Object.keys(hourMap).map((h) => ({ h: Number(h), req: hourMap[h] })).sort((a, b) => a.h - b.h);
  const failures = (D.stability || [0, 0, 0])[2] || 0;
  const tools = (D.tools || []).slice(0, 5).map((t) => ({ name: String(t[0]).replace(/^mcp__/, ''), req: t[1] }));
  const states = { completed: 0, error: 0, cancelled: 0 };
  for (const r of R) { if (r[8] === 0) states.completed++; else if (r[8] === 1) states.error++; else if (r[8] === 2) states.cancelled++; }
  const topSess = Object.values(sessAgg).sort((a, b) => b.tot - a.tot).slice(0, 5);
  // 当前 5h 窗口（与 usage.sh blocks 口径一致：R 按时间降序，从最新往旧，相邻间隔 ≥5h 即断窗）
  let win = { req: 0, tok: 0, start: 0 };
  for (let i = 0; i < R.length; i++) {
    if (i === 0) { win.start = R[0][1]; win.req = 1; win.tok = R[0][4] + R[0][5]; continue; }
    if (R[i - 1][1] - R[i][1] >= 18000000) break;
    win.req++; win.tok += R[i][4] + R[i][5]; win.start = R[i][1];
  }
  // ⑤ 剩余请求估算：按最近 3 个完整窗口的平均请求数，推算当前窗口还可发起多少次
  const wins = [];
  let cur = { req: 0 };
  for (let i = 0; i < R.length; i++) {
    cur.req++;
    if (i < R.length - 1 && R[i][1] - R[i + 1][1] >= 18000000) { wins.push(cur); cur = { req: 0 }; }
  }
  if (cur.req) wins.push(cur);
  // R 按时间降序：wins[0] 是最新（进行中），其后是完整窗口
  const full = wins.slice(1, 4);
  const avgReq = full.length ? Math.round(full.reduce((a, w) => a + w.req, 0) / full.length) : 0;
  const windowEstimate = avgReq > 0 && win.start
    ? { avgReq, basedOn: full.length, remainingReq: Math.max(0, avgReq - win.req) }
    : null;
  return {
    kpi: {
      covered: D.covered, total: D.total, gen: D.gen,
      requests: inn + out ? R.length : 0,
      inTokens: inn, outTokens: out, cacheRead: ca,
      cacheRate: inn ? Math.round(ca / inn * 100) : null,
      todayRequests: todayReq,
    },
    providers: pct(pvAgg).slice(0, 5),
    models: pct(mdAgg).slice(0, 6),
    topSessions: topSess.map((s) => ({ title: s.title.slice(0, 40), req: s.req, tokens: s.tot, last: s.last })),
    window: win,
    windowEstimate,
    daily, hours, tools, failures, states,
    disk: D.disk || {},
    // 常驻面板实际地址：端口可能已顺延（usage-serve.json 是 serve 写下的事实源）
    serveUrl: (() => { const m = servePidFile(); return 'http://127.0.0.1:' + (m && m.port ? m.port : 7741); })(),
  };
}

function buildDetail(args) {
  const limit = Math.max(1, Math.min(200, Number(args && args.limit) || 30));
  const offset = Math.max(0, Number(args && args.offset) || 0);
  const status = args && args.status != null ? Number(args.status) : null;
  const where = status != null && status >= 0
    ? `WHERE CASE status WHEN 'completed' THEN 0 WHEN 'error' THEN 1 WHEN 'cancelled' THEN 2 ELSE 3 END = ${status | 0} `
    : '';
  const rows = JSON.parse(q1(`SELECT json_group_array(json_array(
      datetime(R.started_at/1000,'unixepoch','localtime'),
      R.model_id, R.provider_id,
      R.input_tokens, R.output_tokens+R.reasoning_tokens, R.cache_read_input_tokens,
      R.cache_creation_input_tokens, R.duration_ms, R.time_to_first_token_ms,
      CASE R.status WHEN 'completed' THEN 0 WHEN 'error' THEN 1 WHEN 'cancelled' THEN 2 ELSE 3 END,
      COALESCE((SELECT title FROM session WHERE id = R.session_id),'')))
    FROM (SELECT * FROM model_usage ${where} ORDER BY started_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}) R`));
  return { offset, limit, rows: rows || [] };
}

// ---------- 最小 MCP stdio 协议 ----------
const SERVER_INFO = { name: 'usage-detail-panel', 'version': '0.30.5' };
// 完整版仪表盘作为侧栏页面（与 /usage-ui、serve 本地面板同源同界面，单一维护点）：
// 调 usage.sh dashboard 生成自包含片段（默认全量历史），包上独立壳（主题变量+页签行为）。
import { execFile } from 'node:child_process';
const { SHELL_CSS, TAB_JS } = await import('../shell.mjs');
const USAGE_SH = path.join(HERE, '..', 'usage.sh');
import { providerNames as vendorDisplayNames, projectMap as buildProjectMap } from '../lib/project-meta.mjs';

// bash 可执行解析（Windows 的 Git for Windows 默认只把 git.exe 加入 PATH，bash.exe 常缺；
// 侧栏面板与价格同步都依赖 bash，按常见安装位置兜底查找）——与 serve.mjs 同逻辑
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

let dashCache = { at: 0, html: null };
function getPanelHtml() {
  return new Promise((resolve, reject) => {
    if (dashCache.html && Date.now() - dashCache.at < 60000) return resolve(dashCache.html);
    const gen = (limitEnv) => new Promise((res2, rej2) => {
      // 唯一临时名：并发 resources/read 会同时起多个 gen，固定 pid 名会互相 unlink/读错文件
      const tmp = path.join(os.tmpdir(), 'usage-detail-panel-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.html');
      execFile(resolveBash(), [USAGE_SH, 'dashboard', tmp], { timeout: 120000, env: { ...process.env, ZCODE_USAGE_LIMIT: limitEnv } }, (err) => {
        if (err) return rej2(new Error(err && err.code === 'ENOENT'
          ? '未找到 bash（Windows 需安装 Git for Windows，或设置 ZCODE_BASH 指向 bash.exe）'
          : '生成仪表盘失败：' + (err.message || err)));
        try {
          const frag = fs.readFileSync(tmp, 'utf8');
          fs.unlinkSync(tmp);
          res2(frag);
        } catch (e) { rej2(e); }
      });
    });
    const fullLimit = process.env.ZCODE_USAGE_LIMIT || '-1';
    gen(fullLimit).then((frag) => {
      const finish = (f, notice) => {
        const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZCode 用量面板</title><style>' + SHELL_CSS + '</style></head><body style="padding:10px 12px 40px;max-width:none">' + (notice || '') + '<script>window.__USAGE_SERVE__=false;</script>' + f + '<script>' + TAB_JS + '</scr' + 'ipt></body></html>';
        dashCache = { at: Date.now(), html };
        resolve(html);
      };
      // 防御：宿主对页面资源读取有 8MiB 上限，逼近时自动降额到最近 5000 条重生成
      if (fullLimit === '-1' && frag.length > 7 * 1024 * 1024) {
        gen('5000').then((small) => {
          const notice = '<div style="margin:0 0 10px;padding:8px 12px;border-radius:10px;background:var(--muted);font-size:12px;color:var(--muted-foreground)">历史数据过大（接近面板体积上限），侧栏已仅加载最近 5000 条；完整历史请用本地面板或 <code>usage.sh export</code>。</div>';
          finish(small, notice);
        }).catch(() => finish(frag)); // 降级失败就用全量（宁可大也不空白）
        return;
      }
      finish(frag);
    }).catch(reject);
  });
}

// ---------- 本轮统计资源（ui://usage-detail/turn.txt）----------
// Stop 钩子每轮写 ~/.zcode/usage-detail-turn-done.json 标记；这里轮询 mtime，
// 变化即向宿主发 notifications/resources/updated，订阅了该资源的侧栏面板实时刷新。
// 宿主已声明 resources.subscribe 能力（app.asar / zcode.cjs 均实证），面板桥有
// subscribeResource/onResourceUpdated/readResource（UI_PLUGIN.md「资源订阅」）。
const TURN_URI = 'ui://usage-detail/turn.txt';
const TURN_DONE = path.join(os.homedir(), '.zcode', 'usage-detail-turn-done.json');
let turnSubs = 0;            // 已订阅连接数（本进程单宿主会话，计数即可）
let turnDoneMtime = 0;       // 上次已通知的标记 mtime
let turnWatchStarted = false;
let turnCache = { at: 0, text: null };

function computeTurnText() {
  if (turnCache.text != null && Date.now() - turnCache.at < 5000) return turnCache.text;
  let text = '';
  try {
    text = execFileSync(process.execPath, [path.join(HERE, '..', 'turn-stats.mjs'), '--turn', '--current'], { encoding: 'utf8', timeout: 15000 }).trim();
  } catch (e) { /* 静默：无数据即空 */ }
  turnCache = { at: Date.now(), text };
  return text;
}

function notifyTurnUpdated() {
  turnCache = { at: 0, text: null }; // 下次读取强制重算
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri: TURN_URI } }) + '\n');
}

function watchTurnDone() {
  let mtime = 0;
  try { mtime = fs.statSync(TURN_DONE).mtimeMs || 0; } catch (e) {}
  if (!mtime || mtime === turnDoneMtime) return;
  turnDoneMtime = mtime;
  if (turnSubs > 0) notifyTurnUpdated();
}

function startTurnWatch() {
  if (turnWatchStarted) return;
  turnWatchStarted = true;
  try { turnDoneMtime = fs.statSync(TURN_DONE).mtimeMs || 0; } catch (e) { turnDoneMtime = 0; }
  setInterval(watchTurnDone, 2000).unref();
}

// ---------- 本地配置读写（与 serve.mjs 同文件格式；供侧栏面板直接编辑，App-only 工具不经模型） ----------
const PRICES_FILE = process.env.ZCODE_USAGE_PRICES || path.join(os.homedir(), '.zcode', 'usage-prices.json');
const BUDGET_FILE = path.join(os.homedir(), '.zcode', 'usage-budget.json');
const TURNSTATS_FILE = path.join(os.homedir(), '.zcode', 'usage-turnstats.json');
const ALERTS_CFG = path.join(os.homedir(), '.zcode', 'usage-alerts.json');
// 界面语言持久层（usage-lang.json）：跨面板权威的显式选择，''=跟随系统；
// 侧栏 WebView 的 localStorage 不随面板重开保留，显式语言必须落文件才能保持
const LANG_FILE = path.join(os.homedir(), '.zcode', 'usage-lang.json');
function readLangCfg() {
  try {
    const v = String(JSON.parse(stripBom(fs.readFileSync(LANG_FILE, 'utf8'))).language || '');
    return v === 'zh' || v === 'en' ? v : '';
  } catch (e) { return ''; }
}
function writeLangCfg(v) {
  atomicWrite(LANG_FILE, JSON.stringify({ language: v === 'zh' || v === 'en' ? v : '' }) + '\n');
}
// 上下文 Top 下钻（与 serve.mjs 同款 SQL）：工具字节 Top + 文件字节 Top，按会话按需查询
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
       SELECT COALESCE(NULLIF(${agentExpr()},''),'-') AS agent, mu.started_at AS started_at, mu.duration_ms AS duration_ms,
              mu.input_tokens+mu.output_tokens+mu.reasoning_tokens AS tok, mu.session_id AS sid
       FROM model_usage mu LEFT JOIN session ch ON ch.id = mu.session_id
       WHERE COALESCE(${parentExpr()}, mu.session_id) = ? AND mu.query_source = 'subagent'
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

function atomicWrite(file, data, mode) {
  // 原子写 + Windows 兜底：rename 到被占用（杀毒/并发读）的目标会 EPERM——短重试后直写保功能
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, mode != null ? { mode } : undefined);
  for (let i = 0; i < 3; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i === 2) {
        try { fs.writeFileSync(file, data, mode != null ? { mode } : undefined); } catch (e2) {}
        try { fs.unlinkSync(tmp); } catch (e2) {}
        return;
      }
      const until = Date.now() + 60; while (Date.now() < until) { /* 短退避 */ }
    }
  }
}
// Windows 记事本等编辑器保存的 UTF-8 文件常带 BOM，JSON.parse 会直接抛错——读取后剥除
const stripBom = (s) => String(s == null ? '' : s).replace(/^\uFEFF/, '');
function readJsonCfg(file, fallback) {
  try { return JSON.parse(stripBom(fs.readFileSync(file, 'utf8'))); } catch (e) { return fallback; }
}
function readPricesCfg() {
  const v = readJsonCfg(PRICES_FILE, null);
  if (!v) return { currency: 'CNY', usdCny: null, autoSync: true, models: {} };
  if (!v.models || typeof v.models !== 'object') return { currency: v.currency || 'CNY', usdCny: v.usdCny ?? null, autoSync: v.autoSync !== false, models: v.models || v };
  return { currency: v.currency || 'CNY', usdCny: v.usdCny ?? null, autoSync: v.autoSync !== false, models: v.models };
}
function writePricesCfg(next) {
  // 保留通用设置字段（usdCny/autoSync），models 为模型价
  const prev = readPricesCfg();
  atomicWrite(PRICES_FILE, JSON.stringify({
    currency: next.currency || prev.currency || 'CNY',
    usdCny: next.usdCny != null ? Number(next.usdCny) || null : prev.usdCny,
    autoSync: next.autoSync != null ? next.autoSync !== false : prev.autoSync !== false,
    models: next.models || prev.models || {},
  }) + '\n');
  dashCache.html = null; // 改价后面板按新价重算
  metaCache = { at: 0, v: null };
}
function readBudgetCfg() { return readJsonCfg(BUDGET_FILE, { daily: 0, monthly: 0 }); }

// 多厂商配额凭据（全部可选）：~/.zcode/usage-vendors.json，权限 0600。
// 读取侧（vendor-quota.mjs）按 env → 文件顺序解析；此处只写入与回传「是否已配置」，绝不回传明文。
const VENDOR_IDS = ['deepseek', 'kimi', 'openrouter', 'minimax'];
function vendorKeysPath() { return path.join(os.homedir(), '.zcode', 'usage-vendors.json'); }
function readVendorMask() {
  const v = readJsonCfg(vendorKeysPath(), {}) || {};
  return Object.fromEntries(VENDOR_IDS.map((id) => [id, { configured: !!(v[id] && (v[id].key || v[id].token)) }]));
}
function writeVendorKeys(keys) {
  const cur = readJsonCfg(vendorKeysPath(), {}) || {};
  for (const id of VENDOR_IDS) {
    if (!(id in (keys || {}))) continue;
    const k = String(keys[id] || '').trim();
    if (k) cur[id] = { key: k };
    else delete cur[id]; // 空串 = 清除该厂商凭据
  }
  atomicWrite(vendorKeysPath(), JSON.stringify(cur, null, 2) + '\n', 0o600);
  return readVendorMask();
}

// 瘦身价格表：宿主对 structuredContent 有 64 KiB 上限（超限字段被省略），而同步后的全量
// 价目有数千模型（数百 KiB），必须裁剪。默认只返回当前用量出现过的模型 + GLM 系内置价；
// 传 query 时按模型名子串匹配（仍截断到 200 个）。前端弹框搜索走 query 参数按需取。
const SLIM_MODELS_MAX = 200;
function usedModelNames() {
  try {
    return openDb().prepare('SELECT DISTINCT model_id AS m FROM model_usage ORDER BY m').all().map((r) => String(r.m));
  } catch (e) { return []; }
}
function slimPrices(query) {
  const p = readPricesCfg();
  const all = Object.keys(p.models || {});
  let names;
  const q = String(query || '').trim().toLowerCase();
  if (q) {
    names = all.filter((m) => m.toLowerCase().indexOf(q) >= 0).slice(0, SLIM_MODELS_MAX);
  } else {
    const used = new Set(usedModelNames().map((m) => m.toLowerCase()));
    names = all.filter((m) => used.has(m.toLowerCase()) || /^(glm|deepseek)/.test(m.toLowerCase())).slice(0, SLIM_MODELS_MAX);
  }
  const models = {};
  for (const m of names) models[m] = p.models[m];
  return { currency: p.currency, usdCny: p.usdCny, autoSync: p.autoSync, models, modelsTotal: all.length, modelsSlim: true };
}
function writeBudgetCfg(b) {
  atomicWrite(BUDGET_FILE, JSON.stringify({ daily: Number(b.daily) || 0, monthly: Number(b.monthly) || 0 }) + '\n');
}
function readSwitchesCfg() {
  const ts = readJsonCfg(TURNSTATS_FILE, { enabled: false, mode: 'inject' });
  const al = readJsonCfg(ALERTS_CFG, {});
  return {
    turnstats: ts.enabled === true ? (ts.mode === 'notify' ? 'notify' : 'inject') : 'off',
    budgetAlerts: al.budget !== false,
    permissionAlerts: al.permission === true,
  };
}
function writeSwitchesCfg(b) {
  if (b.turnstats === 'off' || b.turnstats === 'notify' || b.turnstats === 'inject') {
    const v = b.turnstats === 'off' ? { enabled: false } : { enabled: true, mode: b.turnstats };
    atomicWrite(TURNSTATS_FILE, JSON.stringify(v) + '\n');
  }
  // alerts 单文件承载两个开关：侧栏开关逐个提交单字段，必须读旧值合并再写，
  // 否则切「预算告警」会抹掉「权限提醒」（与 serve.mjs writeSwitches 同口径）
  const patch = {};
  if (typeof b.budgetAlerts === 'boolean') patch.budget = b.budgetAlerts;
  if (typeof b.permissionAlerts === 'boolean') patch.permission = b.permissionAlerts;
  if (Object.keys(patch).length) {
    atomicWrite(ALERTS_CFG, JSON.stringify(Object.assign({}, readJsonCfg(ALERTS_CFG, {}), patch)) + '\n');
  }
  return readSwitchesCfg();
}

const TOOLS = [
  {
    name: 'usage_summary',
    description: 'ZCode 本地用量摘要：请求/token KPI、来源与模型占比、Top 会话、当前 5h 窗口与套餐配额（零密钥读客户端日志）。只读本机 SQLite。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    _meta: { ui: { resourceUri: 'ui://usage-detail/panel.html', surface: 'usage', visibility: ['model', 'app'] } },
  },
  {
    name: 'usage_trend',
    description: '按时间范围的用量聚合：KPI、每日 token、时段分布、来源/模型构成。range: today|yesterday|7d|30d|month|last_month|all，或 from/to（YYYY-MM-DD）。',
    inputSchema: {
      type: 'object',
      properties: {
        range: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'usage_sessions',
    description: '会话列表（按 token Top 20，含真会话 id）：标题、请求数、token、缓存率、最后活动。时间范围参数同 usage_trend。',
    inputSchema: {
      type: 'object',
      properties: { range: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'usage_session',
    description: '单个会话详情：元信息、聚合（含平均 tok/s）、模型/来源/工具分布、压缩事件、最近 15 条请求。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '会话 id' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'usage_quota',
    description: '多厂商配额聚合（可选功能）：GLM（零密钥客户端日志源）恒查；DeepSeek / Kimi / OpenRouter / MiniMax 在插件设置填写对应 API Key 后启用，Key 仅发送到对应厂商官方域名。返回各窗口已用百分比/余额与重置时间。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'usage_settings_get',
    description: '读取本地配置：价格表（含币种/汇率/自动同步，默认瘦身为主会话相关模型，query 可搜索全量）、预算、通知开关、多厂商配额 Key 配置状态（只回传是否已配置，不回传明文）。',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: '按模型名子串搜索价格（缺省只返回当前用量相关 + GLM 内置）' } },
      additionalProperties: false,
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'usage_ctx_top',
    description: "会话上下文 Top 下钻（App-only，不经模型）：该会话 part 分段里工具调用字节 Top 与 Read/Edit/Write 文件字节 Top，口径为存储字节近似。与面板「上下文构成」环配套。",
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string', description: '会话 id' } },
      additionalProperties: false,
    },
    _meta: { ui: { resourceUri: 'ui://usage-detail/panel.html', surface: 'usage', visibility: ['app'] } },
  },
  {
    name: 'usage_settings_set',
    description: '写入本地配置（App-only，不经模型）：price 更新单模型价（可带 ctxOverride 覆盖上下文窗口）、priceGeneral 币种/汇率/自动同步、budget 日月预算、switches 通知开关、priceRemove 删除模型价、vendorKeys 多厂商配额 Key（写入本地凭据文件，不回传明文）。',
    inputSchema: {
      type: 'object',
      properties: {
        price: { type: 'object', description: '{model,in,out,cache,ctxOverride?}' },
        priceGeneral: { type: 'object', description: '{currency,usdCny,autoSync}' },
        priceRemove: { type: 'string', description: '要删除的模型名' },
        budget: { type: 'object', description: '{daily,monthly}' },
        switches: { type: 'object', description: '{turnstats:off|notify|inject, budgetAlerts:bool, permissionAlerts:bool}' },
        language: { type: 'string', description: "界面语言覆盖：'' 跟随系统 / 'zh' / 'en'；写入 usage-lang.json 并失效面板缓存" },
        vendorKeys: { type: 'object', description: '{deepseek?,kimi?,openrouter?,minimax?}：API Key，空串清除' },
      },
      additionalProperties: false,
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'open_full_panel',
    description: '打开本地常驻完整面板（http://127.0.0.1:7741）。若服务未运行会自动以只读方式启动（仅监听本机）。返回 { url }。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'usage_prices_sync',
    description: '从 models.dev 同步官方模型价格表（可选联网动作，App-only 不经模型）。完成后返回同步摘要；页面随后按新价重算。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'usage_detail',
    description: 'ZCode 本地请求明细分页（每行：时间/模型/来源/输入/生成/缓存读/缓存写/耗时ms/首字ms/状态/会话）。status: 0 完成 1 失败 2 取消 3 进行中，缺省全部。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '条数（1-200，默认 30）' },
        offset: { type: 'number', description: '偏移（默认 0）' },
        status: { type: 'number', description: '状态过滤，缺省全部' },
      },
      additionalProperties: false,
    },
  },
];

import http2 from 'node:http';
import { spawn } from 'node:child_process';
// 本插件版本（与 serve.mjs 常驻进程做版本握手，不一致即重启旧进程）
let PLUGIN_VERSION = 'unknown';
try { PLUGIN_VERSION = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '.zcode-plugin', 'plugin.json'), 'utf8')).version || 'unknown'; } catch (e) {}

const SERVE_PID_FILE = path.join(os.homedir(), '.zcode', 'usage-serve.json');
function servePidFile() {
  try { return JSON.parse(fs.readFileSync(SERVE_PID_FILE, 'utf8')); } catch (e) { return null; }
}

function serveRunning(port) {
  return new Promise((resolve) => {
    const req = http2.get(`http://127.0.0.1:${port}/api/live`, { timeout: 1200 }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        let v = null;
        try { v = JSON.parse(b).v || null; } catch (e) {}
        resolve({ ok: res.statusCode === 200, v });
      });
      res.resume();
    });
    req.on('error', () => resolve({ ok: false, v: null }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, v: null }); });
  });
}

// 旧版本常驻 serve 缺新路由（如 /report.html、/api/turn）会 404：按 pid 文件重启它
function killStaleServe() {
  try {
    const meta = servePidFile();
    if (!meta || !meta.pid) return; // pid+进程名校验已防误杀；端口不限（支持顺延端口上的旧实例）
    if (process.platform === 'win32') {
      // Windows 无 ps：tasklist 校验映像名后 taskkill（防 pid 被无关进程复用误杀）
      const img = execFileSync('tasklist', ['/FI', `PID eq ${meta.pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      if (/node\.exe/i.test(img)) {
        try { execFileSync('taskkill', ['/PID', String(meta.pid), '/F'], { stdio: 'ignore' }); } catch (e) {}
      }
      return;
    }
    const cmd = execFileSync('ps', ['-p', String(meta.pid), '-o', 'command='], { encoding: 'utf8' });
    if (cmd.includes('serve.mjs')) {
      try { process.kill(meta.pid); } catch (e) {}
    }
  } catch (e) {}
}

// 端口策略与 serve.mjs 对齐：默认 7741；被占时 serve 自动顺延 7742-7749 并把实际端口
// 写进 usage-serve.json——这里以该文件为事实源返回真实地址，不再假设固定 7741
async function ensureServe() {
  const known = servePidFile();
  const knownPort = known && known.port ? Number(known.port) : 7741;
  const cur = await serveRunning(knownPort);
  if (cur.ok) {
    if (cur.v === PLUGIN_VERSION) return { url: `http://127.0.0.1:${knownPort}`, started: false };
    killStaleServe();
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (!(await serveRunning(knownPort)).ok) break;
    }
  } else if (knownPort !== 7741 && (await serveRunning(7741)).ok) {
    // pid 文件丢失但默认端口上有活实例：跟随实际
    const r = await serveRunning(7741);
    if (r.ok && r.v === PLUGIN_VERSION) return { url: 'http://127.0.0.1:7741', started: false };
  }
  // 不传端口启动：serve 在 7741 被占时自行顺延并回写 usage-serve.json
  //（用 process.execPath 而非 PATH 里的 node：ZCode 内置 node 场景 PATH 可能没有）
  const child = spawn(process.execPath, [path.join(HERE, '..', 'serve.mjs')], { detached: true, stdio: 'ignore' });
  child.on('error', function () {});
  child.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const meta = servePidFile();
    const p = meta && meta.port ? Number(meta.port) : 7741;
    const r = await serveRunning(p);
    if (r.ok) {
      if (r.v === PLUGIN_VERSION) return { url: `http://127.0.0.1:${p}`, started: true };
      // 起来的是旧版本（理论上刚被 kill 过）：按旧路径继续等/报错
    }
  }
  return { url: `http://127.0.0.1:${knownPort}`, started: false, error: '启动超时，可手动运行 usage.sh serve' };
}

let quotaToolCache = { at: 0, v: null };
function handleToolCall(name, args) {
  if (name === 'usage_summary') {
    return { structuredContent: buildSummary(), content: [{ type: 'text', text: '用量摘要已生成' }] };
  }
  if (name === 'usage_detail') {
    const out = buildDetail(args);
    return { structuredContent: out, content: [{ type: 'text', text: (out.rows || []).length + ' 条明细' }] };
  }
  if (name === 'usage_trend') {
    return { structuredContent: buildTrend(args), content: [{ type: 'text', text: '趋势聚合' }] };
  }
  if (name === 'usage_sessions') {
    return { structuredContent: { sessions: buildSessions(args) }, content: [{ type: 'text', text: '会话列表' }] };
  }
  if (name === 'usage_session') {
    return { structuredContent: buildSessionDetail(args && args.id), content: [{ type: 'text', text: '会话详情' }] };
  }
  if (name === 'usage_settings_get') {
    return {
      structuredContent: { prices: slimPrices(args && args.query), budget: readBudgetCfg(), switches: readSwitchesCfg(), vendors: readVendorMask(), language: readLangCfg() },
      content: [{ type: 'text', text: '配置已读取' }],
    };
  }
  if (name === 'usage_ctx_top') {
    return {
      structuredContent: ctxTop(args && args.session),
      content: [{ type: 'text', text: '上下文 Top 已返回' }],
    };
  }
  if (name === 'usage_settings_set') {
    let saved = { ok: true };
      if (args && args.price && args.price.model) {
        const m = String(args.price.model).trim();
        if (m) {
          const next = readPricesCfg();
          const num = (v) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : 0; };
          const prevEntry = next.models[m] || {};
          next.models[m] = { in: num(args.price.in), out: num(args.price.out), cache: num(args.price.cache) };
          if (prevEntry.ctx != null) next.models[m].ctx = prevEntry.ctx; // 改价保留上下文窗口字段
          const coRaw = args.price.ctxOverride; // 显式传空/0 = 清除覆盖；未传 = 保留原值（与 serve.mjs 同口径）
          if (coRaw !== undefined) {
            const co = Number(coRaw);
            if (Number.isFinite(co) && co > 0) next.models[m].ctxOverride = Math.round(co);
          } else if (prevEntry.ctxOverride != null) {
            next.models[m].ctxOverride = prevEntry.ctxOverride;
          }
          writePricesCfg(next);
        }
      }
    if (args && args.priceRemove) {
      const next = readPricesCfg();
      delete next.models[String(args.priceRemove).trim()];
      writePricesCfg(next);
    }
    if (args && args.priceGeneral) {
      const g = args.priceGeneral;
      const next = readPricesCfg();
      if (g.currency) next.currency = String(g.currency);
      if ('usdCny' in g) next.usdCny = Number(g.usdCny) || null;
      if (g.autoSync != null) next.autoSync = g.autoSync !== false;
      writePricesCfg(next);
    }
    if (args && args.budget) writeBudgetCfg(args.budget);
    if (args && args.switches) saved.switches = writeSwitchesCfg(args.switches);
    if (args && args.vendorKeys) saved.vendors = writeVendorKeys(args.vendorKeys);
    if (args && args.language !== undefined) {
      writeLangCfg(args.language);
      saved.language = readLangCfg();
      dashCache = { at: 0, html: null }; // 面板 HTML 缓存失效：重开面板立即按新语言重生成
    }
    // 附带保存后的瘦身价格表：面板保存成功直接软刷新（MCP App 沙箱内禁止 location.reload）
    if (args && (args.price || args.priceRemove || args.priceGeneral || args.vendorKeys)) saved.prices = slimPrices('');
    return {
      structuredContent: saved,
      content: [{ type: 'text', text: '配置已保存' }],
    };
  }
  if (name === 'usage_quota') {
    // 多厂商配额聚合：GLM 零密钥（客户端日志源）恒查，其余厂商按已配置的 Key 查询。
    // 结果缓存 60s：侧栏面板每次刷新都会调，避免频繁外网请求与子进程拉起。
    const cached = quotaToolCache.v && Date.now() - quotaToolCache.at < 60000 ? quotaToolCache.v : null;
    const load = cached
      ? Promise.resolve(cached)
      : import('../vendor-quota.mjs').then((mod) => mod.queryAllVendors()).then((j) => { quotaToolCache = { at: Date.now(), v: j }; return j; });
    return load.then((j) => {
      const blocks = (j.vendors || []).map((v) => {
        if (!v.ok) return v.name + '：查询失败（' + ((v.error || '未知错误') + '').slice(0, 120) + '）';
        return v.name + '\n' + (v.items || []).map((it) => '  ' + (it.label || '配额') + '：' + (it.pct != null ? '已用 ' + it.pct + '%' : String(it.text || '未知')) + (it.resets ? '，' + it.resets + ' 重置' : '')).join('\n');
      });
      const text = blocks.length
        ? blocks.join('\n') + '\n\n（其他厂商可在插件设置里填写 API Key 启用：DeepSeek / Kimi / OpenRouter / MiniMax，Key 仅发送到对应厂商官方域名）'
        : '暂无配额数据：GLM 零密钥日志源无观测，其他厂商未配置 Key。可在插件设置里填写 DeepSeek / Kimi / OpenRouter / MiniMax 的 API Key 启用聚合查询。';
      return { structuredContent: j, content: [{ type: 'text', text }] };
    }).catch((e) => ({ isError: true, content: [{ type: 'text', text: '配额查询失败：' + ((e && e.message) || e + '').slice(0, 200) }] }));
  }
  if (name === 'open_full_panel') {
    return ensureServe().then((r) => ({ structuredContent: r, content: [{ type: 'text', text: r.url + (r.started ? '（已启动）' : '（已在运行）') }] }));
  }
  if (name === 'usage_prices_sync') {
    // 联网同步 models.dev 价格表（与 serve /api/sync-prices、usage.sh prices sync 同一实现）
    return new Promise((resolve) => {
      execFile(resolveBash(), [USAGE_SH, 'prices', 'sync'], { timeout: 90000, env: process.env }, (err, stdout) => {
        if (err) {
          resolve({ isError: true, content: [{ type: 'text', text: '同步失败：' + ((err.message || err) + '').slice(0, 300) }] });
          return;
        }
        dashCache.html = null; // 新价生效：面板下次取资源时按新价重算
        const msg = String(stdout || '').trim().split('\n').pop() || '已同步';
        resolve({ structuredContent: { ok: true, prices: slimPrices(''), message: msg }, content: [{ type: 'text', text: msg }] });
      });
    });
  }
  return { isError: true, content: [{ type: 'text', text: '未知工具：' + name }] };
}

function dispatch(msg) {
  const { id, method, params } = msg;
  function reply(result) {
    if (id == null) return;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  }
  function replyErr(code, message) {
    if (id == null) return;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
  }
  try {
    switch (method) {
      case 'initialize':
        reply({
          protocolVersion: params && params.protocolVersion || '2025-06-18',
          capabilities: { tools: { listChanged: false }, resources: { subscribe: true, listChanged: false } },
          serverInfo: SERVER_INFO,
        });
        return;
      case 'ping': reply({}); return;
      case 'tools/list': reply({ tools: TOOLS }); return;
      case 'tools/call': {
        const r = handleToolCall(params && params.name, params && params.arguments);
        if (r && typeof r.then === 'function') {
          // 异步工具（open_full_panel）：挂起计数，等完成再回复；否则 Promise 会被序列化成 {}
          inflight++;
          r.then((v) => reply(v), (e) => replyErr(-32603, (e && e.message) || String(e))).finally(() => { inflight--; tryExit(); });
          return;
        }
        reply(r);
        return;
      }
      case 'resources/list':
        reply({ resources: [
          { uri: 'ui://usage-detail/panel.html', mimeType: 'text/html;profile=mcp-app', name: '用量面板' },
          { uri: TURN_URI, mimeType: 'text/plain', name: '本轮统计', description: '最近一次回复结束时的单行用量摘要（本地计算，零模型开销）' },
        ] });
        return;
      case 'resources/subscribe':
        if (params && params.uri === TURN_URI) { turnSubs++; startTurnWatch(); }
        reply({});
        return;
      case 'resources/unsubscribe':
        if (params && params.uri === TURN_URI && turnSubs > 0) turnSubs--;
        reply({});
        return;
      case 'resources/read': {
        const uri = params && params.uri;
        if (uri === TURN_URI) {
          reply({ contents: [{ uri, mimeType: 'text/plain', text: computeTurnText() }] });
          return;
        }
        if (uri !== 'ui://usage-detail/panel.html') { replyErr(-32602, '未知资源：' + uri); return; }
        inflight++;
        getPanelHtml().then((html) => {
          reply({ contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: html }] });
        }).catch((e) => replyErr(-32603, (e && e.message) || String(e))).finally(() => { inflight--; tryExit(); });
        return;
      }
      default:
        if (method && method.startsWith('notifications/')) return;
        replyErr(-32601, '方法不存在：' + method);
    }
  } catch (e) {
    replyErr(-32603, '内部错误：' + (e && e.message || e));
  }
}

let buf = '';
// stdin 关闭后的退出协调：等所有挂起异步操作完成，再留缓冲刷管道
let inflight = 0;
let exiting = false;
function tryExit() {
  if (!exiting || inflight > 0) return;
  setTimeout(() => process.exit(0), 150);
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try { dispatch(JSON.parse(line)); } catch (e) { /* 坏行忽略 */ }
  }
});
process.stdin.on('end', () => {
  // 延迟退出：先等挂起的异步操作（面板 HTML 生成、open_full_panel）完成——固定 150ms
  // 只够刷管道缓冲，等不了耗时数秒的 dashboard 生成；再缓冲 150ms 让大响应
  // （如全量价格 settings_get）从 stdout 管道刷完，避免 exit 截断。
  exiting = true;
  tryExit();
});
