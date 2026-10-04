// ⚠️ 此文件由 core/cc-usage.mjs 同步生成，请勿直接修改。
// 改动请提交到 core/cc-usage.mjs，然后运行：node scripts/sync-core.mjs
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
 *   node cc-usage.mjs --demo              用内置样例数据预览外观（不联网）
 *   node cc-usage.mjs --verbose            附带凭证来源等诊断信息
 *
 * 选项：--no-color  --org <orgId>  --out <file>
 *
 * 凭证来源（按顺序）：
 *   1. 环境变量 COMMAND_CODE_API_KEY / CMD_API_KEY / COMMANDCODE_API_KEY
 *   2. ~/.commandcode/auth.json        （Command Code CLI 登录后的凭证）
 *   3. ~/.zcode/v2/provider_config.json（ZCode 里配置的 provider，自动匹配 baseUrl）
 */

// 这个脚本每次助手消息都会被跑一次，启动开销就是体验本身。
// ESM 静态 import 每个内建模块约 +2ms，改走 createRequire 实测省 11ms。
// node:http 和 node:crypto 已经不用了——省掉的不是代码，是启动时间。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const VERSION = '1.2.0';
export const DEFAULT_API_BASE = 'https://api.commandcode.ai';
const PROVIDER_MATCH = /commandcode\.ai/i;

/* ------------------------------------------------------------------ 套餐表 */

// 来源：Command Code 官方定价页 commandcode.ai/docs/resources/pricing-limits
// （核对于 2026-09-21）。这里只是**兜底**：接口报的 windowLimits.cap 优先，
// 只有在接口没给上限时才用这张表。金额那一列是套餐内含的额度，不是月费。
//
// 几个容易搞错的点：
//   - Go($1) 只有 $10 额度，且**没有 API 权限**，四个额度接口全 404；
//   - Provider($15) 是按量计费，没有滚动窗口，也没有"月度额度"这个概念；
//   - Enterprise 同样没有滚动窗口，额度是谈出来的；
//   - Max 的额度在"标准模型/高级模型"之间分池，接口报的才是真的。
const PLANS = {
  'individual-go': { name: 'Go', monthly: 10, fiveHour: 3, weekly: 6 },
  'individual-goat': { name: 'GOAT', monthly: 70, fiveHour: 14, weekly: 35 },
  // Pro 的内含额度是 $80（早期版本曾报 $30，两版都留着以免老账号识别不出来）
  'individual-pro': { name: 'Pro', monthly: 80, fiveHour: 16, weekly: 40 },
  'individual-provider': { name: 'Provider', monthly: null, fiveHour: null, weekly: null },
  'individual-max-10x': { name: 'Max 10x', monthly: 150, fiveHour: 45, weekly: 90 },
  'individual-max-20x': { name: 'Max 20x', monthly: 300, fiveHour: 90, weekly: 180 },
  'individual-max': { name: 'Max 10x', monthly: 150, fiveHour: 45, weekly: 90 },
  'individual-ultra': { name: 'Max 20x', monthly: 300, fiveHour: 90, weekly: 180 },
  'teams-pro': { name: 'Team Pro', monthly: 40, fiveHour: 12, weekly: 24 },
  'teams-enterprise': { name: 'Enterprise', monthly: null, fiveHour: null, weekly: null },
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
    org: undefined,
    outFile: undefined,
    verbose: false,
    demo: false,
    // 状态栏模式：给 Claude Code / Grok 这类「每轮自动跑一次脚本」的宿主用。
    // 默认走磁盘缓存，命中就直接出图，不会每条消息都去打四个接口。
    threshold: null,
    // 超过这个年龄就先显示旧快照，同时后台补一次数。
    // 别再调回 60s：它正好等于宿主常见的刷新周期，于是每一跳都起一个后台进程打四个
    // 接口；而额度这种量级，3 分钟内的差异本来也看不出来。
    cacheTtl: 180_000,
    // 超过这么久没有新的请求量增长，就当用户已经切走了，状态栏不再显示。
    // 0 = 永远显示（不推荐，见 README）。
    idleHideMs: 30 * 60_000,
    always: false,
    // 用户自己补的模型名别名——自动匹配不可能覆盖所有命名习惯。
    modelPatterns: [],
    why: false,
    hook: false,
    noCache: false,
    rows: 3,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.mode = 'json';
    else if (a === '--md' || a === '--markdown') out.mode = 'md';
    else if (a === '--compact') out.mode = 'compact';
    else if (a === '--html') out.mode = 'html';
    else if (a === '--watch') out.mode = 'watch';
    else if (a === '--statusline' || a === '--line') out.mode = 'statusline';
    else if (a === '--threshold') out.threshold = Number(argv[++i]);
    else if (a === '--cache-ttl') out.cacheTtl = Number(argv[++i]) || 0;
    else if (a === '--no-cache') out.noCache = true;
    else if (a === '--refresh-cache') out.refreshCache = true;
    else if (a === '--rows') out.rows = Number(argv[++i]) === 1 ? 1 : 3;
    else if (a === '--idle-hide') out.idleHideMs = Number(argv[++i]) * 60_000;
    else if (a === '--always') { out.idleHideMs = 0; out.always = true; }
    else if (a === '--model') out.modelPatterns.push(normalizeModel(argv[++i]));
    else if (a === '--why') out.why = true;
    // Codex 这类没有常驻位的宿主：用 UserPromptSubmit 钩子每轮弹一行。
    else if (a === '--hook') out.hook = true;
    else if (a === '--open') out.open = true;
    else if (a === '--no-color') out.color = false;
    else if (a === '--color') out.color = true;
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
    else if (a === '--out') out.outFile = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  if (process.env.NO_COLOR !== undefined) out.color = false;
  // 状态栏的 stdout 必然不是 TTY——宿主是把脚本输出抓走再渲染的，
  // 所以这里不能按 isTTY 推断，否则状态栏永远是灰的。
  else if (out.mode !== 'statusline' && !process.stdout.isTTY) out.color = false;
  return out;
}

