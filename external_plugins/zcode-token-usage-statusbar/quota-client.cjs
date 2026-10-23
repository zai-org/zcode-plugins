/* 额度客户端（主进程，冷文件）v3：多厂商适配器 + 多源调度器。
 * 阶段 3（浮层 v96 线）：BigModel/Z.ai 内置套餐（解密宿主 OAuth 凭据直查 monitor 端点）
 * 之外，新增零配置官方域适配器（MiniMax/Kimi/CommandCode/DeepSeek/OpenRouter/SiliconFlow/
 * Anthropic OAuth）与显式配置适配器（Cline/MiMo Cookie/火山 AK-SK/SCNet 账本）。
 *
 * 调度语义：enabled 源全量低频刷新（供 tooltip 分家列全），chip 主显跟随本 pane 会话的
 * 模型归属（primary 源）。每源独立 nextAt/epoch/退避/凭据指纹；凭据只在内存，不落盘、
 * 不进日志与诊断；诊断只记 status/HTTP code/错误摘要；key 只发各适配器声明的域。
 *
 * 凭据发现优先级（契约）：环境变量 → quota-secrets.json（运行目录 0600）→ 自动发现
 * （宿主 provider_config.json 的自定义供应商 key；Anthropic 另读 ~/.claude/.credentials.json）。
 * 源码转写声明：MiniMax/Kimi/CommandCode/Cline/MiMo/火山/SCNet 的端点与字段转写自
 * dsh-cost-meter 与 cc-switch（MIT），其中无真实账号实测的家在适配器上标注 unverified。
 *
 * 输出协议：view() = { active, sources: {id: entry} }；为兼容本版浮层，active 源的
 * 字段同时镜像到顶层（下版移除）。entry 形状与 v96 单源一致（status/windows/tools/
 * models/level/plan/balance/stale/...），balance 扩展 parts[]（赠送/充值拆分）。 */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ENC_PREFIX = "enc:v1:";
const QUOTA_PATH = "/api/monitor/usage/quota/limit";
const TTL_MS = 10 * 60 * 1000;            // 套餐窗默认（对齐宿主 usageEntitlementCache）
const TTL_BALANCE_MS = 15 * 60 * 1000;    // 余额默认（dsh 同款）
const FETCH_TIMEOUT_MS = 10 * 1000;
const BODY_LIMIT = 256 * 1024;
const BACKOFF_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000, 10 * 60 * 1000];
const PARSE_BACKOFF_MS = 30 * 60 * 1000;
const NOT_CONFIGURED_RETRY_MS = 60 * 1000;
const EXP_SOON_MS = 2 * 60 * 1000;
const EXP_RETRY_MS = 5 * 60 * 1000;

/* ---------- 基础工具 ---------- */
function sha16(v) { return crypto.createHash("sha256").update(String(v)).digest("hex").slice(0, 16); }
function qErr(code, message, extra) {
  return Object.assign(new Error(message), Object.assign({ code }, extra || {}));
}
function clampPct(x) { return Math.max(0, Math.min(100, x)); }
function parseRetryAfterMs(v) {
  if (v == null) return null;
  const sec = Number(v);
  if (isFinite(sec) && sec >= 0) return Math.min(Math.max(sec * 1000, 30 * 1000), 10 * 60 * 1000);
  return 60 * 1000;
}
function jwtExpMs(token) {
  try {
    const payload = String(token).split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.exp === "number" && json.exp > 0 ? json.exp * 1000 : null;
  } catch (e) { return null; }
}

/* ---------- 宿主凭据解密（enc:v1 AES-256-GCM，按宿主语义重写） ---------- */
function deriveSecret(env) {
  const conf = env.ZCODE_CREDENTIAL_SECRET;
  if (conf) return conf;
  let username = "unknown";
  try { username = os.userInfo().username; } catch (e) { /* 拿不到用户名按占位 */ }
  return `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${username}`;
}
function deriveCipherKey(env) { return crypto.createHash("sha256").update(deriveSecret(env)).digest(); }
function decryptValue(value, key) {
  if (typeof value !== "string" || !value.startsWith(ENC_PREFIX)) return value;
  const parts = value.slice(ENC_PREFIX.length).split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || parts[2] === undefined) return null;
  let iv, tag, ct;
  try {
    iv = Buffer.from(parts[0], "base64url");
    tag = Buffer.from(parts[1], "base64url");
    ct = Buffer.from(parts[2], "base64url");
  } catch (e) { return null; }
  if (iv.length !== 12 || tag.length !== 16) return null;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch (e) { return null; }
}

/* ---------- BigModel/Z.ai monitor 归一化（v96 口径不变） ---------- */
function isNoPlanMessage(msg) {
  const m = String(msg || "").toLowerCase();
  const compact = m.replace(/[\s_-]/g, "");
  return compact.indexOf("codingplan") >= 0 &&
    ["不存在", "没有", "未开通", "not exist", "not found", "not have", "doesn't have", "no coding plan", "not subscribed"]
      .some((kw) => m.indexOf(kw) >= 0);
}
function pctOf(limit) {
  if (typeof limit.percentage === "number" && limit.percentage >= 0) {
    if (typeof limit.currentValue === "number" && typeof limit.usage === "number" &&
        limit.usage > 0 && limit.currentValue >= 0) {
      return Math.round(clampPct((limit.currentValue / limit.usage) * 100) * 10) / 10;
    }
    return Math.round(clampPct(limit.percentage) * 10) / 10;
  }
  if (typeof limit.currentValue === "number" && typeof limit.usage === "number" &&
      limit.usage > 0 && limit.currentValue >= 0) {
    return Math.round(clampPct((limit.currentValue / limit.usage) * 100) * 10) / 10;
  }
  return null;
}
function resetOf(v) {
  if (typeof v === "number" && isFinite(v)) {
    if (v <= 0) return null;
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === "string" && v) return v;
  return null;
}
function usageDetailsOf(limit) {
  const out = [];
  if (Array.isArray(limit && limit.usageDetails)) {
    for (const u of limit.usageDetails) {
      if (u && typeof u === "object" && typeof u.modelCode === "string" && u.modelCode) {
        out.push({ modelCode: u.modelCode, displayName: typeof u.displayName === "string" ? u.displayName : "", usage: typeof u.usage === "number" ? u.usage : null });
      }
    }
  }
  return out;
}
function normalizeQuotaBody(body) {
  if (!body || typeof body !== "object") throw qErr("parse_error", "non-object body");
  if (body.success === false) {
    const msg = String(body.msg || "");
    if (isNoPlanMessage(msg)) return { noPlan: true };
    throw qErr("network_error", "business error: " + msg.slice(0, 80));
  }
  const data = body.data;
  if (!data || typeof data !== "object" || !Array.isArray(data.limits)) {
    throw qErr("parse_error", "missing data.limits");
  }
  const windows = { fiveHour: null, weekly: null };
  let tools = null;
  const unknownUnits = [];
  const unclassified = [];
  const models = [];
  const seenModel = {};
  for (const limit of data.limits) {
    if (!limit || typeof limit !== "object") continue;
    const type = String(limit.type || "").toUpperCase();
    if (type === "TIME_LIMIT") {
      if (!tools) {
        tools = {
          used: typeof limit.currentValue === "number" ? limit.currentValue : null,
          total: typeof limit.usage === "number" ? limit.usage : null,
          resetsAt: resetOf(limit.nextResetTime),
        };
      }
      continue;
    }
    if (type !== "TOKENS_LIMIT" && type !== "CREDIT_LIMIT") continue;
    const entry = { percent: pctOf(limit), resetsAt: resetOf(limit.nextResetTime), details: usageDetailsOf(limit) };
    for (const m of entry.details) {
      const key = m.displayName || m.modelCode;
      if (!seenModel[key]) { seenModel[key] = 1; models.push(key); }
    }
    const u = typeof limit.unit === "number" ? limit.unit : null;
    if (u === 3) { if (!windows.fiveHour) windows.fiveHour = entry; }
    else if (u === 6) { if (!windows.weekly) windows.weekly = entry; }
    else if (u === null) unclassified.push(entry);
    else unknownUnits.push(u);
  }
  unclassified.sort((a, b) => {
    const ra = a.resetsAt == null ? -1 : (typeof a.resetsAt === "string" ? 0 : a.resetsAt);
    const rb = b.resetsAt == null ? -1 : (typeof b.resetsAt === "string" ? 0 : b.resetsAt);
    return ra - rb;
  });
  for (const entry of unclassified) {
    if (!windows.fiveHour) windows.fiveHour = entry;
    else if (!windows.weekly) windows.weekly = entry;
  }
  return { level: typeof data.level === "string" ? data.level : "", windows, tools, models, unknownUnits };
}
/* 订阅周期字段语义（与宿主 bigmodelUsageQuotaMapper.pickCurrentSubscriptionExpireTime 语义对齐且更严）：
 * - nextRenewTime：非自动续费=当前权益结束日；自动续费=下次扣费日（不是最终到期）。
 *   接受纯日期与宿主同款日期时间（空格/T 分隔、可选秒、Z 或 ±hh:mm 偏移；无偏移按
 *   服务端 UTC+8 解释）。
 * - valid 区间可能超前一个计费周期（issue：年度套餐显示 2028-03-14），只有包含
 *   "当前时刻"的区间才能作为权益边界回退；端点带时刻按精确时刻比较（续费日当天
 *   10:00 前未来区间不算生效），仅日期端点按服务端日历日左闭右开；未来/过期/反转/
 *   非法日历或非法时刻（25:99 等）一律整段不采信。
 * - 仅日期的续费边界覆盖整个服务端日：续费日当天上午不清除当前权益显示；
 *   带时刻的续费边界在时刻过后按陈旧数据处理（隐藏日期，不显示下一年）。
 * - currentRenewTime 是当前周期起点；缺失或非法时不暴露，不用未来 valid 起点冒充。 */
const SUB_TZ_OFFSET_MS = 8 * 3600 * 1000;   // BigModel 服务端日历 Asia/Shanghai
function serviceDayMs(day, endExclusive) {
  const y = Number(day.slice(0, 4)), mo = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10)) + (endExclusive ? 1 : 0);
  return Date.UTC(y, mo - 1, d) - SUB_TZ_OFFSET_MS;   // 服务端日的 00:00（endExclusive=次日 00:00）
}
/* 解析单个订阅时间值 → { day, at }；at=精确时刻 ms（值带时刻时），纯日期为 null。
 * 形状/日历/时刻任一非法返回 null（整值拒绝）。 */
