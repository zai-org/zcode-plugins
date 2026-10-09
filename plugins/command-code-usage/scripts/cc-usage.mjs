#!/usr/bin/env node
/**
 * Command Code 额度面板
 *
 * 读取 Command Code（GOAT / Pro / Max ...）订阅的实时额度：
 *   5 小时滚动窗口、每周滚动窗口、月度 credits、本周期用量统计。
 *
 * 用法：
 *   node cc-usage.mjs                      终端仪表盘
 *   node cc-usage.mjs --compact            单行摘要（适合塞进提示）
 *   node cc-usage.mjs --json               归一化 JSON
 *   node cc-usage.mjs --html               生成本地 HTML 面板
 *   node cc-usage.mjs --html --open        生成并自动打开浏览器
 *   node cc-usage.mjs --serve              启动实时面板（默认 8787 端口）
 *   node cc-usage.mjs --demo              用内置样例数据预览外观（不联网）
 *   node cc-usage.mjs --verbose            附带凭证来源等诊断信息
 *
 * 选项：--no-color  --org <orgId>  --port <n>  --out <file>
 *
 * 凭证来源（按顺序）：
 *   1. 环境变量 COMMAND_CODE_API_KEY / CMD_API_KEY / COMMANDCODE_API_KEY
 *   2. ~/.commandcode/auth.json        （Command Code CLI 登录后的凭证）
 *   3. ~/.zcode/v2/provider_config.json（ZCode 里配置的 provider，自动匹配 baseUrl）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { exec } from 'node:child_process';

const VERSION = '1.1.0';
const DEFAULT_API_BASE = 'https://api.commandcode.ai';
const PROVIDER_MATCH = /commandcode\.ai/i;

/* ------------------------------------------------------------------ 套餐表 */

// 来源：Command Code 官方 docs/resources/usage-limits 与 CLI 内置计划表。
const PLANS = {
  'individual-go': { name: 'Go', monthly: 10, fiveHour: 3, weekly: 6 },
  'individual-goat': { name: 'GOAT', monthly: 70, fiveHour: 14, weekly: 35 },
  'individual-pro': { name: 'Pro', monthly: 30, fiveHour: 16, weekly: 40 },
  'individual-pro-v1': { name: 'Pro', monthly: 80, fiveHour: 16, weekly: 40 },
  'individual-provider': { name: 'Provider', monthly: 15, fiveHour: null, weekly: null },
  'individual-max': { name: 'Max 10x', monthly: 150, fiveHour: 45, weekly: 90 },
  'individual-ultra': { name: 'Max 20x', monthly: 300, fiveHour: 90, weekly: 180 },
  'teams-pro': { name: 'Teams Pro', monthly: 40, fiveHour: 12, weekly: 24 },
};

function planInfo(planId) {
  if (!planId || typeof planId !== 'string') return null;
  const norm = planId.toLowerCase().replace(/_/g, '-');
  const hit = Object.keys(PLANS)
    .sort((a, b) => b.length - a.length)
    .find((k) => norm.startsWith(k));
  if (!hit) return null;
  return { id: planId, ...PLANS[hit] };
}

/* -------------------------------------------------------------------- 参数 */

function parseArgs(argv) {
  const out = {
    mode: 'terminal',
    color: true,
    open: false,
    port: 8787,
    org: undefined,
    outFile: undefined,
    verbose: false,
    demo: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.mode = 'json';
    else if (a === '--md' || a === '--markdown') out.mode = 'md';
    else if (a === '--compact') out.mode = 'compact';
    else if (a === '--html') out.mode = 'html';
    else if (a === '--serve') out.mode = 'serve';
    else if (a === '--watch') out.mode = 'watch';
    else if (a === '--open') out.open = true;
    else if (a === '--no-color') out.color = false;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--demo') {
      out.demo = true;
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        out.demoScenario = next;
        i++;
      }
    }
    else if (a === '--org') out.org = argv[++i];
    else if (a === '--from-json') out.fromJson = argv[++i];
    else if (a === '--at') out.at = argv[++i];
    else if (a === '--port') out.port = Number(argv[++i]) || 8787;
    else if (a === '--out') out.outFile = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  if (process.env.NO_COLOR !== undefined) out.color = false;
  if (!process.stdout.isTTY) out.color = false;
  return out;
}

const HELP = `Command Code 额度面板 v${VERSION}

  node cc-usage.mjs                     终端面板（默认，聊天/终端里都能看）
  node cc-usage.mjs --md                表格形式，适配聊天里的 Markdown 渲染
  node cc-usage.mjs --compact           单行摘要
  node cc-usage.mjs --json              归一化 JSON
  node cc-usage.mjs --watch             终端里持续刷新（每 60s）
  node cc-usage.mjs --demo hot          用量吃紧的样例（预览告警长什么样）
  node cc-usage.mjs --from-json <文件>  渲染离线快照（配 --json 存下来的原始响应）
  node cc-usage.mjs --verbose           附带诊断信息
  node cc-usage.mjs --org <orgId>       指定组织

可选（想看大图时才用，平时用不到）：
  node cc-usage.mjs --html [--open]     生成本地 HTML 面板
  node cc-usage.mjs --serve [--port n]  实时面板（浏览器每 30s 刷新）
`;