const HELP = `Command Code 额度面板 v${VERSION}

  node cc-usage.mjs                     终端面板（默认，聊天/终端里都能看）
  node cc-usage.mjs --md                表格形式，适配聊天里的 Markdown 渲染
  node cc-usage.mjs --compact           单行摘要
  node cc-usage.mjs --json              归一化 JSON
  node cc-usage.mjs --watch             终端里持续刷新（每 60s）
  node cc-usage.mjs --statusline         状态栏（3 行彩色进度条，宿主每轮自动调用，不烧 token）
  node cc-usage.mjs --statusline --threshold 70
                                         只在某个窗口超过 70% 时才输出（给只能弹警告的宿主用）
  node cc-usage.mjs --statusline --rows 1  单行（默认三行）
  node cc-usage.mjs --statusline --model <子串>
                                         手工指定"哪些模型名算在用"，可重复。
                                         自动判定靠比对 Command Code 公开模型目录，
                                         命名对不上时用它补
  node cc-usage.mjs --statusline --always  不判断去向，永远显示
  node cc-usage.mjs --statusline --idle-hide <分钟>
                                         拿不到本轮模型证据时，账号闲置多久后隐藏（默认 30）
  node cc-usage.mjs --statusline --why     解释"为什么现在没显示"，输出到 stderr
  node cc-usage.mjs --demo [场景]        内置样例，不联网预览外观
                                         场景：normal（默认）/ hot（用量吃紧）
                                               / provider（按量计费）/ max（Max 20x）
  node cc-usage.mjs --from-json <文件>  渲染离线快照（配 --json 存下来的原始响应）
  node cc-usage.mjs --verbose           附带诊断信息
  node cc-usage.mjs --org <orgId>       指定组织

可选（想看大图时才用，平时用不到）：
  node cc-usage.mjs --html [--open]     生成本地 HTML 面板
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

function readTextFile(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Command Code 的 key 长这样（官方 CLI 生成的形如 user_xxx，不是 sk-）。
const KEY_SHAPE = /^(user_|cc_)[A-Za-z0-9_-]{8,}$/;

// 别人机器上 key 藏在哪儿，取决于他用哪个宿主接的 Command Code。
// 所以这里按"能自动找到就自动找"来排，找不到才要求用户显式设环境变量——
// 一个要手动配 key 才能用的插件，绝大多数人第一步就放弃了。
const JSON_CONFIGS = [
  '~/.zcode/v2/provider_config.json',
  '~/.config/opencode/opencode.jsonc',
  '~/.config/opencode/opencode.json',
  '~/.claude/settings.json',
  '~/.pi/agent/settings.json',
];

// 用 TOML/YAML 存 provider 的那几个宿主（dsh / Codex / Grok）。
// 为这个引一个 YAML 解析器不值得，用"块内就近匹配"够用：
// 先找到提到 commandcode 的那一行，再在它同一块里找 apiKey / apiKeyEnv。
const TEXT_CONFIGS = [
  '~/.dsh/settings.yaml',
  '~/.dsh/.credentials.yaml',
  '~/.codex/config.toml',
  '~/.grok/config.toml',
];

/** 三种写法都认：apiKeyEnv 引用环境变量名、apiKey 直接写值、顶层 apiKey 键。
 *  直接写值的要过 KEY_SHAPE（user_ / cc_ 前缀加 8 位以上）。 */
function keyFromLine(line) {
  const envRef = line.match(/apiKeyEnv\s*[:=]\s*["']?([A-Za-z0-9_]+)["']?/i);
  if (envRef) return { envName: envRef[1] };
  const direct = line.match(/apiKey\s*[:=]\s*["']?([A-Za-z0-9_-]{12,})["']?/i);
  if (direct && KEY_SHAPE.test(direct[1])) return { apiKey: direct[1] };
  return null;
}

/** 在文本配置里按块找 Command Code 的 key；块边界取 TOML 的 [section]。 */
function scanTextConfig(absPath) {
  const text = readTextFile(absPath);
  if (!text || !PROVIDER_MATCH.test(text)) return null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!PROVIDER_MATCH.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
      if (/^\s*\[[^\]]+\]\s*$/.test(lines[j])) break;
      const hit = keyFromLine(lines[j]);
      if (hit) return hit;
    }
  }
  // 整个文件都没提到 commandcode 之外的线索时不做兜底——猜错 key 比找不到更糟。
  return null;
}

/** apiKeyEnv 指向的名字，可能落在环境变量里，也可能落在 dsh 的 .credentials.yaml 里。 */
function resolveEnvRef(name, home) {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const cred = readTextFile(path.join(home, '.dsh', '.credentials.yaml'));
  if (cred) {
    const m = cred.match(new RegExp(`^\s*${name}\s*:\s*["']?([^\s"']+)`, 'm'));
    if (m && KEY_SHAPE.test(m[1].trim())) return m[1].trim();
  }
  return null;
}