function subscriptionTimestamp(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const day = m[1] + "-" + m[2] + "-" + m[3];
  if (m[4] === undefined) return { day: day, at: null };
  const hh = Number(m[4]), mi = Number(m[5]);
  const ss = m[6] === undefined ? 0 : Number(m[6]);
  if (hh > 23 || mi > 59 || ss > 59) return null;
  let at = Date.UTC(y, mo - 1, d, hh, mi, ss);
  if (m[7] === undefined) at -= SUB_TZ_OFFSET_MS;   // 无偏移：服务端时区
  else if (m[7] !== "Z") {
    const offsetHour = Number(m[7].slice(1, 3)), offsetMinute = Number(m[7].slice(-2));
    // ISO 8601：分钟 00-59，小时上限 ±14:00；超界偏移视同非法值
    if (offsetMinute > 59 || offsetHour > 14 || (offsetHour === 14 && offsetMinute > 0)) return null;
    at += (m[7][0] === "+" ? -1 : 1) * (offsetHour * 60 + offsetMinute) * 60000;
  }
  return { day: day, at: at };
}
function parseValidPeriod(value, now) {
  if (typeof value !== "string") return null;
  /* 时刻 token 吸收时偏移必须带冒号（±hh:mm）：免冒号变体会把紧随的下一个日期
   * （"16:28:31-2027-02-28"）误吞成偏移。 */
  const tokens = value.match(/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?/g);
  if (!tokens || tokens.length < 2) return null;
  const start = subscriptionTimestamp(tokens[0]);
  const end = subscriptionTimestamp(tokens[tokens.length - 1]);
  if (!start || !end || start.day > end.day) return null;
  const startMs = start.at != null ? start.at : serviceDayMs(start.day, false);
  const endMs = end.at != null ? end.at : serviceDayMs(end.day, false);   // 仅日期末端：日粒度右开
  return { start: start.day, end: end.day, current: startMs <= now && now < endMs };
}
function normalizeSubscriptionPlan(body, nowMs) {
  const data = body && typeof body === "object" && Array.isArray(body.data) ? body.data : null;
  if (!data) return null;
  const active = data.filter((e) => e && typeof e === "object" && e.status === "VALID" && e.inCurrentPeriod === true);
  if (active.length !== 1) return null;
  const s = active[0];
  const now = typeof nowMs === "number" && isFinite(nowMs) ? nowMs : Date.now();
  const autoRenew = s.autoRenew === true || s.autoRenew === 1;
  const nextRenew = subscriptionTimestamp(s.nextRenewTime);
  const currentRenew = subscriptionTimestamp(s.currentRenewTime);
  const valid = parseValidPeriod(s.valid, now);
  const out = {
    version: typeof s.version === "string" ? s.version.slice(0, 8) : "",
    productName: typeof s.productName === "string" ? s.productName.slice(0, 40) : "",
    validStart: "",
    validEnd: "",
  };
  /* 续费边界时刻：带时刻按精确时刻；纯日期覆盖整个服务端日（当天上午仍属当前权益，
   * 服务端 10:00 扣费惯例下不到时刻不清除；时刻已过=陈旧行，不采信）。 */
  const renewBoundary = nextRenew && (nextRenew.at != null ? nextRenew.at : serviceDayMs(nextRenew.day, true)) > now
    ? nextRenew : null;
  if (renewBoundary && currentRenew && currentRenew.day <= renewBoundary.day) out.validStart = currentRenew.day;
  else if (renewBoundary && valid && valid.current) out.validStart = valid.start;
  if (renewBoundary) {
    if (autoRenew) {
      out.renewAt = renewBoundary.day;   // 自动续费：下次扣费日，不声称最终到期
    } else {
      out.validEnd = renewBoundary.day;   // 非自动续费：nextRenewTime 即当前权益结束日
    }
    return out;
  }
  if (valid && valid.current) {
    out.validStart = valid.start;
    if (!autoRenew) out.validEnd = valid.end;
    else out.periodEnd = valid.end;   // 自动续费且无有效扣费日：仅记录当前周期末端
  }
  return out;
}

/* ---------- 余额工具 ---------- */
/* "CNY 110.00" / "¥110.00" / "$12.5" / 110.5 → {amount, currency}；解析不了返回 null */
function parseCurrencyAmount(v, currencyHint) {
  if (typeof v === "number" && isFinite(v)) return { amount: v, currency: currencyHint || "" };
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^([A-Z]{3}|¥|\$)?\s*([\d,]+(?:\.\d+)?)$/);
  if (!m) return null;
  const cur = m[1] === "¥" ? "CNY" : m[1] === "$" ? "USD" : (m[1] || currencyHint || "");
  return { amount: parseFloat(m[2].replace(/,/g, "")), currency: cur };
}
function num(v) {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(v.trim())) {
    const value = Number(v);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}
/* 通用窗口行收集：[{period|type, percentUsed|percent|utilization|usage_percentage, resetsAt|reset_at|resets_at|resetTime}] */
function collectWindows(list, defs) {
  const out = {};
  if (!Array.isArray(list)) return out;
  const names = new Map(defs.map((d) => (Array.isArray(d) ? [d[0], d[1]] : [d.match, d.name])));
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const key = String(e.type || e.period || e.window || "").toLowerCase().replace(/[\s_-]/g, "");
    const name = names.get(key);
    if (!name || out[name]) continue;
    let pct = num(e.percentUsed);
    if (pct == null) pct = num(e.percent);
    if (pct == null) pct = num(e.utilization);
    if (pct != null && e.usage_percentage != null) { /* ZenMux 0-1 已用小数 */ }
    if (pct == null && e.usage_percentage != null) pct = e.usage_percentage <= 1 ? e.usage_percentage * 100 : e.usage_percentage;
    if (pct == null || !isFinite(pct) || pct < 0) continue;
    out[name] = { percent: Math.round(clampPct(pct) * 10) / 10, resetsAt: resetOf(e.resetsAt != null ? e.resetsAt : (e.resets_at != null ? e.resets_at : e.resetTime)) };
  }
  return out;
}

/* ---------- 宿主路径与供应商配置（builtin → personal） ---------- */
function resolveQuotaPaths(opts) {
  const o = opts || {}, env = o.env || process.env;
  const home = o.defaultHome || os.homedir();
  // 可独立注入 win32；非 Windows 测试/诊断也不能把 D:\\... 当 POSIX 相对路径。
  const pathOf = (p) => o.pathImpl || (/^(?:[a-z]:[\\/]|\\\\)/i.test(p) ? path.win32 : path);
  const absolute = (p) => {
    if (p === "~") p = home;
    else if (/^~[\\/]/.test(p)) p = pathOf(home).join(home, p.slice(2));
    return pathOf(p).resolve(p);
  };
  const base = absolute(o.dataBaseDir || env.ZCODE_DATA_BASE_DIR || o.desktopHome || env.ZCODE_DESKTOP_HOME_DIR || home);
  const root = pathOf(base).join(base, ".zcode", "v2");
  const credsPath = absolute(o.credsPath || pathOf(root).join(root, "credentials.json"));
  const customCfgPath = absolute(o.customCfgPath || env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE || pathOf(root).join(root, "provider_config.json"));
  // Runtime builtin 文件由宿主按版本/endpoint 选择，不能扫描或猜测其它缓存副本。
  const builtin = o.builtinCfgPath || env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE;
  const builtinCfgPath = builtin ? absolute(builtin) : "";
  return { credsPath, customCfgPath, builtinCfgPath,
    credsDir: pathOf(credsPath).dirname(credsPath),
    customCfgDir: pathOf(customCfgPath).dirname(customCfgPath),
    builtinCfgDir: builtinCfgPath ? pathOf(builtinCfgPath).dirname(builtinCfgPath) : "" };
}
let providerCfgCache = null;
function loadProviderCfg(readFile2, cfgPath, builtinCfgPath) {
  const paths = [builtinCfgPath, cfgPath].filter(Boolean);
  let stamp = null;
  try { stamp = JSON.stringify(paths.map((p) => { const s = fs.statSync(p); return [p, s.mtimeMs, s.size]; })); }
  catch (e) { providerCfgCache = null; /* stat 失败仍现读，并撤销旧缓存，避免同时间戳重建后复活旧 key */ }
  if (stamp !== null && providerCfgCache && providerCfgCache.stamp === stamp && providerCfgCache.readFile === readFile2) {
    return providerCfgCache.byId;
  }
  const rules = new Map();
  for (const p of paths) {
    try {
      const d = readFile2(p);
      for (const r of ((d.config || {}).providerConfigRules || {}).providerRules || []) {
        if (!r || !r.providerId) continue;
        const old = rules.get(String(r.providerId)) || {}, cfg = r.config || {};
        rules.set(String(r.providerId), {
          name: r.providerName == null ? old.name : String(r.providerName),
          access: Object.assign({}, old.access, cfg.access),
          api: Object.assign({}, old.api, cfg.api),
        });
      }
    } catch (e) { /* 损坏/缺失按无配置处理 */ }
  }
  const byId = new Map();
  for (const [id, cfg] of rules) {
    byId.set(id, { baseUrl: String(cfg.api.baseUrl || "").replace(/\/+$/, ""), apiKey: String(cfg.access.apiKey || ""), name: cfg.name || "",
      accessType: String(cfg.access.type || "") });
  }
  if (stamp !== null) providerCfgCache = { stamp, readFile: readFile2, byId };
  return byId;
}
function resolveCustomProvider(providerId, readFile2, cfgPath, builtinCfgPath) {
  const e = loadProviderCfg(readFile2, cfgPath, builtinCfgPath).get(String(providerId));
  return e ? { baseUrl: e.baseUrl, apiKey: e.apiKey, name: e.name } : null;
}

/* apiKey 模式的 BigModel/Z.ai 连接（provider bigmodel-api[-N] / zai-api[-N]）：额度端点与 OAuth 同属账号池，
 * 凭据取 provider_config 里同家族的 key，编码套餐 key（access.type 以 coding-plan-api-key 结尾）优先，
 * 其次当前 provider 自身，再其次同家族首个非空 key。baseUrl 若显式配置必须落在官方域，
 * 否则视为指向第三方中转的同名 provider，绝不把它的 key 发往官方域。 */
const API_KEY_PROVIDER_RE = /^(bigmodel|zai)-api(?:-\d+)?$/;
const FAMILY_HOST_RE = { bigmodel: /(^|\.)bigmodel\.cn$/i, zai: /(^|\.)z\.ai$/i };
function apiKeyFamilyOf(providerId) {
  const m = API_KEY_PROVIDER_RE.exec(String(providerId || ""));
  return m ? m[1] : "";
}
function resolveFamilyApiKey(family, providerId, readFile2, cfgPath, builtinCfgPath) {
  const usable = [];
  for (const [id, e] of loadProviderCfg(readFile2, cfgPath, builtinCfgPath)) {
    if (apiKeyFamilyOf(id) !== family || !e.apiKey) continue;
    if (e.baseUrl) {
      let host = "";
      try { host = new URL(e.baseUrl).hostname; } catch (err) { continue; }
      if (!FAMILY_HOST_RE[family].test(host)) continue;
    }
    usable.push({ id, key: e.apiKey, plan: /coding-plan-api-key$/.test(e.accessType) });
  }
  const pick = usable.find((u) => u.plan && u.id === providerId) || usable.find((u) => u.plan) ||
    usable.find((u) => u.id === providerId) || usable[0];
  return pick ? pick.key : "";
}

/* ---------- 适配器注册表 ----------
 * 契约：{id, label, kind, envKeys[], defaultOn, unverified?,
 *   detect(j, providerId) → ctx|null   （providerId 驱动的零配置发现；返回 null=不命中）
 *   resolveCred(j, ctx) → {token|cookie|ak|sk|none, fingerprint, source} | null | {decryptFailed}
 *   fetchOne(j, ctx, cred, ctl) → value | {noPlan:true}   （抛 qErr 分类错误）}
 * j = {env, now, fetchImpl, readFile, secrets, customCfgPath, customProviderOf, log, http} */
const ADAPTERS = [];

