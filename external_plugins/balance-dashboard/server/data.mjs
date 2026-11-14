/**
 * Read-only balance data layer shared by the MCP tool, the one-shot collector,
 * and the sidebar injector.
 *
 * Fetches official balances where the provider offers an API and reads the
 * local ZCode usage database for today's token usage. No credentials are logged
 * or written to disk.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 12 * 1000;
const USER_AGENT = "balance-dashboard/0.3.0";

const env = process.env;
const HOME = os.homedir();
const ZCODE_ROOT = path.join(HOME, ".zcode");
const ZCODE_V2_DIR = path.join(ZCODE_ROOT, "v2");
const RUNTIME_DIR =
  (env.BALANCE_RUNTIME_DIR && env.BALANCE_RUNTIME_DIR.trim()) ||
  path.join(ZCODE_ROOT, "balance-dashboard", "runtime");
const SIDEBAR_STATUS_PATH = path.join(RUNTIME_DIR, "status.json");
const CREDENTIALS_PATH = env.ZCODE_CREDENTIALS_FILE || path.join(ZCODE_V2_DIR, "credentials.json");
const PROVIDER_CONFIG_PATH =
  env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE || path.join(ZCODE_V2_DIR, "provider_config.json");
const SETTING_PATH = env.ZCODE_SETTING_FILE || path.join(ZCODE_V2_DIR, "setting.json");
const CLI_CONFIG_CANDIDATES = [
  env.ZCODE_CLI_CONFIG,
  path.join(ZCODE_ROOT, "cli", "config.json"),
  path.join(ZCODE_ROOT, "config.json"),
].filter(Boolean);
const SECRETS_PATH = path.join(ZCODE_ROOT, "cli", "plugin-secrets.json");
const RUNTIME_OPTIONS_PATH = path.join(RUNTIME_DIR, "options.json");
let pluginOptionsCache = null;
let pluginOptionsSources = [];

function pluginOptionPools(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
  const pools = [];
  if (doc.plugins && typeof doc.plugins === "object" && doc.plugins.options) pools.push(doc.plugins.options);
  if (doc.options && typeof doc.options === "object") pools.push(doc.options);
  pools.push(doc);
  return pools;
}

function pickPluginOptions(doc) {
  for (const pool of pluginOptionPools(doc)) {
    const key = Object.keys(pool).find((name) => name.startsWith("balance-dashboard@"));
    if (key && pool[key] && typeof pool[key] === "object" && !Array.isArray(pool[key])) return pool[key];
  }
  return null;
}

/**
 * Plugin userConfig values are stored in ZCode's CLI config. The MCP server
 * receives them as environment variables, but the injected main-process
 * collector does not; reading the same options here keeps both views in sync.
 *
 * Merge order (low to high precedence):
 *   1. ~/.zcode/cli/config.json  -> plugins.options
 *   2. ~/.zcode/cli/plugin-secrets.json
 *   3. ~/.zcode/balance-dashboard/runtime/options.json (saved by the sidebar modal)
 */
function loadPluginOptions() {
  if (pluginOptionsCache) return pluginOptionsCache;
  const out = {};
  pluginOptionsSources = [];

  const merge = (values, source, decrypt) => {
    if (!values || typeof values !== "object" || Array.isArray(values)) return;
    let changed = false;
    for (const [name, raw] of Object.entries(values)) {
      if (raw == null) continue;
      const resolved = decrypt ? decryptCredential(raw) : raw;
      if (resolved == null || typeof resolved === "object") continue;
      out[name] = String(resolved);
      changed = true;
    }
    if (changed && !pluginOptionsSources.includes(source)) pluginOptionsSources.push(source);
  };

  for (const file of CLI_CONFIG_CANDIDATES) {
    const doc = readJson(file);
    merge(pickPluginOptions(doc), file, true);
  }

  const secretsDoc = readJson(SECRETS_PATH);
  merge(pickPluginOptions(secretsDoc), SECRETS_PATH, true);

  const runtimeDoc = readJson(RUNTIME_OPTIONS_PATH);
  merge(runtimeDoc && typeof runtimeDoc === "object" ? runtimeDoc : null, RUNTIME_OPTIONS_PATH, false);

  pluginOptionsCache = out;
  return pluginOptionsCache;
}

const SECRET_OPTION_FIELDS = new Set(["deepseek_api_key", "volc_secret_access_key", "zcode_jwt_token"]);
const TEXT_OPTION_FIELDS = ["volc_access_key_id", "volc_region", "zcode_usage_db", "zcode_device_mid"];

export function settingsSnapshot() {
  const options = loadPluginOptions();
  const values = {};
  const secrets = {};
  for (const name of SECRET_OPTION_FIELDS) {
    secrets[name] = !!(options[name] && String(options[name]).trim());
  }
  for (const name of TEXT_OPTION_FIELDS) {
    values[name] = options[name] ? String(options[name]) : "";
  }
  return {
    values,
    secrets,
    ui: {
      showDeepseek: options.show_deepseek !== "0",
      showVolcano: options.show_volcano !== "0",
      showZcode: options.show_zcode !== "0",
      hideUnconfigured: options.hide_unconfigured !== "0",
    },
    autoDetected: {
      deepseek: !!discoverDeepSeekKey(),
      volcano: !!discoverVolcengineCredentials(),
      zcodeToken: !!loadCredentials()["zcodejwttoken"],
    },
    runtimeOptionsPath: RUNTIME_OPTIONS_PATH,
    sources: pluginOptionsSources.slice(),
  };
}

