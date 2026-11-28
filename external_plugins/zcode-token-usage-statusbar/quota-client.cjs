/* 额度客户端（主进程热换模块）v3：多厂商适配器 + 多源调度器。
 * 阶段 3（浮层 v96 线）：BigModel/Z.ai 内置套餐（解密宿主 OAuth 凭据直查 monitor 端点）
 * 之外，新增零配置官方域适配器（MiniMax/Kimi/CommandCode/DeepSeek/OpenRouter/SiliconFlow/
 * Anthropic OAuth/OpenCode Go/R4 Coder/千问/Ollama Cloud/StepFun）与显式配置适配器（Cline/MiMo
 * Cookie/火山 AK-SK/SCNet 账本）；清单仅为沿革，现行注册表以 ADAPTERS 为准。
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
/* v135 重置卡（coding plan reset opportunity）：独立只读链，不复用 sources 调度器。
 * 与额度 monitor 是两条链——卡是账号级「立即恢复额度池」的核销机会，每张带 expire_at。 */
const RESET_PATH = "/api/v1/coding-plan/reset/status";
const RESET_TTL_MS = 2 * 60 * 1000;       // 稳态轮询（v361 提速：5min→2min，status 是只读查询）
const RESET_LIST_TTL_MS = RESET_TTL_MS;   // 网页列表增强子链与 status 同节奏（specs/reset-card-refresh.md）：徽标张数读 status、tooltip 明细读 list，同轮刷新才对得上；结算同一时刻写 nextAt 与 listFetchedAt 保证 status 到期即 list 到期
const RESET_POKE_GAP_MS = 30 * 1000;      // pokeReset 软强刷最小间隔（visibility/hover 触发防抖）
const RESET_PARSE_BACKOFF_MS = 15 * 60 * 1000;

/* ---------- 基础工具 ---------- */
function sha16(v) { return crypto.createHash("sha256").update(String(v)).digest("hex").slice(0, 16); }
function qErr(code, message, extra) {
  return Object.assign(new Error(message), Object.assign({ code }, extra || {}));
}
function clampPct(x) { return Number.isNaN(x) ? 0 : Math.max(0, Math.min(100, x)); }   // NaN→0 防御；±Infinity 按钳制方向处理（超限→100，fail-closed）
/* 团队套餐 id 判定：词边界匹配，含 "team" 子串的普通 id（如假想的 steam-promo）不误判 */
function isTeamProviderId(p) { return /(^|[-:])team([-:]|$)/.test(String(p || "")); }
/* 团队套餐 provider 的规范形 → 所属家族；其余（含近似串）null。 */
function teamFamilyOf(p) {
  const s = String(p || "");
  if (s === "account:bigmodel-team-coding-plan") return "bigmodel";
  if (s === "account:zai-team-coding-plan") return "zai";
  return null;
}
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