/* --- BigModel / Z.ai 内置套餐（主链，v96 同款） --- */
for (const fam of ["bigmodel", "zai"]) {
  const conf = fam === "bigmodel"
    ? { credKey: "oauth:bigmodel:access_token", origin: "https://bigmodel.cn", bearer: false,
        envKeys: ["ZCODE_BIGMODEL_USAGE_API_KEY", "BIGMODEL_USAGE_API_KEY"], envUrl: "ZCODE_BIGMODEL_USAGE_QUOTA_URL", subPath: "/api/biz/subscription/list" }
    : { credKey: "oauth:zai:access_token", origin: "https://api.z.ai", bearer: true,
        envKeys: [], envUrl: "", subPath: null };
  ADAPTERS.push({
    id: fam, label: fam === "bigmodel" ? "BigModel" : "Z.ai", kind: "plan", defaultOn: false, envKeys: conf.envKeys,
    detect(j, providerId) {
      if (providerId.indexOf("account:") !== 0) return null;
      if (providerId.indexOf("team") >= 0) return { team: true };
      if (providerId.indexOf("account:" + fam) === 0) return { family: fam };
      return null;
    },
    resolveCred(j, ctx) {
      for (const k of conf.envKeys) {
        const v = j.env[k];
        if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
      }
      const configured = ((j.secrets.sources || {})[fam] || {}).apiKey;
      if (typeof configured === "string" && configured) return { token: configured, fingerprint: "sec:" + sha16(configured), source: "secrets" };
      if (ctx.apiKeyProvider) {
        const key = j.familyApiKeyOf(fam, ctx.apiKeyProvider);
        if (key) return { token: key, fingerprint: "cfg:" + sha16(key), source: "provider_config" };
      }
      let raw = null;
      try { raw = j.readFile(j.credsPath); } catch (e) { return null; }
      const enc = raw && typeof raw === "object" ? raw[conf.credKey] : null;
      if (typeof enc !== "string" || !enc) return null;
      const token = decryptValue(enc, deriveCipherKey(j.env));
      if (!token) return { decryptFailed: true, fingerprint: "host:" + sha16(enc) };
      return { token, fingerprint: "host:" + sha16(enc), source: "host" };
    },
    async fetchOne(j, ctx, cred, ctl) {
      const url = (conf.envUrl && j.env[conf.envUrl]) || conf.origin + QUOTA_PATH;
      /* 订阅元数据与额度并行（仅 bigmodel）；失败静默降级不拖累额度 */
      const subFetch = (conf.subPath && ctx.family === "bigmodel")
        ? j.http.maybeGetJson(conf.origin + conf.subPath, { authorization: cred.token }, ctl) : Promise.resolve(null);
      subFetch.catch(() => { });
      const body = await j.http.getJson(url, { authorization: (conf.bearer ? "Bearer " : "") + cred.token }, ctl);
      const value = normalizeQuotaBody(body);
      if (value && value.noPlan) return { noPlan: true };
      const plan = await subFetch;
      const sub = plan ? normalizeSubscriptionPlan(plan, j.now()) : null;
      return sub ? Object.assign({}, value, { plan: sub }) : value;
    },
  });
}

/* --- MiniMax Token Plan（零配置：api.minimaxi.com/.cn/.io 自定义供应商；可信域可配） --- */
ADAPTERS.push({
  id: "minimax", label: "MiniMax", kind: "plan", defaultOn: true, unverified: true,
  envKeys: ["MINIMAX_API_KEY"],
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    if (!cp) return null;
    if (!cp.baseUrl && providerId === "minimax") return { domain: "https://api.minimaxi.com", key: cp.apiKey, origin: "cfg" };
    let host = "";
    try { host = new URL(cp.baseUrl).hostname; } catch (e) { return null; }
    if (host === "api.minimaxi.com" || host === "api.minimax.cn") return { domain: "https://api.minimaxi.com", key: cp.apiKey, origin: "cfg" };
    if (host === "api.minimax.io") return { domain: "https://api.minimax.io", key: cp.apiKey, origin: "cfg" };
    return null;
  },
  resolveCred(j, ctx) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).minimax || {};
    if (sec.apiKey) return { token: sec.apiKey, fingerprint: "sec:" + sha16(sec.apiKey), source: "secrets" };
    if (ctx.key) return { token: ctx.key, fingerprint: "cfg:" + sha16(ctx.key), source: "provider_config" };
    return null;
  },
  async fetchOne(j, ctx, cred, ctl) {
    const rawDomain = ((j.secrets.sources || {}).minimax || {}).baseUrl || "";
    let host = "";
    try { host = rawDomain ? new URL(rawDomain).hostname : ""; } catch (e) { host = ""; }
    const trusted = host === "api.minimaxi.com" || host === "api.minimax.cn" || host === "api.minimax.io";   // 可信查询域白名单：key 不发任意域
    const domain = trusted ? rawDomain.replace(/\/+$/, "") : (ctx.domain || "https://api.minimaxi.com");
    let body;
    try {
      body = await j.http.getJson(domain + "/v1/api/openplatform/coding_plan/remains", { authorization: "Bearer " + cred.token }, ctl);
    } catch (e) {
      if (e && e.code !== "parse_error") throw e;
      body = await j.http.getJson("https://www." + (domain.indexOf(".io") >= 0 ? "minimax.io" : "minimaxi.com") + "/v1/token_plan/remains", { authorization: "Bearer " + cred.token }, ctl);   // dsh 旧端点兜底
    }
    const br = body && body.base_resp;
    if (br && num(br.status_code) !== 0) throw qErr(br.status_code === 401 || br.status_code === 403 ? "auth_failed" : "parse_error", "minimax base_resp " + br.status_code);
    const rows = Array.isArray(body && body.model_remains) ? body.model_remains : (Array.isArray(body && body.data && body.data.model_remains) ? body.data.model_remains : []);
    const row = rows.find((r) => r && String(r.model_name || "").toLowerCase() === "general") ||
      rows.find((r) => /^minimax-m/i.test(String((r || {}).model_name || ""))) ||
      rows.find((r) => r && (num(r.current_interval_remaining_percent) != null || num(r.current_weekly_remaining_percent) != null));
    if (!row) throw qErr("parse_error", "no general row");
    const windows = {};
    const five = num(row.current_interval_remaining_percent);
    if (five != null) windows.fiveHour = { percent: Math.round(clampPct(100 - five) * 10) / 10, resetsAt: resetOf(row.end_time) };
    if (num(row.current_weekly_status) === 1) {   // ==3 = 套餐无周限额（remaining 恒 100），必须跳过
      const wk = num(row.current_weekly_remaining_percent);
      if (wk != null) windows.weekly = { percent: Math.round(clampPct(100 - wk) * 10) / 10, resetsAt: resetOf(row.weekly_end_time) };
    }
    if (!Object.keys(windows).length) throw qErr("parse_error", "no minimax windows");
    return { windows };
  },
});

/* --- Kimi Code（订阅 usages，401/403 回落 moonshot PAYG 余额） --- */
ADAPTERS.push({
  id: "kimi", label: "Kimi", kind: "plan", defaultOn: true, unverified: true,
  envKeys: ["KIMI_CODING_API_KEY", "MOONSHOT_API_KEY", "KIMI_API_KEY"],
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    if (!cp) return null;
    let u = "";
    try { u = new URL(cp.baseUrl); } catch (e) { return null; }
    if (u.hostname === "api.kimi.com" || u.hostname === "api.moonshot.cn") {
      return { key: cp.apiKey, origin: "cfg" };
    }
    return null;
  },
  resolveCred(j, ctx) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).kimi || {};
    if (sec.apiKey) return { token: sec.apiKey, fingerprint: "sec:" + sha16(sec.apiKey), source: "secrets" };
    if (ctx.key) return { token: ctx.key, fingerprint: "cfg:" + sha16(ctx.key), source: "provider_config" };
    return null;
  },
  async fetchOne(j, ctx, cred, ctl) {
    const headers = { authorization: "Bearer " + cred.token, "user-agent": "KimiCLI/1.6" };
    let body = null;
    let authish = false;
    for (const p of ["/coding/v1/usages", "/coding/v1/usage"]) {
      try {
        body = await j.http.getJson("https://api.kimi.com" + p, headers, ctl);
        break;
      } catch (e) {
        if (e && (e.code === "auth_failed")) { authish = true; break; }   // 该 Key 非订阅 Key/无订阅 → 回落 PAYG
        if (e && e.code !== "network_error" && e.code !== "parse_error") throw e;
      }
    }
    if (body && !authish) {
      const windows = {};
      const limits = Array.isArray(body.limits) ? body.limits : [];
      for (const e of limits) {   // 兼容 cc-switch（detail 直挂）与 dsh（window+detail）两形状
        if (!e || typeof e !== "object") continue;
        const d = e.detail || e;
        const limit = num(d.limit), remaining = num(d.remaining);
        if (limit == null || remaining == null || limit <= 0) continue;
        const pct = clampPct(((limit - remaining) / limit) * 100);
        if (!windows.fiveHour) {   // cc-switch 语义：limits 各行均属 5 小时窗，取首条有效行
          windows.fiveHour = { percent: Math.round(pct * 10) / 10, resetsAt: resetOf(d.resetTime) };
        }
      }
      const u = body.usage && typeof body.usage === "object" ? body.usage : null;
      if (u) {
        const limit = num(u.limit), remaining = num(u.remaining);
        if (limit != null && limit > 0 && remaining != null) {
          windows.weekly = { percent: Math.round(clampPct(((limit - remaining) / limit) * 100) * 10) / 10, resetsAt: resetOf(u.resetTime) };
        }
      }
      if (Object.keys(windows).length) return { windows };
    }
    /* PAYG 回落：moonshot 余额（人民币分） */
    const bal = await j.http.getJson("https://api.moonshot.cn/v1/users/me/balance", { authorization: "Bearer " + cred.token }, ctl);
    const raw = (bal && (bal.available_balance != null ? bal.available_balance : (bal.balance != null ? bal.balance : (bal.data && bal.data.available_balance)))) ||
      (bal && bal.data && (bal.data.available_balance != null ? bal.data.available_balance : bal.data.balance));
    const v = num(raw);
    if (v == null) throw qErr("parse_error", "kimi payg shape");
    const yuan = v >= 100 ? v / 100 : v;   // 分 → 元（≥100 视为分）
    return { balance: { amount: Math.round(yuan * 100) / 100, currency: "CNY" }, note: "PAYG" };
  },
});

/* --- CommandCode（控制面四连；credits 三分） --- */
ADAPTERS.push({
  id: "commandcode", label: "CommandCode", kind: "plan", defaultOn: true, unverified: true,
  envKeys: ["COMMANDCODE_API_KEY"],
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    if (!cp) return null;
    let u = "";
    try { u = new URL(cp.baseUrl); } catch (e) { return null; }
    if (u.hostname === "api.commandcode.ai") return { key: cp.apiKey, origin: "cfg" };
    return null;
  },
  resolveCred(j, ctx) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).commandcode || {};
    if (sec.apiKey) return { token: sec.apiKey, fingerprint: "sec:" + sha16(sec.apiKey), source: "secrets" };
    if (ctx.key) return { token: ctx.key, fingerprint: "cfg:" + sha16(ctx.key), source: "provider_config" };
    return null;
  },
  async fetchOne(j, ctx, cred, ctl) {
    const H = { authorization: "Bearer " + cred.token };
    const who = await j.http.getJson("https://api.commandcode.ai/alpha/whoami?limits=1", H, ctl);
    const orgId = who && who.org && who.org.id;
    if (!orgId) throw qErr("parse_error", "no org id");
    const cred8 = await j.http.getJson("https://api.commandcode.ai/alpha/billing/credits?orgId=" + encodeURIComponent(String(orgId)), H, ctl);
    const c = (cred8 && (cred8.credits || cred8)) || {};
    const wl = (cred8 && (cred8.windowLimits || (cred8.credits && cred8.credits.windowLimits))) || null;
    const windows = {};
    if (wl && wl.limited) {
      for (const [k, name] of [["fiveHour", "fiveHour"], ["weekly", "weekly"]]) {
        const w = wl[k];
        const used = num(w && w.used), cap = num(w && w.cap);
        if (w && cap != null && cap > 0 && used != null) {
          windows[name] = { percent: Math.round(clampPct((used / cap) * 100) * 10) / 10, resetsAt: resetOf(w.resetAt) };
        }
      }
    }
    const subs = await j.http.getJson("https://api.commandcode.ai/alpha/billing/subscriptions?orgId=" + encodeURIComponent(String(orgId)), H, ctl);
    const sd = (subs && (subs.data || subs)) || {};
    const periodStart = sd.currentPeriodStart, periodEnd = sd.currentPeriodEnd;
    let monthly = null;
    const sum = await j.http.getJson("https://api.commandcode.ai/alpha/usage/summary?since=" + encodeURIComponent(String(periodStart || "")) + "&orgId=" + encodeURIComponent(String(orgId)), H, ctl);
    const totalCost = num(sum && sum.totalCost);
    const parts = [
      ["monthly", num(c.monthlyCredits)], ["purchased", num(c.purchasedCredits)], ["free", num(c.freeCredits)],
    ].filter(([, v]) => v != null);
    const remainTotal = parts.reduce((a, [, v]) => a + v, 0);
    if (totalCost != null && (totalCost > 0 || remainTotal > 0)) {
      monthly = { percent: Math.round(clampPct((totalCost / Math.max(totalCost + remainTotal, 1e-9)) * 100) * 10) / 10, resetsAt: resetOf(periodEnd) };
    }
    if (monthly) windows.monthly = monthly;
    const out = {};
    if (Object.keys(windows).length) out.windows = windows;
    if (parts.length) {
      out.balance = { amount: Math.round(remainTotal * 100) / 100, currency: "CR",
        parts: parts.map(([label, v]) => ({ label: { monthly: "月度", purchased: "购买", free: "免费" }[label] || label, amount: v })) };
    }
    if (!out.windows && !out.balance) throw qErr("parse_error", "commandcode empty");
    if (sd.planId) out.plan = { version: "", productName: String(sd.planId).slice(0, 40), validStart: "", validEnd: "" };
    return out;
  },
});

