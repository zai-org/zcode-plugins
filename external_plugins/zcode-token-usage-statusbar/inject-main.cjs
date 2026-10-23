/* ZCode token 用量注入 loader v2（主进程）。
 * 由 patch_install.py 在 app.asar 入口尾部追加一行 import 引入。
 * 职责：1) 向每个窗口注入 turn-stats.js + overlay.js（前者先注入：renderer 会话
 *          store 的只读投影统计，overlay 读 globalThis.ZUsageTurnStats；mtime 热更新）；
 *       2) 触发式拉取：fs.watch 监听 db 目录，db.sqlite/-wal 一有写入（去抖 300ms）就
 *          查询并推送。限频 config.activity_min_ms（默认 1500ms），限频到点
 *          自动补拉，最后一笔写入不漏；完全空闲时零进程零轮询，仅兜底心跳
 *          （config.heartbeat_ms，默认 30s）防文件事件丢失（Node 官方文档：fs.watch
 *          事件不保证送达）。任何失败只打日志，不影响客户端。
 *       3) 每窗口当前会话（v6）：渲染端 workspace shell 把焦点会话 id 经 IPC
 *          "zcode:sync-active-task-session" 推给主进程（客户端自带通道，实测见 app bundle），
 *          这里追加监听记录 webContents.id → 会话 id：查询时把全部窗口的会话强制纳入快照，
 *          推送时给每个窗口注入 mine 字段 —— 多窗口各自显示自己的会话，不再猜"全局最近活跃"。 *
 *  v8：查询改常驻 python（zusage.py serve，stdin/stdout 行协议）——省每次 ~60-100ms 的
 *      解释器启动费；意外退出自动重启（30s 内连续 3 次判不稳定则回退一次性 spawn）；
 *      zusage.py mtime 变化自动重启（升级生效）；stdin EOF = 泵退出，常驻进程自清理。 */
"use strict";
const path = require("path");
const fs = require("fs");
const { spawn, execFile } = require("child_process");
const { createHash } = require("crypto");
const { app, BrowserWindow, webContents } = require("electron");
const { fileURLToPath } = require("url");

const HERE = __dirname;   // 本 loader 被 asar 注入行按绝对 file:// URL import，__dirname 即真实目录（克隆到任意路径无需改代码）
const CONFIG = path.join(HERE, "config.json");
const OVERLAY = path.join(HERE, "overlay.js");
const TURN_STATS = path.join(HERE, "turn-stats.js");
const ZUSAGE = path.join(HERE, "zusage.py");
const TOKEN_RATE = path.join(HERE, "token_rate.py");
const LOG = (...a) => console.error("[zusage]", ...a);
const loadedHashes = { _loadedAt: Date.now() - process.uptime() * 1000 };
for (const name of ["inject-main.cjs", "plugin-updater.cjs", "plugin-release.cjs", "plugin-storage.cjs", "quota-client.cjs", "overlay.js", "zusage.py"]) {
  try { loadedHashes[name] = createHash("sha256").update(fs.readFileSync(path.join(HERE, name))).digest("hex"); }
  catch (e) { LOG("startup fingerprint unavailable:", name, e.message); }
}
function acknowledgeRestart() {
  const helper = path.join(HERE, "runtime_lock.py");
  if (!fs.existsSync(helper)) return;
  execFile(readCfg().python_path || (process.platform === "win32" ? "python" : "python3"),
    [helper, "--ack-restart", HERE, JSON.stringify(loadedHashes)],
    { windowsHide: true, timeout: 15000, maxBuffer: 65536 },
    (error) => { if (error) LOG("restart acknowledgement failed:", error.message); });
}

function readCfg() {
  const c = { resident: true };
  try { Object.assign(c, JSON.parse(fs.readFileSync(CONFIG, "utf8"))); } catch (e) { }
  /* 缺省/空值统一按平台定解释器：Windows 无 python3，macOS/Linux 未必有 python；
     三个 spawn 点直接读 python_path，归一只能在这里做 */
  c.python_path = c.python_path || (process.platform === "win32" ? "python" : "python3");
  return c;
}

/* config.json 内容缓存：热更新定时器每 2s 触发，改为 stat mtime 判变化后才读文件 */
let cfgMtime = 0;
let cfgCache = null;
function readCfgCached() {
  let m = 0;
  try { m = fs.statSync(CONFIG).mtimeMs; } catch (e) { }
  if (!cfgCache || m !== cfgMtime) {
    cfgMtime = m;
    cfgCache = readCfg();
  }
  return cfgCache;
}

/* 页面注入源 + 热更新：mtime 变了就重注入（移除旧条+复位守卫）。
 * 载入前用 new Function 校验语法，避免把写到一半的文件载入页面。
 * turn-stats.js（renderer 会话 store 的只读投影统计）必须先于 overlay.js 注入：
 * overlay 启动时读 globalThis.ZUsageTurnStats。两资产任一 mtime 变化即整体重注入；
 * 都不变时零动作（overlay 无需重建）。 */
function loadValidatedAsset(file) {
  try {
    const m = fs.statSync(file).mtimeMs;
    const src = fs.readFileSync(file, "utf8");
    new Function(src);
    return { mtime: m, src: src };
  } catch (e) { return null; }
}
let overlaySrc = "";
let overlayMtime = 0;
let turnStatsSrc = "";
let turnStatsMtime = 0;
{
  const ov = loadValidatedAsset(OVERLAY);
  if (ov) { overlaySrc = ov.src; overlayMtime = ov.mtime; }
  else LOG("overlay.js missing");
  const ts = loadValidatedAsset(TURN_STATS);
  if (ts) { turnStatsSrc = ts.src; turnStatsMtime = ts.mtime; }
  else LOG("turn-stats.js missing (live/deterministic stats disabled)");
}

function hotReloadIfChanged() {
  let changed = false;
  for (const asset of [{ file: TURN_STATS, srcKey: "turnStats" }, { file: OVERLAY, srcKey: "overlay" }]) {
    let m = 0;
    try { m = fs.statSync(asset.file).mtimeMs; } catch (e) { continue; }
    const known = asset.srcKey === "turnStats" ? turnStatsMtime : overlayMtime;
    if (m === known) continue;   // mtime 未变：不读文件（每 2s 心跳零读盘）
    const loaded = loadValidatedAsset(asset.file);
    if (!loaded) continue;       // 语法没写完：保留旧 mtime，下轮重试
    if (asset.srcKey === "turnStats") { turnStatsMtime = loaded.mtime; turnStatsSrc = loaded.src; }
    else { overlayMtime = loaded.mtime; overlaySrc = loaded.src; }
    changed = true;
  }
  if (!changed) return;
  LOG("overlay assets changed, hot-reloading");
  for (const wc of webContents.getAllWebContents()) {
    if (!isMainWindowState(wc) || wc.isDestroyed()) continue;
    injectOverlay(wc, true);
  }
}

function isMainWindowState(wc) {
  try { return wc.getType() === "window"; } catch (e) { return false; }
}

function pushOnce(wc, payload) {
  if (!isMainWindowState(wc) || wc.isDestroyed() || !payload || typeof payload !== "object") return;
  /* 按窗口注入 mine（本窗口焦点会话 id，可为空串 = 该窗口当前无会话）：
   * overlay 收到 mine 字段就优先显示它，不再多窗口共享同一个猜测。
   * 必须对象合并后序列化，禁止对 JSON 字符串做括号手术——v34 首版 slice 掐尾少补一个
   * 右括号，生成语法错误代码且失败只进静默 catch，全部窗口停在初始零值（实测翻车）。 */
  const obj = Object.assign({}, payload, {
    ...(activeSid.has(wc.id) ? { mine: activeSid.get(wc.id) || "" } : {}),
    scope_bindings: scopeBindings.get(wc.id) || {},
    /* 未收集过按“可能有远端”处理（保守 fail-closed）；收集后无任何远端证据才是 false。 */
    remote_evidence: remoteEvidence.get(wc.id) !== false,
  });
  /* U+2028/2029 转义：JSON.stringify 会输出裸字符，放进 executeJavaScript 字符串字面量
   * 有语法风险（zusage.py 侧 ensure_ascii 的同款考量；会话标题可能含任意文本） */
  const js = `window.__zusageUpdate && window.__zusageUpdate(${JSON.stringify(obj).replace(/[\u2028\u2029]/g, (c) => c === "\u2028" ? "\\u2028" : "\\u2029")})`;
  wc.executeJavaScript(js, true).catch(() => { });
}

/* 每窗口焦点会话：客户端渲染端把 activeTaskId 经此通道同步给主进程（CUA PiP 所用通道），
 * 追加监听器不影响原有处理。值为 "" = 窗口已同步但当前无会话（新空会话/非任务页）；
 * 不在表里 = 该窗口从未同步（辅助窗口），推送时不带 mine，overlay 走本地键启发式。 */