function usageDbPath() {
  const options = loadPluginOptions();
  return (
    (env.ZCODE_USAGE_DB && env.ZCODE_USAGE_DB.trim()) ||
    (options.zcode_usage_db && String(options.zcode_usage_db).trim()) ||
    path.join(ZCODE_ROOT, "cli", "db", "db.sqlite")
  );
}

export const USD_TO_CNY = 7.2;
export const MODEL_PRICES_USD_PER_M = {
  "deepseek-flash": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  "deepseek-v4-flash": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  "deepseek-v4.1-flash": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  "deepseek-v4-1-flash-261017": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  "deepseek-v4-flash-vision-exp": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  "deepseek-v4-pro": { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
  "deepseek-reasoner": { input: 0.55, output: 1.66, cacheRead: 0.14, cacheWrite: 0 },
  "deepseek-chat": { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
  "doubao-seed-2-0-code-preview-260215": { input: 0.475, output: 2.375, cacheRead: 0.095, cacheWrite: 0 },
  "doubao-seed-2-0-pro-260215": { input: 0.475, output: 2.375, cacheRead: 0.095, cacheWrite: 0 },
  "doubao-seed-2-0-lite-260428": { input: 0.089, output: 0.534, cacheRead: 0.018, cacheWrite: 0 },
  "doubao-seed-2-0-mini-260428": { input: 0.03, output: 0.297, cacheRead: 0.006, cacheWrite: 0 },
  "doubao-seed-2-1-pro-260628": { input: 0.891, output: 4.453, cacheRead: 0.178, cacheWrite: 0 },
  "doubao-seed-2-1-turbo-260628": { input: 0.445, output: 2.227, cacheRead: 0.089, cacheWrite: 0 },
  "glm-5.3": { input: 0.4, output: 1.6, cacheRead: 0.08, cacheWrite: 0.5 },
  "glm-5.3-flash": { input: 0.05, output: 0.2, cacheRead: 0.01, cacheWrite: 0.05 },
};
export const DEFAULT_PRICE_USD = { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 };

const log = (...args) => {
  if (env.BALANCE_DEBUG === "1" || env.BALANCE_DEBUG === "true") {
    console.error("[balance-dashboard]", ...args);
  }
};

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */

function readJson(file, fallback = null) {
  try {
    let text = fs.readFileSync(file, "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function finiteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function redact(value, visible = 4) {
  const s = String(value || "");
  if (s.length <= visible * 2) return s ? `${s.slice(0, 2)}***` : "";
  return `${s.slice(0, visible)}…${s.slice(-visible)}`;
}

function errorInfo(code, message, hint) {
  return { code, message: String(message || code), ...(hint ? { hint } : {}) };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, ...(options.headers || {}) },
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, ok: response.ok, text, json };
  } finally {
    clearTimeout(timer);
  }
}

function apiFailure(response, allowCodes = []) {
  if (response.ok && !allowCodes.includes(response.status)) return null;
  const body = response.json || {};
  const raw = body.msg ?? body.message ?? body.error ?? body.ResponseMetadata?.Error?.Message;
  const message =
    (typeof raw === "string" && raw) ||
    (raw && typeof raw === "object" && (raw.message || raw.msg)) ||
    response.text.slice(0, 160);
  return errorInfo(
    response.status === 401 || response.status === 403 ? "auth_failed" : "http_error",
    typeof message === "string" ? message : JSON.stringify(message),
  );
}

/* ------------------------------------------------------------------ */
/* Local ZCode configuration and usage                                  */
/* ------------------------------------------------------------------ */

let providerCache = null;

function loadProviderRules() {
  if (providerCache) return providerCache;
  const doc = readJson(PROVIDER_CONFIG_PATH);
  const rules = doc?.config?.providerConfigRules?.providerRules;
  const map = new Map();
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (!rule || typeof rule !== "object" || !rule.providerId) continue;
      map.set(String(rule.providerId), {
        id: String(rule.providerId),
        name: typeof rule.providerName === "string" ? rule.providerName : String(rule.providerId),
        baseUrl: typeof rule?.config?.api?.baseUrl === "string" ? rule.config.api.baseUrl : "",
        apiKey: typeof rule?.config?.access?.apiKey === "string" ? rule.config.access.apiKey : "",
        accessType: typeof rule?.config?.access?.type === "string" ? rule.config.access.type : "",
      });
    }
  }
  providerCache = map;
  return map;
}

export function bucketOfProvider(providerId, modelId = "") {
  const info = loadProviderRules().get(providerId);
  const baseUrl = info?.baseUrl || "";
  let host = "";
  let pathname = "";
  try {
    const parsed = new URL(baseUrl);
    host = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    // ignore malformed provider configuration
  }
  const name = String(info?.name || providerId || "").toLowerCase();
  const model = String(modelId || "").toLowerCase();

  if (host === "api.deepseek.com" || providerId.includes("deepseek")) return "deepseek";
  if (host === "ark.cn-beijing.volces.com" || host.endsWith(".volces.com")) {
    if (pathname.includes("/coding") || name.includes("coding plan")) return "volcanoCodingPlan";
    return "volcanoAccount";
  }
  if (
    providerId.startsWith("account:") ||
    host === "bigmodel.cn" ||
    host === "z.ai" ||
    host === "api.z.ai" ||
    host === "open.bigmodel.cn"
  ) {
    return "zcode";
  }
  if (model.startsWith("deepseek") && providerId === "deepseek") return "deepseek";
  return "other";
}