/* --- Cline Pass（配置型：独立 Key；三窗口已用%） --- */
ADAPTERS.push({
  id: "cline", label: "Cline Pass", kind: "plan", defaultOn: false, unverified: true,
  envKeys: ["CLINE_API_KEY"],
  detect() { return null; },
  resolveCred(j) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).cline || {};
    if (sec.apiKey) return { token: sec.apiKey, fingerprint: "sec:" + sha16(sec.apiKey), source: "secrets" };
    return null;
  },
  async fetchOne(j, ctx, cred, ctl) {
    const body = await j.http.getJson("https://api.cline.bot/api/v1/users/me/plan/usage-limits", { authorization: "Bearer " + cred.token }, ctl);
    const windows = collectWindows(body && body.data && body.data.limits,
      [["five_hour", "fiveHour"], ["fivehour", "fiveHour"], ["weekly", "weekly"], ["monthly", "monthly"]]);
    if (!Object.keys(windows).length) throw qErr("parse_error", "cline empty");
    return { windows };
  },
});

/* --- Anthropic Claude Pro/Max（OAuth 自动发现 ~/.claude/.credentials.json） --- */
ADAPTERS.push({
  /* 显式启用（非零配置默认）：凭据自动发现读的是第三方应用 Claude Code 的凭据文件，
   * 属跨应用读取，必须用户在 ⚙ 单独打开（披露句随面板/README）。 */
  id: "anthropic", label: "Anthropic", kind: "plan", defaultOn: false, unverified: true,
  envKeys: ["ANTHROPIC_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
  detect() { return null; },
  resolveCred(j) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).anthropic || {};
    if (sec.token) return { token: sec.token, fingerprint: "sec:" + sha16(sec.token), source: "secrets" };
    try {   // 自动发现：Claude Code 凭据文件（披露已列明）
      const p = path.join(os.homedir(), ".claude", ".credentials.json");
      const d = j.readFile(p);
      const tok = d && d.claudeAiOauth && d.claudeAiOauth.accessToken;
      if (typeof tok === "string" && tok) return { token: tok, fingerprint: "claude:" + sha16(tok), source: "claude-file" };
    } catch (e) { /* 未装 Claude Code / 文件不存在：按未配置 */ }
    return null;
  },
  async fetchOne(j, ctx, cred, ctl) {
    const body = await j.http.getJson("https://api.anthropic.com/api/oauth/usage", { authorization: "Bearer " + cred.token }, ctl);
    const windows = {};
    for (const [src, name] of [["five_hour", "fiveHour"], ["seven_day", "weekly"]]) {
      const w = body && body[src];
      if (!w || typeof w !== "object") continue;
      let pct = num(w.utilization);
      if (pct == null) pct = num(w.used_percentage);
      if (pct == null || !isFinite(pct) || pct < 0) continue;
      windows[name] = { percent: Math.round(clampPct(pct) * 10) / 10, resetsAt: resetOf(w.resets_at != null ? w.resets_at : w.reset_at) };
    }
    if (!Object.keys(windows).length) throw qErr("parse_error", "anthropic empty");
    return { windows };   // 子配额窗（seven_day_sonnet 等）整体丢弃，不覆盖主窗
  },
});

/* --- DeepSeek（官方域零配置；total/granted/topped_up 三分拆分） --- */
ADAPTERS.push({
  id: "deepseek", label: "DeepSeek", kind: "balance", defaultOn: true,
  envKeys: ["DEEPSEEK_API_KEY", "DEEPSEEK_BALANCE_API_KEY"],
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    if (!cp) return null;
    let host = "";
    try { host = new URL(cp.baseUrl).hostname; } catch (e) { return null; }
    if (host === "api.deepseek.com") return { key: cp.apiKey, origin: "cfg" };
    return null;
  },
  resolveCred(j, ctx) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).deepseek || {};
    if (sec.apiKey) return { token: sec.apiKey, fingerprint: "sec:" + sha16(sec.apiKey), source: "secrets" };
    if (ctx.key) return { token: ctx.key, fingerprint: "cfg:" + sha16(ctx.key), source: "provider_config" };
    return null;
  },
  async fetchOne(j, ctx, cred, ctl) {
    const body = await j.http.getJson("https://api.deepseek.com/user/balance", { authorization: "Bearer " + cred.token }, ctl);
    const infos = Array.isArray(body && body.balance_infos) ? body.balance_infos : [];
    if (!infos.length) throw qErr("parse_error", "no balance_infos");
    const parsed = infos
      .map((x) => {
        const total = parseCurrencyAmount(x.total_balance, x.currency);
        const granted = parseCurrencyAmount(x.granted_balance, x.currency);
        const topped = parseCurrencyAmount(x.topped_up_balance, x.currency);
        if (!total) return null;
        return { currency: x.currency || total.currency, total, granted, topped };
      })
      .filter(Boolean);
    if (!parsed.length) throw qErr("parse_error", "balance_infos unparsable");
    const best = parsed.sort((a, b) => b.total.amount - a.total.amount)[0];
    const out = { balance: { amount: Math.round(best.total.amount * 100) / 100, currency: best.currency || "CNY" } };
    if (best.granted && best.granted.amount > 0) {   // 仅赠送≠0 才拆分展示
      out.balance.parts = [
        { label: "赠送", amount: best.granted.amount },
        { label: "充值", amount: best.topped ? best.topped.amount : Math.max(0, best.total.amount - best.granted.amount) },
      ];
    }
    return out;
  },
});

/* --- OpenRouter credits --- */
ADAPTERS.push({
  id: "openrouter", label: "OpenRouter", kind: "balance", defaultOn: true,
  envKeys: ["OPENROUTER_MANAGEMENT_KEY"],
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    if (!cp) return null;
    let host = "";
    try { host = new URL(cp.baseUrl).hostname; } catch (e) { return null; }
    if (host === "openrouter.ai") return { key: cp.apiKey, origin: "cfg" };
    return null;
  },
  resolveCred(j, ctx) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).openrouter || {};
    if (sec.apiKey) return { token: sec.apiKey, fingerprint: "sec:" + sha16(sec.apiKey), source: "secrets" };
    return null;
  },
  async fetchOne(j, ctx, cred, ctl) {
    const body = await j.http.getJson("https://openrouter.ai/api/v1/credits", { authorization: "Bearer " + cred.token }, ctl);
    const d = body && body.data;
    const total = num(d && d.total_credits), used = num(d && d.total_usage);
    if (total == null || used == null) throw qErr("parse_error", "openrouter shape");
    return { balance: { amount: Math.round((total - used) * 100) / 100, currency: "USD" } };
  },
});

/* --- SiliconFlow（端点存在 410 废弃风险，失败中性引导） --- */
ADAPTERS.push({
  id: "siliconflow", label: "SiliconFlow", kind: "balance", defaultOn: true,
  envKeys: ["SILICONFLOW_API_KEY"],
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    if (!cp) return null;
    let host = "";
    try { host = new URL(cp.baseUrl).hostname; } catch (e) { return null; }
    if (host === "api.siliconflow.cn" || host === "api.siliconflow.com") return {
      key: cp.apiKey, origin: "cfg", apiOrigin: "https://" + host, currency: host.endsWith(".com") ? "USD" : "CNY" };

    return null;
  },
  resolveCred(j, ctx) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).siliconflow || {};
    if (sec.apiKey) return { token: sec.apiKey, fingerprint: "sec:" + sha16(sec.apiKey), source: "secrets" };
    if (ctx.key) return { token: ctx.key, fingerprint: "cfg:" + sha16(ctx.key), source: "provider_config" };
    return null;
  },
  async fetchOne(j, ctx, cred, ctl) {
    let body;
    /* v102：secrets.baseUrl（⚙ 预设模板写入）仅在可信域白名单内生效（minimax 同款，
     * key 不发任意域）；.com 币种随域。端点自带 currency 时仍以响应为准。 */
    const rawBase = ((j.secrets.sources || {}).siliconflow || {}).baseUrl || "";
    let baseHost = "";
    try { baseHost = rawBase ? new URL(rawBase).hostname : ""; } catch (e) { baseHost = ""; }
    const trustedBase = baseHost === "api.siliconflow.cn" || baseHost === "api.siliconflow.com";
    const baseOrigin = trustedBase ? rawBase.replace(/\/+$/, "") : (ctx.apiOrigin || "https://api.siliconflow.cn");
    const baseCurrency = baseHost === "api.siliconflow.com" ? "USD" : baseHost === "api.siliconflow.cn" ? "CNY" : "";
    try { body = await j.http.getJson(baseOrigin + "/v1/user/info", { authorization: "Bearer " + cred.token }, ctl); }
    catch (e) { if (e && e.httpStatus === 410) throw qErr("unsupported", "siliconflow quota endpoint retired", { reason: "endpoint_retired" }); throw e; }
    const d = (body && body.data) || {};
    const v = parseCurrencyAmount(d.totalBalance != null ? d.totalBalance : d.balance, d.currency || baseCurrency || ctx.currency || "CNY");
    if (!v) throw qErr("parse_error", "siliconflow shape");
    return { balance: { amount: Math.round(v.amount * 100) / 100, currency: v.currency || "CNY" } };
  },
});