const IPC_ACTIVE_SID = "zcode:sync-active-task-session";
const activeSid = new Map();   // webContents.id → 会话 id 或 ""
const windowWorkspaces = new Map();
const windowTasks = new Map();
const scopeBindings = new Map();
const windowQuotaSelections = new Map();   // webContents.id → {paneId: {sid, providerId, modelId}}
/* 本窗是否出现过任何远端工作区/任务证据：issue #40 的无桥本地兜底只在确认
 * “本窗只能查本地”时启用，有远端证据时 overlay 仍 fail-closed。 */
const remoteEvidence = new Map();
/* 可信远端身份白名单：ssh（3.15.x）/ wsl、docker（直接传输）/ server（v3.16 起所有传输
 * 连接握手后统一升级为 remote:server:<serverId>:<path>，remote:wsl: 等只留作 legacy）。
 * 前缀只决定“是否远端”，路由键是整串身份；未知前缀仍 fail-closed 按本地处理。 */
const REMOTE_IDENTITY_RE = /^remote:(?:ssh|wsl|docker|server):/;
function trustedSender(e) {
  try {
    if (!e || !e.sender || e.sender.isDestroyed() || !isMainWindowState(e.sender)) return false;
    const url = e.sender.getURL();
    if (!url.startsWith("file:")) return false;
    const relative = path.relative(process.resourcesPath, fileURLToPath(url));
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch (e) { return false; }
}
try {
  const { ipcMain } = require("electron");
  // 只旁听宿主公开的单向同步，不读取凭据或 Electron 私有 handler 状态。
  ipcMain.on("zcode:sync-web-remote-control-workspaces", (e, rows) => {
    if (!trustedSender(e) || !Array.isArray(rows)) return;
    const normalized = rows.filter((r) => r && typeof r.workspacePath === "string")
      .map((r) => ({ kind: r.kind, identity: typeof r.workspaceIdentity === "string" ? r.workspaceIdentity.trim() : "" }));
    windowWorkspaces.set(e.sender.id, normalized);
    /* 远端证据立即生效：不等下一轮 wants 收集，缩小“查询在途时推送旧 false”的窗口。 */
    if (normalized.some((r) => r.kind === "remote" && REMOTE_IDENTITY_RE.test(r.identity))) {
      remoteEvidence.set(e.sender.id, true);
    }
    scheduleRetry(300);
  });
  ipcMain.on("zcode:sync-web-remote-control-tasks", (e, rows) => {
    if (!trustedSender(e) || !Array.isArray(rows)) return;
    const tasks = new Map();
    for (const r of rows) {
      if (!r || typeof r.taskId !== "string") continue;
      const identity = r.workspaceKind === "remote" && typeof r.workspaceIdentity === "string" ? r.workspaceIdentity.trim() : "";
      if (!tasks.has(r.taskId)) tasks.set(r.taskId, new Set());
      tasks.get(r.taskId).add(identity);
    }
    windowTasks.set(e.sender.id, tasks);
    let remoteTask = false;
    for (const scopes of tasks.values()) {
      if ([...scopes].some((id) => REMOTE_IDENTITY_RE.test(id))) { remoteTask = true; break; }
    }
    if (remoteTask) remoteEvidence.set(e.sender.id, true);
    scheduleRetry(300);
  });
  ipcMain.on(IPC_ACTIVE_SID, (e, sid) => {
    if (!e || !e.sender || e.sender.isDestroyed()) return;
    const s = typeof sid === "string" ? sid.trim() : "";
    const val = s && s.length <= 255 && /^[A-Za-z0-9_-]+$/.test(s) ? s : "";
    const prev = activeSid.get(e.sender.id);
    activeSid.set(e.sender.id, val);
    if (prev !== val) scheduleRetry(800);   // 会话切换/窗口就绪：尽快按新会话拉一次（限频器仍生效）
  });
} catch (e) { LOG("ipc hook failed:", e.message); }

/* db 活动戳：db.sqlite / -wal / -shm 的最新 mtime。WAL 模式下写入主要落在 -wal。 */
let DB_DIR = null;
function dbDir() {
  if (!DB_DIR) DB_DIR = path.join(app.getPath("home"), ".zcode", "cli", "db");
  return DB_DIR;
}
function dbStamp() {
  let m = 0;
  const dir = dbDir();
  for (const f of ["db.sqlite", "db.sqlite-wal", "db.sqlite-shm"]) {
    try { m = Math.max(m, fs.statSync(path.join(dir, f)).mtimeMs); } catch (e) { }
  }
  return m;
}

/* 远端状态按 (sid, workspaceIdentity) 隔离；显式可信 scope 首查失败也续查。
 * 请求直接携带 identity，不依赖上一份 payload 的临时目标序号。
 * 最后成功 remote 标记保留 10 分钟，pending 保证失败后持续恢复。 */
const REMOTE_STICKY_MS = 10 * 60 * 1000;
const remoteSids = new Map();      // sid → lastSeen ms
const pendingSids = new Map();     // sid → next attempt ms
let targetByIdentity = new Map();  // workspaceIdentity → 目标键（最近一次 payload）
function isRemoteSid(s) {
  const t = remoteSids.get(s);
  if (t === undefined) return false;
  if (Date.now() - t > REMOTE_STICKY_MS) { remoteSids.delete(s); return false; }
  return true;
}
function remotePollMs() {
  const r = readCfgCached().remote;
  return Math.max(1000, (r && r.poll_ms | 0) || 3000);
}

let busy = false;
let pushCount = 0;
let lastSpawn = 0;    // 上次发起查询时刻（activity_min_ms 限频用）
let lastStamp = 0;    // 上次拉取时的 db mtime（去重：无新写入不拉）
let lastWants = "";   // 上次查询用的会话 id 集合（变化即拉，防"会话切了但 db 没写入"滞留旧数据）
let lastRequest = { sids: [], scopes: [] };
let lastSourceStamp = "";
function scopeKey(sid, identity) { return JSON.stringify([sid, identity || ""]); }
function requestKeys(request) {
  return request.sids.map((sid) => scopeKey(sid, "")).concat(request.scopes.map((s) => scopeKey(s.sid, s.workspaceIdentity)));
}
function sourceStamp() {
  const home = (process.env && process.env.ZCODE_DESKTOP_HOME_DIR) || app.getPath("home");
  const files = [CONFIG, path.join(home, ".zcode", "v2", "setting.json")];
  return files.map((file) => { try { const s = fs.statSync(file); return `${s.mtimeMs}:${s.size}`; } catch (e) { return "missing"; } }).join("|");
}
let lastHadRemote = false;

function remoteDisabled() {
  const remote = readCfgCached().remote || {};
  return remote.auto === false && remote.enabled === false;
}
/* v96 额度开关真值：config.json 的 quota_enabled（缺省关）。只认显式 true——读凭据联网
 * 属能力升级，缺字段/异常值一律按关闭处理，主进程不解密、不发请求。 */
function quotaEnabled() { return readCfgCached().quota_enabled === true; }
function clearRemoteRecovery() {
  remoteSids.clear();
  pendingSids.clear();
  lastHadRemote = false;
  clearTimeout(retryTimer);
  retryTimer = 0;
}
function syncQuotaProviders() {
  if (shuttingDown || !quotaClient || !quotaEnabled()) return;
  const providers = new Set();
  let hasSelections = false, hasWindow = false;
  for (const wc of webContents.getAllWebContents()) {
    if (!isMainWindowState(wc) || wc.isDestroyed()) continue;
    hasWindow = true;
    if (windowQuotaSelections.has(wc.id)) hasSelections = true;
    for (const sel of Object.values(windowQuotaSelections.get(wc.id) || {})) {
      if (sel.providerId) providers.add(sel.providerId);
    }
  }
  if (hasWindow && !hasSelections && lastGoodPayload) {   // 旧渲染器未上报时，按各会话最近完成请求兼容
    for (const row of [lastGoodPayload.session, ...(lastGoodPayload.recent || [])]) {
      const id = row && row.last && row.last.provider_id;
      if (id) providers.add(id);
    }
  }
  quotaClient.setProviders(Array.from(providers));
  if (hasWindow) quotaClient.tick();
}
function handleQuotaProviders(wc, req) {
  const raw = req.panes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const entries = Object.entries(raw);
  if (entries.length > 4) return;
  const panes = Object.create(null);
  const valid = (v, max) => typeof v === "string" && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
  for (const [pid, sel] of entries) {
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(pid) || !sel || typeof sel !== "object" ||
        !valid(sel.sid, 80) || !valid(sel.providerId, 160) || !valid(sel.modelId, 160) ||
        (sel.sid && !/^[A-Za-z0-9_-]+$/.test(sel.sid))) return;
    panes[pid] = { sid: sel.sid, providerId: sel.providerId, modelId: sel.modelId };
  }
  windowQuotaSelections.set(wc.id, panes);   // 全量替换：关 pane/导航后旧选择不会残留
  syncQuotaProviders();
  if (lastGoodPayload && quotaClient && quotaEnabled()) {
    const payload = Object.assign({}, lastGoodPayload, { quota: quotaClient.view() });
    for (const target of webContents.getAllWebContents()) pushOnce(target, payload);
  }
}
function handlePayload(payload) {
  const disabled = remoteDisabled();
  if (disabled) clearRemoteRecovery();
  // serve 的 error 是查询失败，不是空快照；不可清掉重试状态和最后成功数据显示。
  if (!payload || typeof payload !== "object" || payload.error) return;
  lastGoodPayload = payload;
  if (quotaClient && quotaEnabled()) {
    if (payload.scnet_estimate !== undefined) quotaClient.noteSnapshotExtras({ scnet: payload.scnet_estimate });
    syncQuotaProviders();
    payload = Object.assign({}, payload, { quota: quotaClient.view() });
  }
  const now = Date.now();
  const marks = new Set();
  for (const r of (payload.recent || [])) if (r && r.remote && r.sid && !r.remote_error && !r.remote_missing) {
    const key = scopeKey(r.sid, r.workspace_identity);
    marks.add(key);
    remoteSids.set(key, now);
  }
  const idents = new Map();
  for (const t of (payload.remote_targets || [])) {
    if (!t || !t.key) continue;
    for (const id of (t.identities || [])) if (id) idents.set(String(id), String(t.key));
  }
  targetByIdentity = idents;
  const notLocal = new Set(Array.isArray(payload.not_local) ? payload.not_local : []);
  const poll = remotePollMs();
  const keys = requestKeys(lastRequest);
  for (const key of keys) {
    const [sid, identity] = JSON.parse(key);
    if (marks.has(key)) { pendingSids.delete(key); continue; }
    const remote = readCfgCached().remote || {};
    if (identity && !(remote.auto === false && remote.enabled === false) || (notLocal.has(sid) && payload.remote_enabled && remote.enabled === true)) pendingSids.set(key, now + poll);
    else { pendingSids.delete(key); remoteSids.delete(key); }
  }
  for (const key of pendingSids.keys()) if (!keys.includes(key)) pendingSids.delete(key);
  if (disabled) clearRemoteRecovery(); // 关闭期间返回的迟到成功快照也不能重建粘性标记。
  else lastHadRemote = keys.some((key) => isRemoteSid(key) || pendingSids.has(key));
  for (const wc of webContents.getAllWebContents()) pushOnce(wc, payload);
  // 定位诊断：每 ~15 次拉取收集每个窗口各自的 __zusageDiag，附加泵侧证据后写 diag-<n>.json（多窗口互不覆盖）
  if (++pushCount % 15 === 1) {
    let idx = 0;
    for (const wc of webContents.getAllWebContents()) {
      if (!isMainWindowState(wc) || wc.isDestroyed()) continue;
      const file = path.join(HERE, "diag-" + idx + ".json");
      idx++;
      wc.executeJavaScript("JSON.stringify(window.__zusageDiag||null)", true)
        .then((s) => {
          if (s && s !== "null") {
            try {
              const obj = JSON.parse(s);
              obj.pump = {
                version: 10,
                resident: !!pyRes,
                activeMap: Array.from(activeSid.entries()).slice(0, 12),
                wants: lastWants,
              };
              fs.writeFileSync(file, JSON.stringify(obj));
            } catch (e2) {
              try { fs.writeFileSync(file, s); } catch (e) { }
            }
          }
        })
        .catch(() => { });
    }
  }
}