export function resolveCredentials() {
  const home = os.homedir();
  const expand = (p) => path.join(home, p.replace(/^~[\/]/, ''));

  // 1. 显式环境变量：这是唯一"官方"的接入口，也是最容易被 CI 用上的。
  for (const name of ['COMMAND_CODE_API_KEY', 'COMMANDCODE_API_KEY', 'CMD_API_KEY']) {
    const v = process.env[name];
    if (v && v.trim()) return { apiKey: v.trim(), source: `环境变量 ${name}` };
  }

  // 2. 名字里带 commandcode 的环境变量（dsh 那套命名习惯）。
  for (const [name, value] of Object.entries(process.env)) {
    if (!/commandcode/i.test(name) || typeof value !== 'string') continue;
    if (KEY_SHAPE.test(value.trim())) return { apiKey: value.trim(), source: `环境变量 ${name}` };
  }

  // 3. 官方 command-code CLI 的登录态。
  const cliDoc = readJsonSafe(expand('~/.commandcode/auth.json'));
  if (cliDoc && typeof cliDoc.apiKey === 'string' && cliDoc.apiKey.trim()) {
    const who = cliDoc.userName ? `（${cliDoc.userName}）` : '';
    return { apiKey: cliDoc.apiKey.trim(), source: `~/.commandcode/auth.json${who}` };
  }

  // 4. 各宿主里配过的 Command Code provider（JSON 配置）。
  for (const rel of JSON_CONFIGS) {
    const abs = expand(rel);
    const doc = readJsonSafe(abs);
    const hit = doc ? scanForProviderKey(doc) : null;
    if (hit) {
      return {
        apiKey: hit.apiKey,
        apiBase: hit.baseUrl.replace(/\/provider\/v\d+\/?$/, ''),
        source: `${rel} 里的 provider 配置`,
      };
    }
  }

  // 5. TOML / YAML 配置里的 provider 段，或者它引用的环境变量名。
  for (const rel of TEXT_CONFIGS) {
    const hit = scanTextConfig(expand(rel));
    if (!hit) continue;
    if (hit.apiKey) return { apiKey: hit.apiKey, source: `${rel} 里的 provider 配置` };
    const resolved = resolveEnvRef(hit.envName, home);
    if (resolved) return { apiKey: resolved, source: `${rel} 指向的 ${hit.envName}` };
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

export async function collectUsage({ apiKey, apiBase, orgId }) {
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

export function normalize(raw, meta) {
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

// 不同套餐的形态差别很大（滚动窗口有没有、额度多大、按量计费还是包月），
// 所以样例数据也要按套餐给——没账号的人靠它预览自己那档长什么样。
function demoView(scenario = 'normal') {
  const base = goatDemo(scenario === 'hot' ? 'hot' : 'normal');

  if (scenario === 'provider') {
    // 按量计费：没有滚动窗口，只有余额。
    return {
      ...base,
      plan: { id: 'individual-provider', name: 'Provider', monthlyTotal: null, status: 'active', active: true,
        currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, daysLeft: null },
      windows: { limited: false, fiveHour: null, weekly: null },
      monthly: { used: 32.34, total: 80, remaining: 47.66, planRemaining: 0,
        purchasedRemaining: 47.66, freeRemaining: 0, percent: 0, rawPercent: 0,
        belowThreshold: false, creditThreshold: 0 },
    };
  }

  if (scenario === 'max') {
    const plan = PLANS['individual-max-20x'];
    return {
      ...base,
      plan: { ...base.plan, id: 'individual-max-20x', name: plan.name, monthlyTotal: plan.monthly },
      windows: {
        limited: true,
        fiveHour: { ...base.windows.fiveHour, cap: plan.fiveHour },
        weekly: { ...base.windows.weekly, cap: plan.weekly },
      },
      monthly: { ...base.monthly, total: plan.monthly, remaining: plan.monthly - base.monthly.used },
    };
  }

  return base;
}

function goatDemo(scenario = 'normal') {
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

function openInBrowser(target) {
  // 参数走 argv 数组，不拼 shell 命令串：target 是 URL/路径，插进命令串再交给
  // shell 就要靠引号转义，而引号转义永远比"不经过 shell"更容易出错。
  const [opener, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', target]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  execFile(opener, args, (err) => {
    if (err) console.error(`（自动打开失败，请手动打开：${target}）`);
  });
}

/* ------------------------------------------------------------------- main */

/**
 * 供别的适配器（dsh 的卡片、其它插件）直接调用的一步到位入口。
 * 不导出这个的话，每个适配器都要自己拼 resolveCredentials → collectUsage → normalize，
 * 而凭证解析正是最不该各写一份的那部分。
 */
export async function fetchView({ orgId } = {}) {
  const creds = resolveCredentials();
  if (!creds) throw new Error('找不到 Command Code 凭证');
  const raw = await collectUsage({ apiKey: creds.apiKey, apiBase: creds.apiBase, orgId });
  const view = normalize(raw, {
    now: Date.now(),
    apiBase: creds.apiBase || DEFAULT_API_BASE,
    credentialSource: creds.source,
  });
  return { view, creds, digest: keyDigest(creds.apiKey) };
}

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
    // 状态栏是把错误写在用户脸上最烦的一类插件，没有凭证就安静退场。
    if (opts.mode === 'statusline') return;
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

  // 状态栏那侧起的后台进程，只负责刷新缓存，不产出任何输出。
  if (opts.refreshCache) {
    try {
      const fresh = await collectUsage({ apiKey: creds.apiKey, apiBase: creds.apiBase, orgId: opts.org });
      const view = normalize(fresh, { now: Date.now(), apiBase: creds.apiBase || DEFAULT_API_BASE, credentialSource: creds.source });
      writeCache(view, keyDigest(creds.apiKey));
    } catch {
      // 后台补数失败就继续用旧快照；刷新失败不该让用户看到错误。
    }
    return;
  }

  if (opts.mode === 'statusline' || opts.hook) {
    return statuslineMode(creds, opts);
  }

  const raw = await collectUsage({ apiKey: creds.apiKey, apiBase: creds.apiBase, orgId: opts.org });
  const view = normalize(raw, {
    now: Date.now(),
    apiBase: creds.apiBase || DEFAULT_API_BASE,
    credentialSource: creds.source,
  });

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

/* ------------------------------------- 这一轮到底走没走 Command Code */

// 背景：Claude Code 给 statusLine 的 JSON 里**没有** provider / base_url——唯一沾边的
// model.id 还只是本地别名（走 cc-switch 这类本地路由时，实测 model.id 是
// "claude-opus-5[1M]"，而请求实际打到了 "deepseek/deepseek-v4.1-flash"）。
//
// 判据按可靠性排：
//   1. 环境变量里的路由映射（upstreamFromEnvAlias）。本地路由会把
//      ANTHROPIC_DEFAULT_OPUS_MODEL 和 ..._MODEL_NAME 成对设好，直接换算即可。
//      这是路由自己的配置，不是推测。
//   2. transcript 里每条 assistant 消息的 message.model——上游真实回报的模型名，
//      transcript_path 由宿主通过 stdin 传来。
//   3. 都没有就返回 unknown，退回"账号用量还动不动"的兜底判断。
//
// 拿到真实模型名后，去对照 Command Code 公开的模型目录（/provider/v1/models，免鉴权）。
// 实测精确命中率只有约 36%（"K2.7 Code" 对不上目录里的 "moonshotai/Kimi-K2.7-Code"），
// 所以匹配不上时不猜——留给用户用 --model 补自己的别名。
//
// 这套判据回答的是"这一轮在不在用它"（逐轮）。之前只看"账号用量有没有增长"，
// 那是账号级的：你在 dsh 或另一台机器上用 Command Code，也会让数字增长，
// 于是这个会话明明没用它、状态栏却还挂着。

/* ------------------------------------------- 状态栏模式（宿主本地跑，零 token）*/

// 状态栏脚本会被宿主高频重跑（Claude Code 是每条助手消息一次），而一次取数要打
// 四个接口。所以一律走磁盘缓存：
//   命中且新鲜 → 直接出图，几毫秒
//   命中但过期 → 先出旧图，同时后台补一次，下次调用就是新的
//   没有缓存   → 阻塞取一次（只在首次）
const CACHE_DIR = path.join(os.homedir(), '.commandcode-usage');
const CACHE_FILE = path.join(CACHE_DIR, 'last-report.json');

/** 只存摘要，用来判断快照是不是当前这个账号的——不存 key 本身。 */
export function keyDigest(key) {
  const text = String(key);
  // 非加密用途：只用来判断缓存是不是当前这个账号的。32 位 FNV-1a 足够
  // （不同 key 撞车概率约十亿分之一），换来的是不用加载 node:crypto。
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${h.toString(36)}`;
}

function readCache() {
  const doc = readJsonSafe(CACHE_FILE);
  if (!doc || typeof doc !== 'object' || !('savedAt' in doc)) return null;
  // view 可以为 null —— 那是一条"上次取数失败"的退避记录，不是"没有缓存"。
  return {
    view: doc.view ?? null,
    digest: doc.digest,
    lastActiveAt: typeof doc.lastActiveAt === 'number' ? doc.lastActiveAt : null,
    age: Math.max(0, Date.now() - (Number(doc.savedAt) || 0)),
  };
}

// 取数失败（Go 套餐没有 API 权限、断网、key 失效）时的退避时长。
// 不退避的话状态栏每轮都会打四个接口然后失败，既慢又在刷日志。
const FAIL_BACKOFF_MS = 300_000;

// 「这个账号最近一次真的在跑」是什么时候。
// 判断依据是接口报的请求数有没有变化——用户切走之后，这个数字就不再动了。
// 注意这是**账号级**的兜底判据，不是主判据：你在别的机器/别的宿主上用它，
// 这里的数字照样在涨。主判据见上面的 routeDecision。
function activityOf(view) {
  const prev = readCache();
  const prevReq = prev?.view?.summary?.requests;
  const nowReq = view?.summary?.requests;
  const hasPrev = typeof prevReq === 'number';
  // 用"变了没"而不是"涨了没"：跨计费周期时计数会归零，那同样说明账号在被使用。
  const changed = hasPrev && typeof nowReq === 'number' && nowReq !== prevReq;
  // 第一次拿到数据时无从比较，当成"在用"，否则刚装完会一直不显示。
  const lastActiveAt = !hasPrev || changed ? Date.now() : (prev?.lastActiveAt ?? Date.now());
  return { lastActiveAt, requests: typeof nowReq === 'number' ? nowReq : null };
}

function writeCache(view, digest) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const doc = view
      ? { savedAt: Date.now(), digest, view, ...activityOf(view) }
      : { savedAt: Date.now(), digest, view: null, lastActiveAt: readCache()?.lastActiveAt ?? null };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(doc), 'utf8');
  } catch {
    // 缓存写不进去不该让状态栏报错，静默降级为「每次都现取」。
  }
}

/** 后台补一次数；不阻塞本次输出，失败也无所谓。 */
function refreshInBackground(opts) {
  const args = [process.argv[1], '--refresh-cache'];
  if (opts.org) args.push('--org', opts.org);
  try {
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } catch {
    // 起不来就下次再说。
  }
}

const CATALOG_TTL_MS = 24 * 3600_000;
// 惰性求值：CACHE_DIR 在下面的状态栏小节里才定义，顶层直接算会踩暂时性死区。
const catalogFile = () => path.join(CACHE_DIR, 'models.json');

/** 统一大小写、去掉 vendor 前缀和 [1M] 这类上下文后缀，便于比对。 */
export function normalizeModel(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]\s*$/, '')
    .replace(/^[a-z0-9._-]+\//, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function readCatalog() {
  const doc = readJsonSafe(catalogFile());
  if (!doc || !Array.isArray(doc.ids) || !doc.ids.length) return null;
  if (Date.now() - (Number(doc.savedAt) || 0) > CATALOG_TTL_MS) return null;
  return doc.ids;
}

/** 模型表很少变，缓存一天；拉不到就沿用旧的。 */
async function ensureCatalog(apiBase) {
  if (readCatalog()) return;
  try {
    const res = await apiGet(apiBase, undefined, '/provider/v1/models', {}, 8000);
    const list = res?.data ?? res?.models ?? (Array.isArray(res) ? res : null);
    if (!Array.isArray(list)) return;
    const ids = list.map((m) => normalizeModel(m?.id)).filter(Boolean);
    if (!ids.length) return;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(catalogFile(), JSON.stringify({ savedAt: Date.now(), ids }), 'utf8');
  } catch {
    // 拉不到就算了——判定会退回"未知"，再退回用量活跃度。
  }
}

/**
 * 读 stdin 上的 JSON，但**绝不阻塞**。
 *
 * 不能用 readFileSync(0)：宿主不喂 stdin 时（手动在终端跑、或某些宿主不传数据）
 * 它会一直等到 EOF，而那个 EOF 永远不来——整个状态栏就卡死在那儿。
 * 所以限定一个很短的窗口，拿不到就当没有。
 */
function readStdinJson(timeoutMs = 150) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve(null);
    let settled = false;
    let raw = '';
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 松手：剩下的数据不重要了，别让这个句柄吊着进程不退出。
      try { process.stdin.pause(); } catch { /* 已经关了 */ }
      resolve(value);
    };
    const timer = setTimeout(() => settle(null), timeoutMs);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { raw += chunk; });
      process.stdin.on('end', () => {
        try { settle(raw.trim() ? JSON.parse(raw) : null); } catch { settle(null); }
      });
      process.stdin.on('error', () => settle(null));
      process.stdin.resume();
    } catch {
      settle(null);
    }
  });
}

/** 从 transcript 尾部找这一轮真实用的模型名；只读尾部 128KB，不整文件扫。 */
function lastUsedModel(transcriptPath) {
  if (!transcriptPath) return null;
  let fd;
  try {
    const size = fs.statSync(transcriptPath).size;
    const start = Math.max(0, size - 128 * 1024);
    fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    // 从后往前：跳过子代理（isSidechain）和 <synthetic> 这类占位。
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      // 快速跳过不可能含模型名的行（避免每行都 JSON.parse）。
      // 注意要同时认 "message" 和 "modelId"——Grok 用的是后者。
      if (!line || !/"message"|"modelId"/.test(line)) continue;
      let doc;
      try { doc = JSON.parse(line); } catch { continue; }
      if (doc?.isSidechain === true) continue;
      // 各宿主的字段名不同：
      //   Claude Code —— 消息体里的 message.model
      //   Grok Build  —— updates.jsonl 每条 update 顶层的 modelId
      const m = doc?.message?.model ?? doc?.modelId ?? null;
      if (typeof m === 'string' && m && !m.startsWith('<')) return m;
    }
  } catch {
    // 读不到（路径不存在 / 权限 / 格式变了）就当未知。
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* 已经关了 */ } }
  }
  return null;
}

/**
 * cc-switch 这类"本地路由"会把模型名重映射。它们成对写进 settings.json 的 env：
 *   ANTHROPIC_DEFAULT_OPUS_MODEL      = claude-opus-5[1M]              ← Claude Code 看到的假名
 *   ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = deepseek/deepseek-v4.1-flash   ← 真实上游
 * 这两个环境变量 statusLine 子进程能继承到，于是可以把假名直接换算成真名——
 * 不用去读 transcript，不用猜，也不用等网络。
 *
 * 拿 stdin 里的 model.id 去反查：哪个 *_MODEL 的值等于它，就取配对的 *_NAME。
 * 对不上说明这个会话没走本地路由（或用的就是真名），返回 null 由后面的判据接手。
 */
function upstreamFromEnvAlias(localId, env = process.env) {
  if (!localId) return null;
  const want = normalizeModel(localId);
  for (const [name, value] of Object.entries(env)) {
    if (!/^ANTHROPIC_DEFAULT_[A-Z0-9_]+_MODEL$/.test(name)) continue;
    if (normalizeModel(value) !== want) continue;
    const real = env[`${name}_NAME`];
    if (real && real.trim()) return real.trim();
  }
  return null;
}

/**
 * 纯判定：给一个真实模型名和一份模型目录，说这一轮在不在用 Command Code。
 *
 * 抽成纯函数是为了能脱离网络和凭证测试——routeDecision 的输入要靠取数才拿得到，
 * 而 CI 上既没有凭证也不该联网。
 */
export function decideRoute(used, catalog, { modelPatterns = [], trustedSource = false } = {}) {
  if (!used) return 'unknown';
  const norm = normalizeModel(used);

  // 用户显式给了别名就用用户的——自动匹配不可能覆盖所有命名习惯。
  if (modelPatterns.length) {
    return modelPatterns.some((p) => norm.includes(p)) ? 'yes' : 'no';
  }

  if (!Array.isArray(catalog) || !catalog.length) return 'unknown';
  if (!catalog.includes(norm)) return 'no';
  // 走本地路由时拿到的是路由配的真实上游，比 transcript 更可信，
  // 所以不做下面那条规避——那不是名字，是路由配置。
  if (trustedSource) return 'yes';
  // claude-* 这类名字 Command Code 目录里有，但原生 Anthropic 也叫这个名，
  // 光凭名字分不出路由到哪——不猜，退回下一级判据。
  if (/^claude-/.test(norm)) return 'unknown';
  return 'yes';
}

/**
 * 这一轮在不在用 Command Code。
 * 'yes' 确定在用 / 'no' 确定没用 / 'unknown' 拿不到证据（退回用量活跃度判断）。
 */
export function routeDecision(stdinDoc, opts = {}) {
  // 目录可注入：CI 上没有缓存文件也没有网络，不注入就只能测到"未知"那条路。
  const catalog = opts.catalog ?? readCatalog();
  const ask = (used, trusted) => ({
    decision: decideRoute(used, catalog, { modelPatterns: opts.modelPatterns, trustedSource: trusted }),
    used,
    source: trusted ? '路由映射' : '模型名',
  });

  // 1) 本地路由（cc-switch 之类）把映射写在环境变量里，换算一下就知道真实上游是谁。
  //    这条最硬——它就是路由本身配的东西，不是推测。
  const aliasUpstream = upstreamFromEnvAlias(stdinDoc?.model?.id, opts.env ?? process.env);
  if (aliasUpstream) return ask(aliasUpstream, true);

  // 2) 宿主直接给的模型名。
  //    Codex 的钩子把 model 作为**字符串**放在 stdin 里（实测 "gpt-5.6-terra"），
  //    而它的 transcript_path 是空的——所以这条对 Codex 是必需的，光靠 transcript 会永远判成未知。
  //    Claude Code 那边 model 是对象，不会走到这里。
  const direct = typeof stdinDoc?.model === 'string' && stdinDoc.model.trim() ? stdinDoc.model.trim() : null;
  if (direct) return ask(direct, false);

  // 3) 会话记录里这一轮真实用的模型。
  const fromTranscript = lastUsedModel(stdinDoc?.transcript_path);
  if (!fromTranscript) return { decision: 'unknown', used: null, source: null };
  return ask(fromTranscript, false);
}



// 进度条沿用用户自己 statusline.mjs 的视觉语言：填充上色、空白压暗、八分之一块做
// 半格精度。空白如果也上亮色，低百分比时整条就是一片噪点——这是之前最丑的地方。
const BAR_CELLS = 10;
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

function statusBar(pct, c, level, cells = BAR_CELLS) {
  const exact = (Math.min(Math.max(pct, 0), 100) / 100) * cells;
  let full = Math.floor(exact);
  let rem = Math.round((exact - full) * 8);
  if (rem >= 8) { full += 1; rem = 0; }
  const filled = '█'.repeat(full) + (rem > 0 ? EIGHTHS[rem] : '');
  const empty = '░'.repeat(Math.max(0, cells - full - (rem > 0 ? 1 : 0)));
  return `${sevColor(c, level, filled)}${c.dim(empty)}`;
}

/** 「还有多久重置」比秒级精度重要。跨天的直接给日期——"29d21h" 远不如 "09-25" 好读。 */
function resetText(w) {
  if (!w?.resetAt) return null;
  const ms = w.resetsInMs ?? Math.max(0, w.resetAt - Date.now());
  if (ms >= 86400_000) return `${clock(w.resetAt).slice(0, 5)}重置`;
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const body = h > 0 ? `${h}h${m > 0 ? `${m}m` : ''}` : m > 0 ? `${m}m` : `${t}s`;
  return `${body}后重置`;
}

/**
 * 状态栏与钩子共用的输出。
 *
 * 钩子要的是 stdout 上的 JSON，而且必须单行、无 ANSI——systemMessage 是纯文本，
 * 带上转义码会原样显示成乱码。
 *
 * 抽出来是因为 --demo 走的是 emit()、不走 statuslineMode()：之前钩子分支只写在
 * statuslineMode() 里，于是 `--hook --demo` 会掉进终端面板那条路。
 */
function emitStatus(view, opts, extra = {}) {
  const text = renderStatusline(view, {
    ...opts,
    ...extra,
    rows: opts.hook ? 1 : opts.rows,
    color: opts.hook ? false : opts.color,
  });
  if (!text) return;

  if (opts.hook) {
    // Codex 的钩子协议：用 systemMessage 而不是 additionalContext——前者只显示给用户看，
    // 不进模型上下文，所以每轮弹一次也不烧 token。
    process.stdout.write(JSON.stringify({ systemMessage: text }) + LF);
  } else {
    process.stdout.write(text + LF);
  }
}

function renderStatusline(view, opts = {}) {
  const c = makeColors(opts.color !== false);
  const w5 = view.windows?.fiveHour ?? null;
  const wk = view.windows?.weekly ?? null;
  const limited = view.windows?.limited !== false;
  // 余额不受 limited 影响：Provider 这种按量计费套餐没有滚动窗口，但余额仍要看。
  const m = view.monthly ?? null;

  // 阈值模式：给 Codex 这类只能弹一行警告、弹了就要占屏幕的宿主用。
  // 没过线就一个字都不输出，平时完全安静。
  if (opts.threshold !== null && opts.threshold !== undefined) {
    const peak = [w5, wk, m]
      .filter(Boolean)
      .reduce((acc, w) => Math.max(acc, w.rawPercent ?? w.percent ?? 0), 0);
    if (!(peak >= opts.threshold)) return '';
  }

  const cols = Number(process.env.COLUMNS) || 80;
  const barW = Math.max(6, Math.min(12, cols - 44));
  const planName = view.plan?.name ?? '按量计费';

  const periodEnd = view.plan?.currentPeriodEnd ? Date.parse(view.plan.currentPeriodEnd) : null;
  const monthAsWindow = m
    ? {
        started: true,
        percent: m.percent,
        rawPercent: m.rawPercent,
        exceeded: m.rawPercent >= 100,
        resetAt: periodEnd,
        resetsInMs: periodEnd !== null ? Math.max(0, periodEnd - Date.now()) : null,
      }
    : null;

  // 状态栏是余光扫的东西，50% 就报黄会让人麻木——跟 dsh 插件一样按 60/85 分档。
  const levelFor = (p, exceeded) => (exceeded || p >= 100 ? 'critical' : p >= 85 ? 'high' : p >= 60 ? 'medium' : 'low');

  // 单行模式：跟用户自己那个状态栏脚本同一套视觉语言——进度条 + `│` 分隔。
  // 每条窗口都带自己的重置时间；金额只给月度（5 小时和每周是"过/不过"的闸门，不是预算）。
  if (opts.rows === 1) {
    // 按量计费 / Enterprise：没有滚动窗口，能看的就是余额本身。
    if (!limited) {
      return m ? `${c.bold(`CC ${planName}`)} ${c.gray('│')} 余额 ${c.bold(money(m.remaining))}` : '';
    }
    const win = [['5h', w5], ['周', wk], ['月', monthAsWindow]].filter(([, w]) => w?.started);
    if (!win.length) return '';

    const SEP = ' │ ';
    const stripped = (x) => String(x).replace(/\[[0-9;]*m/g, '');
    const wOf = (x) => displayWidth(stripped(x));
    // 顺序固定（5h→周→月），不按松紧排：固定位置才不用每次重新找。
    const tightLabel = win.reduce((a, b) => ((b[1].rawPercent ?? 0) > (a[1].rawPercent ?? 0) ? b : a))[0];

    const build = (barW, resetsFor, showMoney) => {
      const segs = win.map(([label, w]) => {
        const real = w.rawPercent ?? w.percent ?? 0;
        const lvl = levelFor(real, w.exceeded);
        const inner = [];
        if (barW > 0) inner.push(statusBar(real, c, lvl, barW));
        inner.push(sevColor(c, lvl, `${Math.round(real)}%`));
        // 这条 bar 说的是「已用多少」，金额是「还剩多少」——两个方向，不加标签就会被读成一回事。
        if (showMoney && w === monthAsWindow && m) inner.push(c.gray(`剩${money(m.remaining)}`));
        if (resetsFor === 'all' || label === tightLabel) {
          const r = resetText(w);
          if (r) inner.push(c.gray(r));
        }
        return `${c.gray(label)} ${inner.join(' ')}`;
      });
      const head = `${c.bold(`CC ${planName}`)} ${c.gray('│')} `;
      const text = `${head}${segs.join(c.gray(SEP))}`;
      return { text, width: wOf(head) + segs.reduce((n, x) => n + wOf(x), 0) + SEP.length * (segs.length - 1) };
    };

    // 宽度不够就按优先级往下砍：先缩条 → 去掉条 → 只留最紧那条的重置 → 去掉金额。
    // 宁可少显示几项，也不能折行——折行会让整个底部错位，比少一个数字难看得多。
    for (const [barW, resetsFor, showMoney] of [
      [10, 'all', true],
      [8, 'all', true],
      [6, 'all', true],
      [0, 'all', true],
      [0, 'tight', true],
      [0, 'tight', false],
    ]) {
      const built = build(barW, resetsFor, showMoney);
      if (built.width <= cols) return built.text;
    }
    return build(0, 'tight', false).text;
  }

  // 三条窗口按「最紧的排最上面」——5 小时最先拦住你，所以它第一行。
  const rows = [];
  const pushRow = (label, w, money, reset) => {
    if (!w) return;
    if (!w.started) {
      rows.push([label, c.gray('未开启')]);
      return;
    }
    const shown = Math.max(0, Math.min(100, w.percent));
    const real = w.rawPercent ?? shown;
    const lvl = levelFor(real, w.exceeded);
    const parts = [statusBar(shown, c, lvl, barW), sevColor(c, lvl, `${String(Math.round(real)).padStart(3)}%`)];
    if (money) parts.push(c.gray(money));
    if (reset) parts.push(c.gray(reset));
    rows.push([label, parts.join(' ')]);
  };

  if (!limited) {
    return m ? `${c.bold(`CC ${planName}`)} ${c.gray('│')} 余额 ${c.bold(money(m.remaining))}` : '';
  }
  pushRow('5h', w5, null, resetText(w5));
  pushRow('周', wk, null, resetText(wk));
  // 三行模式同理：bar 是「用了多少」，金额是「还剩多少」，标签放在决定数值的地方。
  pushRow('月', monthAsWindow, m ? `剩${money(m.remaining)}` : null, resetText(monthAsWindow));

  if (!rows.length) return '';

  // 第一行带套餐名，后两行留白对齐。
  const head = c.bold(`CC ${planName}`);
  const pad = ' '.repeat(displayWidth(`CC ${planName}`) + 1);
  const labelW = Math.max(...rows.map((r) => displayWidth(r[0])));

  const lines = rows.map(([label, body], i) => {
    const lead = i === 0 ? `${head} ` : pad;
    return `${lead}${c.gray(padEndW(label, labelW))} ${body}`;
  });

  // 快照年龄只在「明显过期」时才标：几十秒的陈旧对额度这种量级没有意义，
  // 每帧都挂个 ⟳12s 只会变成噪音。阈值取 max(cacheTtl, 3 分钟)：TTL 调大时标记
  // 跟着一起走，TTL 调小时也不会退化成每帧都挂。
  const staleMarkMs = Math.max(Number(opts.cacheTtl) || 0, 180_000);
  if (opts.stale && typeof opts.ageMs === 'number' && opts.ageMs > staleMarkMs) {
    lines[lines.length - 1] += c.gray(` ⟳${Math.round(opts.ageMs / 1000)}s`);
  }
  return lines.join('\n');
}

// 换行符显式构造，避免多层引号里的转义歧义。
const LF = String.fromCharCode(10);

async function statuslineMode(creds, opts) {
  if (!creds) return; // 没配 Command Code 就完全不占位置，这是状态栏该有的礼貌。

  const stdinDoc = await readStdinJson();
  const digest = keyDigest(creds.apiKey);
  const cached = opts.noCache ? null : readCache();
  // 快照属于另一个账号就作废，免得换了 key 还显示旧账号的数。
  const usable = cached && cached.digest === digest ? cached : null;

  let view = usable?.view ?? null;
  let stale = false;

  if (!view) {
    // 上次取数失败且还在退避窗口内：这轮什么都不显示，别再去撞一次。
    if (usable && usable.view === null && usable.age < FAIL_BACKOFF_MS) return;
    try {
      // 模型目录和用量一起取：判定"这一轮在不在用它"要用到目录。
      const [raw] = await Promise.all([
        collectUsage({ apiKey: creds.apiKey, apiBase: creds.apiBase, orgId: opts.org }),
        ensureCatalog(creds.apiBase || DEFAULT_API_BASE),
      ]);
      view = normalize(raw, { now: Date.now(), apiBase: creds.apiBase || DEFAULT_API_BASE, credentialSource: creds.source });
      if (!opts.noCache) writeCache(view, digest);
    } catch {
      // 没有旧图可退，就彻底安静——状态栏不是报错的地方。
      if (!opts.noCache) writeCache(null, digest);
      return;
    }
  } else if (usable.age > opts.cacheTtl) {
    stale = true;
    refreshInBackground(opts);
    ensureCatalog(creds.apiBase || DEFAULT_API_BASE).catch(() => {});
  }

  if (!opts.always) {
    // 一级判据：这一轮用的是哪个模型。切走了就不该继续挂在这儿。
    const { decision, used, source } = routeDecision(stdinDoc, opts);
    if (decision === 'no') {
      if (opts.why) {
        process.stderr.write(`隐藏：这一轮用的是 ${used}（来自${source === '路由映射' ? '本地路由的环境变量映射' : 'transcript'}），不在 Command Code 的模型目录里
`);
      }
      return;
    }
    // 二级判据（只在拿不到本轮证据时才用）：账号用量还动不动。
    // 它能挡住"陈年旧数据一直占着"，但挡不住"你在别的机器/别的宿主上用它"——
    // 那种情况下数字照样在涨，所以只能作为兜底。
    if (decision === 'unknown' && opts.idleHideMs > 0) {
      const lastActiveAt = usable?.lastActiveAt ?? Date.now();
      if (Date.now() - lastActiveAt > opts.idleHideMs) {
        if (opts.why) {
          process.stderr.write(`隐藏：拿不到本轮模型证据（${used ? `只认出 ${used}` : 'stdin 里没有模型信息'}），且账号用量已闲置超过 ${opts.idleHideMs / 60000} 分钟` + LF);
        }
        return;
      }
    }
  }

  emitStatus(view, opts, { stale, ageMs: stale ? usable?.age : undefined });
}

function emit(view, opts) {
  // 状态栏和钩子都走这里——--demo 是经 emit() 出去的，漏掉钩子就预览不了。
  if (opts.mode === 'statusline' || opts.hook) {
    emitStatus(view, opts);
    return;
  }
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

// 只有直接执行时才跑 CLI。被适配器 import 时（dsh 的 quota.mjs 那样）只提供函数，
// 不能顺手把整个 CLI 跑一遍。
const isDirectRun = (() => {
  const entry = String(process.argv[1] || '').replace(/\\/g, '/').toLowerCase();
  if (!entry) return false;
  const self = decodeURIComponent(new URL(import.meta.url).pathname)
    .replace(/^\//, '')
    .replace(/\\/g, '/')
    .toLowerCase();
  return entry === self || entry.endsWith(self) || self.endsWith(entry);
})();

if (isDirectRun) main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