/* --- 小米 MiMo Token Plan（配置型：控制台 Cookie） --- */
function normalizeMimoCookie(raw) {
  let s = String(raw || "").trim().replace(/^Cookie:\s*/i, "").replace(/^["']|["']$/g, "").replace(/\s*\n\s*/g, "; ").replace(/;\s*;+/g, ";");
  if (!/userId=/.test(s)) return null;
  if (!/(api-platform_)?serviceToken=/.test(s)) return null;
  return s;
}
ADAPTERS.push({
  id: "mimo", label: "小米 MiMo", kind: "plan", defaultOn: false, unverified: true,
  envKeys: ["MIMO_COOKIE", "XIAOMI_MIMO_COOKIE"],
  detect() { return null; },
  resolveCred(j) {
    let raw = null;
    for (const k of this.envKeys) { if (j.env[k]) { raw = j.env[k]; break; } }
    if (!raw) raw = ((j.secrets.sources || {}).mimo || {}).cookie;
    if (!raw) return null;
    const cookie = normalizeMimoCookie(raw);
    if (!cookie) return { decryptFailed: true, fingerprint: "sec:" + sha16(raw), missing: "mimoCookieFields" };
    return { cookie, fingerprint: "sec:" + sha16(cookie), source: "secrets" };
  },
  async fetchOne(j, ctx, cred, ctl) {
    const H = { cookie: cred.cookie };
    const base = "https://platform.xiaomimimo.com/api/v1";
    const usage = await j.http.getJson(base + "/tokenPlan/usage", H, ctl);
    const ud = (usage && usage.data) || {};
    const items = Array.isArray(ud.monthUsage && ud.monthUsage.items) ? ud.monthUsage.items : [];
    const windows = {};
    const pick = (names, name) => {
      for (const it of items) {
        if (!it) continue;
        const key = String(it.name || "");
        if (!names.some((n) => key === n)) continue;
        const used = num(it.used), limit = num(it.limit);
        let pct = num(it.percent);
        if ((used != null && limit != null && limit > 0)) pct = (used / limit) * 100;
        if (pct == null || !isFinite(pct) || pct < 0) continue;
        if (!windows[name]) windows[name] = { percent: Math.round(clampPct(pct) * 10) / 10, resetsAt: null };
      }
    };
    pick(["month_total_token", "plan_total_token"], "monthly");
    pick(["compensation_total_token"], "compensation");
    let out = {};
    if (Object.keys(windows).length) out.windows = windows;
    /* 周期截止与余额并行（均无依赖）；失败静默降级 */
    const detP = j.http.maybeGetJson(base + "/tokenPlan/detail", H, ctl).catch(() => null);
    const balP = j.http.maybeGetJson(base + "/balance", H, ctl).catch(() => null);
    const det = await detP;
    const dd = (det && det.data) || {};
    const end = typeof dd.currentPeriodEnd === "string" ? dd.currentPeriodEnd : "";
    if (end) {
      const m = end.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
      if (m && out.windows && out.windows.monthly) out.windows.monthly.resetsAt = m[1] + " " + m[2] + " +08:00";
    }
    const bal = await balP;
    const bd = (bal && bal.data) || {};
    const b = parseCurrencyAmount(bd.balance != null ? bd.balance : bd.cashBalance, bd.currency || "CNY");
    if (b) {
      out.balance = { amount: Math.round(b.amount * 100) / 100, currency: b.currency || "CNY" };
      const cash = parseCurrencyAmount(bd.cashBalance, bd.currency), gift = parseCurrencyAmount(bd.giftBalance, bd.currency);
      if (cash && gift && (gift.amount > 0 || cash.amount > 0)) {
        out.balance.parts = [{ label: "充值", amount: cash.amount || 0 }, { label: "赠送", amount: gift.amount || 0 }];
      }
    }
    if (!out.windows && !out.balance) throw qErr("parse_error", "mimo empty");
    return out;
  },
});

/* --- 火山方舟（配置型 AK/SK；SigV4 火山变体） --- */
function hmac(key, data) { return crypto.createHmac("sha256", key).update(data).digest(); }
async function volcCall(http, host, action, region, ak, sk) {
  const now = new Date();
  const xDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");   // YYYYMMDDTHHMMSSZ
  const query = "Action=" + action + "&Region=" + region + "&Version=2024-01-01";   // 字母序 Action<Region<Version
  const payload = "";
  const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");
  const headers = "host:" + host + "\nx-date:" + xDate + "\nx-content-sha256:" + payloadHash + "\ncontent-type:application/json; charset=utf-8\n";
  const signed = "host;x-date;x-content-sha256;content-type";
  const canonical = "POST\n/\n" + query + "\n" + headers + "\n" + signed + "\n" + payloadHash;
  const date = xDate.slice(0, 8);
  const scope = date + "/" + region + "/ark/request";   // 火山变体：结尾 request，非 aws4_request
  const stringToSign = "HMAC-SHA256\n" + xDate + "\n" + scope + "\n" + crypto.createHash("sha256").update(canonical).digest("hex");
  let k = hmac(sk, date);                       // SK 不加前缀
  k = hmac(k, region); k = hmac(k, "ark"); k = hmac(k, "request");
  const signature = crypto.createHmac("sha256", k).update(stringToSign).digest("hex");
  const res = await http.post("https://" + host + "/?" + query, {
    "x-date": xDate,
    "x-content-sha256": payloadHash,
    "content-type": "application/json; charset=utf-8",
    authorization: "HMAC-SHA256 Credential=" + ak + "/" + scope + ", SignedHeaders=" + signed + ", Signature=" + signature,
  });
  return res;
}
ADAPTERS.push({
  id: "volcano", label: "火山方舟", kind: "plan", defaultOn: false, unverified: true,
  envKeys: ["VOLCENGINE_ACCESS_KEY_ID", "VOLCENGINE_SECRET_ACCESS_KEY"],
  detect() { return null; },
  resolveCred(j) {
    const sec = (j.secrets.sources || {}).volcano || {};
    const ak = j.env.VOLCENGINE_ACCESS_KEY_ID || sec.accessKeyId || sec.ak;
    const sk = j.env.VOLCENGINE_SECRET_ACCESS_KEY || sec.secretAccessKey || sec.sk;
    if (!ak || !sk) return null;
    return { ak, sk, fingerprint: "sec:" + sha16(ak + "|" + sk), source: "secrets" };
  },
  async fetchOne(j, ctx, cred, ctl) {
    const region = ((j.secrets.sources || {}).volcano || {}).region || "cn-beijing";
    const host = "open.volcengineapi.com";
    /* 双 plan 探测：Agent Plan（GetAFPUsage）非空即返；Quota<=0 视为未订阅回落 Coding Plan */
    let body = null, tag = "";
    try {
      body = await volcCall(j.http, host, "GetAFPUsage", region, cred.ak, cred.sk);
      tag = "Agent Plan";
    } catch (e) {
      if (e && e.code === "auth_failed") throw e;
      body = null;
    }
    const afp = body && body.Result;
    const windows = {};
    if (afp && typeof afp === "object") {
      for (const [k, name] of [["AFPFiveHour", "fiveHour"], ["AFPWeekly", "weekly"], ["AFPMonthly", "monthly"]]) {   // AFPDaily 刻意跳过（历史默认值虚高）
        const q = num(afp[k] && afp[k].Quota), used = num(afp[k] && afp[k].Used);
        if (q != null && q > 0 && used != null) {
          windows[name] = { percent: Math.round(clampPct((used / q) * 100) * 10) / 10, resetsAt: resetOf(afp[k].ResetTime) };
        }
      }
    }
    if (Object.keys(windows).length) return { windows, planName: tag };
    const cp = await volcCall(j.http, host, "GetCodingPlanUsage", region, cred.ak, cred.sk);
    const arr = (cp && cp.Result && (cp.Result.QuotaUsage || cp.Result.Usages || cp.Result.Details)) || [];
    for (const e of arr) {
      if (!e || typeof e !== "object") continue;
      const lvl = String(e.Level || e.Type || e.Period || e.Label || e.Window || "").toLowerCase().replace(/[\s_-]/g, "");
      const name = /session|^5h|fivehour|rolling5h/.test(lvl) ? "fiveHour" : /weekly|week|7d/.test(lvl) ? "weekly" : /monthly|month/.test(lvl) ? "monthly" : null;
      if (!name || windows[name]) continue;
      let pct = num(e.Percent);
      if (pct == null) pct = num(e.UsedPercent);
      if (pct == null) pct = num(e.UsagePercent);
      if (pct == null || pct < 0) continue;
      windows[name] = { percent: Math.round(clampPct(pct) * 10) / 10, resetsAt: resetOf(e.ResetTime != null ? e.ResetTime : e.ResetTimestamp) };
    }
    if (!Object.keys(windows).length) throw qErr("parse_error", "volcano empty");
    return { windows };
  },
});

/* --- SCNet（账本估算，无网络；数据由 zusage 快照侧聚合注入） --- */
ADAPTERS.push({
  id: "scnet", label: "SCNet", kind: "ledger", defaultOn: false, unverified: true,
  envKeys: [],
  detect() { return null; },
  resolveCred(j) {
    const sec = (j.secrets.sources || {}).scnet || {};
    if (!sec.enabled || !(num(sec.planCredits) > 0)) return null;
    return { none: true, fingerprint: "sec:scnet:" + sha16(JSON.stringify([sec.planCredits, sec.planStart || "", sec.modelPatterns || {}])), source: "secrets" };
  },
  async fetchOne(j) {
    const ex = j.extras && j.extras.scnet;
    if (!ex || ex.source === "none" || ex.credits_used == null) return { noPlan: true };   // 快照未带估算（zusage 旧版/未配置）：软隐藏不报错
    return {
      windows: { monthly: { percent: Math.round(clampPct((ex.credits_used / ex.plan_credits) * 100) * 10) / 10, resetsAt: ex.resets_at || null } },
      ledger: { used: ex.credits_used, total: ex.plan_credits, source: ex.source },
    };
  },
});

/* sub2api 的 key 用量接口（与推理地址同源，非管理接口）。remaining 可能是最紧
 * 订阅窗口的剩余，不一定是钱包余额：存在 subscription 时仅输出套餐窗口。 */
function normalizeSub2api(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (body.isValid === false) throw qErr("auth_failed", "sub2api key unavailable");
  if (!("isValid" in body) && !("mode" in body)) return null;
  if (body.isValid !== true || !["balance", "subscription", "unrestricted", "quota", "quota_limited"].includes(body.mode)) {
    throw qErr("parse_error", "sub2api mode invalid");
  }
  const unit = body.unit == null && body.mode === "quota_limited" ? "USD" : body.unit;
  if (!["USD", "CNY", "credits"].includes(unit)) throw qErr("parse_error", "sub2api unit invalid");
  if (body.subscription != null && (typeof body.subscription !== "object" || Array.isArray(body.subscription))) {
    throw qErr("parse_error", "sub2api subscription invalid");
  }
  const currency = unit === "credits" ? "CR" : unit;
  if (body.mode === "quota" || body.mode === "quota_limited") {
    const value = { label: "sub2api", kind: "plan" };
    if (body.quota != null) {
      const quota = body.quota;
      const limit = num(quota.limit), used = num(quota.used), remaining = num(quota.remaining);
      if (typeof quota !== "object" || Array.isArray(quota) || limit == null || limit <= 0 ||
          used == null || used < 0 || remaining == null || (quota.unit != null && quota.unit !== "USD")) {
        throw qErr("parse_error", "sub2api quota invalid");
      }
      value.quotaSummary = { limit, used, remaining, currency: "USD" };
    }
    if (body.rate_limits != null) {
      if (!Array.isArray(body.rate_limits)) throw qErr("parse_error", "sub2api rate limits invalid");
      const windows = {};
      for (const entry of body.rate_limits) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw qErr("parse_error", "sub2api rate limit invalid");
        const key = entry.window === "5h" ? "fiveHour" : entry.window === "1d" ? "daily" : entry.window === "7d" ? "weekly" : null;
        if (!key) continue;
        const total = num(entry.limit), used = num(entry.used), remaining = num(entry.remaining);
        if (total == null || total <= 0 || used == null || used < 0 || remaining == null ||
            (entry.unit != null && entry.unit !== "USD")) throw qErr("parse_error", "sub2api rate limit invalid");
        windows[key] = { percent: Math.round(clampPct(used / total * 100) * 10) / 10,
          used, total, remaining, currency: "USD", resetsAt: resetOf(entry.reset_at) };
      }
      if (Object.keys(windows).length) value.windows = windows;
    }
    if (!value.quotaSummary && !value.windows) throw qErr("parse_error", "sub2api quota missing");
    return value;
  }
  const sub = body.subscription;
  if (sub && typeof sub === "object" && !Array.isArray(sub)) {
    const windows = {};
    for (const [period, key] of [["daily", "daily"], ["weekly", "weekly"], ["monthly", "monthly"]]) {
      const total = num(sub[period + "_limit_usd"]);
      const used = num(sub[period + "_usage_usd"]);
      if (total == null || total <= 0 || used == null || used < 0) continue;
      const reset = sub[period + "_reset_at"] || sub[period + "_resets_at"];
      windows[key] = { percent: Math.round(clampPct(used / total * 100) * 10) / 10,
        used: used, total: total, remaining: total - used, currency: "USD", resetsAt: resetOf(reset) };
    }
    if (!Object.keys(windows).length) throw qErr("parse_error", "sub2api subscription windows missing");
    const expires = typeof sub.expires_at === "string" && Number.isFinite(Date.parse(sub.expires_at)) ? sub.expires_at : "";
    return { label: "sub2api", kind: "plan", windows: windows,
      subscription: { name: typeof body.planName === "string" ? body.planName.slice(0, 100) : "", expiresAt: expires } };
  }
  if (body.mode !== "balance" && body.mode !== "unrestricted") throw qErr("parse_error", "sub2api balance scope unknown");
  const remaining = num(body.mode === "unrestricted" ? body.balance : body.remaining);
  if (remaining == null) throw qErr("parse_error", "sub2api balance missing");
  return { label: "sub2api", kind: "balance", balance: { amount: remaining, currency: currency } };
}

function relayQuotaUrls(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch (e) { throw qErr("parse_error", "bad baseUrl"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw qErr("parse_error", "untrusted query scheme");
  if (url.username || url.password) throw qErr("parse_error", "baseUrl userinfo rejected");
  const prefix = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  return { sub2api: url.origin + prefix + "/v1/usage", legacy: url.origin + url.pathname.replace(/\/+$/, "") };
}

/* --- OpenCode Go（$10/月订阅；转写自 cc-switch coding_plan.rs，MIT，未真实账号实测） ---
 * 用量端点第一方未文档化：GET https://opencode.ai/zen/go/v1/usage，只认
 * Authorization: Bearer（与推理侧只认 x-api-key 相反）；响应
 * {usage:{rolling|weekly|monthly:{status,percent(已用0-100),resetsAt(ISO)}}}，
 * 端点不回金额。detect 较 cc-switch 的裸子串收严：host 精确 opencode.ai +
 * 路径 /zen/go 或其子路径（两档预设），防外域伪装；Zen 按量版 /zen/v1 无
 * 用量 API（cc-switch 实测 404）刻意不命中。 */
function normalizeOpencodeGo(body) {
  const usage = body && typeof body === "object" && !Array.isArray(body) &&
    body.usage && typeof body.usage === "object" && !Array.isArray(body.usage) ? body.usage : null;
  if (!usage) throw qErr("parse_error", "opencode usage shape");
  const windows = {};
  for (const pair of [["rolling", "fiveHour"], ["weekly", "weekly"], ["monthly", "monthly"]]) {
    const w = usage[pair[0]] && typeof usage[pair[0]] === "object" && !Array.isArray(usage[pair[0]]) ? usage[pair[0]] : null;
    const pct = w ? num(w.percent) : null;
    if (pct == null || pct < 0) continue;   // 坏窗跳过不整体失败（端点上线当天改过一次形态）
    windows[pair[1]] = {
      percent: Math.round(clampPct(pct) * 10) / 10,   // 已用%直取（Go 语义即已用，非剩余）
      resetsAt: pct > 0 ? resetOf(w.resetsAt) : null,   // percent=0 时 resetsAt 是 now+窗长占位值，丢弃
    };
  }
  if (!Object.keys(windows).length) throw qErr("parse_error", "opencode windows missing");
  return { label: "OpenCode Go", kind: "plan", windows: windows };
}

ADAPTERS.push({
  id: "opencode", label: "OpenCode Go", kind: "plan", defaultOn: true, unverified: true,
  envKeys: ["OPENCODE_API_KEY"],
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    if (!cp) return null;
    let u = null;
    try { u = new URL(cp.baseUrl); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.hostname.toLowerCase() !== "opencode.ai") return null;
    const p = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (p !== "/zen/go" && !p.startsWith("/zen/go/")) return null;   // 仅两档预设；/zen/v1 按量版与 /zen/gopher 类前缀不命中
    return { key: cp.apiKey, origin: "cfg" };
  },
  resolveCred(j, ctx) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).opencode || {};
    if (sec.apiKey) return { token: sec.apiKey, fingerprint: "sec:" + sha16(sec.apiKey), source: "secrets" };
    if (ctx.key) return { token: ctx.key, fingerprint: "cfg:" + sha16(ctx.key), source: "provider_config" };
    return null;
  },
  async fetchOne(j, ctx, cred, ctl) {
    let body;
    try {
      body = await j.http.getJson("https://opencode.ai/zen/go/v1/usage",
        { authorization: "Bearer " + cred.token }, ctl);
    } catch (e) {
      /* 403 EntitlementError：key 本身有效（Zen/Go 共用 workspace key）但无 Go 订阅——
       * 与 401 认证失败分开（classifyStatus 把 401/403 都归 auth_failed，此处按消息分流）。 */
      if (e && e.httpStatus === 403) return { noPlan: true };
      throw e;
    }
    return normalizeOpencodeGo(body);
  },
});

