#!/usr/bin/env node
// 多厂商配额聚合（全部可选，未配置 Key 的厂商直接跳过，不占输出）。
// 隐私边界：每个厂商的 Key 只发送到该厂商自己的官方域名，仅只读查询，无遥测；
// 凭据解析顺序：环境变量 ZCODE_USAGE_<VENDOR>_KEY → ~/.zcode/usage-vendors.json。
// 输出（stdout JSON）：
//   { ok, vendors: [{ id, name, ok, items: [{ label, pct?, text?, resets? }], error?, stale? }] }
// GLM 走既有 quota.mjs（含客户端日志零密钥来源）；其余厂商为纯 API 查询。
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function credsFile() {
  try { return JSON.parse(String(fs.readFileSync(path.join(os.homedir(), '.zcode', 'usage-vendors.json'), 'utf8')).replace(/^\uFEFF/, '')) || {}; } catch (e) { return {}; }
}
function keyFor(vendor, envName) {
  if (process.env[envName]) return process.env[envName];
  const c = credsFile();
  return (c[vendor] && (c[vendor].key || c[vendor].token)) || '';
}

function getJSON(url, headers, timeout = 15000) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json', ...headers }, timeout }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ' ' + body.slice(0, 120))); return; }
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('响应解析失败')); }
      });
    }).on('timeout', function () { this.destroy(new Error('请求超时')); }).on('error', reject);
  });
}

const fmtDate = (s) => (s ? String(s) : null);

// DeepSeek：无窗口概念，官方余额接口（余量文本展示）
async function queryDeepseek(key) {
  const j = await getJSON('https://api.deepseek.com/user/balance', { Authorization: 'Bearer ' + key });
  const b = (j.balance_infos || [])[0] || {};
  return {
    id: 'deepseek', name: 'DeepSeek', ok: true,
    items: [{ label: '余额（' + (b.currency || 'CNY') + '）', text: b.total_balance != null ? b.total_balance : '未知' }],
  };
}

// Kimi（Moonshot）：5 小时滚动窗 + 周窗口
async function queryKimi(key) {
  const j = await getJSON('https://api.kimi.com/coding/v1/usages', { Authorization: 'Bearer ' + key });
  const items = [];
  for (const l of j.limits || []) {
    const used = Number(l.used || 0), lim = Number(l.limit || 0);
    if (!lim) continue;
    const pct = Math.round((used / lim) * 100);
    items.push({ label: l.window || '滚动窗口', pct, resets: fmtDate(l.reset_time) });
  }
  const u = j.usage || {};
  const wUsed = Number(u.used || 0), wLim = Number(u.limit || 0);
  if (wLim) {
    const rem = u.remaining != null ? Number(u.remaining) : Math.max(0, wLim - wUsed);
    items.push({ label: '本周', pct: Math.round((wUsed / wLim) * 100), resets: fmtDate(u.reset_time) });
  }
  if (!items.length) throw new Error('响应中无窗口数据');
  return { id: 'kimi', name: 'Kimi Code', ok: true, items };
}

// OpenRouter：预付额度与当月消费
async function queryOpenrouter(key) {
  const j = await getJSON('https://openrouter.ai/api/v1/credits', { Authorization: 'Bearer ' + key });
  const d = j.data || {};
  const total = Number(d.total_credits || 0), used = Number(d.total_usage || 0);
  if (!total) throw new Error('无额度数据');
  return {
    id: 'openrouter', name: 'OpenRouter', ok: true,
    items: [{ label: '已用额度', pct: Math.round((used / total) * 100), text: '$' + used.toFixed(2) + ' / $' + total.toFixed(2) }],
  };
}

// MiniMax：Token Plan 的 5h/周窗口（count 比率优先，否则 remaining_percent 推导）
async function queryMinimax(key) {
  const j = await getJSON('https://api.minimaxi.com/v1/token_plan/remains?apiKey=' + encodeURIComponent(key));
  const items = [];
  for (const [k, v] of Object.entries(j || {})) {
    if (!v || typeof v !== 'object') continue;
    if (v.current_total_count > 0 && v.current_used_count != null) {
      items.push({ label: k, pct: Math.round((v.current_used_count / v.current_total_count) * 100) });
    } else if (v.current_remaining_percent != null) {
      items.push({ label: k, pct: Math.round(100 - Number(v.current_remaining_percent)) });
    }
  }
  if (!items.length) throw new Error('响应中无窗口数据');
  return { id: 'minimax', name: 'MiniMax', ok: true, items };
}

// GLM：复用既有 quota.mjs（客户端日志零密钥来源 + 智谱监控接口）
function queryGlm() {
  try {
    const out = execFileSync(process.execPath, [path.join(HERE, 'quota.mjs')], { encoding: 'utf8', timeout: 25000 });
    const j = JSON.parse(out);
    return {
      id: 'glm', name: 'GLM Coding Plan', ok: true, stale: !!j.stale,
      items: (j.limits || []).map((l) => ({ label: l.type || '配额', pct: Math.max(0, Math.min(100, Math.round(l.percentage || 0))), resets: fmtDate(l.resetTime) })),
    };
  } catch (e) {
    let msg = (e.message || e) + '';
    try { msg = JSON.parse((e.stdout || e.stderr || '')).error || msg; } catch (e2) {}
    return { id: 'glm', name: 'GLM Coding Plan', ok: false, error: msg.slice(0, 160) };
  }
}

const VENDORS = [
  { id: 'glm', env: 'ZCODE_USAGE_QUOTA_TOKEN', always: true, run: () => queryGlm() }, // GLM 恒查（零密钥日志源也可能有数据）
  { id: 'deepseek', env: 'ZCODE_USAGE_DEEPSEEK_KEY', run: (k) => queryDeepseek(k) },
  { id: 'kimi', env: 'ZCODE_USAGE_KIMI_KEY', run: (k) => queryKimi(k) },
  { id: 'openrouter', env: 'ZCODE_USAGE_OPENROUTER_KEY', run: (k) => queryOpenrouter(k) },
  { id: 'minimax', env: 'ZCODE_USAGE_MINIMAX_KEY', run: (k) => queryMinimax(k) },
];

export async function queryAllVendors() {
  const results = await Promise.allSettled(VENDORS.map(async (v) => {
    if (v.id !== 'glm' && !keyFor(v.id, v.env)) return null; // 未配置的可选厂商跳过
    try {
      return await v.run(keyFor(v.id, v.env));
    } catch (e) {
      return { id: v.id, name: v.id, ok: false, error: ((e && e.message) || e + '').slice(0, 160) };
    }
  }));
  const vendors = results.map((r) => r.value).filter(Boolean);
  return { ok: vendors.some((v) => v.ok), vendors, generatedAt: new Date().toISOString() };
}

// CLI 直跑：node vendor-quota.mjs（调试用）
if (process.argv[1] && process.argv[1].endsWith('vendor-quota.mjs') && process.argv[2] !== '--as-module') {
  queryAllVendors().then((j) => console.log(JSON.stringify(j, null, 2))).catch((e) => { console.error(JSON.stringify({ error: (e && e.message) || e + '' })); process.exit(1); });
}