/* ---------- 宿主凭据解密（enc:v1 / enc:v2 双信封，按宿主语义重写） ---------- */
function deriveSecret(env) {
  const conf = env.ZCODE_CREDENTIAL_SECRET;
  if (conf) return conf;
  let username = "unknown";
  try { username = os.userInfo().username; } catch (e) { /* 拿不到用户名按占位 */ }
  return `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${username}`;
}
function deriveCipherKey(env) { return crypto.createHash("sha256").update(deriveSecret(env)).digest(); }
function decryptV1Value(value, key) {
  if (typeof value !== "string") return value;
  /* 未知 enc: 版本按宿主 legacy 语义拒绝（null）：绝不把密文当明文 token 外发 */
  if (value.startsWith("enc:") && !value.startsWith(ENC_PREFIX)) return null;
  if (!value.startsWith(ENC_PREFIX)) return value;
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

/* ---------- v2 信封（宿主 3.18.0）：enc:v2:{os|env}:{keyId24}:{iv.tag.ct} ----------
 * 密钥是 32 字节随机值，OS 源存宿主 OS 凭据库（service "ZCode Credential Encryption"，
 * account=sha256(resolve(credentials.json)).hex），env 源=sha256(受管 secret)。信封内
 * keyId24=sha256(key).hex 前 24 位，解密前先比对指纹：密钥不在/换钥一律 null，绝不跨钥强解。
 * keychain 读取异步而解密调用点全同步：ensureKey() 异步预热缓存，decrypt 同步读缓存；
 * 未热/失配时置 pending 供调度器用 1 秒短重试（区别于真解密失败的 60 秒）。 */
const ENC_V2_PFX = "enc:v2:";
const V2_SERVICE = "ZCode Credential Encryption";
const V2_KEY_RE = /^[A-Za-z0-9_-]{43}$/;   // 32 字节 base64url（无填充）

function keyIdOf(key) { return crypto.createHash("sha256").update(key).digest("hex").slice(0, 24); }

function openV2Seal(seal, key) {
  const parts = seal.split(".");
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

/* 负缓存按 resourcesDir 分桶：一次空 dir/失败探测不再拖累其它目录（热换重建前的自愈路径） */
const hostKeyringByDir = new Map();
function loadHostKeyring(resourcesDir) {
  const dir = String(resourcesDir || "");
  if (!dir) return null;
  if (hostKeyringByDir.has(dir)) return hostKeyringByDir.get(dir);
  let mod = null;
  const tries = [];
  /* asar 内 wrapper（Electron fs 透传把 .node 指到 unpacked）；直接 require 失败不影响后续 */
  tries.push(() => require(path.join(dir, "app.asar", "node_modules", "@napi-rs", "keyring")));
  try {   // unpacked 原生 .node 兜底：扫描 @napi-rs/keyring-<triple> 目录
    const scope = path.join(dir, "app.asar.unpacked", "node_modules", "@napi-rs");
    for (const name of fs.readdirSync(scope)) {
      if (!/^keyring-/.test(name)) continue;
      const pdir = path.join(scope, name);
      for (const f of fs.readdirSync(pdir)) {
        if (f.endsWith(".node")) tries.push(((p, f2) => () => require(path.join(p, f2)))(pdir, f));
      }
    }
  } catch (e) { /* 无 unpacked 目录/受限读取 */ }
  for (const t of tries) {
    try {
      const m = t();
      if (m && (m.AsyncEntry || m.Entry)) { mod = m; break; }
    } catch (e) { /* 下一候选 */ }
  }
  hostKeyringByDir.set(dir, mod);
  return mod;
}

/* 受管 secret（v2:env 源）：镜像宿主 resolveManagedSecret——ZCODE_CREDENTIAL_SECRET env
 * → ZCODE_CREDENTIAL_SECRET_FILE env 指向的文件（不校验权限位，内容 32–4096 字节在 ensureV2Key 判）
 * → 凭据同目录 credential-secret（宿主在无 os 标记时以它派生 env 源：headless 部署靠它；常规文件、
 *   非 win32 须仅属主可读写、32–4096 字节）。前两者同设按配置错误处理（宿主同款 throw）。 */
function readManagedSecret(ctx) {
  const env = ctx.env || {};
  if (env.ZCODE_CREDENTIAL_SECRET && env.ZCODE_CREDENTIAL_SECRET_FILE) { ctx.lastError = "managed secret misconfigured"; return null; }
  if (env.ZCODE_CREDENTIAL_SECRET) return env.ZCODE_CREDENTIAL_SECRET;
  if (env.ZCODE_CREDENTIAL_SECRET_FILE) {
    try { return (ctx.readFileRaw || ((p) => fs.readFileSync(p, "utf8")))(env.ZCODE_CREDENTIAL_SECRET_FILE); }
    catch (e) { ctx.lastError = "managed secret file unreadable"; return null; }
  }
  if (ctx.credsDir) {
    try {
      const p = path.join(ctx.credsDir, "credential-secret");
      const st = fs.statSync(p);
      if (st.isFile() && st.size >= 32 && st.size <= 4096 &&
          (process.platform === "win32" || (st.mode & 63) === 0)) {
        return (ctx.readFileRaw || ((q) => fs.readFileSync(q, "utf8")))(p);
      }
    } catch (e) { /* 无固定路径文件或不可读：按未配置 */ }
  }
  return null;
}

async function ensureV2Key(ctx, force) {
  const cur = ctx.cache.get(ctx.credsPath) || null;
  if (cur && !force) return cur;   // 已热：不重读 keychain/secret（换钥由 decrypt 侧 keyId 失配限频 force 重读）
  if (ctx.keyFailedAt && Date.now() - ctx.keyFailedAt < 60000) return cur;   // 失败冷却：keychain 缺失时不做 1 秒风暴重试
  ctx.lastError = "";   // 只反映最近一次尝试，不跨调用短路
  const env = ctx.env || process.env;
  let secret = readManagedSecret(ctx), source = "";
  if (ctx.lastError) { ctx.keyFailedAt = ctx.retryNow ? 0 : Date.now(); ctx.retryNow = false; return cur; }   // 受管 secret 配置错误：与 keychain 失败同冷却
  let key;
  if (secret !== null) {
    /* 宿主 X1n：env 源密钥 = sha256(受管 secret) 原始 32 字节，对 secret 无 base64url 形状要求；
     * 文件路径的宿主校验是内容 32–4096 字节。 */
    const blen = Buffer.byteLength(secret, "utf8");
    if (env.ZCODE_CREDENTIAL_SECRET_FILE && (blen < 32 || blen > 4096)) { ctx.lastError = "managed secret file length invalid"; ctx.keyFailedAt = Date.now(); return cur; }
    key = crypto.createHash("sha256").update(secret).digest();
    source = "env";
  } else {
    const mod = ctx.keyringMod !== undefined ? ctx.keyringMod : loadHostKeyring(ctx.resourcesDir);
    if (!mod || !(mod.AsyncEntry || mod.Entry)) { ctx.lastError = "host keyring unavailable"; ctx.keyFailedAt = ctx.retryNow ? 0 : Date.now(); ctx.retryNow = false; return cur; }
    try {
      const E = mod.AsyncEntry || mod.Entry;
      const account = crypto.createHash("sha256").update(String(ctx.credsPath)).digest("hex");
      secret = await new E(V2_SERVICE, account, { linux: { store: "secret-service" } }).getPassword();
    } catch (e) { ctx.lastError = "keychain read failed"; ctx.keyFailedAt = ctx.retryNow ? 0 : Date.now(); ctx.retryNow = false; return cur; }
    source = "os";
    if (typeof secret !== "string" || !V2_KEY_RE.test(secret)) { ctx.lastError = "key shape invalid"; ctx.keyFailedAt = ctx.retryNow ? 0 : Date.now(); ctx.retryNow = false; return cur; }
    key = Buffer.from(secret, "base64url");
    if (key.length !== 32) { ctx.lastError = "key length invalid"; ctx.keyFailedAt = ctx.retryNow ? 0 : Date.now(); ctx.retryNow = false; return cur; }
  }
  const ent = { key, keyId: keyIdOf(key), source };
  ctx.cache.set(ctx.credsPath, ent);   // 重读成功才覆盖：失败路径不清旧钥（旧条目继续可解）
  ctx.lastError = "";
  ctx.keyFailedAt = 0;
  ctx.retryNow = false;   // 成功路径同样消费越窗意图：不留着把下一次无关失败放行出冷却
  return ent;
}

function makeHostDecryptor(opts) {
  const o = opts || {};
  const ctx = {
    credsPath: o.credsPath || "",
    credsDir: o.credsDir || "",
    resourcesDir: o.resourcesDir !== undefined ? o.resourcesDir : ((typeof process !== "undefined" && process.resourcesPath) || ""),
    env: o.env || process.env,
    readFileRaw: o.readFileRaw,
    keyringMod: o.keyringMod,   // undefined=自动探测；null/对象=显式指定（测试注入）
    cache: new Map(), lastError: "", pending: 0, ensuring: null, keyFailedAt: 0, mismatchAt: 0, retryNow: false,
  };
  function ensureKey(force) {
    if (ctx.ensuring) return ctx.ensuring;
    ctx.ensuring = ensureV2Key(ctx, force).finally(() => { ctx.ensuring = null; ctx.pending = 0; });
    return ctx.ensuring;
  }
  function decrypt(enc, legacyKey) {
    if (typeof enc !== "string") return enc;
    if (!enc.startsWith(ENC_V2_PFX)) return decryptV1Value(enc, legacyKey);
    const parts = enc.slice(ENC_V2_PFX.length).split(":");
    if (parts.length !== 3 || !/^(os|env)$/.test(parts[0]) || !/^[a-f0-9]{24}$/.test(parts[1])) return null;
    const ent = ctx.cache.get(ctx.credsPath);
    if (!ent || parts[0] !== ent.source || parts[1] !== ent.keyId) {
      /* 缓存钥与信封不符（宿主换钥/残留旧条目）：不清缓存（重读失败会把仍可解的条目一起打死，
       * 整桶最长 60 秒不可用），限频 force 重读自愈 */
      const now = Date.now();
      /* force 重读与失败冷却共用一条 60 秒节拍：失配限频与失败冷却**都**过期才发 force（盖新
       * 戳），pending 置位让调度器 1 秒短重试接住——「先失败后换钥」的序列在冷却过期的下一拍
       * 即自愈（约 61 秒），而冷却期内不发（防 1 秒风暴，上游防风暴语义保留）。 */
      const mismatchDue = !ctx.mismatchAt || now - ctx.mismatchAt >= 60000;
      const cooldownDue = !ctx.keyFailedAt || now - ctx.keyFailedAt >= 60000;
      if (mismatchDue && cooldownDue) {
        ctx.mismatchAt = now;
        ctx.keyFailedAt = 0;
        try { void ensureKey(true); } catch (e) { /* 同步段不抛 */ }
        ctx.pending = 1;
      }
      return null;
    }
    return openV2Seal(parts[2], ent.key);
  }
  return { ctx, ensureKey, decrypt, keyPending: () => !!ctx.pending };
}

/* 导出的 decryptValue 分发器：v2 信封走缺省宿主解密器（调用方无需感知上下文与缓存），
 * v1/明文维持原 (value, key) 语义。客户端装配时 setDefaultDecryptCtx 绑定真实路径。 */
let defaultDec = makeHostDecryptor({ env: process.env });
function setDefaultDecryptCtx(opts) { defaultDec = makeHostDecryptor(opts || {}); }
function ensureDefaultV2Key() { return defaultDec.ensureKey(); }
function v2KeyPending() { return defaultDec.keyPending(); }
/* 用户显式动作（chip 立即刷新/凭据变更/拉取模型点击）越过 v2 密钥的失败冷却与失配限频，
 * 对齐「点击立即刷新绕过一切间隔与冻结」；在途读取稍后失败时不开新冷却窗。 */
function v2KeyRetryNow() {
  const ctx = defaultDec.ctx;
  if (ctx.ensuring) { ctx.retryNow = true; return; }
  ctx.keyFailedAt = 0;
  ctx.mismatchAt = 0;
}
function decryptValue(value, key) {
  if (typeof value === "string" && value.startsWith(ENC_V2_PFX)) return defaultDec.decrypt(value, key);
  return decryptV1Value(value, key);
}

/* ---------- 宿主 3.18+ 新式登录态键回退（issue #391） ----------
 * 旧平铺键 oauth:{fam}:access_token 在新式登录态下可能整键缺席：业务 token 改存
 * oauth:linked_bigmodel（信封→JSON {userId,customerId,accessToken}，实测直查 monitor 200；
 * JWT 无 exp 走「无 exp 跳过临期守卫」语义）或 oauth:zai_cn:access_token（信封→token 本体，
 * 与旧键同构、键名带地区后缀；issue 的 401 对照是 bigmodel 端点，不代表 api.z.ai 不认）。
 * 旧键优先，缺失或空串才回退；指纹跟随实际命中的信封（宿主换发自动重拉）；
 * 回退信封解不出可用 token（非 JSON/字段缺失）按 decryptFailed 降级，零请求。
 * zcodejwttoken / oauth:active_provider 不是额度端点认的业务 token（实测 401），不作回退。
 * decrypt 可注入（issue #393）：model-puller 传自己的注入闭包（生产形态=同款分发器，
 * 测试 stub 由此进入）；缺省用本模块分发器，键序/字段提取逻辑单一。 */
const HOST_ALT_CRED_KEYS = {
  bigmodel: [{ key: "oauth:linked_bigmodel", field: "accessToken" }],
  zai: [{ key: "oauth:zai_cn:access_token" }],
};
function hostCredDecrypt(raw, fam, credKey, env, decrypt) {
  if (!raw || typeof raw !== "object") return null;
  let enc = raw[credKey], field = null;
  if (typeof enc !== "string" || !enc) {
    enc = null;
    for (const alt of HOST_ALT_CRED_KEYS[fam] || []) {
      const e = raw[alt.key];
      if (typeof e === "string" && e) { enc = e; field = alt.field || null; break; }
    }
  }
  if (!enc) return null;   // 旧键与新式键均缺席：未配置
  const dec = typeof decrypt === "function" ? decrypt : decryptValue;
  let token = dec(enc, deriveCipherKey(env));
  if (token && field) {
    try {
      const obj = JSON.parse(token);
      token = typeof obj[field] === "string" && obj[field] ? obj[field] : null;
    } catch (e) { token = null; }
  }
  return { token: token || null, enc };   // token null = decryptFailed 语义（信封在但取不出可用 token）
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
/* Start Plan（ZCode 免费档，如 1024 Dev Day）归一化：zcode.z.ai billing/balance 的
 * plans[]（权益/订阅）+ balances[]（按模型分桶的 one_time 发放池）。过期判定与宿主
 * 3.16.3 实测行为同款（符号随版本轮换）：status=active 但 ends_at 已过（按 server_time
 * 时钟）就地改判过期；过期 plan 关联的桶一并过滤。只聚合 meter=model_usage 桶（当前
 * 接口只发放模型用量）；percent 自算（原始 units，比服务端整数百分比更准）。resetsAt
 * 语义是「到期」不是周期重置。 */
function zcodeStartTs(v) {
  const n = typeof v === "number" && isFinite(v) && v > 0 ? (v < 1e12 ? v * 1000 : v) : 0;
  return n || null;
}
function zcodeStartStamp(ms) {   // 展示契约 yyyy-MM-dd HH:mm（本地时区，同 overlay qTime）
  const d = new Date(ms);
  const pad = (n) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function normalizeZcodeStartBalance(body, nowMs) {
  if (!body || typeof body !== "object") throw qErr("parse_error", "non-object body");
  /* 错误信封判定（实测形状）：balance 端点失败时只带 code/msg（如 3001 parameter
   * error），没有 success:false 字段。code 非 0/200 或 success===false 一律按业务错误
   * 退避（network_error），未知业务码不作 no_plan 猜测——无套餐的结构信号是 code 0
   * 且 plans 无 active 项。 */
  if (body.success === false || (body.code !== undefined && body.code !== 0 && body.code !== 200)) {
    throw qErr("network_error", "business error: " + String(body.msg || "").slice(0, 80));
  }
  const data = body.data;
  if (!data || typeof data !== "object") throw qErr("parse_error", "missing data");
  const serverMs = zcodeStartTs(data.server_time);   // 秒/毫秒自适应（与 resetOf/zcodeStartTs 同款，防端点单位变化后全量误判过期）
  const t = serverMs || (typeof nowMs === "number" && isFinite(nowMs) ? nowMs : Date.now());
  const plans = Array.isArray(data.plans) ? data.plans : [];
  const activePlans = [];
  for (const p of plans) {
    if (!p || typeof p !== "object") continue;
    const endMs = zcodeStartTs(p.ends_at);
    if (String(p.status || "").toLowerCase() === "active" && endMs && endMs > t) activePlans.push(p);
  }
  if (!activePlans.length) return { noPlan: true };
  activePlans.sort((a, b) => (typeof b.priority === "number" ? b.priority : -1) - (typeof a.priority === "number" ? a.priority : -1));
  const top = activePlans[0];
  const planIds = new Set(activePlans.map((p) => String(p.plan_id || "")));
  const buckets = [];
  for (const b of (Array.isArray(data.balances) ? data.balances : [])) {
    if (!b || typeof b !== "object") continue;
    if (String(b.meter || "") !== "model_usage") continue;
    if (b.plan_id != null && !planIds.has(String(b.plan_id))) continue;
    const total = typeof b.total_units === "number" && isFinite(b.total_units) && b.total_units > 0 ? b.total_units : null;
    if (!total) continue;
    const expiresAt = zcodeStartTs(b.expires_at);
    if (expiresAt && expiresAt <= t) continue;   // 已到期死桶不计入聚合
    const used = typeof b.used_units === "number" && isFinite(b.used_units) && b.used_units >= 0 ? b.used_units : 0;
    buckets.push({
      name: typeof b.show_name === "string" && b.show_name ? b.show_name : "",
      used,
      total,
      expiresAt: expiresAt || 0,
    });
  }
  buckets.sort((a, b) => b.total - a.total);
  const sumOf = (k) => buckets.reduce((acc, x) => acc + x[k], 0);
  let expiresMax = 0;
  for (const x of buckets) if (x.expiresAt > expiresMax) expiresMax = x.expiresAt;
  const models = [];
  const seen = {};
  for (const x of buckets) if (x.name && !seen[x.name]) { seen[x.name] = 1; models.push(x.name); }
  const windows = { daily: null, fiveHour: null, weekly: null, monthly: null, plan: null };
  if (buckets.length) {
    const totalAll = sumOf("total");
    /* 只出百分比与到期：tooltip 窗口行的金额明细是货币格式（quotaBalanceText），
     * token 绝对量进去会变成 500000000.00；宿主 tooltip 同样只展示百分比。 */
    windows.plan = {
      percent: Math.round(clampPct((sumOf("used") / totalAll) * 100) * 10) / 10,   // 服务端超耗时钳 100，与其余归一化路径同款
      resetsAt: expiresMax || null,
      expires: true,   // one_time 发放池：到期语义，渲染端按此切「到期」文案
    };
  }
  return {
    level: "Start",
    plan: {
      productName: top.name && typeof top.name === "string" ? top.name : "ZCode Start Plan",
      validStart: zcodeStartTs(top.starts_at) ? zcodeStartStamp(zcodeStartTs(top.starts_at)) : null,
      validEnd: zcodeStartTs(top.ends_at) ? zcodeStartStamp(zcodeStartTs(top.ends_at)) : null,
    },
    windows,
    models,
  };
}
/* ---------- 重置卡（reset opportunity）归一化 ----------
 * 宿主 packages/services bigmodelUsageQuotaProvider 的 reset status schema 转写：
 * 信封 { code: 0, data: { available_five_hour_resets: [{expire_at}], available_week_resets: [...],
 * latest_*_reset_history, has_unread_history } }。只采信两个机会数组（白名单字段
 * expire_at）；秒/毫秒自适应，保留最近七天过期及未来的记录，统计仅含严格未过期卡。
 * 数组及其中每条正有限数字时间戳均须合法；都为空数组是合法零卡。绝不调用领取端点。 */
function resetExpireMs(v) {
  if (typeof v !== "number" || !isFinite(v) || v <= 0) return null;
  return v < 1e12 ? v * 1000 : v;
}
function normalizeResetStatus(body, nowMs) {
  if (!body || typeof body !== "object") throw qErr("parse_error", "non-object body");
  if (typeof body.code !== "number" || !isFinite(body.code)) throw qErr("parse_error", "invalid reset code");
  if (body.code !== 0 || body.success === false) throw qErr("network_error", "business error: " + String(body.msg || "").slice(0, 80));
  const data = body.data;
  if (!data || typeof data !== "object" || !Array.isArray(data.available_five_hour_resets) || !Array.isArray(data.available_week_resets))
    throw qErr("parse_error", "missing reset arrays");
  const t = typeof nowMs === "number" && isFinite(nowMs) ? nowMs : Date.now();
  const pick = (arr) => {
    const out = [];
    for (const it of arr) {
      const ms = it && typeof it === "object" ? resetExpireMs(it.expire_at) : null;
      if (ms == null) throw qErr("parse_error", "invalid reset expire_at");
      if (ms >= t - 7 * 24 * 60 * 60 * 1000) out.push({ expireAt: ms });
    }
    out.sort((a, b) => a.expireAt - b.expireAt);
    return out;
  };
  const fiveHour = pick(data.available_five_hour_resets);
  const week = pick(data.available_week_resets);
  const valid = fiveHour.concat(week).filter((card) => card.expireAt > t);
  return {
    fiveHour, week,
    count: valid.length,
    expireAt: valid.length ? Math.min(...valid.map((card) => card.expireAt)) : 0,
  };
}
/* 网页控制台的同族列表端点（bigmodel.cn /api/biz/customer-package-reset/list，实测宿主
 * OAuth 裸 authorization 可查，与 subscription 同款头；ZCode 桌面客户端未引用此端点）。
 * 只用于补充「未使用或近 7 天已过期」的逐卡列表与上次重置时间（status 端点没有过期历史）。
 * 信封 code 0/200；形状不符返回 null（可选数据静默降级，绝不拖累 status 主链），不抛错。 */
function normalizeResetList(body, nowMs) {
  if (!body || typeof body !== "object") return null;
  if ((body.code !== 0 && body.code !== 200) || body.success === false) return null;
  const data = body.data;
  if (!data || typeof data !== "object" || !Array.isArray(data.fiveHourResets) || !Array.isArray(data.weekResets)) return null;
  const t = typeof nowMs === "number" && isFinite(nowMs) ? nowMs : Date.now();
  /* 逐卡白名单：expireTime（服务端 UTC+8）+ grantType + available；过期超 7 天丢弃。
   * grantType 是行首展示值（用户规格 2026-10-28），列表端点有而 status 没有。 */
  const pickCards = (arr) => {
    const out = [];
    for (const it of arr) {
      if (!it || typeof it !== "object") continue;
      const stamp = subscriptionTimestamp(it.expireTime);
      const ms = stamp && stamp.at != null ? stamp.at : null;
      if (ms == null) continue;
      const available = it.available === true;
      if (!available && t - ms > 7 * 24 * 60 * 60 * 1000) continue;
      out.push({ expireAt: ms, grantType: typeof it.grantType === "string" ? it.grantType.slice(0, 24) : "",
        available });
    }
    out.sort((a, b) => a.expireAt - b.expireAt);
    return out;
  };
  const cleanStamp = (v) => (typeof v === "string" && subscriptionTimestamp(v) ? v : null);
  return {
    list: { fiveHour: pickCards(data.fiveHourResets), week: pickCards(data.weekResets) },
    lastFiveHour: cleanStamp(data.lastFiveHourResetTime),
    lastWeek: cleanStamp(data.lastWeekResetTime),
  };
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
    // usage_percentage（ZenMux 0-1 已用小数）：仅在前面字段都缺失时兜底，>1 视作已是百分数
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
  /* ino/dev 进 stamp：Windows 文件隧道化下 15 秒内同名重建复用原 birthtime、同 mtime/size
   * 重建时旧 stamp 可逐位相同，文件实例 ID 重建必变（同 model-puller.readTemplateRules 纪律）。 */
  try { stamp = JSON.stringify(paths.map((p) => { const s = fs.statSync(p); return [p, s.mtimeMs, s.size, s.ino, s.dev]; })); }
  catch (e) { providerCfgCache = null; /* stat 失败仍现读，并撤销旧缓存，避免同时间戳重建后复活旧 key */ }
  if (stamp !== null && providerCfgCache && providerCfgCache.stamp === stamp && providerCfgCache.readFile === readFile2) {
    return providerCfgCache.byId;
  }
  const templates = new Map();
  const rules = new Map();
  for (const p of paths) {
    try {
      const d = readFile2(p);
      const pcr = (d.config || {}).providerConfigRules || {};
      /* Array.isArray 守卫：真值非数组的 templateRules 不能连累同文件 providerRules（基线行为） */
      for (const t of Array.isArray(pcr.templateRules) ? pcr.templateRules : []) {
        if (!t || !t.templateId) continue;
        const old = templates.get(String(t.templateId)) || {}, cfg = t.config || {};
        templates.set(String(t.templateId), {
          access: Object.assign({}, old.access, cfg.access),
          api: Object.assign({}, old.api, cfg.api),
        });
      }
      for (const r of pcr.providerRules || []) {
        if (!r || !r.providerId) continue;
        const old = rules.get(String(r.providerId)) || {}, cfg = r.config || {};
        rules.set(String(r.providerId), {
          name: r.providerName == null ? old.name : String(r.providerName),
          templateId: r.templateId == null ? old.templateId : String(r.templateId),
          access: Object.assign({}, old.access, cfg.access),
          api: Object.assign({}, old.api, cfg.api),
        });
      }
    } catch (e) { /* 损坏/缺失按无配置处理 */ }
  }
  const byId = new Map();
  for (const [id, cfg] of rules) {
    /* 模板创建的供应商（个人配置不含 baseUrl）从内置 templateRules 回填
     * baseUrl/access；显式配置仍优先，显式空串 baseUrl 按未填处理回落模板。 */
    const tpl = cfg.templateId ? templates.get(cfg.templateId) : null;
    const api = Object.assign({}, tpl && tpl.api, cfg.api);
    const access = Object.assign({}, tpl && tpl.access, cfg.access);
    if (!api.baseUrl && tpl && tpl.api) api.baseUrl = tpl.api.baseUrl;
    /* enc: 形态是宿主加密信封（或误贴的密文），不是可用凭据：按未配置处理、绝不随请求外发
     * （与 model-puller 规则路径同闸）。宿主 schema 是 z.string() 不 trim，先 trim 再判。 */
    const rawKey = String(access.apiKey || "").trim();
    byId.set(id, { baseUrl: String(api.baseUrl || "").replace(/\/+$/, ""), apiKey: rawKey.indexOf("enc:") === 0 ? "" : rawKey, name: cfg.name || "",
      accessType: String(access.type || "") });
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
      if (isTeamProviderId(providerId)) return { team: true };
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
      const hit = hostCredDecrypt(raw, fam, conf.credKey, j.env);   // 旧平铺键缺席回退新式登录态键（issue #391）
      if (!hit) return null;
      if (!hit.token) return { decryptFailed: true, fingerprint: "host:" + sha16(hit.enc) };
      return { token: hit.token, fingerprint: "host:" + sha16(hit.enc), source: "host" };
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

/* --- 团队套餐（GLM Coding Plan team，配方转写自 magpie zcode_team.go，MIT） ---
 * 成员账号与个人套餐同端点服务，但鉴权用业务登录 token（oauth:{fam}:access_token）、
 * 必须带团队头 Bigmodel-Organization/Bigmodel-Project，配额走 ?type=2
 * （CREDIT_LIMIT unit3=5 小时、unit6=周，TIME_LIMIT=MCP 月度工具调用、不阻断模型）。
 * 选择读 setting.json（恒在 HOME/.zcode/v2，不随 dataBaseDir 迁移）：
 * providerFamilyConnectionSelections[fam]={kind:"team-coding-plan",organizationId,projectId}；
 * legacy modelProviderFamilySelectedKeys[fam]="team-plan:builtin:{fam}-coding-plan:{org}:{project}"
 * （org/project 各段 URL 编码）。无选择=未切团队：fail-closed 不发请求。BigModel 家族里
 * 业务 token 与 zcodejwttoken 解密相同视为陈旧令牌，跳过（ZCode 也不会用它，magpie 同款）。 */
function teamSelectionOf(j, fam) {
  try {
    const set = j.readFile(j.settingPath || path.join(os.homedir(), ".zcode", "v2", "setting.json"));
    if (!set || typeof set !== "object") return null;
    let org = "", project = "";
    const sel = (set.providerFamilyConnectionSelections || {})[fam];
    if (sel && sel.kind === "team-coding-plan") {
      org = String(sel.organizationId || "").trim();
      project = String(sel.projectId || "").trim();
    } else {
      const legacy = String((set.modelProviderFamilySelectedKeys || {})[fam] || "").trim();
      const prefix = "team-plan:builtin:" + fam + "-coding-plan:";
      if (legacy.indexOf(prefix) === 0) {
        const parts = legacy.slice(prefix.length).split(":");
        if (parts.length === 3) {
          try { org = decodeURIComponent(parts[1]); project = decodeURIComponent(parts[2]); } catch (e) { return null; }
        }
      }
    }
    if (!org || !project) return null;
    return { org, project };
  } catch (e) { return null; }
}
/* 团队 PAT（项目访问令牌）交换链——宿主 ProjectAccessTokenClient 同款只读子集：
 * ① getCustomerInfo（裸业务 token）校验 org/project 存在；
 * ② api_keys 列表（裸业务 token + 团队头）找 name=zcode-team-api-key 且 keyType=2 的条目
 *    （缺条目不创建——宿主在 App 内切换团队套餐时自建，本插件只读）；
 * ③ POST api_keys/{id}/access_tokens（Bearer 业务 token，body clientType/clientVersion）
 *    → 项目级短期 PAT，用作 monitor?type=2 的 authorization（裸头，不套 Bearer）。
 *    {id} 就是条目的 apiKey 字段（线上条目没有 apiKeyId；宿主 ProjectAccessTokenClient 同款，
 *    issue #481）。
 * PAT 按 fam|org|project 缓存到过期前 2 分钟；密钥 ID 稳定一并缓存。链上任一环节失败
 * 按既有分类抛出（auth_failed/unsupported/network_error…），fail-closed 零请求降级。 */
const TEAM_PAT_REFRESH_LEAD = 120 * 1000;
const TEAM_PAT_CLIENT = { clientType: "zcode", clientVersion: "3.18.0" };
const teamPatCache = new Map();   // fam|org|project → { pat, expiresAt(ms), apiKey }
function teamPatCacheGet(key, now) {
  const c = teamPatCache.get(key);
  if (c && c.expiresAt - TEAM_PAT_REFRESH_LEAD > now) return c;
  return null;
}
async function ensureTeamPat(j, fam, sel, loginToken, ctl) {
  const bizOrigin = fam === "bigmodel" ? "https://bigmodel.cn" : "https://api.z.ai";
  const cacheKey = fam + "|" + sel.org + "|" + sel.project;
  const now = typeof j.now === "function" ? j.now() : Date.now();
  const hit = teamPatCacheGet(cacheKey, now);
  if (hit) return hit.pat;
  const teamHeaders = {
    "Bigmodel-Organization": sel.org,
    "Bigmodel-Project": sel.project,
    "set-language": "zh",
  };
  /* ① org/project 存在性（裸业务 token，不套 Bearer——宿主 getCustomerInfo 同款） */
  const info = await j.http.getJson(bizOrigin + "/api/biz/customer/getCustomerInfo",
    { authorization: loginToken }, ctl);
  const orgs = info && info.data && Array.isArray(info.data.organizations) ? info.data.organizations : [];
  const orgHit = orgs.some((o) => o && o.organizationId === sel.org &&
    Array.isArray(o.projects) && o.projects.some((pj) => pj && pj.projectId === sel.project));
  if (!orgHit) throw qErr("unsupported", "team project unavailable");
  /* ② api_keys 列表找 keyType=2 团队条目（只读，不创建——创建属宿主 App 内切换行为） */
  const keysUrl = bizOrigin + "/api/biz/v1/organization/" + encodeURIComponent(sel.org) +
    "/projects/" + encodeURIComponent(sel.project) + "/api_keys";
  const keys = await j.http.getJson(keysUrl, { authorization: loginToken, ...teamHeaders }, ctl);
  const keyList = keys && keys.data && Array.isArray(keys.data) ? keys.data : [];
  const teamKey = keyList.find((k) => k && k.name === "zcode-team-api-key" &&
    k.keyType === 2 && typeof k.apiKey === "string" && k.apiKey.trim());
  if (!teamKey) throw qErr("unsupported", "team api key missing");
  /* 密钥 ID 就是条目的 apiKey（issue #481）；`.` 与 `..` 是路径段保留写法——URL 规范化会吃掉上一级
   * 路径段（同源内，仍不该发），按没有团队密钥处理 */
  const teamKeyId = teamKey.apiKey.trim();
  if (teamKeyId === "." || teamKeyId === "..") throw qErr("unsupported", "team api key missing");
  /* ③ PAT 签发（Bearer 业务 token；429/5xx 一次重试，与宿主 MAX_TOKEN_ISSUE_ATTEMPTS 对齐） */
  let raw = null, lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      raw = await j.http.post(keysUrl + "/" + encodeURIComponent(teamKeyId) + "/access_tokens", {
        authorization: "Bearer " + loginToken,
        "content-type": "application/json",
      }, ctl);
      break;
    } catch (e) {
      lastErr = e;
      const retryable = e && (e.code === "network_error" || e.code === "rate_limited");
      if (attempt >= 2 || !retryable) throw e;
      await new Promise((r2) => setTimeout(r2, 500));
    }
  }
  if (lastErr) throw lastErr;
  const patData = raw && raw.data && typeof raw.data === "object" ? raw.data : null;
  const pat = patData && patData.enable !== false && typeof patData.accessToken === "string" &&
    patData.accessToken.trim() ? patData.accessToken.trim() : null;
  if (!pat) throw qErr("unsupported", "team pat missing");
  /* issue #481（线上样本来自报告者抓包）：expiresAt 是秒级时间戳（与 expiresIn 同单位）——< 1e12
   * 视为秒换成毫秒，再与毫秒时钟比较（此前秒级值直接比较，缓存永不命中、每轮都重签 PAT）。
   * 离谱值按缺失处理，否则 PAT 会被永久缓存：非有限值，换算后距今超过 7 天的 expiresAt，以及
   * 折算超过 7 天的 expiresIn；已过期的 expiresAt 原样保留。 */
  const maxTtlMs = 7 * 24 * 3600 * 1000;
  /* 时钟在三步往返之后重取（函数开头的 now 只服务缓存命中判断）：有效期恰好 7 天的 PAT 不因往返
   * 耗时被判成离谱值；增强链同样是在响应之后才取时钟 */
  const settledAt = typeof j.now === "function" ? j.now() : Date.now();
  const at = typeof patData.expiresAt === "number" ? patData.expiresAt : 0;
  const atMs = at > 0 ? (at < 1e12 ? at * 1000 : at) : 0;
  const ttlSec = typeof patData.expiresIn === "number" && patData.expiresIn > 0 && patData.expiresIn * 1000 <= maxTtlMs ? patData.expiresIn : 3600;
  const expiresAt = atMs && atMs - settledAt <= maxTtlMs ? atMs : settledAt + ttlSec * 1000;
  const cachedEntry = { pat, expiresAt, apiKey: teamKeyId };
  teamPatCache.set(cacheKey, cachedEntry);
  return cachedEntry.pat;
}
for (const teamFam of ["bigmodel", "zai"]) {
  const teamOrigin = teamFam === "bigmodel" ? "https://bigmodel.cn" : "https://api.z.ai";
  const teamBearer = teamFam === "zai";   // BigModel 业务 token 裸 Authorization，Z.ai 走 Bearer
  const teamCredKey = teamFam === "bigmodel" ? "oauth:bigmodel:access_token" : "oauth:zai:access_token";
  ADAPTERS.push({
    id: teamFam + "-team", label: teamFam === "bigmodel" ? "BigModel 团队套餐" : "Z.ai 团队套餐", kind: "plan", defaultOn: false, envKeys: [],
    detect(j, providerId) { return teamFamilyOf(providerId) === teamFam ? { family: teamFam, team: true } : null; },
    resolveCred(j, ctx) {
      const sel = teamSelectionOf(j, teamFam);
      if (!sel) return null;   // 未切到团队套餐：按未配置 fail-closed
      let raw = null;
      try { raw = j.readFile(j.credsPath); } catch (e) { return null; }
      const hit = hostCredDecrypt(raw, teamFam, teamCredKey, j.env);   // 旧平铺键缺席回退新式登录态键（issue #391）
      if (!hit) return null;
      const enc = hit.enc;
      const token = hit.token;
      if (!token) return { decryptFailed: true, fingerprint: "host:" + sha16(enc) };
      if (teamFam === "bigmodel") {
        const jwtEnc = raw["zcodejwttoken"];
        if (typeof jwtEnc === "string" && jwtEnc) {
          const jwt = decryptValue(jwtEnc, deriveCipherKey(j.env));
          if (jwt && jwt.trim() === token.trim()) return null;   // 陈旧业务令牌：ZCode 也不会用
        }
      }
      return { token: token.trim(), fingerprint: "team:" + sha16(JSON.stringify([teamFam, sel.org, sel.project, enc])),
               source: "host", team: { org: sel.org, project: sel.project } };
    },
    async fetchOne(j, ctx, cred, ctl) {
      /* monitor 鉴权=项目 PAT（宿主 resolveAccountTeamPlanRuntimeMaterial 同款）；
       * 业务 token 只用于换 PAT。 */
      const pat = await ensureTeamPat(j, teamFam, cred.team, cred.token, ctl);
      const body = await j.http.getJson(teamOrigin + QUOTA_PATH + "?type=2", {
        authorization: pat,
        "Bigmodel-Organization": cred.team.org,
        "Bigmodel-Project": cred.team.project,
        "set-language": "zh",
      }, ctl);
      const value = normalizeQuotaBody(body);
      if (value && value.noPlan) return { noPlan: true };
      return value;
    },
  });
}
/* --- ZCode Start Plan（免费档发放池：zcode.z.ai 账号级权益，OAuth zcodejwttoken 零配置） ---
 * 与 coding plan 是两条独立链：monitor/subscription 只返回编码套餐订阅，Start Plan 的
 * 权益/额度只在 zcode-plan billing/balance（宿主 getStartPlanSnapshot 同源端点）。
 * 鉴权必须用 zcodejwttoken（OAuth access_token 实测 401），且必须带 X-Device-Mid
 * （缺头实测 HTTP 400 code 3001 parameter error）；app_version 参数实测可省略。
 * bigmodel/zai 两个家族的 start-plan 走同一端点同一凭据键；zai 侧未实测真实账号。 */
const ZCODE_START_BALANCE_URL = "https://zcode.z.ai/api/v1/zcode-plan/billing/balance";
function zcodeStartDetectOf(providerId) {
  return providerId.indexOf("account:bigmodel-start-plan") === 0 || providerId.indexOf("account:zai-start-plan") === 0;
}
function readZcodeDeviceMid(j) {   // 宿主设备号：与 credentials.json 同目录的遥测状态文件
  const dir = path.dirname(j.credsPath);
  for (const name of ["telemetry-state.json", "onboarding-record.json"]) {
    let d = null;
    try { d = j.readFile(path.join(dir, name)); } catch (e) { }
    const v = d && typeof d === "object" ? d.deviceMid : null;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
ADAPTERS.push({
  id: "zcode-start", label: "ZCode Start Plan", kind: "plan", defaultOn: false, envKeys: [],
  detect(j, providerId) {
    return zcodeStartDetectOf(providerId) ? { family: "zcode-start" } : null;
  },
  resolveCred(j, ctx) {
    const sec = (j.secrets.sources || {})["zcode-start"] || {};
    const apiKey = typeof sec.apiKey === "string" && sec.apiKey.trim() ? sec.apiKey.trim() : "";
    let token = "", source = "";
    if (apiKey) { token = apiKey; source = "secrets"; } else {
      let raw = null;
      try { raw = j.readFile(j.credsPath); } catch (e) { return null; }
      const enc = raw && typeof raw === "object" ? raw["zcodejwttoken"] : null;
      if (typeof enc !== "string" || !enc) return null;
      token = decryptValue(enc, deriveCipherKey(j.env));
      if (!token) return { decryptFailed: true, fingerprint: "host:" + sha16(enc) };
      source = "host";
    }
    const deviceMid = readZcodeDeviceMid(j);
    if (!deviceMid) return null;   // 缺设备号必被服务端 3001 拒：fail-closed 不发请求
    return { token, deviceMid, fingerprint: sha16(JSON.stringify([token, deviceMid])), source };   // 定界拼接防 "|" 歧义撞指纹
  },
  async fetchOne(j, ctx, cred, ctl) {
    const body = await j.http.getJson(ZCODE_START_BALANCE_URL,
      { authorization: "Bearer " + cred.token, "X-Device-Mid": cred.deviceMid }, ctl);
    return normalizeZcodeStartBalance(body, j.now());
  },
});

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
    let lastErr = null;
    for (const p of ["/coding/v1/usages", "/coding/v1/usage"]) {
      try {
        body = await j.http.getJson("https://api.kimi.com" + p, headers, ctl);
        break;
      } catch (e) {
        if (e && (e.code === "auth_failed")) { authish = true; break; }   // 该 Key 非订阅 Key/无订阅 → 回落 PAYG
        lastErr = e;
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
    /* PAYG 回落：moonshot 余额（人民币分）。仅订阅端点明确 401（authish）或已解析出订阅
     * 响应但无可展示窗口时回落；两端点都瞬时失败（network/parse_error）时不得拿 PAYG
     * 数据冒充套餐，按最后错误抛出走常规退避（2026-10-24 审计修复）。 */
    if (!body && !authish) throw (lastErr && lastErr.code) ? lastErr : qErr("network_error", "kimi subscription unreachable");
    const bal = await j.http.getJson("https://api.moonshot.cn/v1/users/me/balance", { authorization: "Bearer " + cred.token }, ctl);
    /* 余额字段逐级判 null 取值（零余额合法，不能用 || 短路——曾把 available_balance:0
     * 当解析失败打 30 分钟 parse_error 退避）。 */
    const raw = bal && (bal.available_balance != null ? bal.available_balance
      : bal.balance != null ? bal.balance
      : (bal.data && bal.data.available_balance != null) ? bal.data.available_balance
      : (bal.data && bal.data.balance !== undefined) ? bal.data.balance : null);
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
    // 个人订阅账号 whoami 返回 org:null，省略 orgId 即用户作用域（issue #73）；组织账号仍带 orgId
    const org = who && who.org;
    const orgId = org && org.id ? String(org.id) : "";
    if (org != null && !orgId) throw qErr("parse_error", "bad org shape");
    const scope = orgId ? "?orgId=" + encodeURIComponent(orgId) : "";
    const cred8 = await j.http.getJson("https://api.commandcode.ai/alpha/billing/credits" + scope, H, ctl);
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
    const subs = await j.http.getJson("https://api.commandcode.ai/alpha/billing/subscriptions" + scope, H, ctl);
    const sd = (subs && (subs.data || subs)) || {};
    const periodStart = sd.currentPeriodStart, periodEnd = sd.currentPeriodEnd;
    let monthly = null;
    const sum = await j.http.getJson("https://api.commandcode.ai/alpha/usage/summary?since=" + encodeURIComponent(String(periodStart || "")) + (orgId ? "&orgId=" + encodeURIComponent(orgId) : ""), H, ctl);
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

/* --- 千问 AI 平台 Token Plan（issue #399；端点与字段转写自 magpie qianwen_plan.go /
 * alibaba_usage.go（MIT），即官方 @qianwenai/qianwen-cli 1.11.0 的登录与用量读法） ---
 * 推理网关 token-plan.maas.qianwenaiapi.com（sk-sp- key）是纯推理入口：用量百分比只对
 * 平台登录态开放（sk-sp- key 查 cs-data 得 BailianGateway.Login.NotLogined）。链路：
 * 设备码（t.qianwenai.com）→ 浏览器授权 → access token（无 refresh，过期整链重登）→
 * 换控制台令牌（cli.qianwenai.com GenerateCLIAccessToken，按 access 指纹缓存 20 分钟）→
 * cs-data 网关查 per<N><Unit>Percentage 窗口（个人套餐=周/月两窗）。凭据只发 qianwen
 * 官方三域。阿里云百炼（token-plan.*.maas.aliyuncs.com）凭据是 AccessKey 签名链、
 * 本版不认领（落 custom 中转保持现状）；团队 seat 版的绝对 Credits 字段不解析。 */
const QIANWEN_UA = "qianwen-cli/1.11.0";
const QIANWEN_REGION = "cn-beijing";
const QIANWEN_USAGE_API = "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage";
const QIANWEN_CLI_TOKEN_TTL = 20 * 60 * 1000;   // magpie aliTokenTTL 同款
const QIANWEN_POLL_MAX_MS = 30 * 1000;   // 设备码轮询间隔经 slow_down 逐次翻长后的封顶
const qianwenCliTokens = new Map();   // access 指纹 → { token, at }（控制台令牌缓存）
const QIANWEN_WIN_RE = /^per(\d+)(Hour|Day|Week|Month)(Percentage|ResetTime)$/;
function qianwenUuid() {
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}
function qianwenPkce() {   // S256：verifier=32B base64url，challenge=sha256(verifier) base64url
  const verifier = crypto.randomBytes(32).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
}
function qianwenExpiryMs(v) {   // ExpireTime：秒/毫秒数、数字串、日期串自适应（magpie qianwenTime 子集）
  if (typeof v === "number" && isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string" && v) {
    const n = Number(v);
    if (isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
    const t = Date.parse(v);
    return isFinite(t) && t > 0 ? t : 0;
  }
  return 0;
}
/* device/token 轮询回复宽容解析（magpie readQianwenReply 同款两形状：Data.Credentials
 * 大写形与 credentials 小写形；数字/空值字段按缺省走，不连累整回复）。 */
function qianwenReadSigninReply(rep) {
  if (!rep || typeof rep !== "object" || Array.isArray(rep)) return null;
  const data = rep.Data && typeof rep.Data === "object" && !Array.isArray(rep.Data) ? rep.Data : null;
  const creds = data && data.Credentials && typeof data.Credentials === "object" ? data.Credentials : null;
  const alt = rep.credentials && typeof rep.credentials === "object" ? rep.credentials : null;
  const status = String((data && data.Status != null ? data.Status : rep.status) || "authorization_pending").toLowerCase();
  const access = String((creds && creds.AccessToken) || (alt && alt.access_token) || "");
  const expires = creds && creds.ExpireTime != null ? creds.ExpireTime : (alt && alt.expire_time != null ? alt.expire_time : null);
  const u = creds && creds.User && typeof creds.User === "object" ? creds.User
    : (alt && alt.user && typeof alt.user === "object" ? alt.user : null);
  const user = u ? String(u.Id != null ? u.Id : (u.id != null ? u.id : "")) : "";
  const email = u ? String(u.Email || u.email || "") : "";
  return { status, access, expires, account: email || user };
}
function qianwenStatusWordOf(rep) {   // HTTP ≥3xx 错误体里的状态词（magpie 只认这三个，正文不进错误文案）
  let hay = "";
  if (rep && typeof rep === "object") {
    const data = rep.Data && typeof rep.Data === "object" ? rep.Data : null;
    hay = String((data && data.Status) || rep.status || JSON.stringify(rep).slice(0, 500)).toLowerCase();
  }
  if (hay.indexOf("expired") >= 0) return "expired_token";
  if (hay.indexOf("access_denied") >= 0) return "access_denied";
  if (hay.indexOf("slow_down") >= 0) return "slow_down";
  return "";
}
/* 设备端点原始 POST：绕过 j.http 的严格 JSON.parse（回复可能带 BOM 前缀，magpie 实测案例），
 * 剥 BOM 后宽容解析；失败只抛状态错误，响应体绝不进错误文案（可能含 token）。 */
async function qianwenPost(j, ctl, url) {
  const res = await j.fetchImpl(url, {
    method: "POST",
    headers: { accept: "application/json", "user-agent": QIANWEN_UA },
    signal: ctl ? ctl.signal : undefined, redirect: "manual",
  });
  const text = await res.text();
  if (text.length > BODY_LIMIT) throw qErr("network_error", "qianwen reply too large");
  let parsed = null;
  try { parsed = JSON.parse(text.replace(/^\uFEFF/, "")); } catch (e) { parsed = null; }
  if (res.status < 200 || res.status >= 300) {
    const err = qErr("network_error", "qianwen HTTP " + res.status);
    err.body = parsed;
    throw err;
  }
  return parsed;
}
async function qianwenMintCliToken(j, access, fp, ctl) {
  const hit = qianwenCliTokens.get(fp);
  const t = j.now();
  if (hit && t - hit.at < QIANWEN_CLI_TOKEN_TTL) return hit.token;
  const body = JSON.stringify({ product: "ModelStudioRegional", action: "GenerateCLIAccessToken",
    region: QIANWEN_REGION, params: {}, version: "2026-02-10" });
  const r = await j.http.post("https://cli.qianwenai.com/data/v2/api.json", {
    "content-type": "application/json", authorization: "Bearer " + access, "user-agent": QIANWEN_UA,
  }, ctl, body);
  const code = String((r && r.code) != null ? r.code : "");
  const tok = r && r.data && typeof r.data === "object" ? String(r.data.cliAccessToken || "").trim() : "";
  if (code === "200" && r.successResponse === true && tok && tok !== access) {
    qianwenCliTokens.set(fp, { token: tok, at: t });
    return tok;
  }
  qianwenCliTokens.delete(fp);
  if (/NeedLogin|NotLogined|NotLogin/i.test(code)) throw qErr("auth_failed", "qianwen session expired");
  if (code || (r && r.message)) throw qErr("network_error", ("qianwen mint " + (code || "error")).slice(0, 60));
  throw qErr("parse_error", "qianwen mint shape");
}
async function qianwenAskUsage(j, cliToken, ctl) {
  const url = "https://cs-data.qianwenai.com/cli/api.json?action=BroadScopeAspnGateway&product=sfm_bailian&api=" +
    encodeURIComponent(QIANWEN_USAGE_API);
  const params = JSON.stringify({ Api: QIANWEN_USAGE_API, V: "1.0", Data: { cornerstoneParam: {
    protocol: "V2", console: "ONE_CONSOLE", productCode: "p_efm", switchUserType: 3, consoleSite: "QIANWENAI" } } });
  const form = "params=" + encodeURIComponent(params) + "&region=" + QIANWEN_REGION;
  const r = await j.http.post(url, {
    "content-type": "application/x-www-form-urlencoded", authorization: "Bearer " + cliToken, "user-agent": QIANWEN_UA,
  }, ctl, form);
  const d = r && r.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : null;
  if (d && d.success === false) {
    const code = String(d.errorCode != null ? d.errorCode : "");
    if (/NotLogined|NeedLogin|NotLogin/i.test(code)) throw qErr("auth_failed", "qianwen session expired");
    throw qErr("network_error", ("qianwen console " + (code || "error")).slice(0, 80));   // 只回 code：errorMsg 是服务端文本，不进错误链
  }
  let node = d && d.DataV2 != null ? d.DataV2 : null;   // 双层 {data:…} 剥壳（magpie 同款，缺层容忍）
  for (let i = 0; i < 2; i++) {
    if (node && typeof node === "object" && !Array.isArray(node) && node.data && typeof node.data === "object" && !Array.isArray(node.data)) node = node.data;
    else break;
  }
  return node;
}
function qianwenReadWindows(node) {
  const wins = {};
  if (!node || typeof node !== "object" || Array.isArray(node)) return wins;
  for (const k of Object.keys(node)) {
    const m = QIANWEN_WIN_RE.exec(k);
    if (!m) continue;
    const key = m[1] + m[2];
    const w = wins[key] || (wins[key] = { reset: null, used: null });
    if (m[3] === "ResetTime") w.reset = num(node[k]);
    else { const v = num(node[k]); if (v != null) w.used = v; }
  }
  const nameOf = { "5Hour": "fiveHour", "1Day": "daily", "1Week": "weekly", "1Month": "monthly" };
  const out = {};
  for (const key of Object.keys(wins)) {
    const w = wins[key];
    if (w.used == null || !isFinite(w.used) || w.used < 0) continue;
    const name = nameOf[key];
    if (!name || out[name]) continue;   // 未知窗长丢弃，绝不冒充已知窗口
    out[name] = { percent: Math.round(clampPct(w.used * 100) * 10) / 10, resetsAt: resetOf(w.reset) };
  }
  return out;
}
ADAPTERS.push({
  id: "qianwen", label: "千问 Token Plan", kind: "plan", defaultOn: true, unverified: true,
  envKeys: ["ZCODE_QIANWEN_ACCESS_TOKEN"],
  /* 官方域精确命中，或 qianwenaiapi.com 域内 + sk-sp- key 前缀（token-plan key 被用于
   * 同族其它网关路径时仍认领）；不按 provider 名判定（模板名与实际套餐常不一致，issue
   * 明示），qwencloud/aliyuncs 等同族异域不认领。sk-sp- 推理 key 不作额度凭据。 */
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    if (!cp) return null;
    let host = "";
    try { host = new URL(cp.baseUrl).hostname.toLowerCase(); } catch (e) { host = ""; }
    if (host === "token-plan.maas.qianwenaiapi.com") return { config: true, family: "qianwen" };
    if (host.endsWith(".qianwenaiapi.com") && String(cp.apiKey || "").indexOf("sk-sp-") === 0) return { config: true, family: "qianwen" };
    return null;
  },
  resolveCred(j, ctx) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).qianwen || {};
    const token = typeof sec.token === "string" ? sec.token.trim() : "";
    if (!token) return null;
    const exp = num(sec.tokenExpiresAt);   // 平台登录态已过：无 refresh token，归未配置引导重登
    if (exp > 0 && j.now() > exp) return null;
    return { token, fingerprint: "sec:" + sha16(token), source: "secrets" };
  },
  async fetchOne(j, ctx, cred, ctl) {
    const fp = cred.fingerprint;
    let cliToken = await qianwenMintCliToken(j, cred.token, fp, ctl);
    let node;
    try {
      node = await qianwenAskUsage(j, cliToken, ctl);
    } catch (e) {
      /* 缓存的控制台令牌被网关拒（NotLogined）：重换一次新令牌；新令牌仍被拒=平台登录态
       * 已失效，auth_failed 冻结到重新登录（凭据指纹变化），绝不循环重试。 */
      if (e && e.code === "auth_failed" && qianwenCliTokens.has(fp)) {
        qianwenCliTokens.delete(fp);
        cliToken = await qianwenMintCliToken(j, cred.token, fp, ctl);
        node = await qianwenAskUsage(j, cliToken, ctl);
      } else throw e;
    }
    const windows = qianwenReadWindows(node);
    if (!Object.keys(windows).length) throw qErr("parse_error", "qianwen: no personal plan windows");   // 团队 seat 账号/未购个人套餐：不显示 0%
    return { label: "千问 Token Plan", kind: "plan", windows };
  },
});

/* ---------- 千问设备码登录流（⚙ 面板「登录」按钮驱动；每个 client 实例一条） ----------
 * 状态机 idle→pending→done/failed；gen 是唯一存活令牌（重开/取消/dispose 都 +1，在途
 * 轮询按 gen 自弃）。完成经 saveSecrets（注入侧 writeQuotaSecrets）持久化 token/account/
 * tokenExpiresAt → credentialsChanged → 解冻即查。错误文案绝不引用响应体（可能含 token，
 * magpie 有真实泄露事故）。 */
function installQianwenFlow(client, j, o) {
  const flow = { state: "idle", error: "", url: "", account: "", gen: 0, timer: 0 };
  const armTimer = (ms, fn) => {
    flow.timer = setTimeout(() => { flow.timer = 0; fn(); }, ms);
    if (flow.timer && typeof flow.timer.unref === "function") flow.timer.unref();
  };
  const armPoll = (ctl, url) => {   // 单次轮询 15s 超时兜底：挂死不至于冻结整流（重开即恢复）
    const kill = setTimeout(() => { try { ctl.abort(); } catch (e) { } }, 15 * 1000);
    if (kill && typeof kill.unref === "function") kill.unref();
    return qianwenPost(j, ctl, url).finally(() => { clearTimeout(kill); });
  };
  function finish(state, error) {
    flow.state = state;
    flow.error = error || "";
    flow.url = "";   // 终态一律清：授权页 URL 带设备码 auth_token，done/failed 后渲染端都不再需要
  }
  function flowCancel() {
    flow.gen += 1;
    if (flow.timer) { clearTimeout(flow.timer); flow.timer = 0; }
    flow.state = "idle"; flow.error = ""; flow.url = ""; flow.account = "";
  }
  client.qianwenSignInState = () => ({ ok: true, state: flow.state, error: flow.error, url: flow.url, account: flow.account });
  client.qianwenSignInCancel = () => flowCancel();
  client.disposeQianwenFlow = () => flowCancel();
  client.qianwenSignInStart = async () => {
    if (!o || typeof o.saveSecrets !== "function") return { ok: false, error: "sign-in unavailable" };
    flowCancel();
    const gen = flow.gen;
    const clientID = qianwenUuid();
    const pk = qianwenPkce();
    let codeRep = null, codeErr = null;
    const startCtl = new AbortController();
    try {
      codeRep = await armPoll(startCtl, "https://t.qianwenai.com/cli/device/code?client_id=" + encodeURIComponent(clientID) +
        "&code_challenge=" + encodeURIComponent(pk.challenge) + "&code_challenge_method=S256");
    } catch (e) { codeErr = e; }
    if (gen !== flow.gen) return { ok: false, error: "cancelled" };
    const d = codeRep && codeRep.Data && typeof codeRep.Data === "object" ? codeRep.Data : null;
    const deviceToken = d && typeof d.Token === "string" ? d.Token : "";
    /* 授权页 URL 域白名单（官方=account.qianwenai.com）：服务端可控串不经白名单不交 openExternal。
     * 交出去的是 URL 解析归一后的 href——原始串里的首尾空白/控制字符不随 openExternal
     * 出门；带 userinfo 的「evil.com@account.qianwenai.com」形（地址栏可误导）直接拒。 */
    let url = "";
    if (d && typeof d.VerificationUrl === "string") {
      try {
        const u = new URL(d.VerificationUrl);
        url = u.protocol === "https:" && !u.username && !u.password &&
          u.hostname.toLowerCase().endsWith(".qianwenai.com") ? u.href : "";
      } catch (e) { url = ""; }
    }
    if (codeErr && codeErr.body) {   // HTTP ≥3xx：只嗅状态词，正文不进文案
      const word = qianwenStatusWordOf(codeErr.body);
      if (word === "expired_token") { finish("failed", "设备码已过期，请重试"); return { ok: false, error: flow.error }; }
    }
    if (!codeRep || !d || !deviceToken || !url) {
      finish("failed", "无法发起千问登录" + (codeErr ? "（" + String(codeErr.message || "network").slice(0, 40) + "）" : ""));
      return { ok: false, error: flow.error };
    }
    const everyMs = Math.min(Math.max((num(d.Interval) > 0 ? num(d.Interval) : 2) * 1000, 100), 2000);
    const deadline = j.now() + Math.min(Math.max((num(d.ExpiresIn) > 0 ? num(d.ExpiresIn) : 300) * 1000, 30 * 1000), 15 * 60 * 1000);
    let curMs = everyMs;
    flow.state = "pending";
    flow.url = url;
    const poll = async () => {
      if (gen !== flow.gen) return;
      if (j.now() >= deadline) { finish("failed", "登录页已过期，请重新登录"); return; }
      const ctl = new AbortController();
      let rep = null, netErr = null;
      try { rep = await armPoll(ctl, "https://t.qianwenai.com/cli/device/token?client_id=" + encodeURIComponent(clientID) +
        "&token=" + encodeURIComponent(deviceToken) + "&code_verifier=" + encodeURIComponent(pk.verifier)); }
      catch (e) { netErr = e; }
      if (gen !== flow.gen) return;
      let parsed = rep ? qianwenReadSigninReply(rep) : null;
      if (netErr && netErr.body) {   // HTTP ≥3xx 错误体状态词（expired/access_denied/slow_down）
        parsed = { status: qianwenStatusWordOf(netErr.body) || "http_error", access: "", expires: null, account: "" };
      } else if (netErr) {
        parsed = { status: "authorization_pending", access: "", expires: null, account: "" };   // 掉线轮询重问（magpie 同款）
      } else if (rep && !parsed) {
        finish("failed", "平台返回未知形态，请重试");
        return;
      }
      /* 当前轮询间隔：slow_down 持续加长并沿用（RFC 8628 §3.5——加长后的间隔不回落，
       * 否则服务端要求的间隔高于客户端上限时会一直 slow_down 到 deadline），封顶 30s */
      if (parsed.status === "authorization_pending") { armTimer(curMs, poll); return; }
      if (parsed.status === "slow_down") { curMs = Math.min(curMs * 2, QIANWEN_POLL_MAX_MS); armTimer(curMs, poll); return; }
      if (parsed.status === "complete") {
        if (!parsed.access) { finish("failed", "平台未返回令牌，请重试"); return; }
        const expMs = qianwenExpiryMs(parsed.expires);
        try {
          o.saveSecrets((sec) => {
            sec.qianwen = Object.assign({}, sec.qianwen || {}, { token: parsed.access, account: parsed.account });
            if (expMs > 0) sec.qianwen.tokenExpiresAt = expMs; else delete sec.qianwen.tokenExpiresAt;
          });
        } catch (e) { finish("failed", "登录态保存失败"); return; }
        if (gen !== flow.gen) return;   // 保存与取消竞窗：凭据已落盘无害（下次登录覆盖同字段）
        flow.account = parsed.account;
        finish("done", "");
        return;
      }
      if (parsed.status === "expired_token") { finish("failed", "登录页已过期，请重新登录"); return; }
      if (parsed.status === "access_denied") { finish("failed", "授权被拒绝"); return; }
      if (parsed.status === "http_error") { armTimer(curMs, poll); return; }   // 未知 HTTP 错误：按瞬时重问
      finish("failed", "平台返回未知状态，请重试");   // 服务端 Status 串不进错误链（与 usage 错误同口径）
    };
    armTimer(everyMs, poll);
    return { ok: true, url, state: "pending" };
  };
}

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
    if (!infos.length) {
      /* is_available=false（官方语义：无余额可供调用）且无币种条目：按合法零余额显示，不判解析失败——
       * 文档不承诺无可用余额的账户仍返回 balance_infos 条目；币种无响应证据，沿用平台缺省 CNY。 */
      if (body && body.is_available === false) return { balance: { amount: 0, currency: "CNY" } };
      throw qErr("parse_error", "no balance_infos");
    }
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
  /* Ark Agent Plan 自定义供应商认领（issue #261）：官方域 + /api/plan 前缀才命中（/api/v3
   * 按量版无套餐查询语义，不认领）。只解析 provider baseUrl，不查凭据、不发请求——无 AK/SK
   * 时归本源报 not_configured（chip 引导去 ⚙ 配置），比落 custom 报 unsupported 更可操作；
   * ⚙ 显式 enabled=false 时复合源报 disabled 隐藏 chip（尊重显式关闭）。 */
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    if (!cp) return null;
    let u = null;
    try { u = new URL(cp.baseUrl); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.hostname.toLowerCase() !== "ark.cn-beijing.volces.com") return null;
    const p = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (p !== "/api/plan" && !p.startsWith("/api/plan/")) return null;
    return { config: true, family: "volcano" };
  },
  resolveCred(j) {
    const sec = (j.secrets.sources || {}).volcano || {};
    const ak = j.env.VOLCENGINE_ACCESS_KEY_ID || sec.accessKeyId || sec.ak;
    const sk = j.env.VOLCENGINE_SECRET_ACCESS_KEY || sec.secretAccessKey || sec.sk;
    if (!ak || !sk) return null;
    return { ak, sk, fingerprint: "sec:" + sha16(ak + "|" + sk), source: "secrets" };
  },
  async fetchOne(j, ctx, cred, ctl) {
    const rawRegion = ((j.secrets.sources || {}).volcano || {}).region;
    const region = typeof rawRegion === "string" && /^[a-z0-9-]{2,32}$/.test(rawRegion) ? rawRegion : "cn-beijing";   // 非法 region 回默认，不让坏配置进签名串
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
    if (Object.keys(windows).length) return { label: "火山方舟", kind: "plan", plan: { productName: tag }, windows, planName: tag };
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
    return { label: "火山方舟", kind: "plan", plan: { productName: "Coding Plan" }, windows };
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
  // 空/非法 baseUrl 是配置类不可用：按 unsupported 长退避（quota.md 契约），不是响应形状问题
  let url;
  try { url = new URL(baseUrl); } catch (e) { throw qErr("unsupported", "bad baseUrl"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw qErr("parse_error", "untrusted query scheme");
  if (url.username || url.password) throw qErr("parse_error", "baseUrl userinfo rejected");
  const prefix = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  return { sub2api: url.origin + prefix + "/v1/usage", legacy: url.origin + url.pathname.replace(/\/+$/, "") };
}

/* --- OpenCode Go（$10/月订阅；端点为第一方未文档化接口，2026-11-15 个人 Go 档实测） ---
 * 主链 GET https://opencode.ai/console/api/go/status（控制台 Go 页面同源；API key
 * 同样以 Authorization: Bearer 读取）：access.meters.{fiveHour,week,month} 各自带
 * {startsAt?,resetsAt,limitMicroCents,usedMicroCents}，金额单位 microcent
 * （1 USD = 1e8 microcent），percent 自算，可显示 $ 用量/额度明细。
 * 兜底 GET https://opencode.ai/zen/go/v1/usage（cc-switch coding_plan.rs 转写，MIT）：
 * {usage:{rolling|weekly|monthly:{status,percent(已用0-100),resetsAt(ISO)}}}；
 * 该端点只回整数已用百分比且向下取整（5 小时窗口用量 <1% 时恒为 0），也不回金额。
 * 两链同域 opencode.ai，凭据不出官方域。detect 较 cc-switch 的裸子串收严：host 精确
 * opencode.ai + 路径 /zen/go 或其子路径（两档预设），防外域伪装；Zen 按量版 /zen/v1
 * 无用量 API（cc-switch 实测 404）刻意不命中。 */
const OPENCODE_GO_STATUS_URL = "https://opencode.ai/console/api/go/status";
const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const OPENCODE_MICROCENTS_PER_USD = 1e8;
const OPENCODE_STATUS_TIMEOUT_MS = Math.min(3000, FETCH_TIMEOUT_MS);
function opencodeLinkedAbort(parent) {
  const ctl = new AbortController();
  const signal = parent && parent.signal;
  if (!signal) return ctl;
  if (signal.aborted) { try { ctl.abort(); } catch (e) { } return ctl; }
  try { signal.addEventListener("abort", () => { try { ctl.abort(); } catch (e) { } }, { once: true }); }
  catch (e) { /* 极简 signal 桩：仍可独立超时 */ }
  return ctl;
}
function opencodeUsdOf(v) {
  const n = num(v);
  return n == null || n < 0 ? null : n / OPENCODE_MICROCENTS_PER_USD;
}
/* 控制台 meters → 窗口；形状不符/全无有效窗返回 null（调用方回落 public usage 端点，
 * 不把一次控制台改版打成 parse_error 长退避）。percent 保留两位小数：public 端点的
 * 整数向下取整会把 0.67% 显示成 0%，正是 5 小时窗口「看起来查不到」的根因。 */
function normalizeOpencodeGoStatus(body) {
  const access = body && typeof body === "object" && !Array.isArray(body) &&
    body.access && typeof body.access === "object" && !Array.isArray(body.access) ? body.access : null;
  const meters = access && access.meters && typeof access.meters === "object" &&
    !Array.isArray(access.meters) ? access.meters : null;
  if (!meters) return null;
  const windows = {};
  for (const pair of [["fiveHour", "fiveHour"], ["week", "weekly"], ["month", "monthly"]]) {
    const m = meters[pair[0]] && typeof meters[pair[0]] === "object" && !Array.isArray(meters[pair[0]])
      ? meters[pair[0]] : null;
    if (!m) continue;
    const limitMc = num(m.limitMicroCents), usedMc = num(m.usedMicroCents);
    if (limitMc == null || !(limitMc > 0) || usedMc == null || usedMc < 0) continue;
    const total = opencodeUsdOf(limitMc), used = opencodeUsdOf(usedMc);
    windows[pair[1]] = {
      percent: Math.round(clampPct((usedMc / limitMc) * 100) * 100) / 100,
      resetsAt: resetOf(m.resetsAt) || (pair[0] === "month" ? resetOf(access.endsAt) : null),
      used, total, remaining: total != null && used != null ? Math.max(0, total - used) : null,
      currency: "USD",
    };
  }
  /* 缺某窗（字段漂移/该档无此窗）时不拿兜底整数百分比补洞：避免不同来源/时刻的数据
   * 混在同一张卡上；全部窗都缺失才整源回落，下一拍控制台恢复即自愈。 */
  if (!Object.keys(windows).length) return null;
  return { label: "OpenCode Go", kind: "plan", windows: windows };
}
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
      /* percent=0 时 public 端点的 resetsAt 是 now+窗长占位值（空闲窗），丢弃；
       * 子 1% 活跃窗由控制台 meters 主链给出精确 percent 与真实 resetsAt。 */
      resetsAt: pct > 0 ? resetOf(w.resetsAt) : null,
    };
  }
  if (!Object.keys(windows).length) throw qErr("parse_error", "opencode windows missing");
  return { label: "OpenCode Go", kind: "plan", windows: windows };
}

ADAPTERS.push({
  id: "opencode", label: "OpenCode Go", kind: "plan", defaultOn: true,
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
    const headers = { authorization: "Bearer " + cred.token };
    /* 两个端点并行、各自独立 AbortController（仅父信号联动）：控制台 meters 给出精确金额/
     * 子 1% 用量；public usage 端点作为独立兜底并负责 403 无订阅判定。控制台 3 秒宽限
     * 超时后单独中止，不拖住已就绪的兜底；控制台 401/403/网络/形态变化静默降级，不让
     * 一次控制台改版把整条链打成 parse_error 长退避。 */
    const statusCtl = opencodeLinkedAbort(ctl);
    const usageCtl = opencodeLinkedAbort(ctl);
    const statusTimer = setTimeout(() => { try { statusCtl.abort(); } catch (e) { } }, OPENCODE_STATUS_TIMEOUT_MS);
    if (statusTimer && typeof statusTimer.unref === "function") statusTimer.unref();
    const statusP = j.http.getJson(OPENCODE_GO_STATUS_URL, headers, statusCtl)
      .then((body) => normalizeOpencodeGoStatus(body))
      .catch(() => null)
      .finally(() => clearTimeout(statusTimer));
    /* 显式信封而非 instanceof Error：fetchImpl 是注入接缝，可能以字符串/普通对象拒绝。 */
    const usageP = j.http.getJson(OPENCODE_GO_USAGE_URL, headers, usageCtl)
      .then((body) => ({ ok: true, value: normalizeOpencodeGo(body) }))
      .catch((error) => ({ ok: false, error }));
    const rich = await statusP;
    if (rich) {
      try { usageCtl.abort(); } catch (e) { }   // 主链已够：取消多余兜底请求
      return rich;
    }
    const usage = await usageP;
    if (!usage.ok) {
      /* 403 EntitlementError：key 本身有效（Zen/Go 共用 workspace key）但无 Go 订阅——
       * 与 401 认证失败分开（classifyStatus 把 401/403 都归 auth_failed，此处按消息分流）。 */
      if (usage.error && usage.error.httpStatus === 403) return { noPlan: true };
      throw usage.error;
    }
    return usage.value;
  },
});

/* --- R4 Coder（r4.codes 中转；/v1/cli/key + /v1/cli/meta 同源只读） ---
 * 自定义供应商 baseUrl 指向 api.r4.codes 时零配置认领；普通 coder_ 推理 key 即查询
 * 凭据（文档：Authorization Bearer 与 x-api-key 等价，三端点共享 60 req/min 桶）。
 * key 给出调用 Key 的 limit/spent/held（reserve gate 口径），meta 给出套餐池、
 * limit_windows（如 5 小时 ceiling）、钱包余额与到期。两请求并行：meta 失败只损失
 * 套餐增强，key 限额仍可展示；两者都无可展示数据才 fail-closed。 */
const R4_API_ORIGIN = "https://api.r4.codes";
function r4WindowName(seconds) {
  if (!(seconds > 0)) return "";
  if (seconds <= 6 * 3600) return "fiveHour";
  if (seconds <= 36 * 3600) return "daily";
  if (seconds <= 8 * 86400) return "weekly";
  if (seconds <= 32 * 86400) return "monthly";
  return "";   // 未知长窗丢弃：绝不冒充套餐池（plan 只由 plan.total/remaining 产出）
}
function r4Day(value) {
  const m = typeof value === "string" ? value.match(/^(\d{4}-\d{2}-\d{2})/) : null;
  return m ? m[1] : "";
}
/* 金额是服务端字符串转来的十进制小数；减法会留下 1.392046999999998 这类尾差，
 * 统一收到 6 位再进快照（展示层只用到 2–4 位，不影响精度）。 */
function r4Usd(value) { return Math.round(value * 1e6) / 1e6; }
function normalizeR4(keyBody, metaBody) {
  const key = keyBody && typeof keyBody === "object" && !Array.isArray(keyBody) ? keyBody : null;
  const meta = metaBody && typeof metaBody === "object" && !Array.isArray(metaBody) ? metaBody : null;
  if (!key && !meta) throw qErr("parse_error", "r4 empty");
  const out = { label: "R4 Coder", kind: "plan" };
  const windows = {};
  let hasQuota = false;
  const plan = meta && meta.plan && typeof meta.plan === "object" && !Array.isArray(meta.plan) ? meta.plan : null;
  if (plan) {
    const total = num(plan.total_usd), remaining = num(plan.remaining_usd);
    if (total != null && total > 0 && remaining != null && remaining >= 0) {
      const used = Math.max(0, total - remaining);
      windows.plan = {
        percent: Math.round(clampPct((used / total) * 100) * 10) / 10,
        used: r4Usd(used), total: r4Usd(total), remaining: r4Usd(Math.min(remaining, total)),
        currency: "USD", resetsAt: resetOf(plan.expires_at), expires: true,
      };
      hasQuota = true;
    }
    const list = Array.isArray(plan.limit_windows) ? plan.limit_windows : [];
    for (const lw of list) {
      if (!lw || typeof lw !== "object" || Array.isArray(lw)) continue;
      const ceiling = num(lw.ceiling_usd), consumed = num(lw.consumed_usd);
      /* ceiling=null 是「该窗不限速」语义，不是 0 额度：跳过，绝不造 0% 假窗口。 */
      if (ceiling == null || !(ceiling > 0) || consumed == null || consumed < 0) continue;
      const left = num(lw.remaining_usd);
      const name = r4WindowName(num(lw.duration_seconds));
      if (!name) continue;
      const win = {
        percent: Math.round(clampPct((consumed / ceiling) * 100) * 10) / 10,
        used: consumed, total: ceiling,
        remaining: left != null && left >= 0 ? left : Math.max(0, ceiling - consumed),
        currency: "USD", resetsAt: resetOf(lw.resets_at),
      };
      /* 同标签多窗（字段漂移/多档叠加）取已用比例更高者，不让低窗掩盖受限状态。 */
      if (!windows[name] || win.percent > windows[name].percent) windows[name] = win;
      hasQuota = true;
    }
    const pkg = typeof plan.package_name === "string" ? plan.package_name.trim() : "";
    if (pkg) out.plan = { productName: pkg.slice(0, 60) };
    const end = r4Day(plan.expires_at);
    if (end && out.plan) out.plan.validEnd = end;
  }
  if (key) {
    const limit = num(key.limit_usd), spent = num(key.spent_usd), held = num(key.held_usd);
    const remaining = num(key.remaining_usd);
    if (limit != null && limit >= 0 && (remaining != null || spent != null)) {
      const used = spent != null ? spent + (held != null ? held : 0) : Math.max(0, limit - remaining);
      out.quotaSummary = {
        limit: r4Usd(limit), used: r4Usd(used),
        remaining: r4Usd(remaining != null ? remaining : Math.max(0, limit - used)),
        currency: "USD",
      };
      hasQuota = true;
    }
  }
  if (Object.keys(windows).length) out.windows = windows;
  if (!hasQuota) {
    const wallet = meta && meta.wallet && typeof meta.wallet === "object" && !Array.isArray(meta.wallet) ? meta.wallet : null;
    const balance = wallet ? num(wallet.balance_usd) : null;
    if (balance == null || balance < 0) return { noPlan: true };   // 钱包缺失/负值且无套餐/限额：无任何可展示额度（0 是合法零余额，照常显示）
    out.kind = "balance";
    out.balance = { amount: balance, currency: "USD" };
  }
  return out;
}
function r4KeyUsable(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (!("limit_usd" in body) && !("spent_usd" in body) && !("remaining_usd" in body)) return false;
  for (const k of ["limit_usd", "spent_usd", "held_usd", "remaining_usd"]) {
    if (body[k] != null && num(body[k]) == null) return false;   // 字段漂移/脏值不猜 0
  }
  return true;
}
function r4MetaUsable(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (!("plan" in body) && !("wallet" in body)) return false;
  for (const k of ["plan", "wallet"]) {
    if (body[k] != null && (typeof body[k] !== "object" || Array.isArray(body[k]))) return false;
  }
  return true;
}
ADAPTERS.push({
  id: "r4", label: "R4 Coder", kind: "plan", defaultOn: true,
  envKeys: ["R4_API_KEY", "R4_CODER_API_KEY", "R4CODES_API_KEY"],
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    if (!cp) return null;
    let u = null;
    try { u = new URL(cp.baseUrl); } catch (e) { return null; }
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    /* key 只发 r4 官方域；r4.codes 主站与 API 子域都只认这两个入口，路径不参与判定
     * （/v1、/v1/anthropic 等宿主 baseUrl 变体同域命中）。 */
    if (host === "api.r4.codes") return { key: cp.apiKey, origin: "cfg", apiOrigin: R4_API_ORIGIN };
    if (host === "r4.codes" || host === "www.r4.codes") return { key: cp.apiKey, origin: "cfg", apiOrigin: "https://" + host };
    return null;
  },
  resolveCred(j, ctx) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).r4 || {};
    if (sec.apiKey) return { token: sec.apiKey, fingerprint: "sec:" + sha16(sec.apiKey), source: "secrets" };
    if (ctx.key) return { token: ctx.key, fingerprint: "cfg:" + sha16(ctx.key), source: "provider_config" };
    return null;
  },
  async fetchOne(j, ctx, cred, ctl) {
    const origin = ctx.apiOrigin || R4_API_ORIGIN;
    const headers = { authorization: "Bearer " + cred.token };
    const got = (p) => p.then((body) => ({ ok: true, body }), (error) => ({ ok: false, error }));
    const [keyR, metaR] = await Promise.all([
      got(j.http.getJson(origin + "/v1/cli/key", headers, ctl)),
      got(j.http.getJson(origin + "/v1/cli/meta", headers, ctl)),
    ]);
    const key = keyR.ok && r4KeyUsable(keyR.body) ? keyR.body : null;
    const meta = metaR.ok && r4MetaUsable(metaR.body) ? metaR.body : null;
    if (!key && !meta) throw (keyR.error || metaR.error || qErr("parse_error", "r4 shape"));
    const out = normalizeR4(key, meta);
    /* 无可展示额度且缺任一端点：只有两端都成功才判无订阅；请求失败按瞬时错误重试，
     * 绝不用 no_plan 把状态冻结到用户换 key。 */
    if (out && out.noPlan && (!meta || !key)) {
      throw (keyR.error || metaR.error || qErr("parse_error", "r4 shape"));
    }
    return out;
  },
});