/* --- 自定义中转（sub2api / OpenAI legacy；仅查询配置地址的同源） --- */
ADAPTERS.push({
  id: "custom", label: "中转站", kind: "balance", defaultOn: false,
  envKeys: [],
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    return cp ? { cp } : null;
  },
  resolveCred(j, ctx) { return { token: ctx.cp.apiKey, fingerprint: "cfg:" + sha16(ctx.cp.apiKey + "|" + ctx.cp.baseUrl), source: "provider_config" }; },
  async fetchOne(j, ctx, cred, ctl) {
    const cp = ctx.cp;
    const urls = relayQuotaUrls(cp.baseUrl);
    const headers = { authorization: "Bearer " + cred.token };
    let usage = null;
    try { usage = await j.http.getJson(urls.sub2api, headers, ctl); }
    catch (e) {
      if (!e || (e.code !== "parse_error" && e.httpStatus !== 404 && e.httpStatus !== 405)) throw e;
    }
    const detected = normalizeSub2api(usage);
    if (detected) return detected;
    const sub = await j.http.maybeGetJson(urls.legacy + "/dashboard/billing/subscription", headers, ctl);
    if (!sub) return null;   // 识别不了的网关：无可展示余额（unsupported 由调度器标注）
    const hard = num(sub.hard_limit_usd);
    if (hard == null || hard >= 1e8) return null;   // 按量后付无固定池
    const billed = await j.http.getJson(urls.legacy + "/dashboard/billing/usage", headers, ctl);
    const cents = billed && num(billed.total_usage);
    if (cents == null || cents < 0) throw qErr("parse_error", "legacy usage missing");
    return { balance: { amount: Math.round((hard - cents / 100) * 100) / 100, currency: "USD" } };
  },
});
const ADAPTER_BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

/* ---------- 预设模板（v102，⚙ 面板「预设模板」行） ----------
 * CC Switch / magpie 同款「选模板只填 Key」体验：presets 为官方域变体，选中值写入
 * secrets.sources.<id>.baseUrl（minimax 的可信域白名单机制，同款推广到 siliconflow）；
 * keyUrl 是控制台取 Key 页。纯静态白名单数据，key 绝不进预设；未列出的源无模板行。 */
const SOURCE_PRESETS = {
  minimax: {
    keyUrl: "https://platform.minimaxi.com",
    presets: [
      { label: "国内站", labelEn: "China", value: "https://api.minimaxi.com" },
      { label: "国际站", labelEn: "Global", value: "https://api.minimax.io" },
    ],
  },
  siliconflow: {
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
    presets: [
      { label: "中国站 ¥", labelEn: "China ¥", value: "https://api.siliconflow.cn" },
      { label: "国际站 $", labelEn: "Global $", value: "https://api.siliconflow.com" },
    ],
  },
  deepseek: { keyUrl: "https://platform.deepseek.com/api_keys" },
  openrouter: { keyUrl: "https://openrouter.ai/settings/keys" },
  kimi: { keyUrl: "https://platform.moonshot.cn/console/api-keys" },
  anthropic: { keyUrl: "https://console.anthropic.com/settings/keys" },
  mimo: { keyUrl: "https://platform.xiaomimimo.com" },
  volcano: { keyUrl: "https://console.volcengine.com/ark" },
};

