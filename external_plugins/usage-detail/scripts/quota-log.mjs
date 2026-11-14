// 套餐配额的零密钥数据源：尾随解析 ZCode 客户端日志。
//
// 客户端会定期把两类额度响应明文写进当天日志（[usage-stats] 记录器）：
//   1. `billing/balance 请求完成 {JSON}` —— zcode-plan 套餐余额（balances[] 配额桶 + payload.data.plans[] 套餐）
//   2. `官方 MCP 额度响应 {"body":"{...}"} ` —— MCP 额度（level/total_usage{used,limit,remaining}）
// 日志位置：~/.zcode/v2/logs/<YYYY-MM-DD>.log（数据目录迁移场景探测 ZCODE_DATA_BASE_DIR）。
// 解析策略参考 zcode-fox-widget（MIT）的实测经验：
//   - 尾窗逐级扩读 512KB→4MB→32MB：会话高峰的 host-log 刷屏会把标记挤出小尾窗
//   - 标记行从新到旧逐条尝试：跳过套餐切换间隙的空桶过渡态快照
//   - 只统计 active 套餐名下的桶：过期套餐的残留桶会把剩余百分比稀释失真
//   - 回看最近 7 天；非当天观测标记 stale；30s 缓存
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BALANCE_MARK = 'billing/balance 请求完成 ';
const MCP_MARK = '官方 MCP 额度响应 ';
const TAIL_STEPS = [512 * 1024, 4 * 1024 * 1024, 32 * 1024 * 1024];
const MAX_LOOKBACK_DAYS = 7;
const CACHE_TTL_MS = 30_000;

function localDayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function logDirCandidates() {
  const dirs = [];
  if (process.env.ZCODE_DATA_BASE_DIR) dirs.push(path.join(process.env.ZCODE_DATA_BASE_DIR, '.zcode', 'v2', 'logs'));
  dirs.push(path.join(os.homedir(), '.zcode', 'v2', 'logs'));
  return dirs;
}

// 从一段日志文本解析全部标记行，按时间从新到旧返回（后写的在前）
function parseMarkedLines(text, mark) {
  const out = [];
  let from = 0;
  for (;;) {
    const idx = text.indexOf(mark, from);
    if (idx === -1) break;
    const lineEnd = text.indexOf('\n', idx);
    const raw = (lineEnd === -1 ? text.slice(idx + mark.length) : text.slice(idx + mark.length, lineEnd)).trim();
    from = lineEnd === -1 ? text.length : lineEnd;
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') out.push(obj);
    } catch (e) { /* 截断行/坏行跳过 */ }
  }
  return out.reverse();
}