/* ---------- 常驻查询进程（v8）：zusage.py serve，stdin 请求行 / stdout 响应行 ---------- */
let pyRes = null;        // { proc, buf, waiters: [fn], born }
let pyFail = 0;          // 启动 30s 内退出次数（>=3 判不稳定，回退一次性 spawn）
let pyBackoff = 1000;
let residentRestartTimer = 0, residentIdleTimer = 0;
let shuttingDown = false;
function hasWindows() {
  return webContents.getAllWebContents().some((wc) => isMainWindowState(wc) && !wc.isDestroyed());
}
function residentAllowed() {
  return !shuttingDown && readCfgCached().resident !== false && pyFail < 3 && hasWindows();
}
function stopResident(restart = false) {
  clearTimeout(residentRestartTimer);
  clearTimeout(residentIdleTimer);
  const state = pyRes;
  if (!state) return;
  state.intentional = true;
  state.restart = restart;
  try { state.proc.kill(); } catch (e) { }
  state.finish();
}
function armResidentIdle() {
  clearTimeout(residentIdleTimer);
  if (pyRes) residentIdleTimer = setTimeout(() => stopResident(), 30000);
}
function startResident() {
  if (pyRes || !residentAllowed()) return;
  let proc;
  try { proc = spawn(readCfgCached().python_path, [ZUSAGE, "serve"], { windowsHide: true }); }
  catch (e) { LOG("resident spawn failed:", e.message); pyFail++; return; }
  const state = { proc, buf: "", waiters: [], born: Date.now(), finished: false, intentional: false, restart: false };
  pyRes = state;
  LOG("resident python starting");
  state.finish = () => {
    if (state.finished) return;
    state.finished = true;
    if (pyRes === state) pyRes = null;
    clearTimeout(residentIdleTimer);
    const pending = state.waiters;
    state.waiters = [];
    pending.forEach((w) => w(null));
    if (state.intentional) {
      if (state.restart && residentAllowed()) residentRestartTimer = setTimeout(startResident, 0);
      return;
    }
    if (Date.now() - state.born < 30000) {
      pyFail++;
      if (pyFail >= 3) { LOG("resident unstable (3 early exits), fallback to one-shot spawn"); return; }
      if (residentAllowed()) residentRestartTimer = setTimeout(startResident, pyBackoff);
      pyBackoff = Math.min(pyBackoff * 2, 30000);
    } else {
      pyFail = 0;
      pyBackoff = 1000;
      if (residentAllowed()) residentRestartTimer = setTimeout(startResident, 0);
    }
  };
  const fail = (e) => {
    LOG("resident failed:", e.message);
    try { proc.kill(); } catch (e2) { }
    state.finish();
  };
  proc.on("error", fail);
  proc.stdin.on("error", fail);
  proc.on("close", state.finish);
  proc.stdout.on("data", (d) => {
    if (state.finished) return;
    state.buf += d.toString("utf8");
    let i;
    while ((i = state.buf.indexOf("\n")) >= 0) {
      const line = state.buf.slice(0, i);
      state.buf = state.buf.slice(i + 1);
      const w = state.waiters.shift();
      if (!w) continue;
      let payload = null;
      try { payload = JSON.parse(line); } catch (e) { }
      w(payload);
    }
  });
  proc.stderr.on("data", () => { });
  armResidentIdle();
  /* 进程级错误处理在 startResident 体内统一走 fail/close（state.finish 带退避重启与
   * intentional 标记），main 侧旧版分段处理不再需要 */
}
function killResidentForUpgrade() { stopResident(true); }

/* 统一查询入口：resident 可用走 JSON 行协议（scopes 路由请求），否则一次性 spawn。
 * 每笔请求只结算一次；error 载荷转 pendingSids 由远端重试链兜底。 */
function runQuery(request) {
  busy = true;
  let settled = false;
  const done = (payload) => {
    if (settled) return;
    settled = true;
    busy = false;
    const keys = requestKeys(request);
    if (payload && !payload.error) {
      if (!shuttingDown && hasWindows()) handlePayload(payload);
    } else if (remoteDisabled()) {
      clearRemoteRecovery();
    } else {
      for (const key of keys) pendingSids.set(key, Date.now() + remotePollMs());
      lastHadRemote = keys.length > 0;
    }
    if (!shuttingDown && lastHadRemote && hasWindows()) scheduleRetry(remotePollMs());
    armResidentIdle();
  };
  const line = JSON.stringify(request);
  if (residentAllowed()) {
    clearTimeout(residentRestartTimer);
    if (!pyRes) startResident();
    if (pyRes && pyRes.proc.stdin.writable) {
      clearTimeout(residentIdleTimer);
      const state = pyRes;
      const waiter = (payload) => { clearTimeout(timer); done(payload); };
      const timer = setTimeout(() => {
        LOG("resident query timeout, restarting it");
        stopResident(true);
      }, 15000);
      state.waiters.push(waiter);
      try {
        state.proc.stdin.write(line + "\n", (error) => {
          if (error && !state.finished) {
            LOG("resident write failed:", error.message);
            try { state.proc.kill(); } catch (e) { }
            state.finish();
          }
        });
      } catch (e) {
        LOG("resident write failed:", e.message);
        try { state.proc.kill(); } catch (e2) { }
        state.finish();
      }
      return;
    }
  }
  legacySpawn(line, done);
}