/* ---------- 多源调度器 ---------- */
function createQuotaClient(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const now = o.now || (() => Date.now());
  const fetchImpl = o.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const { credsPath, customCfgPath, builtinCfgPath } = resolveQuotaPaths(o);
  const secretsPath = o.secretsPath || path.join(path.dirname(credsPath), "quota-secrets.json");
  const readFile = o.readFile || ((p) => JSON.parse(fs.readFileSync(p, "utf8")));
  const log = o.log || (() => {});
  const onUpdate = o.onUpdate || null;

  /* quota-secrets.json：运行目录 0600（首读强制收紧权限）；损坏/缺失按空配置 */
  let secretsMtime = -2, secrets = { sources: {} };
  function readSecrets() {
    let m = -1;
    try { m = fs.statSync(secretsPath).mtimeMs; }
    catch (e) { m = -1; }   // stat 失败不短路：仍尝试读取（测试虚拟路径/权限受限）；-1 不缓存
    if (m !== secretsMtime) {
      try {
        const d = readFile(secretsPath);
        secrets = d && typeof d === "object" && d.sources && typeof d.sources === "object" ? d : { sources: {} };
      } catch (e) { secrets = { sources: {} }; }
      if (m >= 0) secretsMtime = m; else return secrets;
    }
    return secrets;
  }
  const extras = {};   // 快照侧注入的账本数据（scnet 估算等）：noteSnapshotExtras 写入

  /* HTTP 助手：分类错误（401/403 auth_failed、429 rate_limited、5xx/其它 network_error、
   * JSON 解析 parse_error）；maybeGetJson 任何失败返回 null（探测/可选端点用）。 */
  function classifyStatus(status, headers) {
    if (status === 401 || status === 403) return qErr("auth_failed", "HTTP " + status, { httpStatus: status });
    if (status === 429) {
      const ra = headers && typeof headers.get === "function" ? headers.get("retry-after") : null;
      return qErr("rate_limited", "HTTP 429", { retryAfterMs: parseRetryAfterMs(ra) });
    }
    return qErr("network_error", "HTTP " + status, { httpStatus: status });
  }
  async function rawFetch(url, headers, ctl, method) {
    const res = await fetchImpl(url, {
      method: method || "GET",
      headers: Object.assign({ accept: "application/json", "accept-encoding": "identity" }, headers),
      signal: ctl ? ctl.signal : undefined, redirect: "manual",
    });
    let text = "";
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      const chunks = []; let size = 0;
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        chunks.push(step.value); size += step.value.length;
        if (size > BODY_LIMIT) { try { ctl.abort(); } catch (e) { } throw qErr("parse_error", "response too large"); }
      }
      const buf = Buffer.alloc(size); let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }
      text = buf.toString("utf8");
    } else {
      text = await res.text();
      if (text.length > BODY_LIMIT) throw qErr("parse_error", "response too large");
    }
    return { status: res.status, headers: res.headers, text };
  }
  const http = {
    async getJson(url, headers, ctl) {
      const r = await rawFetch(url, headers, ctl);
      if (r.status < 200 || r.status >= 300) throw classifyStatus(r.status, r.headers);
      try { return JSON.parse(r.text); } catch (e) { throw qErr("parse_error", "invalid json"); }
    },
    async maybeGetJson(url, headers, ctl) {
      try { return await http.getJson(url, headers, ctl); } catch (e) { return null; }
    },
    async post(url, headers, ctl) {
      const r = await rawFetch(url, headers, ctl, "POST");
      let json = null;
      try { json = JSON.parse(r.text); } catch (e) { throw qErr("parse_error", "invalid json"); }
      const meta = json && json.ResponseMetadata && json.ResponseMetadata.Error;   // 火山信封：HTTP 200 也可能带错
      if (meta && meta.Code) {
        const c = String(meta.Code);
        if (/auth|signature|accessdenied|denied|unauthorized|forbidden|credential|token/i.test(c)) throw qErr("auth_failed", c.slice(0, 60));
        throw qErr("network_error", c.slice(0, 60));
      }
      if (json && json.Error && json.Error.Code) {
        const c = String(json.Error.Code);
        if (/auth|signature|denied|unauthorized|forbidden/i.test(c)) throw qErr("auth_failed", c.slice(0, 60));
        throw qErr("network_error", c.slice(0, 60));
      }
      if (r.status < 200 || r.status >= 300) throw classifyStatus(r.status, r.headers);   // 签名错常 400 非 401
      return json;
    },
  };

  const j = {
    env, now, fetchImpl, readFile, secrets: { sources: {} }, customCfgPath, log, http, extras,
    credsPath,
    customProviderOf: (pid) => resolveCustomProvider(pid, readFile, customCfgPath, builtinCfgPath),
    familyApiKeyOf: (family, pid) => resolveFamilyApiKey(family, pid, readFile, customCfgPath, builtinCfgPath),
  };

  /* 源状态：id → st（v96 单源状态机的每源实例） */
  const states = new Map();
  const byProvider = {};   // providerId → 源 id（同厂商不同 provider 也隔离）
  let wantedProviders = null;   // null 为旧渲染端单源模式；数组来自全部存活 pane 的实时选择

  function adapterOf(id) { return ADAPTER_BY_ID.get(String(id).split(":")[0]); }
  let primaryId = "";        // 本 pane 会话模型归属的源（chip 主显）
  let primaryProvider = "";  // 最近一次 noteProvider 的原始 provider 串
  let seq = 0;

  function stateOf(id) {
    let st = states.get(id);
    if (!st) {
      st = { id, status: "idle", reason: "", value: null, fetchedAt: 0, nextAt: 0, backoffIdx: 0,
        fingerprint: "", epoch: 0, inFlight: null, ctl: null, lastError: "", ctx: null };
      states.set(id, st);
    }
    return st;
  }
  function setState(st, fields) {
    Object.assign(st, fields);
    if (onUpdate) onUpdate();
  }

  /* provider → 源 id 解析（primary 专用；custom 匹配官方域适配器优先于 generic relay） */
  function resolvePrimary(providerId) {
    const p = String(providerId || "");
    if (!p) return { id: "" };
    if (p.indexOf("account:") === 0) {
      if (p.indexOf("team") >= 0) return { id: "team" };
      if (p.indexOf("account:bigmodel") === 0) return { id: "bigmodel", ctx: { family: "bigmodel" } };
      if (p.indexOf("account:zai") === 0) return { id: "zai", ctx: { family: "zai" } };
      return { id: "" };
    }
    const keyFam = apiKeyFamilyOf(p);
    if (keyFam) return { id: keyFam, ctx: { family: keyFam, apiKeyProvider: p }, provider: p };
    j.secrets = readSecrets();   // provider→adapter 探测前刷新配置
    for (const a of ADAPTERS) {
      if (a.id === "custom" || a.id === "bigmodel" || a.id === "zai") continue;
      try {
        const ctx = a.detect(j, p);
        if (ctx) return { id: a.id, ctx, provider: p };
      } catch (e) { /* detect 抛错按不命中 */ }
    }
    const ctx = ADAPTER_BY_ID.get("custom").detect(j, p);
    /* custom 源按 provider 隔离（custom:<pid>）：两个不同中转的窗口各持独立状态/key，
     * 互不覆盖、互不串显；未命中同样建独立空源（unsupported/provider）。 */
    return { id: "custom:" + p, ctx, provider: p };
  }

  function settleError(st, ep, err) {
    if (ep !== st.epoch) return;   // 代际守卫：源凭据/身份已切换，旧响应丢弃
    const code = err && err.code || "network_error";
    st.lastError = String(err && err.message || code).slice(0, 120);
    st.status = code;
    if (code === "auth_failed" || code === "no_plan") st.nextAt = Infinity;
    else if (code === "parse_error") st.nextAt = now() + PARSE_BACKOFF_MS;
    else if (code === "rate_limited") st.nextAt = now() + (err.retryAfterMs || 60 * 1000);
    else st.nextAt = now() + BACKOFF_MS[Math.min(st.backoffIdx++, BACKOFF_MS.length - 1)];
    log("quota settle:", st.id, code, st.lastError);
    if (onUpdate) onUpdate();
  }
  function settleOk(st, ep, value) {
    if (ep !== st.epoch) return;
    st.value = value;
    st.fetchedAt = now();
    st.status = "ok";
    st.lastError = "";
    st.backoffIdx = 0;
    const a = adapterOf(st.id);
    st.nextAt = now() + (a && a.kind === "balance" ? TTL_BALANCE_MS : TTL_MS);
    if (onUpdate) onUpdate();
  }

  function startFetch(adapter, st) {
    st.epoch += 1;
    const ep = st.epoch;
    const ctl = new AbortController();
    st.ctl = ctl;
    const kill = setTimeout(() => { try { ctl.abort(); } catch (e) { } }, FETCH_TIMEOUT_MS);
    const p = (async () => {
      const value = await adapter.fetchOne(j, st.ctx, st.cred, ctl);
      if (value && value.noPlan) { const e = qErr("no_plan", "no plan"); e.st = st; throw e; }
      if (value == null) { const e = qErr("unsupported", "gateway"); e.st = st; throw e; }   // custom：识别不了的网关
      settleOk(st, ep, value);
    })()
      .catch((e) => {
        const target = e && e.st || st;
        if (e && e.code === "no_plan") { if (ep === target.epoch) { target.status = "no_plan"; target.nextAt = Infinity; target.lastError = "no plan"; if (onUpdate) onUpdate(); } return; }
        if (e && e.code === "unsupported") { if (ep === target.epoch) { target.status = "unsupported"; target.reason = e.reason || "gateway"; target.value = null; target.lastError = ""; target.nextAt = now() + PARSE_BACKOFF_MS; if (onUpdate) onUpdate(); } return; }
        settleError(target, ep, e);
      })
      .finally(() => { clearTimeout(kill); });
    st.inFlight = p;
    const q = p;
    p.then(() => { if (st.inFlight === q) st.inFlight = null; });   // fetchOne 包装自身不 reject
  }

  function tickSource(adapter, st, force) {
    j.secrets = readSecrets();
    if (((j.secrets.sources || {})[adapter.id] || {}).enabled === false) return;
    const t = now();
    if (st.inFlight) return;
    if (!force && t < st.nextAt) return;
    const ctx = st.ctx;
    if (!ctx) {
      if (adapter.id === "custom") {   // 无配置的自定义供应商：unsupported/provider（v96 兼容语义）
        if (st.status !== "unsupported" || st.reason !== "provider") setState(st, { status: "unsupported", reason: "provider", value: null });
      } else if (st.status !== "not_configured") setState(st, { status: "not_configured", reason: "", lastError: "" });
      st.nextAt = t + NOT_CONFIGURED_RETRY_MS;
      return;
    }
    const cred = adapter.resolveCred(j, ctx);
    if (!cred) {
      if (st.status !== "not_configured") setState(st, { status: "not_configured", reason: "", lastError: "" });
      st.nextAt = t + NOT_CONFIGURED_RETRY_MS;
      return;
    }
    if (cred.decryptFailed) {
      if (st.status !== "not_configured") setState(st, { status: "not_configured", reason: "decrypt", lastError: "credential decrypt failed" });
      st.nextAt = t + NOT_CONFIGURED_RETRY_MS;
      return;
    }
    if (cred.fingerprint !== st.fingerprint) {
      st.fingerprint = cred.fingerprint;
      st.backoffIdx = 0;
      if (st.status === "auth_failed" || st.status === "no_plan" || (st.status === "unsupported" && st.reason === "gateway")) st.status = "idle";
      st.nextAt = 0;
    }
    if (!force && (st.status === "auth_failed" || st.status === "no_plan")) return;
    if (cred.source === "host" || cred.source === "env") {
      const exp = jwtExpMs(cred.token || "");
      if (exp && exp - t < EXP_SOON_MS) { st.nextAt = t + EXP_RETRY_MS; return; }
    }
    st.cred = cred;
    startFetch(adapter, st);
  }

  /* 配置撤销清展示值并换代；不通知 onUpdate，避免 view/settings 重评递归推送。 */
  function deactivateSource(st, status) {
    if (st.status === status && !st.value && !st.inFlight && !st.fingerprint) return;
    st.epoch += 1;
    if (st.ctl) { try { st.ctl.abort(); } catch (e) { } }
    Object.assign(st, { status, reason: "", value: null, fetchedAt: 0, nextAt: 0,
      backoffIdx: 0, fingerprint: "", cred: null, ctl: null, inFlight: null, lastError: "" });
  }

  /* 活跃源集合：primary + 全部可解析的零配置适配器 + secrets 显式启用的配置适配器 */
  function activeSet() {
    j.secrets = readSecrets();
    const set = new Map();
    const wanted = wantedProviders === null ? [primaryProvider] : wantedProviders;
    for (const providerId of wanted) {
      const id = byProvider[providerId] || "";
      if (id === "team") {
        const st = stateOf(id);
        if (st.status !== "unsupported") setState(st, { status: "unsupported", reason: "team" });
        continue;
      }
      const a = adapterOf(id);
      if (!a) continue;
      const st = stateOf(id);
      const cfg = (j.secrets.sources || {})[a.id] || {};
      if (cfg.enabled === false) continue;
      if (a.id === "anthropic" && cfg.enabled !== true) continue;   // anthropic 仅显式启用（终版契约）
      set.set(id, { a, st });
    }
    for (const a of ADAPTERS) {
      if (a.id === "custom" || set.has(a.id)) continue;   // custom 系只在 primary 分支进入
      /* 账户复合源（vendor:providerId）已入集时跳过裸厂商源：同一凭据两条状态
       * 会重复请求同一端点（secrets 键被两者共用），账户源已覆盖该厂商。 */
      let vendorCovered = false;
      for (const k of set.keys()) if (k.indexOf(a.id + ":") === 0) { vendorCovered = true; break; }
      if (vendorCovered) continue;
      const secCfg = (j.secrets.sources || {})[a.id] || {};
      const enabledCfg = secCfg.enabled === true;
      const hasEnv = a.envKeys.some((key) => !!j.env[key]);
      const hasConfigured = !!(secCfg.apiKey || secCfg.cookie || secCfg.token || secCfg.accessKeyId);
      if (secCfg.enabled !== false && (enabledCfg || (a.defaultOn && (hasEnv || hasConfigured)))) {
        const st = stateOf(a.id);
        if (!st.ctx) {
          const auto = hasEnv || secCfg.apiKey || secCfg.cookie || secCfg.token || (a.id === "scnet" && num(secCfg.planCredits) > 0) ||
            (a.id === "anthropic") || (a.id === "volcano" && (j.env.VOLCENGINE_ACCESS_KEY_ID || secCfg.accessKeyId));
          if (auto || a.id === "scnet") st.ctx = { config: true, family: a.id };   // anthropic 已改显式启用：enabled+凭据可得才激活
        }
        if (st.ctx) set.set(a.id, { a, st });
        else if (a.defaultOn) {
          /* 零配置适配器但探测不到 provider：仅当 primary 是它时才标 not_configured，否则静默跳过 */
        }
      }
    }
    for (const [id, st] of states) {
      const a = adapterOf(id);   // 复合源 id（vendor:providerId）也须命中：禁用/撤销/解密检查不得跳过账户源
      if (!a) continue;
      const cfg = (j.secrets.sources || {})[a.id] || {};
      if (cfg.enabled === false) {
        deactivateSource(st, "disabled");
      } else if (a.id !== "custom" && !set.has(id)) {
        /* 复合账户源（id 含 ":"）随 pane 离开只视为不在集合：保留 TTL 内缓存供切回即用；
         * 禁用（enabled=false）与凭据失效（resolveCred 空）的撤销在各自分支执行。 */
        if (id.indexOf(":") < 0) deactivateSource(st, "not_configured");
      } else if (set.has(id) && st.ctx) {
        const cred = a.resolveCred(j, st.ctx);
        if (!cred || cred.decryptFailed) {
          deactivateSource(st, "not_configured");
          if (cred && cred.decryptFailed) {
            st.reason = "decrypt";
            st.lastError = "credential decrypt failed";
          }
        } else if (st.status === "disabled") st.status = "idle";
      }
    }
    return set;
  }

  let primaryCtx = null;

  function tick(force) {
    for (const { a, st } of activeSet().values()) tickSource(a, st, force);
  }

  function rememberProvider(providerId) {
    const r = resolvePrimary(providerId);
    if (r.id && providerId.indexOf("account:") !== 0 && r.id.indexOf(":") < 0) {
      r.id += ":" + providerId;
    }
    byProvider[providerId] = r.id || "";
    if (!r.id || r.id === "team") return r;
    const st = stateOf(r.id);
    const contextStamp = sha16(JSON.stringify(r.ctx || null));
    if (st.contextStamp !== contextStamp) {
      st.epoch += 1;
      if (st.ctl) st.ctl.abort();
      st.inFlight = null;
      st.ctx = r.ctx || null;
      st.contextStamp = contextStamp;
      st.value = null;
      st.fetchedAt = 0;
      st.status = "idle";
      st.reason = "";
      st.lastError = "";
      st.fingerprint = "";
      st.backoffIdx = 0;
      st.nextAt = 0;
    }
    return r;
  }

  function entryView(st) {
    const t = now();
    const a = adapterOf(st.id);
    const ttl = a && a.kind === "balance" ? TTL_BALANCE_MS : TTL_MS;
    const cfg = a ? ((j.secrets.sources || {})[a.id] || {}) : {};
    const v = { status: cfg.enabled === false ? "disabled" : st.status, reason: st.reason, fetchedAt: st.fetchedAt,
      stale: !!(st.fetchedAt && t - st.fetchedAt > ttl), error: st.lastError };
    if (cfg.enabled === false) return v;
    if (st.value) {
      v.level = st.value.level;
      v.plan = st.value.plan || null;
      v.balance = st.value.balance || null;
      v.windows = st.value.windows;
      v.tools = st.value.tools;
      v.models = st.value.models;
      v.ledger = st.value.ledger || null;
      if (st.value.label) v.label = st.value.label;
      if (st.value.kind) v.kind = st.value.kind;
      if (st.value.subscription) v.subscription = st.value.subscription;
      if (st.value.quotaSummary) v.quotaSummary = st.value.quotaSummary;
    }
    return v;
  }

  return {
    tick,
    refresh() { tick(true); },
    refreshSource(id) {   // 厂商按钮刷新该厂商各账户；chip 的完整源 id 只刷新本账户
      const a = adapterOf(id);
      if (!a) return;
      if (String(id).indexOf(":") >= 0) {
        const st = states.get(id);
        if (st) tickSource(a, st, true);
      } else {
        for (const st of states.values()) if (adapterOf(st.id) === a) tickSource(a, st, true);
      }
    },
    noteProvider(providerId) {
      const p = String(providerId || "");
      if (p === primaryProvider && wantedProviders === null) return;
      wantedProviders = null;
      primaryProvider = p;
      if (!p) { primaryId = ""; primaryCtx = null; return; }
      const r = rememberProvider(p);
      primaryId = r.id;
      primaryCtx = r.ctx || null;
    },
    setProviders(providerIds) {
      const next = Array.from(new Set((Array.isArray(providerIds) ? providerIds : [])
        .filter((p) => typeof p === "string" && p.length > 0 && p.length <= 160 && !/[\x00-\x1f\x7f]/.test(p))));
      const ids = new Set();
      for (const p of next) ids.add(rememberProvider(p).id);
      for (const p of Object.keys(byProvider)) if (!next.includes(p)) delete byProvider[p];
      if (!next.includes(primaryProvider)) primaryProvider = next[0] || "";
      primaryId = byProvider[primaryProvider] || "";
      primaryCtx = primaryId ? stateOf(primaryId).ctx : null;
      wantedProviders = next;
      for (const [id, st] of states) {
        if (id.indexOf(":") < 0 || ids.has(id) || !st.inFlight) continue;
        st.epoch += 1;
        if (st.ctl) st.ctl.abort();
        st.inFlight = null;
      }
    },
    credentialsChanged() {
      /* 同一 provider 的 key/baseURL 也可能被修改；重读实际配置并重判适配器，
       * 不能沿用旧 ctx 或让一次 unsupported 永久锁住后来补全的 MiniMax 规则。 */
      const registered = new Set(Object.keys(byProvider));
      if (primaryProvider) registered.add(primaryProvider);
      /* 经 rememberProvider 重判：复合源后缀（vendor:providerId）与代际失效/状态复位
       * 由它统一处理——直接用 resolvePrimary 裸写 byProvider 会把厂商内复合源坍缩成
       * 裸家族源，丢账户隔离（多账户中转串显，实测）。 */
      for (const provider of registered) rememberProvider(provider);
      if (primaryProvider) {
        primaryId = byProvider[primaryProvider] || "";
        const st = primaryId ? states.get(primaryId) : null;
        primaryCtx = st ? st.ctx : null;
      }
      activeSet();   // 总开关关闭时也撤销旧额度；只重评本地配置，不发请求/回调
      /* 唤醒"值得重评"的源：冻结态（Infinity）重评后仍由 status 短路（指纹未变不复 fetch）；
       * not_configured 唤醒以承接 secrets/供应商配置刚启用；宿主凭据源即时重拉（token 刷新）。
       * ok 态保持 TTL——指纹在其自然到期重查时校验，避免一次 secrets 写入全源冗余刷新。 */
      for (const st of states.values()) {
        if (st.nextAt === Infinity || st.status === "not_configured" || (st.cred && st.cred.source === "host")) st.nextAt = 0;
      }
    },
    noteSnapshotExtras(data) {   // 快照侧注入（scnet 估算等）；ledger 源数据到位即解冻
      const prevScnet = extras.scnet;
      Object.assign(extras, data || {});
      if (data && data.scnet !== undefined && JSON.stringify(data.scnet) !== JSON.stringify(prevScnet)) {
        const st = states.get("scnet");
        if (st && (st.status === "no_plan" || st.status === "network_error")) {
          st.status = "idle";
          st.nextAt = 0;   // 估算就绪：立即重查（首次启用早于首个快照的自我冻结修复）
        }
      }
    },
    view() {
      activeSet();   // 配置撤销立即可见，不等待下一轮联网 tick
      const sources = {};
      for (const [id, st] of states) sources[id] = entryView(st);
      const out = { active: primaryId || "", byProvider: Object.assign({}, byProvider), sources };
      const prim = primaryId ? sources[primaryId] : null;   // 兼容镜像（本版保留，浮层迁移完成后移除）
      if (prim) Object.assign(out, {
        status: prim.status, reason: prim.reason, providerId: primaryProvider,
        fetchedAt: prim.fetchedAt, stale: prim.stale, error: prim.error,
        level: prim.level, plan: prim.plan, balance: prim.balance,
        windows: prim.windows, tools: prim.tools, models: prim.models, ledger: prim.ledger,
        label: prim.label, kind: prim.kind, subscription: prim.subscription, quotaSummary: prim.quotaSummary,
      });
      return out;
    },
    sourcesConfig() {   // ⚙ 面板数据源列表（不回显凭据值）
      activeSet();
      const list = [];
      for (const a of ADAPTERS) {
        if (a.id === "custom") continue;
        const cfg = (j.secrets.sources || {})[a.id] || {};
        const accounts = Array.from(states.values()).filter((st) => adapterOf(st.id) === a && st.ctx);
        const st = accounts.find((entry) => entry.status === "ok") || accounts[0] || states.get(a.id);
        list.push({
          id: a.id, label: a.label, kind: a.kind, defaultOn: a.defaultOn, unverified: !!a.unverified,
          enabled: cfg.enabled !== false && (a.defaultOn || cfg.enabled === true),
          credentialFields: a.id === "mimo" ? ["cookie"] : a.id === "volcano" ? ["accessKeyId", "secretAccessKey"] : a.id === "scnet" ? ["planCredits", "planStart"] : a.id === "anthropic" ? ["token"] : ["apiKey"],
          keyConfigured: !!(cfg.apiKey || cfg.cookie || cfg.token || cfg.accessKeyId ||
            accounts.some((entry) => !!entry.cred) || (a.id === "scnet" && num(cfg.planCredits) > 0)),
          keySource: st && st.cred ? st.cred.source : "",
          /* v104：显式关闭的源统一报 disabled（与 entryView 同口径）——原样透传 st.status 时
           * 从未激活过的关闭源会冒充 idle，面板出现「开关已关却显示待查询」的矛盾 */
          status: cfg.enabled === false ? "disabled" : (st ? st.status : "idle"),
          /* v102：预设模板（静态白名单）+ 当前 baseUrl（域名非凭据，仅用于面板高亮选中模板；
           * apiKey/cookie/token/AK/SK 照旧不回显） */
          presets: (SOURCE_PRESETS[a.id] || {}).presets,
          keyUrl: (SOURCE_PRESETS[a.id] || {}).keyUrl,
          baseUrl: cfg.baseUrl || "",
        });
      }
      return list;
    },
    secretsPath,
    dispose() {
      for (const st of states.values()) {
        if (st.ctl) { try { st.ctl.abort(); } catch (e) { } }
        st.inFlight = null;
      }
    },
    get _state() { return states.get(primaryId) || states.get("custom") || {}; },   // 测试接缝兼容（v96 单源形状）
    _states: states,
    _adapters: ADAPTERS,
  };
}

module.exports = {
  createQuotaClient,
  resolveQuotaPaths,
  resolveCustomProvider,
  decryptValue,
  deriveCipherKey,
  jwtExpMs,
  normalizeQuotaBody,
  normalizeSubscriptionPlan,
  normalizeSub2api,
  relayQuotaUrls,
  isNoPlanMessage,
  normalizeMimoCookie,
  parseCurrencyAmount,
  collectWindows,
  resolveWanted(providerId) {   // v96 兼容导出（单测在用）：内置 family 判定
    const p = String(providerId || "");
    if (apiKeyFamilyOf(p)) return { family: apiKeyFamilyOf(p) };
    if (p.indexOf("account:") !== 0) return null;
    if (p.indexOf("team") >= 0) return { unsupported: "team" };
    if (p.indexOf("account:bigmodel") === 0) return { family: "bigmodel" };
    if (p.indexOf("account:zai") === 0) return { family: "zai" };
    return null;
  },
  TTL_MS,
};
