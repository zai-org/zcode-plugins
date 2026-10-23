#!/usr/bin/env node
// 本问统计：输出最近一次提问之后的模型用量单行摘要（供模型附在回复末尾）。
//
// 用法：node turn-stats.mjs --turn --current
//   --current 守卫：仅当状态文件由 UserPromptSubmit 写入（source=prompt-submit）
//   且 sessionId 与当前一致时才统计 promptTs 之后的记录——绝不把上一轮数据
//   冒充本问；无数据时输出空（模型据此省略统计行）。
// 数据源：本地 model_usage 只读查询。口径与仪表盘一致：
//   生成 = 输出 + 思考；速率 = 生成 token / 生成耗时（总耗时 − 首字，缺失按总耗时）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB = process.env.ZCODE_USAGE_DB || path.join(os.homedir(), '.zcode/cli/db/db.sqlite');
const STATE_FILE = process.env.ZCODE_USAGE_TURN_STATE || path.join(os.homedir(), '.zcode', 'usage-detail-turn.json');
const args = process.argv.slice(2);
const current = args.includes('--current');

function fmt(n) {
  n = Number(n || 0);
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return n.toLocaleString('en-US');
}

if (!fs.existsSync(DB)) process.exit(0);
let state = null;
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
const sid = process.env.ZCODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
if (current) {
  if (!state || state.source !== 'prompt-submit') process.exit(0);
  if (sid && state.sessionId && state.sessionId !== sid) process.exit(0);
}
const promptTs = state && Number(state.promptTs);
if (!promptTs) process.exit(0);

let rows;
try {
  const db = new DatabaseSync(DB, { readOnly: true });
  rows = db.prepare(`
    SELECT output_tokens + reasoning_tokens AS gen,
           duration_ms, time_to_first_token_ms,
           input_tokens, cache_read_input_tokens, status, session_id
    FROM model_usage WHERE started_at >= ? ORDER BY started_at ASC
  `).all(promptTs);
} catch (e) { process.exit(0); }

if (!rows || !rows.length) process.exit(0);
// --current：只认属于当前会话的行；状态文件无 sessionId 时放宽为本机全部
const scoped = sid && state.sessionId ? rows.filter((r) => r.session_id === sid) : rows;
if (!scoped.length) process.exit(0);

const ok = scoped.filter((r) => r.status === 'completed');
const gen = ok.reduce((a, r) => a + (r.gen || 0), 0);
const genMs = ok.reduce((a, r) => a + Math.max(1, (r.duration_ms || 0) - (r.time_to_first_token_ms || 0)), 0);
const inn = ok.reduce((a, r) => a + (r.input_tokens || 0), 0);
const ca = ok.reduce((a, r) => a + (r.cache_read_input_tokens || 0), 0);
const fail = scoped.filter((r) => r.status === 'error').length;
const ttft = ok.find((r) => r.time_to_first_token_ms != null);
const totalMs = ok.reduce((a, r) => a + (r.duration_ms || 0), 0);
const wall = ok.length ? ok[ok.length - 1]._rowEnd || 0 : 0;
// 墙钟时间用首末请求跨度近似（与仪表盘口径一致）
let firstTs = 0, lastTs = 0;
try {
  const db2 = new DatabaseSync(DB, { readOnly: true });
  const span = db2.prepare(`SELECT min(started_at) AS a, max(started_at) AS b FROM model_usage WHERE started_at >= ? ${sid && state.sessionId ? 'AND session_id = ?' : ''}`).all(...(sid && state.sessionId ? [promptTs, sid] : [promptTs]));
  firstTs = span[0] && span[0].a || 0; lastTs = span[0] && span[0].b || 0;
} catch (e) {}
const wallSec = firstTs && lastTs ? Math.max(1, Math.round((lastTs - firstTs) / 100) / 10) : Math.round(totalMs / 1000);

const parts = [];
if (genMs > 0) parts.push('⚡ ' + Math.round(gen / genMs * 1000) + ' tok/s');
if (ttft) parts.push('首字 ' + (ttft.time_to_first_token_ms / 1000).toFixed(1) + 's');
if (inn) parts.push('输入 ' + fmt(inn) + ' tok' + (inn ? '（缓存 ' + Math.round(ca / inn * 100) + '%）' : ''));
if (gen) parts.push('生成 ' + fmt(gen) + ' tok');
parts.push(ok.length + ' 次请求' + (fail ? '（失败 ' + fail + '）' : ''));
if (wallSec >= 1) parts.push('本轮 ' + wallSec + 's');
// 会话累计（当前会话全部历史）
try {
  const db3 = new DatabaseSync(DB, { readOnly: true });
  if (sid) {
    const acc = db3.prepare(`SELECT COALESCE(sum(output_tokens+reasoning_tokens),0) AS g FROM model_usage WHERE session_id = ?`).get(sid);
    if (acc && acc.g > 0) parts.push('会话累计 ' + fmt(acc.g) + ' tok');
  }
} catch (e) {}

console.log('本轮用量：' + parts.join(' · '));