function discoverDeepSeekKey() {
  const options = loadPluginOptions();
  const explicit = (
    env.DEEPSEEK_API_KEY ||
    env.DEEPSEEK_BALANCE_API_KEY ||
    options.deepseek_api_key ||
    ""
  )
    .toString()
    .trim();
  if (explicit) return { key: explicit, source: "user_config" };
  for (const info of loadProviderRules().values()) {
    if (!info.apiKey) continue;
    let host = "";
    try {
      host = new URL(info.baseUrl).hostname.toLowerCase();
    } catch {
      host = "";
    }
    if (host === "api.deepseek.com" || (!info.baseUrl && info.id === "deepseek")) {
      return { key: info.apiKey, source: "provider_config" };
    }
  }
  return null;
}

function discoverVolcengineCredentials() {
  const options = loadPluginOptions();
  const ak = (
    env.VOLC_ACCESS_KEY_ID ||
    env.VOLCENGINE_ACCESS_KEY_ID ||
    env.VOLCENGINE_AK ||
    options.volc_access_key_id ||
    ""
  )
    .toString()
    .trim();
  const sk = (
    env.VOLC_SECRET_ACCESS_KEY ||
    env.VOLCENGINE_SECRET_ACCESS_KEY ||
    env.VOLCENGINE_SK ||
    options.volc_secret_access_key ||
    ""
  )
    .toString()
    .trim();
  if (!ak || !sk) return null;
  const region = String(env.VOLC_REGION || env.VOLCENGINE_REGION || options.volc_region || "").trim();
  return { ak, sk, region: region || "" };
}

function deriveCredentialSecret() {
  const direct = (env.ZCODE_CREDENTIAL_SECRET || "").trim();
  if (direct) return direct;
  const file = (env.ZCODE_CREDENTIAL_SECRET_FILE || "").trim();
  if (file) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {
      // fall through to the host-compatible fallback secret
    }
  }
  let username = "unknown";
  try {
    username = os.userInfo().username;
  } catch {
    // keep placeholder
  }
  return `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${username}`;
}

function decryptCredential(value) {
  if (typeof value !== "string" || !value.startsWith("enc:")) return value;
  if (!value.startsWith("enc:v1:")) {
    log("unsupported credential envelope", value.slice(0, 9));
    return null;
  }
  const parts = value.slice("enc:v1:".length).split(".");
  if (parts.length !== 3) return null;
  try {
    const key = crypto.createHash("sha256").update(deriveCredentialSecret()).digest();
    const iv = Buffer.from(parts[0], "base64url");
    const tag = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function loadCredentials() {
  const doc = readJson(CREDENTIALS_PATH, {});
  const out = {};
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    for (const [key, value] of Object.entries(doc)) {
      const decrypted = decryptCredential(value);
      if (decrypted != null) out[key] = decrypted;
    }
  }
  return out;
}

function readDeviceMid() {
  const options = loadPluginOptions();
  const explicit = String(env.ZCODE_DEVICE_MID || options.zcode_device_mid || "").trim();
  if (explicit) return explicit;
  for (const name of ["telemetry-state.json", "onboarding-record.json"]) {
    const doc = readJson(path.join(ZCODE_V2_DIR, name));
    if (doc && typeof doc.deviceMid === "string" && doc.deviceMid.trim()) return doc.deviceMid.trim();
  }
  return "";
}

function loadPlanSelection() {
  const doc = readJson(SETTING_PATH, {});
  return {
    family: typeof doc?.providerFamilyDomain === "string" ? doc.providerFamilyDomain : "",
    selection: doc?.providerFamilyConnectionSelections || {},
    legacyKeys: doc?.modelProviderFamilySelectedKeys || {},
  };
}

async function loadUsageRows() {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const usageDb = usageDbPath();
    if (!fs.existsSync(usageDb)) {
      return { available: false, error: errorInfo("db_missing", `用量数据库不存在：${usageDb}`) };
    }
    const db = new DatabaseSync(usageDb, { readOnly: true });
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const rows = db
        .prepare(
          `select provider_id, model_id, count(*) as requests,
                  coalesce(sum(input_tokens),0) as input_tokens,
                  coalesce(sum(output_tokens),0) as output_tokens,
                  coalesce(sum(reasoning_tokens),0) as reasoning_tokens,
                  coalesce(sum(cache_read_input_tokens),0) as cache_read_tokens,
                  coalesce(sum(cache_creation_input_tokens),0) as cache_write_tokens,
                  coalesce(sum(computed_total_tokens),0) as computed_total_tokens
             from model_usage
            where started_at >= ? and started_at < ?
            group by provider_id, model_id`,
        )
        .all(start.getTime(), end.getTime());
      return {
        available: true,
        start: start.toISOString(),
        end: end.toISOString(),
        rows: rows.map((row) => ({
          providerId: String(row.provider_id || ""),
          modelId: String(row.model_id || ""),
          requests: Number(row.requests) || 0,
          inputTokens: Number(row.input_tokens) || 0,
          outputTokens: Number(row.output_tokens) || 0,
          reasoningTokens: Number(row.reasoning_tokens) || 0,
          cacheReadTokens: Number(row.cache_read_tokens) || 0,
          cacheWriteTokens: Number(row.cache_write_tokens) || 0,
          computedTotalTokens: Number(row.computed_total_tokens) || 0,
        })),
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return { available: false, error: errorInfo("db_read_failed", error.message || String(error)) };
  }
}

export function priceOfModel(modelId) {
  const key = String(modelId || "").toLowerCase();
  return MODEL_PRICES_USD_PER_M[key] || null;
}

function summarizeRows(rows, { estimateCost = false } = {}) {
  const summary = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    models: [],
    cost: null,
  };
  let costUSD = 0;
  let pricedRequests = 0;
  let unknownModels = 0;

  for (const row of rows) {
    summary.requests += row.requests;
    summary.inputTokens += row.inputTokens;
    summary.outputTokens += row.outputTokens;
    summary.reasoningTokens += row.reasoningTokens;
    summary.cacheReadTokens += row.cacheReadTokens;
    summary.cacheWriteTokens += row.cacheWriteTokens;
    // Same token semantics as the analytics view: computed_total_tokens
    // first, input+output as the fallback.
    summary.totalTokens += row.computedTotalTokens || row.inputTokens + row.outputTokens;
    summary.models.push({
      modelId: row.modelId,
      providerId: row.providerId,
      requests: row.requests,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
    });

    if (estimateCost) {
      const rates = priceOfModel(row.modelId) || DEFAULT_PRICE_USD;
      if (!priceOfModel(row.modelId)) unknownModels += 1;
      else pricedRequests += row.requests;
      const bareInput = Math.max(0, row.inputTokens - row.cacheReadTokens - row.cacheWriteTokens);
      costUSD +=
        (bareInput * rates.input +
          row.cacheReadTokens * rates.cacheRead +
          row.cacheWriteTokens * rates.cacheWrite +
          row.outputTokens * rates.output) /
        1_000_000;
    }
  }

  summary.models.sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
  if (estimateCost) {
    summary.cost = {
      amount: round2(costUSD * USD_TO_CNY),
      currency: "CNY",
      estimated: true,
      note: unknownModels ? "部分模型无公开牌价，按通用均价估算" : "按公开牌价估算",
      unknownModels,
      pricedRequests,
    };
  }
  return summary;
}