// 读一个日志文件的尾部并解析两类标记；找不到任何标记返回 null。
// 全同步读 + 32MB 封顶：服务事件循环里不能被无上限的大文件拖死。
function readLogFile(full) {
  let stat;
  try { stat = fs.statSync(full); } catch (e) { return null; }
  for (const step of TAIL_STEPS) {
    const size = Math.min(step, stat.size);
    const start = Math.max(0, stat.size - size);
    let text = '';
    try {
      const fd = fs.openSync(full, 'r');
      try {
        const buf = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        text = buf.toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch (e) { return null; }
    const balances = parseMarkedLines(text, BALANCE_MARK);
    const mcp = parseMarkedLines(text, MCP_MARK);
    if (balances.length || mcp.length) return { balances, mcp, mtimeMs: stat.mtimeMs };
    if (size >= stat.size) return null;
  }
  return null;
}

// billing/balance 顶层响应 → 配额桶数组（active 套餐过滤 + 模型归属）
function bucketsFromBalance(raw) {
  const balances = Array.isArray(raw && raw.balances) ? raw.balances : [];
  const plansRaw = raw && raw.payload && raw.payload.data && Array.isArray(raw.payload.data.plans)
    ? raw.payload.data.plans
    : (Array.isArray(raw && raw.plans) ? raw.plans : []);
  if (!balances.length) return [];
  const modelsByEntitlement = new Map();
  for (const p of plansRaw) {
    if (String((p && p.status) || '').toLowerCase() !== 'active') continue;
    for (const e of (Array.isArray(p && p.entitlements) ? p.entitlements : [])) {
      if (!e || !e.entitlement_id) continue;
      const models = (Array.isArray(e.capabilities) ? e.capabilities : [])
        .filter((c) => typeof c === 'string' && c.indexOf('model:') === 0)
        .map((c) => c.slice(6).toLowerCase())
        .filter(Boolean);
      if (models.length) modelsByEntitlement.set(e.entitlement_id, models);
    }
  }
  const inlineCaps = (b) => Array.isArray(b && b.capabilities) && b.capabilities.some((c) => typeof c === 'string' && c.indexOf('model:') === 0);
  const active = modelsByEntitlement.size
    ? balances.filter((b) => b && (modelsByEntitlement.has(b.entitlement_id) || inlineCaps(b)))
    : balances;
  const out = [];
  for (const b of active) {
    const total = Number(b.total_units), used = Number(b.used_units), remaining = Number(b.remaining_units);
    if (!Number.isFinite(total) || total <= 0) continue;
    const models = modelsByEntitlement.get(b.entitlement_id);
    const name = String(b.show_name || (models ? models.join('/') : '') || b.entitlement_id || '套餐额度');
    let resetAt = null;
    for (const k of ['period_end', 'expires_at']) {
      const v = Number(b[k]);
      if (Number.isFinite(v) && v > 0) { resetAt = v * 1000; break; }
    }
    out.push({ kind: 'plan', name, used, limit: total, remaining, percent: Math.round(used / total * 1000) / 10, resetAt });
  }
  return out;
}

// 官方 MCP 额度响应 → 额度桶
function bucketsFromMcp(raw) {
  const data = raw && raw.data ? raw.data : (raw && raw.body && raw.body.data ? raw.body.data : null);
  const t = data && data.total_usage;
  if (!t || !Number.isFinite(Number(t.limit)) || Number(t.limit) <= 0) return [];
  const limit = Number(t.limit), used = Number(t.used) || 0, remaining = Number(t.remaining);
  const nr = Number(data.next_refresh_at);
  return [{
    kind: 'mcp',
    name: 'MCP 额度' + (data.level ? '（' + data.level + '）' : ''),
    used, limit,
    remaining: Number.isFinite(remaining) ? remaining : Math.max(0, limit - used),
    percent: Math.round(used / limit * 1000) / 10,
    resetAt: Number.isFinite(nr) && nr > 0 ? nr * 1000 : null,
  }];
}

// 主入口：读最近 N 天日志，返回合并的配额观测（带 30s 缓存）。
// 返回 { ok, buckets, sources, logDate, stale, observedAt } 或 { ok:false, reason }。
export function readQuotaFromLog() {
  readQuotaFromLog.cache = readQuotaFromLog.cache || { at: 0, v: null };
  if (readQuotaFromLog.cache.v && Date.now() - readQuotaFromLog.cache.at < CACHE_TTL_MS) return readQuotaFromLog.cache.v;
  const today = localDayKey();
  let found = null;
  outer: for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    const date = localDayKey(new Date(Date.now() - i * 86400_000));
    for (const dir of logDirCandidates()) {
      const hit = readLogFile(path.join(dir, date + '.log'));
      if (!hit) continue;
      const buckets = [];
      const sources = [];
      // 每类标记只取最新一条非空观测（列表已按从新到旧排；空桶过渡态自动跳过）
      for (const raw of hit.balances) {
        const bs = bucketsFromBalance(raw);
        if (bs.length) { buckets.push(...bs); sources.push('plan-log'); break; }
      }
      for (const raw of hit.mcp) {
        let obj = raw;
        if (typeof raw.body === 'string') { try { obj = JSON.parse(raw.body); } catch (e) { continue; } }
        const bs = bucketsFromMcp(obj);
        if (bs.length) { buckets.push(...bs); sources.push('mcp-log'); break; }
      }
      if (buckets.length) {
        found = { ok: true, buckets, sources, logDate: date, stale: date !== today, observedAt: hit.mtimeMs };
        break outer;
      }
    }
  }
  const v = found || { ok: false, reason: 'no-quota-log' };
  readQuotaFromLog.cache = { at: Date.now(), v };
  return v;
}
