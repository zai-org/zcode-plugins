'use strict';

// 用量与余额：肚子上的胶囊数据源。
// - 默认读 ZCode 本地用量库（~/.zcode/cli/db/db.sqlite，只读）统计今日/近 7 天 token。
// - 可选：在 XiaoqiPet/balance.json 配置任意返回 JSON 的额度接口（url + headers + valuePath），
//   配置后胶囊改显示远端余量。60 秒缓存。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stateRoot } = require('./feed');

const TTL_MS = 60_000;

function databasePath() {
  const base = process.env.ZCODE_DATA_BASE_DIR || os.homedir();
  return path.join(base, '.zcode', 'cli', 'db', 'db.sqlite');
}

function balanceConfigPath() {
  return path.join(stateRoot(), 'balance.json');
}

function formatTokens(value) {
  const trim = (number, unit) => {
    const text = number.toFixed(1);
    return `${text.endsWith('.0') ? text.slice(0, -2) : text}${unit}`;
  };
  if (value >= 1_000_000) return trim(value / 1_000_000, 'M');
  if (value >= 1_000) return trim(value / 1_000, 'k');
  return String(value);
}

function readUsage() {
  const file = databasePath();
  if (!fs.existsSync(file)) return null;
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return null;
  }
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch {
    // WAL 只读打开失败时退回临时副本。
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoqi-db-'));
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.copyFileSync(file + suffix, path.join(tmp, `db.sqlite${suffix}`)); } catch { /* optional part */ }
      }
      db = new DatabaseSync(path.join(tmp, 'db.sqlite'), { readOnly: true });
    } catch {
      return null;
    }
  }
  try {
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    const weekAgo = Date.now() - 7 * 86_400_000;
    const row = (since) => db.prepare(`
      SELECT COALESCE(SUM(computed_total_tokens), 0) AS total,
             COALESCE(SUM(input_tokens), 0) AS input,
             COALESCE(SUM(output_tokens), 0) AS output,
             COALESCE(SUM(reasoning_tokens), 0) AS reasoning,
             COUNT(*) AS turns,
             COALESCE(SUM(tool_call_count), 0) AS tools
      FROM turn_usage WHERE started_at >= ?
    `).get(since);
    const today = row(startOfToday);
    const week = row(weekAgo);
    if (!today) return null;
    return {
      todayTotal: Number(today.total),
      todayInput: Number(today.input),
      todayOutput: Number(today.output),
      todayReasoning: Number(today.reasoning),
      todayTurns: Number(today.turns),
      todayTools: Number(today.tools),
      weekTotal: Number(week ? week.total : 0),
    };
  } catch {
    return null;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

function readRemoteConfig() {
  try {
    const dict = JSON.parse(fs.readFileSync(balanceConfigPath(), 'utf8'));
    if (!dict || typeof dict.url !== 'string') return null;
    const url = new URL(dict.url);
    const headers = {};
    if (dict.headers && typeof dict.headers === 'object') {
      for (const [key, value] of Object.entries(dict.headers)) {
        if (typeof value === 'string') headers[key] = value;
      }
    }
    return {
      url,
      headers,
      valuePath: typeof dict.valuePath === 'string' ? dict.valuePath : '',
      label: typeof dict.label === 'string' ? dict.label : '套餐余量',
      prefix: typeof dict.prefix === 'string' ? dict.prefix : '',
      suffix: typeof dict.suffix === 'string' ? dict.suffix : '',
    };
  } catch {
    return null;
  }
}

function extractValue(json, valuePath) {
  if (valuePath === '') return json;
  let cursor = json;
  for (const key of valuePath.split('.')) {
    if (cursor && typeof cursor === 'object' && !Array.isArray(cursor) && key in cursor) {
      cursor = cursor[key];
    } else if (Array.isArray(cursor) && /^\d+$/.test(key) && Number(key) < cursor.length) {
      cursor = cursor[Number(key)];
    } else {
      return undefined;
    }
  }
  return cursor;
}

function displayValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(2);
  }
  if (typeof value === 'string' && value !== '') return value;
  return null;
}

async function fetchRemote(config) {
  let response;
  try {
    response = await fetch(config.url, {
      method: 'GET',
      headers: { accept: 'application/json', ...config.headers },
      signal: AbortSignal.timeout(6000),
    });
  } catch (error) {
    throw new Error(error && error.name === 'TimeoutError' ? 'timeout' : 'network error');
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error('invalid json');
  }
  const display = displayValue(extractValue(json, config.valuePath));
  if (display === null) throw new Error('valuePath not found in response');
  return { label: config.label, display: config.prefix + display + config.suffix, fetchedAt: Date.now() };
}

let cache = null;
let cachedAt = 0;
let inFlight = null;

async function getBalance(force = false) {
  const now = Date.now();
  if (!force && cache && now - cachedAt < TTL_MS) return cache;
  if (inFlight) return inFlight;
  cachedAt = now;
  const usage = readUsage();
  const config = readRemoteConfig();
  if (!config) {
    cache = { usage, remote: null, remoteError: null, updatedAt: now };
    return cache;
  }
  inFlight = (async () => {
    let remote = null;
    let remoteError = null;
    try {
      remote = await fetchRemote(config);
    } catch (error) {
      remoteError = error instanceof Error ? error.message : String(error);
      // 拉取失败时沿用上一次的余量并标记过期，和 dsh 版一致。
      remote = cache && cache.remote ? { ...cache.remote, stale: true } : null;
    }
    return { usage, remote, remoteError, updatedAt: Date.now() };
  })().finally(() => {
    inFlight = null;
  });
  cache = await inFlight;
  return cache;
}

module.exports = {
  databasePath,
  balanceConfigPath,
  formatTokens,
  readUsage,
  readRemoteConfig,
  getBalance,
};