/* --- Ollama Cloud（issue #410；官方 /api/balance 单端点，两代套餐形状） ---
 * 自定义供应商 baseUrl host 为 ollama.com 时零配置认领（路径不参与判定，/v1 等宿主
 * baseUrl 变体同域命中；本地 11434 非 https 不命中）。新套餐 included.balance_usd
 * （本期剩余）+ allowance_usd（总额）+ period → 月度额度池窗；旧套餐 included.session/
 * weekly 的 remaining_percent（剩余制）翻转为已用并映射 5 小时/周窗；purchased.
 * balance_usd 是套餐外充值余额——有窗口时不进顶层 balance（渲染端余额形态优先会挤掉
 * 窗口段），仅无窗口时退化为余额卡。端点与两代响应形状转写自 magpie（MIT）与官方
 * docs（docs.ollama.com/cloud/usage、/api/balance）；限流 10 req/min（issue 报告者
 * 转述，未实测），429 由调度器按 Retry-After 退避；未真账号实测（unverified）。 */
function normalizeOllama(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw qErr("parse_error", "ollama shape");
  const included = body.included && typeof body.included === "object" && !Array.isArray(body.included) ? body.included : null;
  const purchased = body.purchased && typeof body.purchased === "object" && !Array.isArray(body.purchased) ? body.purchased : null;
  if (!included && !purchased) throw qErr("parse_error", "ollama empty");
  const windows = {};
  /* 旧套餐：remaining_percent 是剩余制（75=还剩 75%），翻转为已用并钳 [0,100]；
   * 缺 remaining_percent 不猜 0，直接无窗。 */
  const pctWin = (l) => {
    if (!l || typeof l !== "object" || Array.isArray(l)) return null;
    const left = num(l.remaining_percent);
    if (left == null) return null;
    return { percent: Math.round(clampPct(100 - left) * 10) / 10, resetsAt: resetOf(l.resets_at) };
  };
  const s = pctWin(included && included.session);
  if (s) windows.fiveHour = s;
  const w = pctWin(included && included.weekly);
  if (w) windows.weekly = w;
  /* 新套餐：allowance<=0（含 0 档/字段为 0）无窗防除零；balance>allowance（超支后
   * 由充值余额垫付）钳满格。period.until 可解析才带 resetsAt 并入月窗，否则落 plan
   * 窗（「套餐」标签不带周期语义，不冒充月窗）。 */
  if (included) {
    const allowance = num(included.allowance_usd);
    const left = num(included.balance_usd);
    if (allowance != null && allowance > 0 && left != null) {
      const used = Math.min(allowance, Math.max(0, allowance - left));
      const win = {
        percent: Math.round(clampPct((used / allowance) * 100) * 10) / 10,
        used, total: allowance,
        remaining: Math.min(Math.max(0, left), allowance),
        currency: "USD",
      };
      const period = included.period && typeof included.period === "object" && !Array.isArray(included.period) ? included.period : null;
      /* until 非空但非日期（端点改版回垃圾串）不得冒充月窗：resetOf 对非空字符串透传是
       * 全仓基线，此处单适配器内敛加 Date.parse 门，解析失败落 plan 窗。数字毫秒（及毫秒
       * 数字串——同 stepfun 的整数字符串写法）不经 Date.parse 直接作 resetsAt：此前只认
       * 日期串，数字形态会被误落 plan 窗（「套餐」标签、无重置时间）。 */
      const untilRaw = period ? resetOf(period.until) : null;
      let until = null;
      if (typeof untilRaw === "number") until = untilRaw >= 1e11 ? untilRaw : null;
      else if (typeof untilRaw === "string") {
        /* 纯数字串只当毫秒，不走 Date.parse：V8 会把 "12345" 当成公元 12345 年而放行。
         * 1e11（1973 年）下限挡玩具数值——resetOf 会把任何 <1e12 的数字当秒乘 1000。 */
        if (/^\d+$/.test(untilRaw)) { const n = Number(untilRaw); until = Number.isFinite(n) && n >= 1e11 ? n : null; }   // 超长数字串是 Infinity：同 stepfun 加有限性闸
        else if (!Number.isNaN(Date.parse(untilRaw))) until = untilRaw;
      }
      if (until) { win.resetsAt = until; windows.monthly = win; }
      else windows.plan = win;
    }
  }
  const out = { label: "Ollama Cloud", kind: "plan" };
  if (Object.keys(windows).length) { out.windows = windows; return out; }
  const bought = purchased ? num(purchased.balance_usd) : null;
  if (bought != null && bought >= 0) {
    out.kind = "balance";
    out.balance = { amount: bought, currency: "USD" };
  }
  /* included 在但无任何可解析窗口且无/负 purchased：ok 空窗——纯 PAYG 账号合法形态，
   * 不判 no_plan 冻结（balance 端点对有效 key 恒回其账号数据，无「无订阅」信封可辨）。 */
  return out;
}
ADAPTERS.push({
  id: "ollama", label: "Ollama Cloud", kind: "plan", defaultOn: true, unverified: true,
  envKeys: ["OLLAMA_API_KEY"],
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    if (!cp) return null;
    let u = null;
    try { u = new URL(cp.baseUrl); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.hostname.toLowerCase() !== "ollama.com") return null;
    return { key: cp.apiKey, origin: "cfg" };
  },
  resolveCred(j, ctx) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).ollama || {};
    if (sec.apiKey) return { token: sec.apiKey, fingerprint: "sec:" + sha16(sec.apiKey), source: "secrets" };
    if (ctx.key) return { token: ctx.key, fingerprint: "cfg:" + sha16(ctx.key), source: "provider_config" };
    return null;
  },
  async fetchOne(j, ctx, cred, ctl) {
    return normalizeOllama(await j.http.getJson("https://ollama.com/api/balance", { authorization: "Bearer " + cred.token }, ctl));
  },
});