/* 回退路径：沿用同款 JSON scope 请求（resident=false 不丢隔离），error/close/timeout 共用单次结算。 */
function legacySpawn(line, done) {
  const args = [ZUSAGE, "json"];
  if (line) args.push(line);
  let py;
  try { py = spawn(readCfgCached().python_path, args, { windowsHide: true }); }
  catch (e) { LOG("spawn failed:", e.message); done(null); return; }
  let out = "", finished = false;
  const finish = (payload) => {
    if (finished) return;
    finished = true;
    clearTimeout(killTimer);
    done(payload);
  };
  const killTimer = setTimeout(() => {
    LOG("query timeout, killing");
    try { py.kill(); } catch (e) { }
    finish(null);
  }, 15000);
  py.stdout.on("data", (d) => { out += d; });
  py.stderr.on("data", () => { });
  py.on("error", (e) => { LOG("spawn failed:", e.message); finish(null); });
  py.on("close", () => {
    let payload = null;
    try { payload = JSON.parse(out); } catch (e) { }
    finish(payload);
  });
}

/* 触发式拉取：db 有新写入（mtime 变化）才 spawn 查询；限频不满足时安排补拉，
 * 保证限频窗口结束后最后一笔写入的数据一定被取到。 */
let retryTimer = 0;
function scheduleRetry(ms) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(maybeSpawn, ms);
}
let collectingWants = false;
function maybeSpawn() {
  if (shuttingDown) return;
  if (!hasWindows()) {
    clearTimeout(retryTimer);
    lastHadRemote = false;
    stopResident();
    activeSid.clear();
    lastWants = "";
    lastStamp = 0;
    return;
  }
  if (busy || collectingWants) { scheduleRetry(300); return; }
  const st = dbStamp();
  const cfg = readCfgCached();
  if (remoteDisabled()) clearRemoteRecovery();
  const wait = Math.max(300, cfg.activity_min_ms | 0 || 1500);
  /* 先取各窗口的"当前会话 id"：主进程 IPC 映射（应用自己上报的焦点会话，v6）优先，
   * overlay 从 localStorage 键读出的 __zusageWantSid 兜底；无窗口时直接短路（空闲零进程的
   * 设计意图）；executeJavaScript 挂 1s 超时，防渲染进程卡死导致泵永不 settle。
   * v8：全部窗口都已在 IPC 映射表里（含"已同步但无会话"的空串）时跳过整轮 eval ——
   * mine 模式下 WantSid 已非主数据源，省掉活跃期每 1.5s × N 窗口的页面求值。 */
  const wcs = webContents.getAllWebContents().filter((wc) => isMainWindowState(wc) && !wc.isDestroyed());
  if (!wcs.length) return;
  const liveIds = new Set(wcs.map((wc) => wc.id));
  for (const id of activeSid.keys()) if (!liveIds.has(id)) activeSid.delete(id);
  for (const id of remoteEvidence.keys()) if (!liveIds.has(id)) remoteEvidence.delete(id);
  const withTimeout = (p, ms) => {
    let timer;
    return Promise.race([p, new Promise((r) => { timer = setTimeout(() => r(""), ms); })])
      .finally(() => clearTimeout(timer));
  };
  /* 各窗口的 pane 会话 id（v10，__zusageWantSids 数组，分屏多实例状态条用）+ 旧单值兜底；
   * v12 附带 __zusageSidWs（sid→workspaceIdentity）与 __zusagePaneScopes（pane 绑定，
   * 多服务器路由）。 */
  collectingWants = true;
  const readWantsJs = '(function(){var a=window.__zusageWantSids;if(!a||!a.length){a=window.__zusageWantSid?[window.__zusageWantSid]:[]}return JSON.stringify({s:a,w:window.__zusageSidWs||{},p:window.__zusagePaneScopes||{}})})()';
  /* Promise.resolve().then 包裹：renderer 同步销毁时 executeJavaScript 直接 throw，
   * 转成 rejected promise 交给 catch 吞掉，别把整轮收集锁死 */
  Promise.all(wcs.map((wc) => withTimeout(Promise.resolve().then(() => wc.executeJavaScript(readWantsJs, true)).catch(() => ""), 1000)))
    .then((vals) => {
      if (shuttingDown || !hasWindows()) { stopResident(); return; }
      /* 汇总全部窗口的全部 pane 会话（去重）：request.sids 无 identity、
       * request.scopes 带 workspaceIdentity（远端路由键）；add 的去重按 (sid, identity) 对。 */
      const request = { sids: [], scopes: [] };
      const add = (sid, identity) => {
        if (identity) {
          if (!request.scopes.some((s) => s.sid === sid && s.workspaceIdentity === identity)) request.scopes.push({ sid, workspaceIdentity: identity });
        } else if (!request.sids.includes(sid)) request.sids.push(sid);
      };
      wcs.forEach((wc, i) => {
        let parsed = {};
        try { parsed = JSON.parse(vals[i] || "{}"); } catch (e) { }
        const wants = Array.isArray(parsed.s) ? parsed.s.slice() : [];
        if (activeSid.get(wc.id)) wants.push(activeSid.get(wc.id));
        const workspaces = windowWorkspaces.get(wc.id) || [];
        const trusted = new Set(workspaces.filter((w) => w.kind === "remote" && REMOTE_IDENTITY_RE.test(w.identity)).map((w) => w.identity));
        const tasks = windowTasks.get(wc.id);
        const bindings = {};
        for (const [pid, pane] of Object.entries(parsed.p || {})) {
          if (!pane || !wants.includes(pane.sid) || typeof pane.sid !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(pane.sid)) continue;
          bindings[pid] = ""; // 本地/未知 pane 显式隔离，不能从同 sid 远端绑定继承。
          if (pane.identity === "" || (pid === "workspace-main" && !Object.prototype.hasOwnProperty.call(pane, "identity"))) {
            // 工作区同步可能只含 connected remotes，不能证明主 pane 当前属于远端。
            add(pane.sid, "");
            continue;
          }
          if (!trusted.has(pane.identity)) continue;
          const taskScopes = tasks && tasks.get(pane.sid);
          if (taskScopes && !taskScopes.has(pane.identity)) continue;
          bindings[pid] = pane.identity;
          add(pane.sid, pane.identity);
        }
        for (const sid of wants) {
          if (typeof sid !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(sid)) continue;
          const raw = parsed.w && parsed.w[sid];
          const candidates = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).filter((id) => trusted.has(id));
          const taskScopes = tasks && tasks.get(sid);
          const eligible = [...new Set(candidates)].filter((id) => !taskScopes || taskScopes.has(id));
          const primary = parsed.p && parsed.p["workspace-main"];
          if (primary && primary.sid === sid && !Object.prototype.hasOwnProperty.call(primary, "identity")) continue;
          if (eligible.length === 1) {
            bindings[sid] = eligible[0];
            add(sid, eligible[0]);
          } else if (!request.scopes.some((s) => s.sid === sid)) {
            // 本地/未知不能自动借唯一历史SSH通道；Python JSON无scope默认只查本地。
            add(sid, "");
          }
        }
        scopeBindings.set(wc.id, bindings);
        /* 远端任务证据只取本窗 wants 里的 sid：无关 sid 的远端任务不能把本地 pane 一并判死。 */
        let evidence = trusted.size > 0;
        if (!evidence && tasks) {
          for (const sid of wants) {
            const scopes = tasks.get(sid);
            if (scopes && [...scopes].some((id) => REMOTE_IDENTITY_RE.test(id))) { evidence = true; break; }
          }
        }
        remoteEvidence.set(wc.id, evidence);
      });
      request.sids.sort();
      request.scopes.sort((a, b) => scopeKey(a.sid, a.workspaceIdentity).localeCompare(scopeKey(b.sid, b.workspaceIdentity)));
      const key = JSON.stringify(request);
      const src = sourceStamp();
      const keys = requestKeys(request);
      const now = Date.now();
      const remoteActive = keys.some((s) => isRemoteSid(s));
      const pendingDue = keys.some((s) => { const t = pendingSids.get(s); return t !== undefined && t <= now; });
      if (key === lastWants && src === lastSourceStamp && st && st === lastStamp && !remoteActive && !pendingDue) return;
      const effWait = (remoteActive || pendingDue) ? remotePollMs() : wait;
      if (now - lastSpawn < effWait) { scheduleRetry(effWait - (now - lastSpawn) + 50); return; }
      lastWants = key;
      lastSourceStamp = src;
      lastRequest = request;
      lastHadRemote = remoteActive || pendingDue || request.scopes.length > 0;
      if (st) lastStamp = st;
      lastSpawn = now;
      runQuery(request);
    })
    .catch(() => { })
    .finally(() => { collectingWants = false; });
}