/* ------------------------------------------------------------------ 凭证 */

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 在任意 JSON 结构里找出 "access.apiKey + api.baseUrl" 形状且 baseUrl 指向 Command Code 的条目。 */
function scanForProviderKey(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = scanForProviderKey(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const baseUrl = node?.api?.baseUrl;
  const apiKey = node?.access?.apiKey;
  if (typeof apiKey === 'string' && apiKey.trim() && typeof baseUrl === 'string' && PROVIDER_MATCH.test(baseUrl)) {
    return { apiKey: apiKey.trim(), baseUrl: baseUrl.trim() };
  }
  for (const value of Object.values(node)) {
    const hit = scanForProviderKey(value, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function resolveCredentials() {
  const envKeys = ['COMMAND_CODE_API_KEY', 'CMD_API_KEY', 'COMMANDCODE_API_KEY'];
  for (const name of envKeys) {
    const v = process.env[name];
    if (v && v.trim()) return { apiKey: v.trim(), source: `环境变量 ${name}` };
  }

  const home = os.homedir();
  const cliAuth = path.join(home, '.commandcode', 'auth.json');
  const cliDoc = readJsonSafe(cliAuth);
  if (cliDoc && typeof cliDoc.apiKey === 'string' && cliDoc.apiKey.trim()) {
    const who = cliDoc.userName ? `（${cliDoc.userName}）` : '';
    return { apiKey: cliDoc.apiKey.trim(), source: `~/.commandcode/auth.json${who}` };
  }

  const zcodeCfg = path.join(home, '.zcode', 'v2', 'provider_config.json');
  const zcodeDoc = readJsonSafe(zcodeCfg);
  const hit = zcodeDoc ? scanForProviderKey(zcodeDoc) : null;
  if (hit) {
    return {
      apiKey: hit.apiKey,
      apiBase: hit.baseUrl.replace(/\/provider\/v\d+\/?$/, ''),
      source: `ZCode provider 配置（${hit.baseUrl}）`,
    };
  }

  return null;
}

function maskKey(key) {
  if (!key) return '(none)';
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/* -------------------------------------------------------------------- 取数 */

async function apiGet(baseUrl, apiKey, route, query = {}, timeoutMs = 15000) {
  const url = new URL(route, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': `zcode-cc-usage/${VERSION}`,
      },
      signal: ac.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (!res.ok) {
      const detail = body?.error?.message || body?.message || text.slice(0, 200) || res.statusText;
      const err = new Error(`${route} → HTTP ${res.status}: ${detail}`);
      err.status = res.status;
      throw err;
    }
    if (!body || typeof body !== 'object') throw new Error(`${route} 返回了非 JSON 内容`);
    return body;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`${route} 请求超时（${timeoutMs}ms）`);
    if (err instanceof TypeError) throw new Error(`${route} 网络不可达（${err.message}）`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 单项取数失败不致命：记下错误，其余数据照常展示。 */
async function soft(promise, fallback = null) {
  try {
    return { data: await promise, error: null };
  } catch (err) {
    return { data: fallback, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 同一原因命中多个端点时合并成一行，避免把同一句报错重复四遍。 */
function groupErrors(list) {
  const groups = new Map();
  for (const raw of list) {
    if (!raw) continue;
    const m = /^(\S+)\s*→\s*([\s\S]+)$/.exec(raw);
    const route = m ? m[1] : null;
    const rest = m ? m[2] : raw;
    if (!groups.has(rest)) groups.set(rest, []);
    if (route) groups.get(rest).push(route);
  }
  return [...groups].map(([rest, routes]) =>
    routes.length > 1 ? `${rest}（${routes.join('、')}）` : routes.length === 1 ? `${routes[0]} → ${rest}` : rest,
  );
}

async function collectUsage({ apiKey, apiBase, orgId }) {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  const scoped = orgId ? { orgId } : {};

  const whoamiRes = await soft(apiGet(base, apiKey, '/alpha/whoami', { limits: '1' }));
  const effectiveOrg = orgId || whoamiRes.data?.org?.id || undefined;

  const [creditsRes, subRes] = await Promise.all([
    soft(apiGet(base, apiKey, '/alpha/billing/credits', { orgId: effectiveOrg })),
    soft(apiGet(base, apiKey, '/alpha/billing/subscriptions', { orgId: effectiveOrg })),
  ]);

  const since = subRes.data?.data?.currentPeriodStart;
  const summaryRes = await soft(apiGet(base, apiKey, '/alpha/usage/summary', { ...(effectiveOrg ? { orgId: effectiveOrg } : {}), since }));

  const errors = groupErrors([whoamiRes.error, creditsRes.error, subRes.error, summaryRes.error]);
  if (!whoamiRes.data && !creditsRes.data && !subRes.data) {
    throw new Error(`无法读取 Command Code 额度：\n  - ${errors.join('\n  - ')}`);
  }

  return {
    whoami: whoamiRes.data,
    credits: creditsRes.data,
    subscription: subRes.data,
    summary: summaryRes.data,
    errors,
  };
}

/* -------------------------------------------------------------- 归一化视图 */

function normalize(raw, meta) {
  const now = meta.now ?? Date.now();
  const sub = raw.subscription?.data ?? null;
  const plan = planInfo(sub?.planId);
  const c = raw.credits?.credits ?? {};
  const wl = raw.credits?.windowLimits ?? null;
  const summary = raw.summary ?? {};

  const monthlyRemaining = Math.max(0, Number(c.monthlyCredits) || 0);
  const purchasedRemaining = Math.max(0, Number(c.purchasedCredits) || 0);
  const freeRemaining = Math.max(0, Number(c.freeCredits) || 0);
  const totalRemaining = monthlyRemaining + purchasedRemaining + freeRemaining;
  const totalSpent = Math.max(0, Number(summary.totalCost) || 0);

  // 与 Command Code CLI 的 projectUsageView 保持一致：
  // 订阅有效时用套餐面额作分母，否则退回「已花 + 剩余」。
  const active = sub?.status === 'active';
  const planMonthly = active && plan ? plan.monthly : null;
  const totalPool = planMonthly !== null ? Math.max(planMonthly, monthlyRemaining) + purchasedRemaining + freeRemaining : totalSpent + totalRemaining;
  const monthlyUsed = Math.max(0, totalPool - totalRemaining);

  const window = (spec, fallbackCap) => {
    if (!spec) return null;
    const used = Math.max(0, Number(spec.used) || 0);
    const cap = Number(spec.cap) || fallbackCap || 0;
    const resetAt = Number(spec.resetAt) || null;
    const started = used > 0 || (resetAt !== null && resetAt > now);
    return {
      used,
      cap,
      percent: cap > 0 ? Math.min((used / cap) * 100, 100) : 0,
      rawPercent: cap > 0 ? (used / cap) * 100 : 0,
      remaining: Math.max(0, cap - used),
      resetAt,
      resetsInMs: resetAt !== null ? Math.max(0, resetAt - now) : null,
      exceeded: Boolean(spec.exceeded),
      started,
    };
  };

  const periodEnd = sub?.currentPeriodEnd ? Date.parse(sub.currentPeriodEnd) : null;
  const fiveHour = window(wl?.fiveHour, plan?.fiveHour);
  const weekly = window(wl?.weekly, plan?.weekly);

  // 用户实际要回答的是两个问题：还能跑多少、会不会在重置前用完。
  // 次数只能按「他自己这个周期的均单价」估——Command Code 的额度单位是美元价值，
  // 换模型就换单价，所以这里必须说明估算基准，不能当成承诺。
  const avgCostPerRequest = Number(summary.averageCost) > 0 ? Number(summary.averageCost) : null;
  const requestsLeft = (usd) =>
    avgCostPerRequest && usd > 0 ? Math.floor(usd / avgCostPerRequest) : null;

  // 速度外推只在样本占窗口足够比例时才成立：刚开窗口时的一波用量代表不了整周，
  // 拿 1 小时的速度去推 7 天只会误报「要超限了」。所以不足 5% 就不给结论。
  const pace = (w, windowMs, startMs) => {
    if (!w || !w.started || !w.resetAt || !(windowMs > 0)) return null;
    const startedAt = startMs ?? w.resetAt - windowMs;
    const elapsed = now - startedAt;
    const minSample = Math.max(10 * 60_000, windowMs * 0.05);
    if (!(elapsed >= minSample)) return null;
    const ratePerMs = w.used / elapsed;
    if (!(ratePerMs > 0)) return null;
    const remainingMs = Math.max(0, w.resetAt - now);
    const projected = w.used + ratePerMs * remainingMs;
    return {
      sampleMs: elapsed,
      ratePerHour: ratePerMs * 3600_000,
      projected,
      willExceed: projected > w.cap,
      exhaustInMs: Math.max(0, (w.cap - w.used) / ratePerMs),
    };
  };

  const periodStartMs = sub?.currentPeriodStart ? Date.parse(sub.currentPeriodStart) : null;
  const periodMs = periodStartMs && periodEnd ? periodEnd - periodStartMs : 0;

  return {
    fetchedAt: now,
    apiBase: meta.apiBase,
    credentialSource: meta.credentialSource,
    account: {
      userName: raw.whoami?.user?.userName ?? null,
      name: raw.whoami?.user?.name ?? null,
      email: raw.whoami?.user?.email ?? null,
      userId: raw.whoami?.user?.id ?? null,
      org: raw.whoami?.org ?? null,
    },
    orgLimits: Array.isArray(raw.whoami?.orgLimits) ? raw.whoami.orgLimits : [],
    plan: plan
      ? {
          id: plan.id,
          name: plan.name,
          monthlyTotal: plan.monthly,
          status: sub?.status ?? null,
          active,
          currentPeriodStart: sub?.currentPeriodStart ?? null,
          currentPeriodEnd: sub?.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: Boolean(sub?.cancelAtPeriodEnd),
          daysLeft: periodEnd !== null ? Math.max(0, Math.ceil((periodEnd - now) / 86400000)) : null,
        }
      : sub
        ? {
            // 套餐表里没有这个 planId（Command Code 新套餐 / 企业套餐）：
            // 不编月度面额，窗口 cap 仍以接口返回为准。
            id: sub.planId ?? 'unknown',
            name: sub.planId ?? '未知套餐',
            monthlyTotal: null,
            status: sub.status ?? null,
            active,
            currentPeriodStart: sub.currentPeriodStart ?? null,
            currentPeriodEnd: sub.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
            daysLeft: periodEnd !== null ? Math.max(0, Math.ceil((periodEnd - now) / 86400000)) : null,
          }
        : null,
    monthly: {
      used: monthlyUsed,
      total: totalPool,
      remaining: totalRemaining,
      planRemaining: monthlyRemaining,
      purchasedRemaining,
      freeRemaining,
      percent: totalPool > 0 ? Math.min((monthlyUsed / totalPool) * 100, 100) : 0,
      rawPercent: totalPool > 0 ? (monthlyUsed / totalPool) * 100 : 0,
      belowThreshold: Boolean(c.belowThreshold),
      creditThreshold: Number(c.creditThreshold) || 0,
    },
    windows: {
      limited: wl ? Boolean(wl.limited) : null,
      fiveHour,
      weekly,
    },
    estimate: {
      avgCostPerRequest,
      requestsLeft: {
        fiveHour: fiveHour ? requestsLeft(fiveHour.remaining) : null,
        weekly: weekly ? requestsLeft(weekly.remaining) : null,
        monthly: requestsLeft(totalRemaining),
      },
      pace: {
        fiveHour: pace(fiveHour, 5 * 3600_000),
        weekly: pace(weekly, 7 * 86400_000),
        monthly:
          periodStartMs && periodMs > 0
            ? pace(
                { started: true, used: monthlyUsed, cap: totalPool, resetAt: periodEnd },
                periodMs,
                periodStartMs,
              )
            : null,
      },
    },
    summary: {
      requests: Number(summary.totalCount) || 0,
      completed: Number(summary.completedCount) || 0,
      failed: Number(summary.failedCount) || 0,
      successRate: summary.successRate === undefined ? null : Number(summary.successRate),
      totalCost: totalSpent,
      averageCost: Number(summary.averageCost) || 0,
      tokensIn: Number(summary.totalTokensIn) || 0,
      tokensOut: Number(summary.totalTokensOut) || 0,
      tokens: Number(summary.totalTokens) || 0,
      periodBasis: summary.periodBasis ?? null,
    },
    errors: raw.errors ?? [],
    // 原始响应一并带上：--json 的输出因此是自洽快照，可用 --from-json 离线重放。
    raw: {
      whoami: raw.whoami ?? null,
      credits: raw.credits ?? null,
      subscription: raw.subscription ?? null,
      summary: raw.summary ?? null,
    },
  };
}

/* -------------------------------------------------------------- 格式化工具 */

function isWide(cp) {
  return (
    cp >= 0x1100 &&
    (cp <= 0x115f ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x3fffd))
  );
}

function displayWidth(str) {
  let w = 0;
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x20e3) continue;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

function padEndW(str, width) {
  const s = String(str);
  const diff = width - displayWidth(s);
  return diff > 0 ? s + ' '.repeat(diff) : s;
}

function truncateW(str, width) {
  let out = '';
  let w = 0;
  for (const ch of String(str)) {
    const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
    if (w + cw > width) break;
    out += ch;
    w += cw;
  }
  return out;
}

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const money4 = (n) => `$${(Number(n) || 0).toFixed(4)}`;

function tokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

function duration(ms) {
  if (ms === null || ms === undefined) return '—';
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function clock(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function timeOnly(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function bar(percent, width = 24) {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function severity(p, exceeded) {
  if (exceeded || p >= 100) return 'critical';
  if (p >= 80) return 'high';
  if (p >= 50) return 'medium';
  return 'low';
}

function makeColors(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return {
    dim: wrap(2),
    bold: wrap(1),
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    blue: wrap(34),
    magenta: wrap(35),
    cyan: wrap(36),
    gray: wrap(90),
  };
}

function sevColor(c, level, text) {
  if (level === 'critical') return c.red(c.bold(text));
  if (level === 'high') return c.red(text);
  if (level === 'medium') return c.yellow(text);
  return c.green(text);
}

/* ------------------------------------------------------------ 终端渲染 */

/** 组织级消费限额的字段名没有公开 schema，只认能识别的形状，认不出就不显示（不编造）。 */
function describeOrgLimit(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const num = (...keys) => {
    for (const k of keys) {
      const v = Number(entry[k]);
      if (Number.isFinite(v)) return v;
    }
    return null;
  };
  const spent = num('spent', 'used', 'consumed', 'usedUsd', 'spentUsd');
  const limit = num('limit', 'cap', 'max', 'amountUsd', 'limitUsd', 'capUsd');
  if (spent === null || limit === null || limit <= 0) return null;
  const resetAt = num('resetAt', 'resetsAt', 'periodEnd');
  // 模型维度的限额常带 "vendor:model" 前缀，显示时只留模型名。
  const rawLabel = String(entry.scope ?? entry.model ?? entry.name ?? entry.type ?? '组织限额');
  const label = rawLabel.includes(':') ? rawLabel.slice(rawLabel.lastIndexOf(':') + 1) : rawLabel;
  return {
    label,
    spent,
    limit,
    percent: Math.min((spent / limit) * 100, 100),
    resetAt: resetAt && resetAt > 1e11 ? resetAt : null,
  };
}

/** 账号形态不同，同一行数据的叫法也该不同：订阅额度 / 推算额度 / 纯余额。 */
function balancePresentation(view) {
  const p = view.plan;
  if (p?.active && p.monthlyTotal !== null && p.monthlyTotal !== undefined) {
    return { label: '月度额度', showBar: true, note: '月度额度已用' };
  }
  if (p?.active) {
    // 订阅有效但套餐面额未知（新套餐/企业套餐），分母是推算出来的，明说。
    return { label: '额度', showBar: true, note: '总额度按「已花 + 剩余」推算，仅供参考' };
  }
  // 没有有效订阅：这是余额，不是额度，不该套百分比。
  return { label: '余额', showBar: false, note: null };
}

const count = (n) => (n === null || n === undefined ? null : n.toLocaleString('en-US'));

/** 「还能跑多少次」这一句的措辞要与估算基准绑定，换模型就不再成立。 */
function estimateLine(view, monthlyLabel = '本月') {
  const e = view.estimate;
  if (!e?.avgCostPerRequest) return null;
  const parts = [];
  const add = (label, n) => {
    if (n !== null && n !== undefined) parts.push(`${label} ≈ ${count(n)} 次`);
  };
  add('5 小时窗口', e.requestsLeft.fiveHour);
  add('本周', e.requestsLeft.weekly);
  add(monthlyLabel, e.requestsLeft.monthly);
  if (!parts.length) return null;
  return `按本周期均单价 ${money4(e.avgCostPerRequest)} 估算还能跑：${parts.join(' · ')}`;
}

/** 按当前消耗速度，这个窗口会不会在重置之前就撞上限。 */
function paceWarning(label, w, p) {
  if (!w || !p || !p.willExceed) return null;
  return `⚠ 按当前速度（${money(p.ratePerHour)}/小时），${label}会在重置前用完，约 ${duration(p.exhaustInMs)} 后耗尽`;
}

function renderTerminal(view, opts = {}) {
  const c = makeColors(opts.color !== false);
  const W = 74;
  const lines = [];

  const planName = view.plan?.name ?? '按量计费';
  const stamp = clock(view.fetchedAt);
  const days = view.plan?.daysLeft;
  const stampFull = days !== null && days !== undefined ? `${stamp} · 周期剩 ${days} 天` : stamp;
  const title = `Command Code · ${planName}`;
  lines.push(`${c.bold(c.magenta(title))}${' '.repeat(Math.max(1, W - displayWidth(title) - displayWidth(stampFull)))}${c.gray(stampFull)}`);
  lines.push(c.gray('─'.repeat(W)));

  const acct = [view.account.userName, view.account.email && `<${view.account.email}>`].filter(Boolean).join(' ');
  lines.push(`${c.gray('账号')}  ${acct || '—'}`);
  if (view.plan && !view.plan.active) {
    lines.push(`${c.gray('状态')}  ${c.yellow(`订阅${view.plan.status ? ` ${view.plan.status}` : ''}，额度按接口返回的窗口计算`)}`);
  }

  lines.push('');

  // 按量计费 / 企业池：没有滚动窗口，只有余额，不要硬套两个窗口行。
  const noWindows = view.windows.limited === false;
  if (noWindows) {
    lines.push(c.gray('该账号没有滚动窗口限制（按量计费或企业池），只看余额。'));
  }

  const row = (label, w) => {
    if (!w) return;
    const level = severity(w.percent, w.exceeded);
    lines.push(
      `${c.bold(padEndW(label, 12))}${sevColor(c, level, bar(w.percent, 24))}${sevColor(c, level, `${w.percent.toFixed(1)}%`.padStart(7))}  ${`${money(w.used)} / ${money(w.cap)}`.padStart(16)}`,
    );
    let foot;
    if (!w.started) foot = c.gray('窗口未开启（发起第一次请求后开始计时）');
    else foot = c.gray(`重置 ${timeOnly(w.resetAt)} · ${duration(w.resetsInMs)} 后`);
    if (w.exceeded) foot += '  ' + c.red(c.bold('已超限'));
    lines.push(`${' '.repeat(12)}${foot}`);
  };

  row('5 小时窗口', noWindows ? null : view.windows.fiveHour);
  row('每周窗口', noWindows ? null : view.windows.weekly);

  const m = view.monthly;
  const bp = balancePresentation(view);
  const mLevel = severity(m.percent, m.belowThreshold);
  if (bp.showBar) {
    lines.push(
      `${c.bold(padEndW(bp.label, 12))}${sevColor(c, mLevel, bar(m.percent, 24))}${sevColor(c, mLevel, `${m.percent.toFixed(1)}%`.padStart(7))}  ${`${money(m.used)} / ${money(m.total)}`.padStart(16)}`,
    );
    const mExtra = [`剩 ${money(m.remaining)}`];
    if (m.purchasedRemaining > 0) mExtra.push(`含额外额度 ${money(m.purchasedRemaining)}`);
    if (m.freeRemaining > 0) mExtra.push(`赠额 ${money(m.freeRemaining)}`);
    if (m.belowThreshold) mExtra.push(c.red('已低于预警阈值'));
    lines.push(`${' '.repeat(12)}${c.gray(mExtra.join(' · '))}`);
  } else {
    lines.push(`${c.bold(padEndW(bp.label, 12))}${c.green(money(m.remaining))}`);
    const mExtra = [];
    if (m.purchasedRemaining > 0) mExtra.push(`额外额度 ${money(m.purchasedRemaining)}`);
    if (m.freeRemaining > 0) mExtra.push(`赠额 ${money(m.freeRemaining)}`);
    if (m.creditThreshold > 0) mExtra.push(`预警线 ${money(m.creditThreshold)}`);
    if (m.belowThreshold) mExtra.push(c.red('已低于预警阈值'));
    if (mExtra.length) lines.push(`${' '.repeat(12)}${c.gray(mExtra.join(' · '))}`);
  }
  if (bp.note && bp.showBar && view.plan?.monthlyTotal === null) {
    lines.push(`${' '.repeat(12)}${c.gray(bp.note)}`);
  }

  // 组织级消费限额：字段名无公开 schema，认不出的条目直接跳过。
  for (const raw of view.orgLimits ?? []) {
    const l = describeOrgLimit(raw);
    if (!l) continue;
    const level = severity(l.percent, false);
    lines.push(
      `${c.bold(padEndW(truncateW(l.label, 14), 14))}${sevColor(c, level, bar(l.percent, 22))}${sevColor(c, level, `${l.percent.toFixed(1)}%`.padStart(7))}  ${`${money(l.spent)} / ${money(l.limit)}`.padStart(16)}`,
    );
    if (l.resetAt) lines.push(`${' '.repeat(14)}${c.gray(`重置 ${clock(l.resetAt)}`)}`);
  }

  lines.push('');
  const s = view.summary;
  if (s.requests > 0) {
    const parts = [
      `${s.requests} 次请求`,
      s.successRate !== null ? `成功率 ${s.successRate}%` : null,
      `入 ${tokens(s.tokensIn)} / 出 ${tokens(s.tokensOut)} tokens`,
    ].filter(Boolean);
    lines.push(`${c.gray('本周期')}  ${parts.join(' · ')}`);
  } else {
    lines.push(`${c.gray('本周期')}  暂无请求记录`);
  }

  const est = estimateLine(view, bp.showBar ? '本月' : '余额');
  if (est) {
    lines.push(`${c.gray('预估')}  ${est}`);
    lines.push(c.gray('（估算基于你本周期的实际模型组合；换更贵的模型，次数会明显变少）'));
  } else if (s.requests === 0) {
    lines.push(c.gray('预估  本周期还没有请求记录，暂时无法估算次数'));
  }

  const warns = [
    paceWarning('5 小时窗口', view.windows.fiveHour, view.estimate?.pace?.fiveHour),
    paceWarning('每周窗口', view.windows.weekly, view.estimate?.pace?.weekly),
  ].filter(Boolean);
  for (const w of warns) lines.push(c.yellow(w));

  if (opts.verbose) {
    lines.push('');
    lines.push(c.gray(`接口 ${view.apiBase} · 凭证来源 ${view.credentialSource}`));
  }
  if (view.errors?.length) {
    lines.push('');
    for (const e of view.errors) lines.push(c.yellow(`⚠ ${e}`));
  }

  return lines.join('\n');
}

/* --------------------------------------------------------- 聊天渲染（Markdown） */

function renderMarkdown(view) {
  const out = [];
  const planName = view.plan?.name ?? '按量计费';
  out.push(`**Command Code · ${planName}**　${clock(view.fetchedAt)}`);

  const meta = [];
  if (view.account.userName) meta.push(`账号 \`${view.account.userName}\``);
  if (view.plan?.id) meta.push(`套餐 \`${view.plan.id}\``);
  if (view.plan?.daysLeft !== null && view.plan?.daysLeft !== undefined) meta.push(`周期剩 ${view.plan.daysLeft} 天`);
  if (meta.length) out.push(meta.join(' · '));

  const rows = [];
  const push = (label, used, cap, percent, note) => {
    rows.push(`| ${label} | ${percent.toFixed(1)}% | $${used.toFixed(2)} / $${cap.toFixed(2)} | ${note} |`);
  };
  const noWindows = view.windows.limited === false;
  const noteOf = (w) => (w.exceeded ? '**已超限**' : !w.started ? '未开启' : `${duration(w.resetsInMs)} 后重置`);

  if (!noWindows) {
    const w5 = view.windows.fiveHour;
    const wk = view.windows.weekly;
    if (w5) push('5 小时窗口', w5.used, w5.cap, w5.percent, noteOf(w5));
    if (wk) push('每周窗口', wk.used, wk.cap, wk.percent, noteOf(wk));
  }
  const m = view.monthly;
  const bp = balancePresentation(view);
  if (bp.showBar) {
    push(bp.label, m.used, m.total, m.percent, `剩 $${m.remaining.toFixed(2)}${m.belowThreshold ? ' · **低于阈值**' : ''}`);
  } else {
    rows.push(`| ${bp.label} | — | $${m.remaining.toFixed(2)} | ${m.belowThreshold ? '**低于预警线**' : '可用'}${
      m.creditThreshold > 0 ? ` · 预警线 $${m.creditThreshold.toFixed(2)}` : ''
    } |`);
  }
  for (const raw of view.orgLimits ?? []) {
    const l = describeOrgLimit(raw);
    if (!l) continue;
    rows.push(`| ${l.label} | ${l.percent.toFixed(1)}% | $${l.spent.toFixed(2)} / $${l.limit.toFixed(2)} | ${l.resetAt ? `${clock(l.resetAt)} 重置` : '组织限额'} |`);
  }

  out.push('');
  out.push('| 额度 | 已用 | 用量 | 说明 |');
  out.push('| --- | ---: | ---: | --- |');
  out.push(...rows);

  if (noWindows) out.push('');
  if (noWindows) out.push('_该账号没有滚动窗口限制（按量计费或企业池），只看余额。_');

  const est = estimateLine(view, bp.showBar ? '本月' : '余额');
  if (est) {
    out.push('');
    out.push(est);
    out.push('_估算基于你本周期的实际模型组合；换更贵的模型，次数会明显变少。_');
  }

  const warns = [
    paceWarning('5 小时窗口', view.windows.fiveHour, view.estimate?.pace?.fiveHour),
    paceWarning('每周窗口', view.windows.weekly, view.estimate?.pace?.weekly),
  ].filter(Boolean);
  for (const w of warns) {
    out.push('');
    out.push(w);
  }

  const s = view.summary;
  if (s.requests > 0) {
    out.push('');
    out.push(
      `本周期 ${s.requests} 次请求 · 成功率 ${s.successRate ?? '—'}% · 入 ${tokens(s.tokensIn)} / 出 ${tokens(s.tokensOut)} tokens`,
    );
  } else {
    out.push('');
    out.push('_本周期还没有请求记录，暂时无法估算次数。_');
  }
  if (view.errors?.length) {
    out.push('');
    for (const e of view.errors) out.push(`⚠ ${e}`);
  }
  return out.join('\n');
}

function renderCompact(view) {
  const w5 = view.windows.fiveHour;
  const wk = view.windows.weekly;
  const m = view.monthly;
  const e = view.estimate;
  const noWindows = view.windows.limited === false;
  const bp = balancePresentation(view);
  const planName = view.plan?.name ?? '按量计费';

  const parts = [`CC ${planName}`];
  if (noWindows) {
    const n = e?.requestsLeft?.monthly;
    parts.push(`余额 ${money(m.remaining)}${n !== null && n !== undefined ? `（≈${count(n)} 次）` : ''}`);
  } else {
    if (w5) {
      const n = e?.requestsLeft?.fiveHour;
      parts.push(w5.started ? `5h ${w5.percent.toFixed(0)}%${n !== null && n !== undefined ? `（≈${count(n)} 次）` : ''}` : '5h 未开启');
    }
    if (wk) parts.push(wk.started ? `周 ${wk.percent.toFixed(0)}%` : '周未开启');
    if (bp.showBar) parts.push(`月 ${m.percent.toFixed(1)}%`);
    parts.push(`剩 ${money(m.remaining)}`);
    if (wk?.started && wk.resetAt) parts.push(`周重置 ${duration(wk.resetsInMs)}后`);
  }

  const warns = [
    paceWarning('5 小时窗口', w5, e?.pace?.fiveHour),
    paceWarning('每周窗口', wk, e?.pace?.weekly),
  ].filter(Boolean);
  return parts.join(' · ') + (warns.length ? `\n${warns.join('\n')}` : '');
}

/* ------------------------------------------------------------- HTML 面板 */

function renderHtml(view, opts = {}) {
  const live = Boolean(opts.live);
  const snapshot = JSON.stringify(view).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Command Code 额度面板</title>
<style>
  :root {
    --bg: #0b0d12; --panel: #14171f; --panel-2: #1b1f29;
    --line: #262b38; --fg: #e6e9f0; --muted: #8b93a7;
    --low: #34d399; --medium: #fbbf24; --high: #fb7185; --critical: #f43f5e;
    --accent: #a78bfa;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 24px 64px; background: radial-gradient(1200px 600px at 20% -10%, #1a1f2e 0%, var(--bg) 60%);
    color: var(--fg); font: 15px/1.5 ui-sans-serif, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    min-height: 100vh;
  }
  .wrap { max-width: 1080px; margin: 0 auto; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 6px; }
  h1 { font-size: 22px; margin: 0; letter-spacing: .3px; }
  h1 .plan { color: var(--accent); }
  .stamp { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .sub { color: var(--muted); font-size: 13.5px; margin-bottom: 26px; }
  .sub code { color: var(--fg); background: var(--panel-2); padding: 1px 6px; border-radius: 5px; }
  .gauges { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; margin-bottom: 18px; }
  .card { background: linear-gradient(180deg, var(--panel) 0%, rgba(20,23,31,.72) 100%); border: 1px solid var(--line); border-radius: 16px; padding: 18px; }
  .gauge { display: flex; flex-direction: column; align-items: center; text-align: center; }
  .gauge .label { font-size: 13px; color: var(--muted); letter-spacing: .4px; margin-bottom: 10px; }
  .ring { position: relative; width: 168px; height: 168px; }
  .ring svg { transform: rotate(-90deg); }
  .ring .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .ring .pct { font-size: 30px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .ring .amt { font-size: 12.5px; color: var(--muted); margin-top: 2px; font-variant-numeric: tabular-nums; }
  .gauge .foot { margin-top: 12px; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .stat { background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
  .stat .k { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  .stat .v { font-size: 19px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .stat .v small { font-size: 12.5px; color: var(--muted); font-weight: 400; }
  .note { margin-top: 18px; color: var(--muted); font-size: 12.5px; }
  .note.warn { color: var(--medium); }
  .pill { display: inline-block; font-size: 11.5px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); margin-left: 8px; vertical-align: 2px; }
  footer { margin-top: 26px; color: var(--muted); font-size: 12px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  button { background: var(--panel-2); color: var(--fg); border: 1px solid var(--line); border-radius: 9px; padding: 7px 14px; font: inherit; font-size: 13px; cursor: pointer; }
  button:hover { border-color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Command Code · <span class="plan" id="plan">—</span></h1>
    <div class="stamp" id="stamp">—</div>
  </header>
  <div class="sub" id="sub"></div>

  <div class="gauges">
    <div class="card gauge" data-gauge="fiveHour">
      <div class="label">5 小时滚动窗口</div>
      <div class="ring"><svg width="168" height="168" viewBox="0 0 168 168"></svg>
        <div class="center"><div class="pct">—</div><div class="amt">—</div></div>
      </div>
      <div class="foot">—</div>
    </div>
    <div class="card gauge" data-gauge="weekly">
      <div class="label">每周滚动窗口</div>
      <div class="ring"><svg width="168" height="168" viewBox="0 0 168 168"></svg>
        <div class="center"><div class="pct">—</div><div class="amt">—</div></div>
      </div>
      <div class="foot">—</div>
    </div>
    <div class="card gauge" data-gauge="monthly">
      <div class="label">月度额度</div>
      <div class="ring"><svg width="168" height="168" viewBox="0 0 168 168"></svg>
        <div class="center"><div class="pct">—</div><div class="amt">—</div></div>
      </div>
      <div class="foot">—</div>
    </div>
  </div>

  <div class="card">
    <div class="stats">
      <div class="stat"><div class="k">本周期请求</div><div class="v" id="s-req">—</div></div>
      <div class="stat"><div class="k">成功率</div><div class="v" id="s-ok">—</div></div>
      <div class="stat"><div class="k">输入 tokens</div><div class="v" id="s-in">—</div></div>
      <div class="stat"><div class="k">输出 tokens</div><div class="v" id="s-out">—</div></div>
      <div class="stat"><div class="k">平均单价</div><div class="v" id="s-avg">—</div></div>
      <div class="stat"><div class="k">本周期已花</div><div class="v" id="s-spent">—</div></div>
    </div>
    <div class="note" id="note"></div>
  </div>

  <footer>
    <span id="foot-left">—</span>
    <span>${live ? '<button id="refresh">立即刷新</button>' : '静态快照 · 重新运行命令即可更新'}</span>
  </footer>
</div>

<script>
  var SNAPSHOT = ${snapshot};
  var LIVE = ${live ? 'true' : 'false'};
  var RADIUS = 70, CIRC = 2 * Math.PI * RADIUS;

  function money(n) { return '$' + (Number(n) || 0).toFixed(2); }
  function money4(n) { return '$' + (Number(n) || 0).toFixed(4); }
  function tokens(n) {
    var v = Number(n) || 0;
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function clock(ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function hhmm(ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function duration(ms) {
    if (ms === null || ms === undefined) return '—';
    var t = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600),
        m = Math.floor((t % 3600) / 60), s = t % 60;
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }
  function levelOf(p, bad) {
    if (bad || p >= 100) return 'critical';
    if (p >= 80) return 'high';
    if (p >= 50) return 'medium';
    return 'low';
  }
  function colorOf(level) {
    return getComputedStyle(document.documentElement).getPropertyValue('--' + level).trim();
  }

  function drawGauge(el, spec) {
    var svg = el.querySelector('svg');
    var level = levelOf(spec.percent, spec.bad);
    var color = colorOf(level);
    if (!svg.dataset.built) {
      svg.innerHTML =
        '<circle cx="84" cy="84" r="' + RADIUS + '" fill="none" stroke="#242a37" stroke-width="13"/>' +
        '<circle class="arc" cx="84" cy="84" r="' + RADIUS + '" fill="none" stroke="' + color + '" stroke-width="13" ' +
        'stroke-linecap="round" stroke-dasharray="' + CIRC + '" stroke-dashoffset="' + CIRC + '" ' +
        'style="transition:stroke-dashoffset .6s ease"/>';
      svg.dataset.built = '1';
    }
    var arc = svg.querySelector('.arc');
    arc.setAttribute('stroke', color);
    arc.setAttribute('stroke-dashoffset', String(CIRC * (1 - Math.min(spec.percent, 100) / 100)));
    el.querySelector('.pct').textContent = spec.percent.toFixed(1) + '%';
    el.querySelector('.pct').style.color = color;
    el.querySelector('.amt').textContent = spec.amount;
    el.querySelector('.foot').innerHTML = spec.foot;
  }

  function render(v) {
    document.getElementById('plan').textContent = v.plan ? v.plan.name : '按量计费';
    document.getElementById('stamp').textContent = clock(v.fetchedAt);

    var who = v.account.userName || v.account.name || '—';
    var sub = [];
    if (v.plan) {
      sub.push(v.plan.id);
      sub.push(v.plan.active ? '生效中' : (v.plan.status || '未知'));
      if (v.plan.currentPeriodStart && v.plan.currentPeriodEnd) {
        sub.push(clock(Date.parse(v.plan.currentPeriodStart)) + ' → ' + clock(Date.parse(v.plan.currentPeriodEnd)));
      }
      if (v.plan.daysLeft !== null && v.plan.daysLeft !== undefined) sub.push('剩 ' + v.plan.daysLeft + ' 天');
      if (v.plan.cancelAtPeriodEnd) sub.push('期末取消');
    }
    document.getElementById('sub').innerHTML =
      '账号 <code>' + (v.account.email || who) + '</code> · ' + sub.join(' · ');

    var w5 = v.windows.fiveHour, wk = v.windows.weekly;
    function windowFoot(w) {
      if (!w) return '该套餐没有此窗口';
      if (!w.started) return '窗口未开启';
      var t = '重置 ' + hhmm(w.resetAt) + ' · ' + duration(w.resetsInMs) + ' 后';
      if (w.exceeded) t += ' · 已超限';
      return t;
    }
    drawGauge(document.querySelector('[data-gauge="fiveHour"]'), w5
      ? { percent: w5.percent, bad: w5.exceeded, amount: money(w5.used) + ' / ' + money(w5.cap), foot: windowFoot(w5) }
      : { percent: 0, bad: false, amount: '不可用', foot: '该套餐没有此窗口' });
    drawGauge(document.querySelector('[data-gauge="weekly"]'), wk
      ? { percent: wk.percent, bad: wk.exceeded, amount: money(wk.used) + ' / ' + money(wk.cap), foot: windowFoot(wk) }
      : { percent: 0, bad: false, amount: '不可用', foot: '该套餐没有此窗口' });

    var m = v.monthly;
    var mFoot = '剩余 ' + money(m.remaining);
    if (m.purchasedRemaining > 0) mFoot += ' · 含额外 ' + money(m.purchasedRemaining);
    if (m.belowThreshold) mFoot += ' · 低于预警阈值';
    drawGauge(document.querySelector('[data-gauge="monthly"]'), {
      percent: m.percent, bad: m.belowThreshold,
      amount: money(m.used) + ' / ' + money(m.total), foot: mFoot
    });

    var s = v.summary;
    document.getElementById('s-req').textContent = s.requests > 0 ? String(s.requests) : '—';
    document.getElementById('s-ok').innerHTML = s.successRate === null
      ? '—' : s.successRate + '<small>%</small>';
    document.getElementById('s-in').textContent = tokens(s.tokensIn);
    document.getElementById('s-out').textContent = tokens(s.tokensOut);
    document.getElementById('s-avg').textContent = money4(s.averageCost);
    document.getElementById('s-spent').textContent = money(s.totalCost);

    var notes = [];
    if (v.windows.limited === false) notes.push('账号当前没有滚动窗口限制（按量计费或企业池）。');
    if (s.failed > 0) notes.push('本周期有 ' + s.failed + ' 次请求失败。');
    if (v.errors && v.errors.length) notes.push('部分接口报错：' + v.errors.join('；'));
    var noteEl = document.getElementById('note');
    noteEl.textContent = notes.join(' ');

    document.getElementById('foot-left').textContent =
      '接口 ' + v.apiBase + ' · 凭证来源 ' + v.credentialSource;
  }

  var CURRENT = SNAPSHOT;
  render(CURRENT);

  setInterval(function () {
    var five = CURRENT.windows.fiveHour, wk = CURRENT.windows.weekly;
    if (five && five.resetAt) five.resetsInMs = Math.max(0, five.resetAt - Date.now());
    if (wk && wk.resetAt) wk.resetsInMs = Math.max(0, wk.resetAt - Date.now());
    render(CURRENT);
  }, 1000);

  if (LIVE) {
    var reload = function () {
      fetch('/api/usage').then(function (r) { return r.json(); }).then(function (v) {
        CURRENT = v; render(CURRENT);
      }).catch(function () {});
    };
    document.getElementById('refresh').addEventListener('click', reload);
    setInterval(reload, 30000);
  }
</script>
</body>
</html>
`;
}

/* -------------------------------------------------------------------- demo */

function demoView(scenario = 'normal') {
  const now = Date.now();
  const hot = scenario === 'hot';
  const fiveReset = now + (3 * 3600 + 12 * 60) * 1000;
  const weekReset = now + (6 * 86400 + 19 * 3600) * 1000;
  // hot 场景：窗口已开 3 小时、速度足以在重置前撞限，用来预览告警长什么样
  const fiveUsed = hot ? 12.9 : 4.48;
  const weekUsed = hot ? 30.2 : 14.35;
  const avg = hot ? 0.039 : 0.0387;
  return {
    fetchedAt: now,
    apiBase: DEFAULT_API_BASE,
    credentialSource: `示例数据（--demo${hot ? ' hot' : ''}）`,
    account: { userName: 'demo-user', name: 'demo-user', email: 'demo@example.com', userId: 'demo', org: null },
    orgLimits: [],
    plan: {
      id: 'individual-goat', name: 'GOAT', monthlyTotal: 70, status: 'active', active: true,
      currentPeriodStart: new Date(now - 86400000).toISOString(),
      currentPeriodEnd: new Date(now + 29 * 86400000).toISOString(),
      cancelAtPeriodEnd: false, daysLeft: 29,
    },
    monthly: {
      used: hot ? 41.6 : 12.4, total: 70, remaining: hot ? 28.4 : 57.6,
      planRemaining: hot ? 28.4 : 57.6, purchasedRemaining: 0, freeRemaining: 0,
      percent: hot ? 59.4 : 17.7, rawPercent: hot ? 59.4 : 17.7,
      belowThreshold: false, creditThreshold: 0,
    },
    windows: {
      limited: true,
      fiveHour: {
        used: fiveUsed, cap: 14, percent: (fiveUsed / 14) * 100, rawPercent: (fiveUsed / 14) * 100,
        remaining: Math.max(0, 14 - fiveUsed), resetAt: fiveReset, resetsInMs: fiveReset - now,
        exceeded: false, started: true,
      },
      weekly: {
        used: weekUsed, cap: 35, percent: (weekUsed / 35) * 100, rawPercent: (weekUsed / 35) * 100,
        remaining: Math.max(0, 35 - weekUsed), resetAt: weekReset, resetsInMs: weekReset - now,
        exceeded: false, started: true,
      },
    },
    estimate: {
      avgCostPerRequest: avg,
      requestsLeft: {
        fiveHour: Math.floor(Math.max(0, 14 - fiveUsed) / avg),
        weekly: Math.floor(Math.max(0, 35 - weekUsed) / avg),
        monthly: Math.floor((hot ? 28.4 : 57.6) / avg),
      },
      // 5h 窗口已开 3h（>5% 门槛），速度外推成立；周窗口刚开 3h（<8.4h 门槛）故意留空，
      // 展示「样本不足就不给结论」的行为。
      pace: hot
        ? {
            fiveHour: { sampleMs: 3 * 3600_000, ratePerHour: fiveUsed / 3, projected: (fiveUsed / 3) * 5, willExceed: (fiveUsed / 3) * 5 > 14, exhaustInMs: ((14 - fiveUsed) / (fiveUsed / 3)) * 3600_000 },
            weekly: null,
            monthly: null,
          }
        : { fiveHour: null, weekly: null, monthly: null },
    },
    summary: {
      requests: hot ? 1067 : 312, completed: hot ? 1067 : 312, failed: 0, successRate: 100,
      totalCost: hot ? 41.6 : 12.4, averageCost: avg,
      tokensIn: hot ? 412_000_000 : 128_400_000, tokensOut: hot ? 4_100_000 : 1_240_000,
      tokens: hot ? 416_100_000 : 129_640_000, periodBasis: 'billing-period',
    },
    errors: [],
  };
}

/* ------------------------------------------------------------------ serve */

async function serve(creds, opts) {
  const port = opts.port;
  let cache = null;
  let cacheAt = 0;

  async function current() {
    if (cache && Date.now() - cacheAt < 15000) return cache;
    const raw = await collectUsage({ apiKey: creds.apiKey, apiBase: creds.apiBase, orgId: opts.org });
    cache = normalize(raw, { now: Date.now(), apiBase: creds.apiBase, credentialSource: creds.source });
    cacheAt = Date.now();
    return cache;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/usage') {
      try {
        const view = await current();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(view));
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      try {
        const view = await current();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(renderHtml(view, { live: true }));
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<pre style="color:#fb7185;font:14px monospace;padding:24px">读取失败：\n${String(err instanceof Error ? err.message : err)}</pre>`);
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Command Code 额度面板已启动：${url}`);
    console.log('浏览器每 30 秒自动刷新一次；按 Ctrl+C 停止。');
    if (opts.open) openInBrowser(url);
  });
  return server;
}

function openInBrowser(target) {
  const isUrl = /^https?:\/\//i.test(target);
  const cmd =
    process.platform === 'win32'
      ? `start "" ${isUrl ? `"${target}"` : `"" "${target}"`}`
      : process.platform === 'darwin'
        ? `open ${isUrl ? `"${target}"` : `"${target}"`}`
        : `xdg-open "${target}"`;
  exec(cmd, (err) => {
    if (err) console.error(`（自动打开失败，请手动打开：${target}）`);
  });
}

/* ------------------------------------------------------------------- main */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  if (opts.demo) {
    const view = demoView(opts.demoScenario);
    return emit(view, opts);
  }

  // 离线渲染：既接受 --json 存下来的自洽快照（含 raw），也接受原始四段响应。
  if (opts.fromJson) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.resolve(opts.fromJson), 'utf8'));
    } catch (err) {
      console.error(`读取快照失败：${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 2;
      return;
    }
    const raw = doc && typeof doc.raw === 'object' && doc.raw !== null ? doc.raw : doc;
    const view = normalize(raw, {
      now: opts.at ? Date.parse(opts.at) : Date.now(),
      apiBase: raw.__apiBase || DEFAULT_API_BASE,
      credentialSource: `快照 ${opts.fromJson}`,
    });
    return emit(view, opts);
  }

  const creds = resolveCredentials();
  if (!creds) {
    console.error(
      [
        '找不到 Command Code 凭证。按下列任一方式提供：',
        '  1. 设置环境变量 COMMAND_CODE_API_KEY',
        '  2. 用 Command Code CLI 登录，生成 ~/.commandcode/auth.json',
        '  3. 在 ZCode 里配置 baseUrl 含 commandcode.ai 的 provider',
      ].join('\n'),
    );
    process.exitCode = 2;
    return;
  }

  if (opts.verbose) {
    console.error(`凭证来源：${creds.source}（${maskKey(creds.apiKey)}）`);
    console.error(`接口地址：${creds.apiBase || DEFAULT_API_BASE}`);
  }

  const raw = await collectUsage({ apiKey: creds.apiKey, apiBase: creds.apiBase, orgId: opts.org });
  const view = normalize(raw, {
    now: Date.now(),
    apiBase: creds.apiBase || DEFAULT_API_BASE,
    credentialSource: creds.source,
  });

  if (opts.mode === 'serve') {
    await serve(creds, opts);
    return;
  }

  if (opts.mode === 'watch') {
    const tick = () => {
      const r = collectUsage({ apiKey: creds.apiKey, apiBase: creds.apiBase, orgId: opts.org });
      r.then((fresh) => {
        const v = normalize(fresh, { now: Date.now(), apiBase: creds.apiBase || DEFAULT_API_BASE, credentialSource: creds.source });
        if (opts.color) process.stdout.write('\x1b[2J\x1b[H');
        console.log(renderTerminal(v, opts));
        console.log(makeColors(opts.color).gray(`每 60s 刷新 · Ctrl+C 退出 · ${clock(Date.now())}`));
      }).catch((err) => console.error(String(err instanceof Error ? err.message : err)));
    };
    tick();
    setInterval(tick, 60000);
    return;
  }

  return emit(view, opts);
}

function emit(view, opts) {
  if (opts.mode === 'json') {
    console.log(JSON.stringify(view, null, 2));
    return;
  }
  if (opts.mode === 'md') {
    console.log(renderMarkdown(view));
    return;
  }
  if (opts.mode === 'compact') {
    console.log(renderCompact(view));
    return;
  }
  if (opts.mode === 'html') {
    const file = path.resolve(opts.outFile || path.join(process.cwd(), 'command-code-usage.html'));
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, renderHtml(view, { live: false }), 'utf8');
    } catch (err) {
      console.error(`写入面板失败：${file}\n  ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`已生成面板：${file}`);
    if (opts.open) openInBrowser(file);
    return;
  }
  console.log(renderTerminal(view, opts));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