/* --- StepFun Step Plan（订阅 Credit 池，2026-11-21 外部贡献） ---
 * 官方文档化端点：GET https://api.stepfun.com/step_plan/v1/usage（Bearer key），
 * 转写自 platform.stepfun.com/docs/zh/step-plan/usage（2026-11-20 抓取）并经真实账号
 * 实调验证（Pro/Max 两档快照 + createQuotaClient 全链 + 桌面 chip 挂载，2026-11-20/21）。
 * 响应是账号级套餐额度快照：plan.name / plan.subscription.expires_at_ms 为套餐名与
 * 订阅到期；quota.credit_buckets[] 为额度桶（type="subscription" 是套餐月池，加油包
 * 桶同构）。total/remaining 是整数字符串（官方防 JS 精度损失写法，Token Plan 档位
 * ≤ 2e10 Credit < 2^53，按 Number 解析安全）；used_percent 是服务端已算好的已用%，
 * 缺失时按 (total−remaining)/total 自算兜底。Credit 按订阅月发放、当期剩余到期清零
 * 不结转（1 元 = 1,000,000 Credit，档位见官方 pricing 文档）。 */
const STEPFUN_USAGE_URL = "https://api.stepfun.com/step_plan/v1/usage";
/* 毫秒时间戳归一（resets_at_ms / expires_at_ms 同一口径）：数字毫秒直传；全数字字符串转
 * Number 恢复（官方 total/remaining 用整数字符串防精度，毫秒值可能同款——isFinite 拦超长
 * 串的 Infinity，低于 1e11 视为非毫秒垃圾串丢弃）；其余字符串仅当 allowDate 时过
 * Date.parse 门（对齐 ollama 的单适配器内敛门——端点改版回垃圾串不冒充重置时间）。 */