/* 监听 db 目录：WAL/主库一有写入立刻（去抖 300ms）触发拉取；完全空闲时零进程零轮询 */
let debounceTimer = 0;
let dbWatcher = null;
function watchDb() {
  if (dbWatcher) return;
  try {
    dbWatcher = fs.watch(dbDir(), (ev, f) => {
      if (f && !/db\.sqlite/.test(f)) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(maybeSpawn, 300);
    });
    dbWatcher.on("error", () => {
      LOG("db watcher error, re-arm in 5s");
      try { dbWatcher.close(); } catch (e) { }
      dbWatcher = null;
      setTimeout(watchDb, 5000);
    });
    LOG("watching", dbDir());
  } catch (e) {
    LOG("fs.watch failed, retry in 5s:", e.message);
    setTimeout(watchDb, 5000);
  }
}

/* overlay / zusage.py 热更新检查（stat mtime，开销可忽略）；config.hot_reload=false 可关闭
 * （发布/稳定形态：改文件需重启 ZCode 才生效），开关改动随下次心跳生效。
 * zusage.py 变化时重启常驻进程（serve 进程驻内存的是旧代码）；顺带 stat config mtime。 */
let overlayMtimeKnown = false;
let zusageMtime = 0;
setInterval(() => {
  const cfg = readCfgCached();
  if (!residentAllowed()) stopResident();
  if (cfg.hot_reload === false) return;
  hotReloadIfChanged();
  try {
    const m = fs.statSync(ZUSAGE).mtimeMs;
    if (overlayMtimeKnown && m !== zusageMtime && pyRes) {
      LOG("zusage.py changed, restarting resident python");
      killResidentForUpgrade();
    }
    zusageMtime = m;
    overlayMtimeKnown = true;
  } catch (e) { }
}, 2000);
setInterval(maybeSpawn, Math.max(10000, readCfg().heartbeat_ms | 0 || 30000));   // 兜底心跳：防文件事件丢失
watchDb();
maybeSpawn();   // 启动先拉一次

let pluginUpdater = null;
let pluginRequestBusy = false;
let lastGoodPayload = null;   // 额度结算后无需重查库即可向各窗口补推（payload 已含 quota）
let quotaClient = null;
function pushPluginState(wc, state) {
  if (!isMainWindowState(wc) || wc.isDestroyed()) return;
  /* rateLine / quotaEnabled 随插件状态一起推送：⚙ 面板两个开关的真值都来自 config.json */
  const payload = { ...state, rateLine: readCfgCached().answer_rate_line !== false, quotaEnabled: quotaEnabled(),
    quotaSources: quotaClient ? quotaClient.sourcesConfig() : [] };
  wc.executeJavaScript(`window.__zusagePluginUpdate && window.__zusagePluginUpdate(${JSON.stringify(payload)})`, true).catch(() => { });
}
try {
  const { createUpdater } = require("./plugin-updater.cjs");
  pluginUpdater = createUpdater({ runtime: HERE, home: app.getPath("home"),
    resourcesPath: process.resourcesPath, executable: process.execPath,
    notify: (state) => webContents.getAllWebContents().forEach((wc) => pushPluginState(wc, state)) });
} catch (e) {
  delete loadedHashes["plugin-updater.cjs"];
  delete loadedHashes["plugin-release.cjs"];
  delete loadedHashes["plugin-storage.cjs"];
  LOG("plugin updater unavailable:", e.message);
}
acknowledgeRestart();

/* ---------- v96 额度客户端（BigModel/Z.ai 个人编码套餐）：解密宿主 OAuth 凭据 →
 * monitor 端点 → 归一化 → 快照 quota 字段。独立模块，加载失败只少额度不拖垮主链
 * （overlay 收不到 quota 字段即隐藏 chip）。凭据只在 quota-client 进程内存流转；
 * 诊断只记 status/HTTP code/错误摘要，token 与请求头绝不进日志。 */
try {
  const { createQuotaClient, resolveQuotaPaths } = require("./quota-client.cjs");
  const quotaPaths = resolveQuotaPaths({ defaultHome: app.getPath("home") });
  const QUOTA_SECRETS = path.join(HERE, "quota-secrets.json");
  quotaClient = createQuotaClient({
    ...quotaPaths,
    secretsPath: QUOTA_SECRETS,
    log: (...a) => LOG("[quota]", ...a),
    onUpdate: () => {   // 手动刷新/解冻等结算：拿最近成功快照补推（不触发 Python 重查）
      if (!lastGoodPayload) return;
      const withQuota = Object.assign({}, lastGoodPayload, { quota: quotaClient.view() });
      for (const wc of webContents.getAllWebContents()) pushOnce(wc, withQuota);
    },
  });
  /* 监听实际凭据与 builtin/personal 目录（原子替换文件也能收到），配置变更重判归属并解冻。 */
  const quotaWatchDirs = new Map();
  for (const [file, dir] of [[quotaPaths.credsPath, quotaPaths.credsDir],
    [quotaPaths.customCfgPath, quotaPaths.customCfgDir], [quotaPaths.builtinCfgPath, quotaPaths.builtinCfgDir]]) {
    if (!file) continue;
    if (!quotaWatchDirs.has(dir)) quotaWatchDirs.set(dir, new Set());
    const filePath = /^(?:[a-z]:[\\/]|\\\\)/i.test(file) ? path.win32 : path.posix;
    quotaWatchDirs.get(dir).add(filePath.basename(file));
  }
  let quotaCredDebounce = 0;
  for (const [dir, names] of quotaWatchDirs) {
    let watcher = null;
    const watchQuotaCredentials = () => {
      if (watcher) return;
      try {
        watcher = fs.watch(dir, (ev, f) => {
          if (f && !names.has(String(f))) return;
          clearTimeout(quotaCredDebounce);
          quotaCredDebounce = setTimeout(() => {
            if (!quotaClient || !quotaEnabled()) return;
            quotaClient.credentialsChanged();
            syncQuotaProviders();   // 重读配置后重判 provider 绑定（内含 tick）
          }, 300);
        });
        watcher.on("error", () => {
          try { watcher.close(); } catch (e) { }
          watcher = null;
          setTimeout(watchQuotaCredentials, 5000);
        });
      } catch (e) { setTimeout(watchQuotaCredentials, 5000); }
    };
    watchQuotaCredentials();
  }
  setInterval(() => {   // 兜底：not_configured 低频重探/退避到点补拉（活跃时 handlePayload 也会 tick）
    if (hasWindows() && quotaEnabled()) syncQuotaProviders();
  }, 60000);
} catch (e) {
  delete loadedHashes["quota-client.cjs"];
  LOG("quota client unavailable:", e.message);
}

/* 逐问速率行开关（⚙ 面板）：原子写运行时 config.json 的 answer_rate_line（缺省=开启）。
   prompt-submit hook 每次提问时读同一文件——开关下一问即生效，无需重启客户端。 */
function broadcastPluginState() {
  const base = pluginUpdater ? pluginUpdater.status() : {};
  webContents.getAllWebContents().forEach((wc) => pushPluginState(wc, base));
}
async function setAnswerRateLine(enabled) {
  try {
    const { updateConfig } = require("./plugin-updater.cjs");
    await updateConfig(HERE, { answer_rate_line: enabled }, readCfgCached().python_path || (process.platform === "win32" ? "python" : "python3"));
    cfgCache = null;   // 写后置空，下一次 readCfgCached 立即重读（mtime 判变的双保险）
    broadcastPluginState();
  } catch (e) { LOG("answer_rate_line toggle failed:", e.message); }
}
/* 阶段 3 源配置：quota-secrets.json（运行目录 0600，凭据只进此文件，不进 config.json/日志/诊断）。
 * 同目录原子替换（tmp+rename），字段白名单防任意键；写入后 credentialsChanged 解冻重读。 */