function usageForBucket(usage, bucket, options) {
  if (!usage?.available) return null;
  const rows = usage.rows.filter((row) => bucketOfProvider(row.providerId, row.modelId) === bucket);
  const summary = summarizeRows(rows, options);
  return summary.requests > 0 ? summary : null;
}

/* ------------------------------------------------------------------ */
/* DeepSeek                                                             */
/* ------------------------------------------------------------------ */

async function getDeepSeek(usage, force) {
  const keyInfo = discoverDeepSeekKey();
  const localToday = usageForBucket(usage, "deepseek", { estimateCost: true });
  if (!keyInfo) {
    return {
      status: "unconfigured",
      configured: false,
      balance: null,
      today: localToday,
      hint: "未找到 DeepSeek API Key。请在 ZCode 的 DeepSeek 供应商中配置 Key，或在插件的 deepseek_api_key 选项中填写。",
    };
  }
  try {
    const response = await cached("deepseek", force, () =>
      fetchWithTimeout("https://api.deepseek.com/user/balance", {
        headers: { authorization: `Bearer ${keyInfo.key}`, accept: "application/json" },
      }),
    );
    const failure = apiFailure(response);
    if (failure) return { status: "error", configured: true, error: failure, balance: null, today: localToday };
    const body = response.json || {};
    const infos = Array.isArray(body.balance_infos) ? body.balance_infos : [];
    if (!infos.length) {
      if (body.is_available === false) {
        return {
          status: "ok",
          configured: true,
          balance: { amount: 0, currency: "CNY", parts: [] },
          today: localToday,
          keySource: keyInfo.source,
        };
      }
      return {
        status: "error",
        configured: true,
        error: errorInfo("parse_error", "DeepSeek 余额响应中没有 balance_infos"),
        balance: null,
        today: localToday,
      };
    }
    const parsed = infos
      .map((item) => {
        const total = finiteNumber(item.total_balance);
        const granted = finiteNumber(item.granted_balance);
        const topped = finiteNumber(item.topped_up_balance);
        if (total == null) return null;
        return {
          currency: typeof item.currency === "string" ? item.currency : "CNY",
          total,
          granted: granted == null ? 0 : granted,
          topped: topped == null ? 0 : topped,
        };
      })
      .filter(Boolean);
    if (!parsed.length) {
      return {
        status: "error",
        configured: true,
        error: errorInfo("parse_error", "DeepSeek 余额字段无法解析"),
        balance: null,
        today: localToday,
      };
    }
    const best = parsed.sort((a, b) => b.total - a.total)[0];
    return {
      status: "ok",
      configured: true,
      keySource: keyInfo.source,
      balance: {
        amount: round2(best.total),
        currency: best.currency,
        parts: [
          { label: "赠送", amount: round2(best.granted) },
          { label: "充值", amount: round2(best.topped) },
        ],
        available: body.is_available !== false,
      },
      today: localToday,
    };
  } catch (error) {
    return {
      status: "error",
      configured: true,
      error: errorInfo(
        error.name === "AbortError" ? "timeout" : "network_error",
        error.name === "AbortError" ? "DeepSeek 余额查询超时" : error.message || String(error),
      ),
      balance: null,
      today: localToday,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Volcengine signing                                                   */
/* ------------------------------------------------------------------ */

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

async function volcRequest({ action, version, service, region, body = "", timeoutMs = FETCH_TIMEOUT_MS }) {
  const credentials = discoverVolcengineCredentials();
  if (!credentials) throw Object.assign(new Error("missing Volcano AK/SK"), { code: "unconfigured" });
  const host = "open.volcengineapi.com";
  // Ark's plan APIs take Region in the query; the billing APIs document it as a header.
  const queryPairs = [
    ["Action", action],
    ...(service === "ark" ? [["Region", region]] : []),
    ["Version", version],
  ].sort((a, b) => a[0].localeCompare(b[0]));
  const query = queryPairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const now = new Date();
  const xDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = xDate.slice(0, 8);
  const payloadHash = crypto.createHash("sha256").update(body).digest("hex");
  const canonicalHeaders =
    `host:${host}\nx-date:${xDate}\nx-content-sha256:${payloadHash}\ncontent-type:application/json; charset=utf-8\n`;
  const signedHeaders = "host;x-date;x-content-sha256;content-type";
  const canonicalRequest = `POST\n/\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/${region}/${service}/request`;
  const stringToSign = `HMAC-SHA256\n${xDate}\n${scope}\n${crypto
    .createHash("sha256")
    .update(canonicalRequest)
    .digest("hex")}`;
  let signingKey = hmac(credentials.sk, date);
  signingKey = hmac(signingKey, region);
  signingKey = hmac(signingKey, service);
  signingKey = hmac(signingKey, "request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `HMAC-SHA256 Credential=${credentials.ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetchWithTimeout(
    `https://${host}/?${query}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-date": xDate,
        "x-content-sha256": payloadHash,
        authorization,
        region,
        servicename: service,
      },
      body,
    },
    timeoutMs,
  );
  if (!response.ok) {
    const bodyJson = response.json || {};
    const gatewayError = bodyJson?.ResponseMetadata?.Error;
    throw Object.assign(
      new Error(
        gatewayError?.Message || bodyJson?.message || bodyJson?.msg || response.text.slice(0, 180) || `HTTP ${response.status}`,
      ),
      { code: response.status === 401 || response.status === 403 ? "auth_failed" : "http_error", status: response.status },
    );
  }
  const bodyJson = response.json || {};
  if (bodyJson?.ResponseMetadata?.Error) {
    const e = bodyJson.ResponseMetadata.Error;
    throw Object.assign(new Error(e.Message || e.Code || "Volcengine API error"), { code: "business_error", status: 200 });
  }
  return bodyJson;
}

function periodParts(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return {
    period: `${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
  };
}

async function getVolcanoAccount(usage, force) {
  const credentials = discoverVolcengineCredentials();
  const localToday = usageForBucket(usage, "volcanoAccount", { estimateCost: true });
  if (!credentials) {
    return {
      status: "unconfigured",
      configured: false,
      balance: null,
      today: localToday,
      hint: "账户余额需要火山引擎 AK/SK。请在插件配置中填写 volc_access_key_id / volc_secret_access_key。",
    };
  }
  const billingRegion = credentials.region || "cn-north-1";
  try {
    const balanceBody = await cached("volcano-account-balance", force, () =>
      volcRequest({
        action: "QueryBalanceAcct",
        version: "2022-01-01",
        service: "billing",
        region: billingRegion,
      }),
    );
    const result = balanceBody?.Result || {};
    const available = finiteNumber(result.AvailableBalance);
    const cash = finiteNumber(result.CashBalance);
    const arrears = finiteNumber(result.ArrearsBalance);
    const credit = finiteNumber(result.CreditLimit);
    if (available == null) {
      return {
        status: "error",
        configured: true,
        error: errorInfo("parse_error", "火山引擎余额响应缺少 AvailableBalance"),
        balance: null,
        today: localToday,
      };
    }

    let officialToday = null;
    let billWarning = null;
    try {
      const { period, date } = periodParts();
      let offset = 0;
      let total = null;
      let sum = 0;
      let rows = 0;
      for (let page = 0; page < 6; page += 1) {
        const payload = JSON.stringify({
          BillPeriod: period,
          ExpenseDate: date,
          GroupPeriod: 1,
          Limit: 300,
          Offset: offset,
          NeedRecordNum: 1,
          IgnoreZero: 1,
        });
        const bill = await volcRequest({
          action: "ListBillDetail",
          version: "2022-01-01",
          service: "billing",
          region: billingRegion,
          body: payload,
        });
        const r = bill?.Result || {};
        const list = Array.isArray(r.List) ? r.List : Array.isArray(r.ListBillDetail) ? r.ListBillDetail : [];
        total = finiteNumber(r.Total);
        for (const item of list) {
          const amount = finiteNumber(item.PayableAmount ?? item.DiscountBillAmount ?? item.OriginalBillAmount);
          if (amount != null) sum += amount;
          rows += 1;
        }
        if (!list.length) break;
        offset += list.length;
        if (total != null && offset >= total) break;
        if (list.length < 300) break;
      }
      officialToday = {
        amount: round2(sum),
        currency: "CNY",
        rows,
        date,
        note: rows ? "来自火山引擎当日账单" : "当日账单尚未生成",
      };
    } catch (error) {
      billWarning = errorInfo(error.code || "billing_error", error.message || String(error));
    }

    return {
      status: "ok",
      configured: true,
      balance: {
        amount: round2(available),
        currency: "CNY",
        cash: cash == null ? null : round2(cash),
        arrears: arrears == null ? null : round2(arrears),
        creditLimit: credit == null ? null : round2(credit),
      },
      today: officialToday && officialToday.rows > 0 ? officialToday : localToday,
      todaySource: officialToday && officialToday.rows > 0 ? "official_bill" : "local_estimate",
      localToday,
      officialToday,
      error: billWarning,
      region: billingRegion,
    };
  } catch (error) {
    const code = error.code || (error.name === "AbortError" ? "timeout" : "network_error");
    return {
      status: "error",
      configured: true,
      error: errorInfo(
        code,
        error.name === "AbortError" ? "火山引擎账户查询超时" : error.message || String(error),
        code === "auth_failed" ? "AK/SK 可能无效或没有账单/余额权限。" : "",
      ),
      balance: null,
      today: localToday,
    };
  }
}

function normalizeAfpWindows(result) {
  const windows = [];
  const map = [
    ["AFPDaily", "daily", "日额度"],
    ["AFPFiveHour", "fiveHour", "5 小时"],
    ["AFPWeekly", "weekly", "周额度"],
    ["AFPMonthly", "monthly", "月额度"],
  ];
  for (const [key, id, label] of map) {
    const item = result?.[key];
    if (!item || typeof item !== "object") continue;
    const quota = finiteNumber(item.Quota);
    const used = finiteNumber(item.Used);
    if (quota == null || used == null || quota <= 0) continue;
    windows.push({
      id,
      label,
      used,
      quota,
      remaining: Math.max(0, quota - used),
      percent: Math.round(Math.min(100, Math.max(0, (used / quota) * 100)) * 10) / 10,
      resetsAt: normalizeTimestamp(item.ResetTime),
    });
  }
  return windows;
}

function normalizeCodingPlanWindows(result) {
  const rows = result?.QuotaUsage || result?.Usages || result?.Details || result?.List || [];
  const windows = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const level = String(row.Level || row.Type || row.Period || row.Label || row.Window || "")
      .toLowerCase()
      .replace(/[\s_-]/g, "");
    const id = /session|^5h|fivehour|rolling5h/.test(level)
      ? "fiveHour"
      : /weekly|week|7d/.test(level)
        ? "weekly"
        : /monthly|month/.test(level)
          ? "monthly"
          : /daily|day/.test(level)
            ? "daily"
            : null;
    if (!id || seen.has(id)) continue;
    let percent = finiteNumber(row.Percent ?? row.UsedPercent ?? row.UsagePercent);
    if (percent == null) continue;
    seen.add(id);
    windows.push({
      id,
      label: id === "fiveHour" ? "5 小时" : id === "weekly" ? "周额度" : id === "monthly" ? "月额度" : "日额度",
      percent: Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10,
      resetsAt: normalizeTimestamp(row.ResetTime ?? row.ResetTimestamp),
    });
  }
  return windows;
}

function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

async function getVolcanoCodingPlan(usage, force) {
  const credentials = discoverVolcengineCredentials();
  const localToday = usageForBucket(usage, "volcanoCodingPlan", { estimateCost: false });
  if (!credentials) {
    return {
      status: "unconfigured",
      configured: false,
      plan: null,
      windows: [],
      today: localToday,
      hint: "Coding Plan 额度需要火山引擎 AK/SK（在火山方舟控制台创建访问密钥）。也可用环境变量 VOLCENGINE_ACCESS_KEY_ID / VOLCENGINE_SECRET_ACCESS_KEY。",
    };
  }
  const region = credentials.region || "cn-beijing";
  try {
    let windows = [];
    let planName = "";
    let officialDaily = null;
    try {
      const afp = await cached("volcano-afp", force, () =>
        volcRequest({ action: "GetAFPUsage", version: "2024-01-01", service: "ark", region }),
      );
      if (afp?.Result && typeof afp.Result === "object") {
        windows = normalizeAfpWindows(afp.Result);
        planName = "Agent Plan";
        officialDaily = windows.find((w) => w.id === "daily") || null;
      }
    } catch (error) {
      if (error.code === "auth_failed") throw error;
      log("GetAFPUsage unavailable", error.message);
    }
    if (!windows.length) {
      const coding = await cached("volcano-coding", force, () =>
        volcRequest({ action: "GetCodingPlanUsage", version: "2024-01-01", service: "ark", region }),
      );
      windows = normalizeCodingPlanWindows(coding?.Result || {});
      planName = "Coding Plan";
    }
    if (!windows.length) {
      return {
        status: "no_plan",
        configured: true,
        plan: null,
        windows: [],
        today: localToday,
        hint: "该账号下未检测到 Agent Plan 或 Coding Plan 额度。",
      };
    }
    return {
      status: "ok",
      configured: true,
      plan: { name: planName || "Coding Plan" },
      windows,
      today: localToday,
      officialDaily,
      region,
    };
  } catch (error) {
    const code = error.code || (error.name === "AbortError" ? "timeout" : "network_error");
    const message = error.name === "AbortError" ? "Coding Plan 额度查询超时" : error.message || String(error);
    if (code !== "auth_failed" && /coding\s*plan|agent\s*plan|套餐|未开通|not\s*found|no\s*plan/i.test(message)) {
      return {
        status: "no_plan",
        configured: true,
        plan: null,
        windows: [],
        today: localToday,
        hint: "该账号下未检测到 Agent Plan 或 Coding Plan 额度。",
      };
    }
    return {
      status: "error",
      configured: true,
      error: errorInfo(
        code,
        message,
        code === "auth_failed" ? "AK/SK 无效或没有 Ark Coding Plan 权限。" : "",
      ),
      plan: null,
      windows: [],
      today: localToday,
    };
  }
}

/* ------------------------------------------------------------------ */
/* ZCode plan balance                                                   */
/* ------------------------------------------------------------------ */

function startPlanWindows(balanceBody) {
  if (!balanceBody || typeof balanceBody !== "object") return null;
  if (balanceBody.success === false || (balanceBody.code !== undefined && balanceBody.code !== 0 && balanceBody.code !== 200)) {
    return { error: errorInfo("business_error", balanceBody.msg || "Start Plan 接口返回错误") };
  }
  const data = balanceBody.data;
  if (!data || typeof data !== "object") return { error: errorInfo("parse_error", "Start Plan 响应缺少 data") };
  const serverTime = finiteNumber(data.server_time);
  const now = serverTime != null ? (serverTime < 1e12 ? serverTime * 1000 : serverTime) : Date.now();
  const activePlans = (Array.isArray(data.plans) ? data.plans : [])
    .filter((plan) => {
      if (!plan || typeof plan !== "object") return false;
      const end = normalizeTimestamp(plan.ends_at);
      return String(plan.status || "").toLowerCase() === "active" && end && end > now;
    })
    .sort((a, b) => (finiteNumber(b.priority) ?? -1) - (finiteNumber(a.priority) ?? -1));
  if (!activePlans.length) return { noPlan: true };
  const planIds = new Set(activePlans.map((plan) => String(plan.plan_id || "")));
  const buckets = (Array.isArray(data.balances) ? data.balances : [])
    .filter((bucket) => {
      if (!bucket || typeof bucket !== "object") return false;
      if (String(bucket.meter || "") !== "model_usage") return false;
      if (bucket.plan_id != null && !planIds.has(String(bucket.plan_id))) return false;
      const total = finiteNumber(bucket.total_units);
      const expires = normalizeTimestamp(bucket.expires_at);
      return total != null && total > 0 && (!expires || expires > now);
    })
    .map((bucket) => ({
      name: typeof bucket.show_name === "string" ? bucket.show_name : "",
      used: finiteNumber(bucket.used_units) ?? 0,
      total: finiteNumber(bucket.total_units) ?? 0,
      expiresAt: normalizeTimestamp(bucket.expires_at),
    }))
    .sort((a, b) => b.total - a.total);
  const used = buckets.reduce((sum, b) => sum + b.used, 0);
  const total = buckets.reduce((sum, b) => sum + b.total, 0);
  const expiresAt = buckets.reduce((max, b) => Math.max(max, b.expiresAt || 0), 0);
  const top = activePlans[0];
  return {
    kind: "start_plan",
    label: top.name || "ZCode Start Plan",
    percent: total > 0 ? Math.round(Math.min(100, Math.max(0, (used / total) * 100)) * 10) / 10 : 0,
    used,
    total,
    remaining: Math.max(0, total - used),
    expiresAt: expiresAt || null,
    validEnd: normalizeTimestamp(top.ends_at),
    windows: total > 0
      ? [{ id: "plan", label: "套餐额度", percent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0, resetsAt: expiresAt || null }]
      : [],
  };
}

function codingPlanWindows(body) {
  if (!body || typeof body !== "object") return null;
  if (body.success === false) {
    const message = String(body.msg || "");
    if (/coding\s*plan|套餐|订阅|plan/i.test(message) && /不存在|未开通|not|no|missing|required/i.test(message)) {
      return { noPlan: true };
    }
    return { error: errorInfo("business_error", message || "编码套餐接口返回错误") };
  }
  const data = body.data;
  if (!data || typeof data !== "object" || !Array.isArray(data.limits)) {
    return { error: errorInfo("parse_error", "编码套餐响应缺少 data.limits") };
  }
  const windows = [];
  let tools = null;
  for (const limit of data.limits) {
    if (!limit || typeof limit !== "object") continue;
    const type = String(limit.type || "").toUpperCase();
    if (type === "TIME_LIMIT") {
      tools = {
        used: finiteNumber(limit.currentValue),
        total: finiteNumber(limit.usage),
        resetsAt: normalizeTimestamp(limit.nextResetTime),
      };
      continue;
    }
    if (type !== "TOKENS_LIMIT" && type !== "CREDIT_LIMIT") continue;
    let percent = finiteNumber(limit.percent ?? limit.usedPercent ?? limit.usagePercent);
    if (percent == null) {
      const current = finiteNumber(limit.currentValue);
      const total = finiteNumber(limit.usage);
      if (current != null && total != null && total > 0) percent = (current / total) * 100;
    }
    if (percent == null) continue;
    const unit = finiteNumber(limit.unit);
    const id = unit === 3 ? "fiveHour" : unit === 6 ? "weekly" : windows.length === 0 ? "fiveHour" : "weekly";
    windows.push({
      id,
      label: id === "fiveHour" ? "5 小时" : id === "weekly" ? "周额度" : "额度",
      percent: Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10,
      resetsAt: normalizeTimestamp(limit.nextResetTime),
    });
  }
  if (!windows.length) return { noPlan: true };
  return {
    kind: "coding_plan",
    label: typeof data.level === "string" && data.level ? `${data.level} 编码套餐` : "编码套餐",
    windows,
    tools,
  };
}

async function getZCodePlan(force) {
  const creds = loadCredentials();
  const selection = loadPlanSelection();
  const results = [];
  const warnings = [];

  // ZCode Start Plan
  const options = loadPluginOptions();
  const startToken =
    String(env.ZCODE_JWT_TOKEN || options.zcode_jwt_token || "").trim() || creds["zcodejwttoken"] || "";
  if (startToken) {
    try {
      const response = await cached("zcode-start-plan", force, async () => {
        const deviceMid = readDeviceMid();
        const headers = { authorization: `Bearer ${startToken}` };
        if (deviceMid) headers["x-device-mid"] = deviceMid;
        return fetchWithTimeout("https://zcode.z.ai/api/v1/zcode-plan/billing/balance", { headers });
      });
      if (!response.ok) {
        warnings.push(errorInfo("start_plan_http", `Start Plan 查询失败（HTTP ${response.status}）`));
      } else {
        const parsed = startPlanWindows(response.json);
        if (parsed?.error) warnings.push(parsed.error);
        else if (parsed && !parsed.noPlan) results.push(parsed);
      }
    } catch (error) {
      warnings.push(
        errorInfo(
          error.name === "AbortError" ? "timeout" : "network_error",
          error.name === "AbortError" ? "Start Plan 查询超时" : error.message || String(error),
        ),
      );
    }
  }

  // BigModel / Z.ai coding plan (individual subscription)
  let family = selection.family === "zai" ? "zai" : selection.family === "bigmodel" ? "bigmodel" : "";
  if (!family) {
    family = creds["oauth:zai:access_token"] ? "zai" : creds["oauth:bigmodel:access_token"] ? "bigmodel" : "";
  }
  const familyTokenKey = family === "zai" ? "oauth:zai:access_token" : "oauth:bigmodel:access_token";
  const familyToken = creds[familyTokenKey] || "";
  if (family && familyToken) {
    const origin = family === "zai" ? "https://api.z.ai" : "https://bigmodel.cn";
    const bearer = family === "zai";
    try {
      const response = await cached(`zcode-${family}-plan`, force, () =>
        fetchWithTimeout(`${origin}/api/monitor/usage/quota/limit`, {
          headers: { authorization: (bearer ? "Bearer " : "") + familyToken, "set-language": "zh" },
        }),
      );
      if (response.ok) {
        const parsed = codingPlanWindows(response.json);
        if (parsed?.error) warnings.push(parsed.error);
        else if (parsed && !parsed.noPlan) results.push(parsed);
      } else {
        warnings.push(errorInfo(`${family}_plan_http`, `${family} 编码套餐查询失败（HTTP ${response.status}）`));
      }
    } catch (error) {
      warnings.push(
        errorInfo(
          error.name === "AbortError" ? "timeout" : "network_error",
          error.name === "AbortError" ? "编码套餐查询超时" : error.message || String(error),
        ),
      );
    }
  }

  if (results.length) {
    const best = results.sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0];
    return { status: "ok", configured: true, plan: best, plans: results, warnings };
  }
  return {
    status: "no_plan",
    configured: true,
    plan: null,
    plans: [],
    warnings,
    hint: "未检测到 ZCode Start Plan 或编码套餐订阅；今日消耗仍可统计。",
  };
}

/* ------------------------------------------------------------------ */
/* Cache                                                                */
/* ------------------------------------------------------------------ */

const memoryCache = new Map();
const inflight = new Map();

async function cached(key, force, factory) {
  const now = Date.now();
  const hit = memoryCache.get(key);
  if (!force && hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  if (!force && inflight.has(key)) return inflight.get(key);
  const promise = Promise.resolve()
    .then(factory)
    .then((value) => {
      memoryCache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                          */
/* ------------------------------------------------------------------ */

function readSidebarStatus() {
  const status = readJson(SIDEBAR_STATUS_PATH);
  if (!status || typeof status !== "object") {
    return { state: "unknown", message: "左侧组件状态未知（插件尚未完成注入检查）" };
  }
  return status;
}

export async function getBalances(force = false) {
  const usage = await loadUsageRows();
  const [deepseek, volcanoAccount, volcanoCodingPlan, zcodePlan] = await Promise.all([
    getDeepSeek(usage, force),
    getVolcanoAccount(usage, force),
    getVolcanoCodingPlan(usage, force),
    getZCodePlan(force),
  ]);

  // The sidebar's ZCode row must match the analytics view, so it uses the
  // "zcode" provider bucket only; the all-provider total is reported
  // separately as todayAll.
  const zcodeToday = usage?.available ? usageForBucket(usage, "zcode", { estimateCost: true }) : null;
  const todayAll = usage?.available ? summarizeRows(usage.rows, { estimateCost: true }) : null;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    today: periodParts().date,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    usage: {
      available: !!usage?.available,
      path: usageDbPath(),
      ...(usage?.error ? { error: usage.error } : {}),
    },
    deepseek,
    volcano: {
      account: volcanoAccount,
      codingPlan: volcanoCodingPlan,
    },
    zcode: {
      plan: zcodePlan,
      today: zcodeToday,
    },
    todayAll,
    settings: settingsSnapshot(),
    sidebar: readSidebarStatus(),
  };
}