function stepfunStamp(v, allowDate) {
  const raw = resetOf(v);
  if (typeof raw === "number") return raw >= 1e11 ? raw : null;   // 1e11 下限同 ollama：挡玩具数值
  if (typeof raw !== "string") return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1e11 ? n : null;
  }
  return allowDate && !Number.isNaN(Date.parse(raw)) ? raw : null;
}
function normalizeStepfun(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw qErr("parse_error", "stepfun non-object body");
  const plan = body.plan, quota = body.quota;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw qErr("parse_error", "stepfun missing plan");
  if (!quota || typeof quota !== "object" || Array.isArray(quota)) throw qErr("parse_error", "stepfun missing quota");
  const buckets = (Array.isArray(quota.credit_buckets) ? quota.credit_buckets : [])
    .filter((b) => b && typeof b === "object" && !Array.isArray(b) && num(b.total) > 0 && num(b.remaining) >= 0);
  if (!buckets.length) return { noPlan: true };   // 无有效额度桶 = 无在订套餐（fail-closed 冻结，不造 0%）
  /* 选桶（规格「无 subscription 桶时取首个有效桶兜底」）：subscription 桶优先；没有时取
   * 首个 remaining 可解析的桶——加油包桶列表里前几个桶缺 remaining 时不再被它们抢占
   * （此前 buckets[0] 会选中缺 remaining 的桶，让紧随其后的有效桶也报 parse_error）；
   * 全都解析不了才落 buckets[0]，走下方 parse_error 按 30 分钟退避自愈。 */
  const pick = buckets.find((b) => b.type === "subscription")
    || buckets.find((b) => num(b.remaining) != null) || buckets[0];
  const total = num(pick.total), remaining = num(pick.remaining);
  if (total == null || remaining == null || remaining > total) throw qErr("parse_error", "stepfun bucket shape invalid");
  const usedPct = num(pick.used_percent);
  const pct = usedPct != null ? usedPct : ((total - remaining) / total) * 100;
  /* remaining 为 null/undefined/空串的桶不被过滤（JS 里 null >= 0 为 true），落下面
   * remaining == null 的 parse_error 按 30 分钟退避自愈，优于对在订账号误冻结 noPlan；
   * total 为 null/空串（无法产出任何窗口）与负 remaining（透支形状，官方文档未载）在
   * 过滤条件被剔除 → noPlan。 */
  const resetsAt = stepfunStamp(pick.resets_at_ms, true);
  const out = { label: "StepFun", kind: "plan",
    /* resets_at_ms 是月度 Credit 重置（真重置语义才填 resetsAt）；缺失（实测 Max 快照
     * 不带该字段）不拿订阅到期冒充——到期时间单独落 plan.validEnd。 */
    windows: { monthly: { percent: Math.round(clampPct(pct) * 10) / 10, resetsAt } } };
  const name = typeof plan.name === "string" ? plan.name.slice(0, 40) : "";
  const sub = plan.subscription;
  const expiresMs = (sub && typeof sub === "object" && !Array.isArray(sub)) ? stepfunStamp(sub.expires_at_ms, false) : null;
  if (name || expiresMs) {
    out.plan = { version: "", productName: name, validStart: "",
      validEnd: expiresMs != null ? zcodeStartStamp(expiresMs).slice(0, 10) : "" };
  }
  return out;
}
ADAPTERS.push({
  id: "stepfun", label: "StepFun", kind: "plan", defaultOn: true,
  envKeys: ["STEPFUN_API_KEY"],
  detect(j, providerId) {
    if (providerId.indexOf("account:") === 0) return null;
    const cp = j.customProviderOf(providerId);
    if (!cp) return null;
    let u = null;
    try { u = new URL(cp.baseUrl); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.hostname.toLowerCase() !== "api.stepfun.com") return null;
    return { key: cp.apiKey, origin: "cfg" };
  },
  resolveCred(j, ctx) {
    for (const k of this.envKeys) {
      const v = j.env[k];
      if (v) return { token: v, fingerprint: "env:" + sha16(v), source: "env" };
    }
    const sec = (j.secrets.sources || {}).stepfun || {};
    if (sec.apiKey) return { token: sec.apiKey, fingerprint: "sec:" + sha16(sec.apiKey), source: "secrets" };
    if (ctx.key) return { token: ctx.key, fingerprint: "cfg:" + sha16(ctx.key), source: "provider_config" };
    return null;
  },
  async fetchOne(j, ctx, cred, ctl) {
    return normalizeStepfun(await j.http.getJson(STEPFUN_USAGE_URL, { authorization: "Bearer " + cred.token }, ctl));
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
  resolveCred(j, ctx) { return { token: ctx.cp.apiKey, fingerprint: "cfg:" + sha16(JSON.stringify([ctx.cp.apiKey, ctx.cp.baseUrl])), source: "provider_config" }; },   // 定界拼接防 "|" 歧义撞指纹
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
  stepfun: { keyUrl: "https://platform.stepfun.com/account-overview" },
  openrouter: { keyUrl: "https://openrouter.ai/settings/keys" },
  r4: { keyUrl: "https://r4.codes/dashboard/api-keys" },
  kimi: { keyUrl: "https://platform.moonshot.cn/console/api-keys" },
  anthropic: { keyUrl: "https://console.anthropic.com/settings/keys" },
  mimo: { keyUrl: "https://platform.xiaomimimo.com" },
  volcano: { keyUrl: "https://console.volcengine.com/ark" },
  qianwen: { keyUrl: "https://platform.qianwenai.com" },
  ollama: { keyUrl: "https://ollama.com/settings/keys" },
};

/* ---------- 多源调度器 ---------- */
function createQuotaClient(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const now = o.now || (() => Date.now());
  const fetchImpl = o.fetchImpl || (typeof fetch === "function" ? fetch : null);
  /* v135 双门控：quota_enabled 只关额度 chip 的查询链；reset_badge_enabled 独立控制重置卡。
   * 额度关 + 重置开时主进程仍解密凭据（仅查 reset/status 只读端点）——⚙ 面板已披露该联网语义。 */
  const quotaOn = o.quotaEnabled || (() => true);
  /* resetOn 缺省关：reset 链是注入侧显式启用的附加功能（inject-main 传 resetBadgeEnabled），
   * 库内默认关保证旧宿主装配/测试夹具零改动兼容，冷热混部时也只是少徽标不报错 */
  const resetOn = o.resetEnabled || (() => false);
  /* resetListOn 同理缺省关：bigmodel 族并行查网页控制台列表端点补充过期卡历史
   * （status 端点无过期历史）；请求量翻倍且属增强数据，由注入侧显式开启 */
  const resetListOn = typeof o.resetList === "function" ? o.resetList : (o.resetList ? () => true : () => false);
  const { credsPath, customCfgPath, builtinCfgPath, credsDir } = resolveQuotaPaths(o);
  /* v2 凭据（宿主 3.18.0 enc:v2:os）绑定真实路径上下文并预热 keychain 密钥缓存：
   * 异步预热、解密同步读缓存；未热时解密失败走 pending 短重试（见 tickSource）。 */
  setDefaultDecryptCtx({ credsPath, credsDir, resourcesDir: o.resourcesDir, env });
  void ensureDefaultV2Key();
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
  async function rawFetch(url, headers, ctl, method, body) {
    const res = await fetchImpl(url, {
      method: method || "GET",
      headers: Object.assign({ accept: "application/json", "accept-encoding": "identity" }, headers),
      signal: ctl ? ctl.signal : undefined, redirect: "manual",
      body: body == null ? undefined : body,
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
    async post(url, headers, ctl, body) {   // body：可选请求体字符串（JSON/form；火山调用不传维持原状）
      const r = await rawFetch(url, headers, ctl, "POST", body);
      let json = null;
      try { json = JSON.parse(r.text); } catch (e) { json = null; }
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
      if (r.status < 200 || r.status >= 300) {
        /* 非 2xx：body 带 JSON 错误信封的已在上面按信封分类（签名错常 400 非 401）；
         * 剩下的（如网关 HTML 错误页）按状态分类——瞬时错误走 network_error 阶梯，
         * 不冒充 parse_error 的 30 分钟长退避（与 getJson 的状态优先同向，2026-10-24 审计修复）。 */
        throw classifyStatus(r.status, r.headers);
      }
      if (!json) throw qErr("parse_error", "invalid json");
      return json;
    },
  };

  /* 团队套餐选择所在的 setting.json：恒在 HOME/.zcode/v2（不随 dataBaseDir 迁移）；测试可注入 */
  const settingPath = o.settingPath || path.join(os.homedir(), ".zcode", "v2", "setting.json");
  const j = {
    env, now, fetchImpl, readFile, secrets: { sources: {} }, customCfgPath, log, http, extras,
    credsPath, settingPath,
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
      const teamFam = teamFamilyOf(p);
      if (teamFam) return { id: teamFam + "-team", ctx: { family: teamFam, team: true } };
      if (zcodeStartDetectOf(p)) return { id: "zcode-start", ctx: { family: "zcode-start" } };
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
    if (kill && typeof kill.unref === "function") kill.unref();
    if (ctl.signal && typeof ctl.signal.addEventListener === "function") {
      ctl.signal.addEventListener("abort", () => clearTimeout(kill), { once: true });
    }
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
    if (onUpdate) onUpdate();
    p.then(() => {
      if (st.inFlight !== q) return;
      st.inFlight = null;
      if (onUpdate) onUpdate();
    });   // fetchOne 包装自身不 reject
  }

  function tickSource(adapter, st, force) {
    j.secrets = readSecrets();
    if (((j.secrets.sources || {})[adapter.id] || {}).enabled === false) return false;
    const t = now();
    if (st.inFlight) return false;
    if (!force && t < st.nextAt) return false;
    const ctx = st.ctx;
    if (!ctx) {
      if (adapter.id === "custom") {   // 无配置的自定义供应商：unsupported/provider（v96 兼容语义）
        if (st.status !== "unsupported" || st.reason !== "provider") setState(st, { status: "unsupported", reason: "provider", value: null });
      } else if (st.status !== "not_configured") setState(st, { status: "not_configured", reason: "", lastError: "" });
      st.nextAt = t + NOT_CONFIGURED_RETRY_MS;
      return false;
    }
    const cred = adapter.resolveCred(j, ctx);
    if (!cred) {
      if (st.status !== "not_configured") setState(st, { status: "not_configured", reason: "", lastError: "" });
      st.nextAt = t + NOT_CONFIGURED_RETRY_MS;
      return false;
    }
    if (cred.decryptFailed) {
      if (st.status !== "not_configured") setState(st, { status: "not_configured", reason: "decrypt", lastError: "credential decrypt failed" });
      /* v2 密钥缓存未热是瞬态（预热在途）：1 秒短重试；真不可解（keychain 缺失等）维持低频 */
      st.nextAt = t + (v2KeyPending() ? 1000 : NOT_CONFIGURED_RETRY_MS);
      return false;
    }
    if (cred.fingerprint !== st.fingerprint) {
      st.fingerprint = cred.fingerprint;
      st.backoffIdx = 0;
      if (st.status === "auth_failed" || st.status === "no_plan" || (st.status === "unsupported" && st.reason === "gateway")) st.status = "idle";
      st.nextAt = 0;
    }
    if (!force && (st.status === "auth_failed" || st.status === "no_plan")) return false;
    /* 凭据刚就绪（钥匙串密钥到位、用户补了 key）：离开「未配置」，无论 token 是否临期——
     * 否则临期早退会把上一拍的 decrypt 失败状态原样留在面板上 */
    if (st.status === "not_configured") { st.status = "idle"; st.reason = ""; st.lastError = ""; }
    if (cred.source === "host" || cred.source === "env") {
      const exp = jwtExpMs(cred.token || "");
      if (exp && exp - t < EXP_SOON_MS) { st.nextAt = t + EXP_RETRY_MS; return false; }
    }
    st.cred = cred;
    startFetch(adapter, st);
    return true;
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
    let started = 0;
    void ensureDefaultV2Key();   // v2 密钥缓存预热：已缓存/在途时为廉价空转（memoize）
    const qOn = quotaOn();
    const set = activeSet();   // 撤销/禁用重评始终执行；额度关时只停联网查询
    if (qOn) for (const { a, st } of set.values()) if (tickSource(a, st, force)) started++;
    tickReset(force);
    return started;
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
    v.busy = !!st.inFlight;
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

  /* ---------- v135 重置卡轮询器（独立链，账号族级） ----------
   * 端点在 ZCode API 基址 zcode.z.ai（宿主 dn(env, `${bP}/status`) 同款，与 OAuth token
   * 端点同源；实测 bigmodel.cn/api.z.ai 均 404 NOT_FOUND）。两族只差 X-Bigmodel-Authorization
   * 的凭据键（oauth:bigmodel / oauth:zai），各自持 OAuth+zcodejwttoken 才查该族。
   * apiKey-only 用户无此数据（reset 端点是宿主登录态契约）；失败保留最近成功值由 view 标
   * stale（同额度链口径），绝不构造假数据。 */
  const RESET_ORIGIN = "https://zcode.z.ai";
  const RESET_LIST_ORIGIN = "https://bigmodel.cn";
  const RESET_FAMILIES = [
    { fam: "bigmodel", credKey: "oauth:bigmodel:access_token", listPath: "/api/biz/customer-package-reset/list?targetType=PERSONAL" },
    { fam: "zai", credKey: "oauth:zai:access_token" },
  ];
  const resetStates = new Map();
  function resetStateOf(fam) {
    let st = resetStates.get(fam);
    if (!st) {
      st = { status: "idle", value: null, fetchedAt: 0, listFetchedAt: 0, nextAt: 0, backoffIdx: 0,
        fingerprint: "", epoch: 0, inFlight: null, ctl: null, lastError: "" };
      resetStates.set(fam, st);
    }
    return st;
  }
  function resolveResetCred(famConf) {
    let raw = null;
    try { raw = j.readFile(j.credsPath); } catch (e) { return null; }
    const hit = hostCredDecrypt(raw, famConf.fam, famConf.credKey, j.env);   // 旧平铺键缺席回退新式登录态键（issue #391）
    if (!hit) return null;
    const oauthEnc = hit.enc;
    const oauth = hit.token;
    if (!oauth) return { decryptFailed: true, fingerprint: "host:" + sha16(oauthEnc) };
    if (!oauth.trim()) return null;
    const sel = teamSelectionOf(j, famConf.fam);
    if (sel) {
      /* 团队模式：targetType=TEAM 列表只认业务身份——业务 token + org/project，个人 zcodejwttoken 不参与 */
      return { oauth: oauth.trim(), team: sel,
        fingerprint: sha16(JSON.stringify([famConf.fam, sel.org, sel.project, oauthEnc])) };
    }
    const jwtEnc = raw["zcodejwttoken"];
    if (typeof jwtEnc !== "string" || !jwtEnc) return null;
    const jwt = decryptValue(jwtEnc, deriveCipherKey(j.env));
    if (!jwt || !jwt.trim()) return { decryptFailed: true, fingerprint: "host:" + sha16(oauthEnc + "\n" + jwtEnc) };
    return { oauth: oauth.trim(), jwt: jwt.trim(), fingerprint: sha16(JSON.stringify([oauthEnc, jwtEnc])) };
  }
  /* 关闭门控时清除整个独立链；view/sourcesConfig 不发回调，避免推送时递归。 */
  function resetGateOpen() {
    if (resetOn()) return true;
    for (const st of resetStates.values()) {
      st.epoch += 1;
      if (st.ctl) { try { st.ctl.abort(); } catch (e) { } }
    }
    resetStates.clear();
    return false;
  }
  /* 在推送前或发请求前复核凭据；身份变化时清除旧账户值并废弃在途结果。 */
  function syncResetCredential(st, cred) {
    const fingerprint = cred && !cred.decryptFailed && cred.oauth && (cred.jwt || cred.team) ? cred.fingerprint : "";
    const error = cred && cred.decryptFailed ? "credential decrypt failed" : "";
    if (fingerprint === st.fingerprint && (fingerprint || (st.status === "not_configured" && st.lastError === error))) return false;
    st.epoch += 1;
    if (st.ctl) { try { st.ctl.abort(); } catch (e) { } }
    Object.assign(st, { ctl: null, inFlight: null, value: null, fetchedAt: 0, listFetchedAt: 0,
      fingerprint, backoffIdx: 0, nextAt: 0, status: fingerprint ? "idle" : "not_configured", lastError: error });
    return true;
  }
  function tickReset(force) {
    if (!resetGateOpen()) return;
    const t = now();
    for (const famConf of RESET_FAMILIES) {
      if (!resetGateOpen()) return;
      const st = resetStateOf(famConf.fam);
      let cred = resolveResetCred(famConf);
      const changed = syncResetCredential(st, cred);
      if (changed && onUpdate) onUpdate();
      if (!resetGateOpen() || resetStates.get(famConf.fam) !== st) return;
      if (!st.fingerprint || st.inFlight) continue;
      if (changed && onUpdate) {   // 回调可能同步更换或撤销凭据
        cred = resolveResetCred(famConf);
        if (syncResetCredential(st, cred)) { onUpdate(); continue; }
      }
      if (!force && t < st.nextAt) continue;
      if (!force && st.status === "auth_failed") continue;
      if (!cred.team) {
        const exp = jwtExpMs(cred.jwt);
        if (exp && exp - t < EXP_SOON_MS) { st.nextAt = t + EXP_RETRY_MS; continue; }   // JWT 临期不发请求（个人链）
      }
      st.epoch += 1;
      const ep = st.epoch;
      const ctl = new AbortController();
      st.ctl = ctl;
      const kill = setTimeout(() => { try { ctl.abort(); } catch (e) { } }, FETCH_TIMEOUT_MS);
      if (kill && typeof kill.unref === "function") kill.unref();
      if (ctl.signal && typeof ctl.signal.addEventListener === "function") {
        ctl.signal.addEventListener("abort", () => clearTimeout(kill), { once: true });
      }
      let listAttempted = false;   // 个人链列表增强按 RESET_LIST_TTL_MS 计时（尝试即计时；v361 起独立计时，现与 status 同节奏）
      let listFailed = false;      // 本轮尝试了列表但未取到（传输失败/形状变化）：沿用旧 list 防天窗
      const p = (async () => {
        if (cred.team) {
          /* 团队模式：个人 reset/status 不适用，只打 targetType=TEAM 列表（成员可用的卡）。
           * 鉴权与配额链同款=项目 PAT（ensureTeamPat 换取并缓存）；值形与个人链对齐
           * （fiveHour/week 仅存未过期可用卡），供徽标同款消费。 */
          const pat = await ensureTeamPat(j, famConf.fam, cred.team, cred.oauth, ctl);
          const teamList = await j.http.getJson(RESET_LIST_ORIGIN + "/api/biz/customer-package-reset/list?targetType=TEAM", {
            authorization: pat,
            "Bigmodel-Organization": cred.team.org,
            "Bigmodel-Project": cred.team.project,
            "set-language": "zh",
          }, ctl);
          const parsed = normalizeResetList(teamList, now());
          if (!parsed || !parsed.list) throw qErr("parse_error", "invalid team reset list");
          const live = (cards) => (cards || []).filter((c) => c && c.available !== false &&
            typeof c.expireAt === "number" && c.expireAt > now()).map((c) => ({ expireAt: c.expireAt, grantType: c.grantType || "" }));
          return { fiveHour: live(parsed.list.fiveHour), week: live(parsed.list.weekly), list: parsed.list };
        }
        const body = await j.http.getJson(RESET_ORIGIN + RESET_PATH, {
          authorization: /^Bearer\s/i.test(cred.jwt) ? cred.jwt : "Bearer " + cred.jwt,
          "X-Bigmodel-Authorization": cred.oauth,   // 宿主契约：裸 token，不套 Bearer
          "Bigmodel-Target-Type": "PERSONAL",
        }, ctl);
        const value = normalizeResetStatus(body, now());
        if (famConf.listPath && resetListOn() &&
            (force || t - st.listFetchedAt >= RESET_LIST_TTL_MS)) {
          /* 网页控制台列表端点：补充近 7 天过期卡与上次重置时间（status 无过期历史）。
           * 与 subscription 同款可选并行——失败/形状变化静默降级，不影响 status 主链。
           * 列表与 status 同节奏（RESET_LIST_TTL_MS = RESET_TTL_MS，specs/reset-card-refresh.md）：
           * 徽标张数读 status、tooltip 明细读 list，status 到期重查的同一轮必打列表，两边同轮落库；
           * TTL 内的 poke 轮只刷 status，force 仍必打；团队分支不走这里（团队 list 就是主链）。 */
          listAttempted = true;
          const listBody = await j.http.maybeGetJson(RESET_LIST_ORIGIN + famConf.listPath,
            { authorization: cred.oauth, "set-language": "zh" }, ctl);
          const extra = listBody ? normalizeResetList(listBody, now()) : null;
          if (extra) {
            value.list = extra.list;
            if (extra.lastFiveHour) value.lastFiveHour = extra.lastFiveHour;
            if (extra.lastWeek) value.lastWeek = extra.lastWeek;
          } else {
            listFailed = true;
          }
        }
        return value;
      })().then((value) => {
        if (!resetGateOpen() || resetStates.get(famConf.fam) !== st || ep !== st.epoch) return;
        if (syncResetCredential(st, resolveResetCred(famConf))) { if (onUpdate) onUpdate(); return; }
        /* 列表增强按 RESET_LIST_TTL_MS 刷新：本轮未打列表（TTL 内 poke 轮）或尝试失败（listFailed）
         * 时沿用上一轮的 list/上次重置时间，否则这一轮 status 重查会把深度信息清掉，tooltip 开天窗；
         * 业务如实返回的空列表（extra 非 null）不沿用。仅限个人链——团队分支每轮 list 都是新鲜抓取
         * （listAttempted 恒 false），sticky 会把它冻结在首次抓取，tooltip 与 badge 张数从此不一致。 */
        if (!cred.team && (!listAttempted || listFailed) && st.value) {
          if (st.value.list) value.list = st.value.list;
          if (st.value.lastFiveHour) value.lastFiveHour = st.value.lastFiveHour;
          if (st.value.lastWeek) value.lastWeek = st.value.lastWeek;
        }
        st.value = value;
        /* 三个时刻同源：RESET_LIST_TTL_MS = RESET_TTL_MS 时「status 到期」恒推出「列表到期」；
         * 分两次取时钟会在边界毫秒上让列表隔一轮（tick 恰等于 nextAt 而 listFetchedAt 晚 1ms）。 */
        const doneAt = now();
        st.fetchedAt = doneAt;
        st.status = "ok";
        st.lastError = "";
        st.backoffIdx = 0;
        st.nextAt = doneAt + RESET_TTL_MS;
        if (listAttempted) st.listFetchedAt = doneAt;
      }).catch((e) => {
        if (!resetGateOpen() || resetStates.get(famConf.fam) !== st || ep !== st.epoch) return;
        if (syncResetCredential(st, resolveResetCred(famConf))) { if (onUpdate) onUpdate(); return; }
        const code = e && e.code || "network_error";
        st.lastError = String(e && e.message || code).slice(0, 120);
        st.status = code;
        if (code === "auth_failed") st.nextAt = Infinity;   // 冻结到凭据指纹变化
        else if (code === "parse_error") st.nextAt = now() + RESET_PARSE_BACKOFF_MS;
        else if (code === "rate_limited") st.nextAt = now() + (e.retryAfterMs || 60 * 1000);
        else st.nextAt = now() + BACKOFF_MS[Math.min(st.backoffIdx++, BACKOFF_MS.length - 1)];
        log("quota reset:", famConf.fam, code, st.lastError);
      }).finally(() => {
        clearTimeout(kill);
        if (!resetGateOpen() || resetStates.get(famConf.fam) !== st || st.inFlight !== p) return;
        st.inFlight = null;
        st.ctl = null;
        if (onUpdate) onUpdate();
      });
      st.inFlight = p;
    }
  }
  /* v361 事件触发的软强刷：渲染端在窗口恢复可见/悬停重置卡徽标时发 quota-poke。
   * 与 force（chip 点击 refresh()）不同——只唤醒处于 ok 态且数据已旧于 RESET_POKE_GAP_MS
   * 的族（置 nextAt=0 借 tickReset 既有守卫拉新）：失败态（网络退避/rate retry-after/
   * parse 15min）与 auth 冻结族一律不唤醒，退避与冻结语义完全不被事件越过；未首发族
   * （idle，nextAt 本就是 0）也交给泵 tick，不占 poke 名额。返回实际唤醒的族数（门控关闭=0）。 */
  function pokeReset() {
    if (!resetGateOpen()) return 0;
    const t = now();
    let poked = 0;
    for (const st of resetStates.values()) {
      if (st.status !== "ok") continue;
      if (!st.fingerprint || st.inFlight) continue;   // ok 态下 fingerprint 必非空：纵深防御，防后续守卫组合演化漏保护
      if (t - st.fetchedAt < RESET_POKE_GAP_MS) continue;
      st.nextAt = 0;
      poked += 1;
    }
    if (poked) tickReset(false);
    return poked;
  }

  const client = {
    tick,
    refresh() { v2KeyRetryNow(); return tick(true) > 0; },   // 用户显式刷新：越过 v2 密钥冷却/失配限频
    pokeReset,
    /* 千问设备码登录（issue #399）：saveSecrets 由注入侧传入（writeQuotaSecrets），
     * 登录完成持久化并触发 credentialsChanged 解冻；未传（旧装配/测试）时 start 报不可用。 */
    qianwenSignInStart: () => Promise.resolve({ ok: false, error: "sign-in unavailable" }),
    qianwenSignInState: () => ({ ok: false, error: "sign-in unavailable" }),
    qianwenSignInCancel: () => { },
    refreshSource(id) {   // 厂商按钮刷新该厂商各账户；chip 的完整源 id 只刷新本账户
      const a = adapterOf(id);
      if (!a) return false;
      v2KeyRetryNow();
      let started = false;
      if (String(id).indexOf(":") >= 0) {
        const st = states.get(id);
        if (st) started = tickSource(a, st, true);
      } else {
        for (const st of states.values()) if (adapterOf(st.id) === a) started = tickSource(a, st, true) || started;
      }
      return started;
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
    credentialsChanged() {   // 凭据文件/配置变更（主桥 fs.watch 等）：v2 密钥也可能换了，允许马上重取
      v2KeyRetryNow();
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
      if (resetGateOpen()) for (const famConf of RESET_FAMILIES) {
        const st = resetStates.get(famConf.fam);
        if (!st) continue;
        if (!syncResetCredential(st, resolveResetCred(famConf)) &&
            (st.nextAt === Infinity || st.status === "not_configured")) st.nextAt = 0;
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
      if (resetGateOpen()) {   // v135：重置卡独立字段（关开关不暴露旧值，fail-closed）
        const t = now(), resets = {};
        for (const famConf of RESET_FAMILIES) {
          const fam = famConf.fam, st = resetStates.get(fam);
          if (!st) continue;
          syncResetCredential(st, resolveResetCred(famConf));
          resets[fam] = Object.assign({
            status: st.status, fetchedAt: st.fetchedAt,
            stale: !!(st.fetchedAt && t - st.fetchedAt > RESET_TTL_MS),
            error: st.lastError, busy: !!st.inFlight,
          }, st.value || {});
        }
        out.resets = resets;
      }
      return out;
    },
    sourcesConfig() {   // ⚙ 面板数据源列表（不回显凭据值）
      resetGateOpen();   // 宿主切换开关时先广播设置，及时中止关闭的 reset 链
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
          credentialFields: a.id === "mimo" ? ["cookie"] : a.id === "volcano" ? ["accessKeyId", "secretAccessKey"] : a.id === "scnet" ? ["planCredits", "planStart"] : (a.id === "anthropic" || a.id === "qianwen") ? ["token"] : ["apiKey"],
          keyConfigured: !!(cfg.apiKey || cfg.cookie || cfg.token || cfg.accessKeyId ||
            accounts.some((entry) => !!entry.cred) || (a.id === "scnet" && num(cfg.planCredits) > 0)),
          keySource: st && st.cred ? st.cred.source : "",
          /* v104：显式关闭的源统一报 disabled（与 entryView 同口径）——原样透传 st.status 时
           * 从未激活过的关闭源会冒充 idle，面板出现「开关已关却显示待查询」的矛盾 */
          status: cfg.enabled === false ? "disabled" : (st ? st.status : "idle"),
          busy: cfg.enabled !== false && accounts.some((entry) => !!entry.inFlight),
          fetchedAt: st ? st.fetchedAt : 0,
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
      client.disposeQianwenFlow();   // 千问登录流随实例销毁（在途轮询按 gen 自弃）
      for (const st of states.values()) {
        if (st.ctl) { try { st.ctl.abort(); } catch (e) { } }
        st.inFlight = null;
      }
      for (const st of resetStates.values()) {
        st.epoch += 1;
        if (st.ctl) { try { st.ctl.abort(); } catch (e) { } }
        st.inFlight = null;
      }
    },
    get _state() { return states.get(primaryId) || states.get("custom") || {}; },   // 测试接缝兼容（v96 单源形状）
    _states: states,
    _adapters: ADAPTERS,
  };
  installQianwenFlow(client, j, o);   // 覆写上面的 no-op 缺省：真登录流绑定本实例的 http 与 saveSecrets
  return client;
}

module.exports = {
  createQuotaClient,
  resolveQuotaPaths,
  resolveCustomProvider,
  decryptValue,
  deriveCipherKey,
  hostCredDecrypt,   // issue #393：model-puller 套餐 token 目录同走键名代际回退单一实现
  makeHostDecryptor,
  setDefaultDecryptCtx,
  ensureDefaultV2Key,
  v2KeyPending,
  v2KeyRetryNow,
  jwtExpMs,
  normalizeQuotaBody,
  normalizeZcodeStartBalance,
  normalizeResetStatus,
  normalizeResetList,
  normalizeSubscriptionPlan,
  normalizeSub2api,
  normalizeR4,
  normalizeOllama,
  normalizeStepfun,
  relayQuotaUrls,
  isNoPlanMessage,
  normalizeMimoCookie,
  parseCurrencyAmount,
  collectWindows,
  resolveWanted(providerId) {   // v96 兼容导出（单测在用）：内置 family 判定
    const p = String(providerId || "");
    if (apiKeyFamilyOf(p)) return { family: apiKeyFamilyOf(p) };
    if (p.indexOf("account:") !== 0) return null;
    const teamFam = teamFamilyOf(p);
    if (teamFam) return { family: teamFam, team: true };
    if (zcodeStartDetectOf(p)) return { family: "zcode-start" };
    if (p.indexOf("account:bigmodel") === 0) return { family: "bigmodel" };
    if (p.indexOf("account:zai") === 0) return { family: "zai" };
    return null;
  },
  TTL_MS,
  RESET_TTL_MS,
  RESET_LIST_TTL_MS,
  RESET_POKE_GAP_MS,
};