const QUOTA_SECRET_FIELDS = new Set(["apiKey", "cookie", "token", "accessKeyId", "secretAccessKey", "baseUrl", "planCredits", "planStart", "region", "modelPatterns"]);
function readQuotaSecrets() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(HERE, "quota-secrets.json"), "utf8"));
    return d && typeof d === "object" && d.sources && typeof d.sources === "object" ? d : { sources: {} };
  } catch (e) { return { sources: {} }; }
}
function writeQuotaSecrets(mutate) {
  const d = readQuotaSecrets();
  mutate(d.sources);
  const file = path.join(HERE, "quota-secrets.json");
  const tmp = file + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch (e2) { /* Windows/权限失败忽略：tmp 已按 0600 创建 */ }
  } catch (e) { LOG("quota secrets write failed:", e.message); return; }
  if (quotaClient) {
    quotaClient.credentialsChanged();
    if (quotaEnabled()) {
      quotaClient.tick();   // 总开关关闭时不触发联网（与手动刷新同口径）
      if (lastGoodPayload) {
        const withQuota = Object.assign({}, lastGoodPayload, { quota: quotaClient.view() });
        for (const wc of webContents.getAllWebContents()) pushOnce(wc, withQuota);
      }
    }
  }
  broadcastPluginState();   // 面板状态无论开关都要刷新（写入结果回显）
}
function handleQuotaSourceRequest(req) {
  const id = String(req.id || "");
  if (!id || !/^[a-z][a-z0-9-]{0,31}$/.test(id)) return;   // 源 id 白名单
  if (req.action === "quota-src-refresh") {
    if (quotaClient && quotaEnabled()) quotaClient.refreshSource(id);
    return;
  }
  if (req.action === "quota-src" && typeof req.enabled === "boolean") {
    writeQuotaSecrets((sec) => { sec[id] = Object.assign({}, sec[id] || {}, { enabled: req.enabled }); });
    return;
  }
  if (req.action === "quota-src-key") {
    const field = String(req.field || "");
    if (!QUOTA_SECRET_FIELDS.has(field)) return;
    const value = req.value == null ? "" : String(req.value).slice(0, 4096);
    writeQuotaSecrets((sec) => {
      sec[id] = Object.assign({}, sec[id] || {});
      const isCred = field === "apiKey" || field === "cookie" || field === "token" || field === "secretAccessKey";
      if (value === "" && (isCred || field === "modelPatterns")) { delete sec[id][field]; return; }
      if (field === "planCredits") { if (value === "") delete sec[id][field]; else sec[id][field] = Number(value) || 0; }
      else if (field === "planStart" || field === "region" || field === "baseUrl") { if (value === "") delete sec[id][field]; else sec[id][field] = value; }
      else if (field === "modelPatterns") {
        try { const parsed = JSON.parse(value); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) sec[id][field] = parsed; } catch (e) { /* 非法 JSON 忽略 */ }
      }
      else sec[id][field] = value;
    });
  }
}
/* v96 套餐额度开关（⚙ 面板）：原子写 config.json 的 quota_enabled（缺省关）。开启即刻 tick
 * 一次（结算后经 onUpdate 补推）；关闭后 handlePayload 不再 tick/附加，chip 随之隐藏。 */
async function setQuotaEnabled(enabled) {
  try {
    const { updateConfig } = require("./plugin-updater.cjs");
    await updateConfig(HERE, { quota_enabled: enabled }, readCfgCached().python_path || (process.platform === "win32" ? "python" : "python3"));
    cfgCache = null;
    broadcastPluginState();
    if (enabled && quotaClient) syncQuotaProviders();
  } catch (e) { LOG("quota_enabled toggle failed:", e.message); }
}
/* 确定性历史行的数据库富文本（v75）：渲染端只从 turn 容器拿到 DOM turn id，
 * 桥接数据里没有首字延迟/分段/峰值/累计等字段，拼不出模型时代那行统计；这里按
 * turn 身份一次性查库（token_rate.py --turn --session --turn-id，纯文本），把结果
 * 推回请求它的那个渲染进程。用一次性 spawn 而非常驻泵：这是低频（每个完成的轮次
 * 至多几次重试）、与主数据泵完全并行的旁路查询，不能占用泵的 stdin 行协议。
 * 查不到（数据库还没追上）时回推空串，渲染端据此限流重试。 */
/* 确定性历史行的富文本旁路查询：桥接数据里没有首字延迟/分段/峰值/累计等字段，拼不出
 * 模型时代那行统计；数据库的 turn_id（turn_<uuid>）和渲染器投影的 turnId/productTurnId
 * （msg_<uuid>，DOM data-turn-id 同源）是两套互不相通的标识，前端没有、也查不到后者
 * 对应的数据库主键——不能按显式 turn-id 查库。改为复用 Hook 原本依赖的 --current 时间戳
 * 推断路径（token_rate.py 按 session 记录的"提问时刻"反查最新一轮，session 级映射，
 * 并行会话不串台），这正是模型以前实际在跑的同一条查询，口径已被验证过。
 * 用一次性 spawn 而非常驻泵：低频（每个完成的轮次至多几次重试）、与主数据泵完全并行
 * 的旁路查询，不占用泵的 stdin 行协议。查不到（数据库还没追上/没有有效提问时刻/
 * 这一轮已被新提问越过）时回推空串，不是错误，渲染端据此限流重试。 */
function queryTurnText(sid, wc, plainUnits) {
  const deliver = (text) => {
    if (!wc || wc.isDestroyed()) return;
    wc.executeJavaScript("window.__zusageDeliverTurnText && window.__zusageDeliverTurnText(" +
      JSON.stringify(sid) + "," + JSON.stringify(text || "") + ")", true).catch(() => { });
  };
  if (typeof sid !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(sid)) return;
  let py;
  try {
    /* --no-cn-units：渲染端万/亿开关（localStorage，主进程无真值）显式关闭时才传；
       缺省（含旧渲染端不带 cn 字段）与产品默认一致，Python 侧自行用万/亿 */
    py = spawn(readCfgCached().python_path,
      [TOKEN_RATE, "--turn", "--current", "--session", sid].concat(plainUnits ? ["--no-cn-units"] : []), { windowsHide: true });
  } catch (e) { LOG("turn text spawn failed:", e.message); deliver(""); return; }
  let out = "", finished = false;
  const finish = (text) => {
    if (finished) return;
    finished = true;
    clearTimeout(killTimer);
    deliver(text);
  };
  const killTimer = setTimeout(() => {
    LOG("turn text query timeout, killing");
    try { py.kill(); } catch (e) { }
    finish("");
  }, 15000);
  py.stdout.on("data", (d) => { out += d; });
  py.stderr.on("data", () => { });
  py.on("error", (e) => { LOG("turn text spawn failed:", e.message); finish(""); });
  py.on("close", () => { finish(String(out).trim()); });   // 空串 = 库里还没这一轮，不是错误
}

/* ---------- Git 状态旁路查询（v96）：工具行 Git chip 的数据源 ----------
 * 渲染端把各 pane 的本地工作区路径写进 window.__zusageGitPaths（远端 pane 不上报；开关关闭为空），
 * 这里每 10s 取各主窗口并集逐路径跑 git（一次性 execFile，与 Python 泵无关，不占 stdin 行协议），
 * 结果按路径推回每个声明过该路径的窗口（window.__zusageGitState）。渲染端 git-refresh 请求
 * （回合后节流 / chip 点击）立即重查。git 缺失 / 非仓库按 reason 回推，渲染端据此不挂载；
 * 超时与其它错误也回推，渲染端保留最近成功态并标 stale。
 * 命令：status --porcelain --branch（分支/上游/ahead-behind/各类文件计数）+ diff HEAD --shortstat
 * （工作区相对 HEAD 的插入/删除行数，含已暂存；HEAD 无效的无提交仓库退回 diff + diff --cached
 * 求和，即 cc-pretty-statusline 的原始做法）。GIT_OPTIONAL_LOCKS=0 不写 index 锁（后台轮询不与
 * 用户的 git 操作抢 index.lock），LC_ALL=C 让 shortstat 文案可解析，GIT_TERMINAL_PROMPT=0 杜绝交互。
 * 多仓聚合：workspace 自身非仓库（status 报 notrepo）时枚举直接子目录中的 git 仓库——0 仓维持
 * notrepo（chip 隐藏）；恰 1 仓对该子仓走完整单仓管线（成功结果附 repoPath）；≥2 仓每仓只跑一条
 * status --porcelain --branch（Promise.all 并行，不跑 diff 行数），按字母序聚合为 kind:"multi"，
 * 上限 GIT_REPO_CAP=32，超出折叠进 more；子仓失败只在对应项记 err，不拖垮整体与其余仓。 */
const GIT_TICK_MS = 10000, GIT_TIMEOUT_MS = 8000, GIT_MAX_BUFFER = 4 * 1024 * 1024;
const GIT_ENV = Object.assign({}, process.env, { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" });
const GIT_CONFLICT = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const GIT_REPO_CAP = 32;   // 多仓聚合上限：父目录非仓库时最多查询 32 个直接子仓库，超出折叠进 more
let gitTickBusy = false, gitRefreshPending = false, gitNoBinaryLogged = false;

function parseGitPorcelain(text) {
  const out = { branch: "", upstream: "", ahead: 0, behind: 0, detached: false, noCommits: false, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, changed: 0 };
  for (const raw of String(text || "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    if (line.startsWith("## ")) {
      const head = line.slice(3);
      if (head === "HEAD (no branch)") { out.detached = true; continue; }
      const fresh = head.match(/^(?:No commits yet|Initial commit) on (.+)$/);
      if (fresh) { out.noCommits = true; out.branch = fresh[1]; continue; }
      const m = head.match(/^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/);   // 分支名不含 ".."，按 "..." 切上游是安全的
      if (!m) continue;
      out.branch = m[1];
      out.upstream = m[2] || "";
      const a = m[3] && m[3].match(/ahead (\d+)/), b = m[3] && m[3].match(/behind (\d+)/);
      if (a) out.ahead = parseInt(a[1], 10);
      if (b) out.behind = parseInt(b[1], 10);
      continue;
    }
    if (line.length < 2) continue;
    const x = line[0], y = line[1];
    if (x === "?" && y === "?") { out.untracked++; continue; }
    if (x === "!" && y === "!") continue;   // 仅 --ignored 时出现
    out.changed++;   // 非未跟踪/非忽略的条目行计 1：MM 部分暂存也只算一行，不与 staged/unstaged 相加重复计
    if (GIT_CONFLICT.has(x + y)) { out.conflicts++; continue; }
    if (x !== " ") out.staged++;
    if (y !== " ") out.unstaged++;
  }
  return out;
}
function parseShortstat(text) {
  const s = String(text || "");
  const ins = s.match(/(\d+) insertions?\(\+\)/), del = s.match(/(\d+) deletions?\(-\)/);
  return { ins: ins ? parseInt(ins[1], 10) : 0, del: del ? parseInt(del[1], 10) : 0 };
}
function gitPathOk(p) {
  if (typeof p !== "string" || !p || p.length > 4096 || /[\x00-\x1f\x7f]/.test(p) || !path.isAbsolute(p)) return false;
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}
function gitExec(cwd, args) {
  return new Promise((resolve) => {
    try {
      execFile("git", ["-C", cwd].concat(args), { timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, windowsHide: true, env: GIT_ENV },
        (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ""), stderr: String(stderr || "") }));
    } catch (e) { resolve({ error: e, stdout: "", stderr: "" }); }
  });
}
function gitFailure(r) {   // null = 成功；否则渲染端可识别的 reason
  if (!r.error) return null;
  if (r.error.code === "ENOENT") return "nogit";
  if (r.error.killed || r.error.signal) return "timeout";
  if (/not a git repository/i.test(r.stderr)) return "notrepo";
  return "error";
}
/* 单仓管线（queryGitStatus 的原有主体）：status + diff HEAD --shortstat，无提交仓库退回
 * diff + diff --cached 求和。成功返回统一附 repoPath（渲染端 tooltip 目录行用）与 ts（成功
 * 时刻）与 op（进行中的 Git 操作），失败形状不变。 */
async function gitSingleStatus(cwd) {
  const st = await gitExec(cwd, ["status", "--porcelain", "--branch"]);
  const bad = gitFailure(st);
  if (bad) {
    if (bad === "nogit" && !gitNoBinaryLogged) { gitNoBinaryLogged = true; LOG("git not found in PATH; git chip stays hidden"); }
    return { ok: false, reason: bad, ts: Date.now() };
  }
  const d1 = await gitExec(cwd, ["diff", "HEAD", "--shortstat"]);
  let counts = null;
  if (!d1.error) counts = parseShortstat(d1.stdout);
  else if (gitFailure(d1) === "error") {   // HEAD 无效（无提交仓库）等非超时失败：退回两段式求和
    const a = await gitExec(cwd, ["diff", "--shortstat"]);
    const b = a.error ? a : await gitExec(cwd, ["diff", "--cached", "--shortstat"]);
    if (!a.error && !b.error) {
      const pa = parseShortstat(a.stdout), pb = parseShortstat(b.stdout);
      counts = { ins: pa.ins + pb.ins, del: pa.del + pb.del };
    }
  }
  if (!counts) return { ok: false, reason: gitFailure(d1) || "error", ts: Date.now() };
  return Object.assign({ ok: true, ts: Date.now(), ins: counts.ins, del: counts.del, repoPath: cwd, op: detectGitOp(cwd) }, parseGitPorcelain(st.stdout));
}
/* 进行中的 Git 操作探测：解析 .git 目录（目录或 worktree 链接文件都认），按官方触发器文件
 * 存在性判操作类型。纯 fs 探针零子进程；rebase-apply 目录被 rebase --apply 与 git am 共用，
 * 以 applying 文件区分。探测不到返回空串（不代表没有操作，只代表本探测不可见）。 */
function gitDotDir(cwd) {
  const dot = path.join(cwd, ".git");
  try {
    const st = fs.statSync(dot);
    if (st.isDirectory()) return dot;
    const m = /^gitdir: (.+)\r?\n?$/.exec(fs.readFileSync(dot, "utf8"));
    return m ? m[1].trim() : null;
  } catch (e) { return null; }
}
function detectGitOp(cwd) {
  const g = gitDotDir(cwd);
  if (!g) return "";
  const has = (p) => { try { return fs.existsSync(path.join(g, p)); } catch (e) { return false; } };
  if (has("rebase-merge")) return "rebase";
  if (has("rebase-apply")) return has("applying") ? "am" : "rebase";
  if (has("MERGE_HEAD")) return "merge";
  if (has("CHERRY_PICK_HEAD")) return "cherry-pick";
  if (has("REVERT_HEAD")) return "revert";
  if (has("BISECT_LOG")) return "bisect";
  return "";
}
/* 父目录自身非仓库时枚举直接子目录中的 git 仓库：readdir/stat 异常返回空或跳过该项，不让异常
 * 穿出 git tick；子项 statSync 须为目录（跟随符号链接），其下存在 .git（目录或 worktree 链接
 * 文件都认）才算仓库。名字按 Array#sort() 默认码点序，前 GIT_REPO_CAP 个进入查询，剩余计入 more。 */
function discoverChildRepos(parent) {
  let names;
  try { names = fs.readdirSync(parent); } catch (e) { return { repos: [], more: 0 }; }
  names.sort();
  const repos = [];
  for (const name of names) {
    const child = path.join(parent, name);
    try { if (!fs.statSync(child).isDirectory()) continue; } catch (e) { continue; }
    if (!fs.existsSync(path.join(child, ".git"))) continue;
    repos.push({ name, path: child });
  }
  return { repos: repos.slice(0, GIT_REPO_CAP), more: Math.max(0, repos.length - GIT_REPO_CAP) };
}
/* 入口三分支：workspace 自身是仓库 → 单仓管线原样返回；status 判定 notrepo → 枚举直接子仓库
 * 聚合（0 仓维持 notrepo 语义、恰 1 仓对该子仓走完整单仓管线、≥2 仓每仓只跑一条 status 有界
 * 并行聚合）；nogit/timeout/error 等其余失败原样返回，不触发发现。
 * 逐仓失败携带最近一次成功快照（stale:true 标注历史属性，渲染端不把旧冲突算已确认）；
 * 逐仓成功附 ts（最近成功时刻），渲染端据此区分"最近尝试"与"最近成功"。 */
const GIT_REPO_CONCURRENCY = 6;   // 有界并发：一次 tick 最多同时 6 个 git 子进程
const gitRepoLastGood = new Map();   // repo path → 最近一次成功条目（不含 err）
async function queryGitStatus(cwd) {
  const first = await gitSingleStatus(cwd);
  if (first.ok !== false || first.reason !== "notrepo") return first;
  const found = discoverChildRepos(cwd);
  if (!found.repos.length) return first;   // 没有任何子仓库：维持 notrepo，chip 隐藏
  if (found.repos.length === 1) return await gitSingleStatus(found.repos[0].path);
  const repos = found.repos.slice();   // 已按名字码点序
  let cursor = 0;
  const runOne = async (r) => {
    const s = await gitExec(r.path, ["status", "--porcelain", "--branch"]);   // 多仓只跑 status，不跑 diff 行数
    const bad = gitFailure(s);
    if (bad) {
      const good = gitRepoLastGood.get(r.path);
      const entry = { name: r.name, path: r.path, err: bad, tsAttempt: Date.now() };
      if (good) return Object.assign({ name: r.name, path: r.path, err: bad, stale: true }, good);   // 失败携带旧快照（明确标注）
      return entry;
    }
    const entry = Object.assign({ name: r.name, path: r.path, ts: Date.now(), op: detectGitOp(r.path) }, parseGitPorcelain(s.stdout));
    gitRepoLastGood.set(r.path, entry);
    return entry;
  };
  const out = new Array(repos.length);
  const worker = async () => { while (cursor < repos.length) { const i = cursor++; out[i] = await runOne(repos[i]); } };
  await Promise.all(Array.from({ length: Math.min(GIT_REPO_CONCURRENCY, repos.length) }, worker));
  return { ok: true, kind: "multi", ts: Date.now(), more: found.more, repos: out };
}
function isLocalHostPage(wc) {   // 与 pollPluginRequests 同口径：只信宿主本地 file: 页面上的渲染端全局
  try {
    const url = wc.getURL();
    if (!url.startsWith("file:")) return false;
    const relative = path.relative(process.resourcesPath, fileURLToPath(url));
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch (e) { return false; }
}
async function readGitPaths(wc) {
  try {
    const raw = await Promise.race([
      wc.executeJavaScript('(function(){var p=window.__zusageGitPaths;return JSON.stringify(Array.isArray(p)?p.slice(0,8):[])})()', true),
      new Promise((resolve) => setTimeout(() => resolve("[]"), 1000)),
    ]);
    const arr = JSON.parse(String(raw || "[]"));
    return Array.isArray(arr) ? arr.filter(gitPathOk) : [];
  } catch (e) { return []; }
}
function pushGitState(wc, p, st) {
  if (!wc || wc.isDestroyed()) return;
  const js = ("window.__zusageGitState && window.__zusageGitState(" + JSON.stringify(p) + "," + JSON.stringify(st) + ")")
    .replace(/[\u2028\u2029]/g, (c) => c === "\u2028" ? "\\u2028" : "\\u2029");
  wc.executeJavaScript(js, true).catch(() => { });
}
async function gitTick(fromRefresh) {
  if (gitTickBusy) { if (fromRefresh) gitRefreshPending = true; return; }   // 在途时的手动刷新：结束后补跑一轮
  if (shuttingDown || !hasWindows()) return;
  gitTickBusy = true;
  try {
    const wants = [];   // [wc, paths]
    for (const wc of webContents.getAllWebContents()) {
      if (!isMainWindowState(wc) || wc.isDestroyed() || !isLocalHostPage(wc)) continue;
      const paths = await readGitPaths(wc);
      if (paths.length) wants.push([wc, paths]);
    }
    const all = new Set();
    for (const [, ps] of wants) for (const p of ps) all.add(p);
    await Promise.all([...all].map(async (p) => {   // 同一仓库多窗口/多 pane 只查一次，结果分发
      const st = await queryGitStatus(p);
      for (const [wc, ps] of wants) if (ps.includes(p)) pushGitState(wc, p, st);
    }));
  } catch (e) { LOG("git status tick failed:", e.message); }
  finally {
    gitTickBusy = false;
    if (gitRefreshPending) { gitRefreshPending = false; gitTick(true).catch(() => { }); }
  }
}
setInterval(() => { gitTick(false).catch(() => { }); }, GIT_TICK_MS);

async function pollPluginRequests() {
  if (pluginRequestBusy) return;
  pluginRequestBusy = true;
  try {
    for (const wc of webContents.getAllWebContents()) {
      if (!isMainWindowState(wc) || wc.isDestroyed()) continue;
      // 仅在宿主本地窗口读取固定动作；外部网页不能触发插件更新或配置写入。
      const url = wc.getURL();
      if (!url.startsWith("file:")) continue;
      const local = fileURLToPath(url);
      const relative = path.relative(process.resourcesPath, local);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      const requests = await Promise.race([
        wc.executeJavaScript('(function(){var q=window.__zusagePluginRequests;return Array.isArray(q)?q.splice(0,8):[]})()', true),
        new Promise((resolve) => setTimeout(() => resolve([]), 1000)),
      ]);
      if (!Array.isArray(requests)) continue;
      for (const req of requests) {
        if (req && ["auto", "check", "update"].includes(req.action)) {
          if (pluginUpdater) pluginUpdater.request(req).catch((e) => LOG("plugin update action failed:", e.message));
        } else if (req && req.action === "rate-line" && typeof req.enabled === "boolean") {
          setAnswerRateLine(req.enabled);
        } else if (req && req.action === "quota-providers") {
          handleQuotaProviders(wc, req);
        } else if (req && req.action === "quota" && typeof req.enabled === "boolean") {
          setQuotaEnabled(req.enabled);
        } else if (req && (req.action === "quota-src" || req.action === "quota-src-key" || req.action === "quota-src-refresh")) {
          handleQuotaSourceRequest(req);
        } else if (req && req.action === "quota-refresh") {   // ⚙/chip 手动刷新：绕过 TTL 与软冻结
          if (quotaClient && quotaEnabled()) {
            if (typeof req.sourceId === "string" && req.sourceId.length <= 256) quotaClient.refreshSource(req.sourceId);
            else quotaClient.refresh();
          }
        } else if (req && req.action === "turn-text" && typeof req.sid === "string") {
          queryTurnText(req.sid, wc, req.cn === 0);
        } else if (req && req.action === "git-refresh") {   // v96：Git chip 点击 / 快照后节流：立即重查全部已关注路径
          gitTick(true).catch(() => { });
        }
      }
    }
  } catch (e) { LOG("plugin update request failed:", e.message); }
  finally { pluginRequestBusy = false; }
}
setInterval(pollPluginRequests, 1000);
setInterval(() => { if (pluginUpdater) pluginUpdater.tick().catch((e) => LOG("plugin auto update:", e.message)); }, 60000);
if (pluginUpdater) pluginUpdater.tick().catch((e) => LOG("plugin auto update:", e.message));

function injectOverlay(wc, reload = false) {
  if (!overlaySrc || !isMainWindowState(wc) || wc.isDestroyed()) return;
  const cleanup = '(function(){if(window.__zusageDispose)window.__zusageDispose();else{document.querySelectorAll(".zusage-root,.zusage-tip-root,.zusage-exc").forEach(function(e){e.remove()});if(window.__zusageRateCleanup)window.__zusageRateCleanup()}window.__zusageOverlay=false;})();\n';
  /* turn-stats.js 先于 overlay.js 注入（IIFE 幂等，重复执行只是重挂 ZUsageTurnStats）：
   * overlay 启动即读取该全局做实时/确定性统计；overlay 缺它时自动降级为 DB 轮询路径。 */
  wc.executeJavaScript((reload ? cleanup : "") + turnStatsSrc + "\n" + overlaySrc, true).then(() => {
    /* 无条件推送：updater 不可用时也要让面板拿到 rateLine 真值（缺省开） */
    pushPluginState(wc, pluginUpdater ? pluginUpdater.status() : {});
  }).catch(() => { });
}

const hook = (wc) => {
  if (!isMainWindowState(wc)) return;
  wc.on("destroyed", () => {
    activeSid.delete(wc.id);
    windowQuotaSelections.delete(wc.id);
    syncQuotaProviders();
    if (!hasWindows()) {
      clearTimeout(retryTimer);
      lastHadRemote = false;
      lastWants = "";
      lastStamp = 0;
      stopResident();
    }
  });
  wc.on("did-start-navigation", (event, url, inPlace, isMainFrame) => {
    if (isMainFrame === false || inPlace) return;
    windowQuotaSelections.set(wc.id, {});
    syncQuotaProviders();
  });
  wc.on("did-finish-load", () => injectOverlay(wc));
  if (wc.isLoading()) return;
  injectOverlay(wc);
};
app.on("web-contents-created", (e, wc) => hook(wc));
for (const wc of webContents.getAllWebContents()) hook(wc);

/* 测试接缝：vm 沙箱加载后取内部引用复现真实控制流；生产加载方（asar 动态 import）不用它。 */
if (typeof module === "object" && module && module.exports) {
  module.exports.__zusageTest = {
    handlePayload, maybeSpawn, isRemoteSid, remoteSids, pendingSids,
    targetByIdentity: () => targetByIdentity,
    parseGitPorcelain, parseShortstat, queryGitStatus, gitTick, discoverChildRepos, detectGitOp,
  };
}

LOG("injected v12 (auto remote targets + per-sid multi-server routing, per-pane wants array, resident query mode with idle shutdown, renderer bridge probe, answer_rate_line config write, plugin request polling, quota entitlement client, git status chip)");

app.on("before-quit", () => {
  shuttingDown = true;
  clearTimeout(retryTimer);
  clearTimeout(debounceTimer);
  stopResident();
  if (quotaClient) quotaClient.dispose();
  if (dbWatcher) { try { dbWatcher.close(); } catch (e) { } dbWatcher = null; }
});
