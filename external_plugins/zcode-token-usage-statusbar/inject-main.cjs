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
const { app, BrowserWindow, webContents, dialog } = require("electron");
const { fileURLToPath } = require("url");

const HERE = __dirname;   // 本 loader 被 asar 注入行按绝对 file:// URL import，__dirname 即真实目录（克隆到任意路径无需改代码）
const CONFIG = path.join(HERE, "config.json");
const OVERLAY = path.join(HERE, "overlay.js");
const TURN_STATS = path.join(HERE, "turn-stats.js");
const ZUSAGE = path.join(HERE, "zusage.py");
const TOKEN_RATE = path.join(HERE, "token_rate.py");
const LOG = (...a) => console.error("[zusage]", ...a);
/* CDP 调试口：正式包宿主仅 !app.isPackaged 开 9229（宿主 index.ts），这里 ready 前强制补开。
 * 尊重两类既有出口：宿主同款逃生口 env ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT=1，
 * 以及用户显式传入的 --remote-debugging-port（Chromium 同名 switch 后者覆盖，append 前查
 * hasSwitch 不抢用户值）。守卫与 append 一并收在 try 内：宿主缺失 commandLine/hasSwitch
 * 的极端形态退回既有的 catch 日志路径，不改变 VM/stub 测试环境下的可加载性。
 * 注入行是入口尾部浮动 import，loader 顶层先于 app ready 执行（Electron 45 实证 LOADER-TOP
 * isReady=false 且 /json/version 可达）；端口被占（如同跑开发实例）时静默放弃绑定，不影响启动。 */
try {
  let cdpSkip = process.env.ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT === "1";
  if (!cdpSkip && app.commandLine && typeof app.commandLine.hasSwitch === "function" && app.commandLine.hasSwitch("remote-debugging-port")) cdpSkip = true;
  if (!cdpSkip) app.commandLine.appendSwitch("remote-debugging-port", "9229");
}
catch (e) { LOG("cdp remote-debugging-port switch failed:", e.message); }
const loadedHashes = { _loadedAt: Date.now() - process.uptime() * 1000 };
for (const name of ["inject-main.cjs", "plugin-updater.cjs", "plugin-release.cjs", "plugin-storage.cjs", "quota-client.cjs", "model-puller.cjs", "engine-patch.cjs", "mobile-relay.cjs", "sysmon-client.cjs", "overlay.js", "zusage.py"]) {
  try { loadedHashes[name] = createHash("sha256").update(fs.readFileSync(path.join(HERE, name))).digest("hex"); }
  catch (e) { LOG("startup fingerprint unavailable:", name, e.message); }
}
function acknowledgeRestart(done) {
  const helper = path.join(HERE, "runtime_lock.py");
  const finish = () => {
    if (typeof done === "function") { try { done(); } catch (e) { LOG("restart ack callback failed:", e.message); } }
  };
  if (!fs.existsSync(helper)) { finish(); return Promise.resolve(); }
  return new Promise((resolve) => {
    execFile(readCfg().python_path || (process.platform === "win32" ? "python" : "python3"),
      [helper, "--ack-restart", HERE, JSON.stringify(loadedHashes)],
      { windowsHide: true, timeout: 15000, maxBuffer: 65536 },
      (error) => {
        if (error) LOG("restart acknowledgement failed:", error.message);
        // v258：可选回调——热替换完成后等销账落定再广播状态（红点即时撤下）。
        finish();
        resolve();
      });
  });
}

function readCfg() {
  const c = { resident: true };
  try { Object.assign(c, JSON.parse(fs.readFileSync(CONFIG, "utf8"))); } catch (e) { }
  /* 缺省/空值统一按平台定解释器：Windows 无 python3，macOS/Linux 未必有 python；
     三个 spawn 点直接读 python_path，归一只能在这里做 */
  c.python_path = c.python_path || (process.platform === "win32" ? "python" : "python3");
  return c;
}

/* config.json 内容缓存：热更新定时器按 hotTickMs 周期触发，改为 stat mtime 判变化后才读文件 */
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

/* ---------- issue #372：待收尾 asar 的应用内重启交接 ---------- */
const RELAUNCH_REQUEST = path.join(HERE, "relaunch-request.json");

/* 待收尾 install 包的 asar 路径；没有合法 TMP+sidecar 时返回空串。 */
function pendingAsarPath() {
  try {
    const configured = readCfgCached().asar_path;
    const asar = typeof configured === "string" && configured ? configured : path.join(process.resourcesPath, "app.asar");
    const tmp = asar + ".zusage.tmp";
    const metaFile = tmp + ".json";
    if (!fs.existsSync(tmp) || !fs.existsSync(metaFile)) return "";
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    if (!meta || meta.operation !== "install" || meta.validated !== true) return "";
    return path.resolve(asar);
  } catch (e) { return ""; }
}

/* 写重启交接请求；返回 createdAt（0=失败，调用方回退原 app.relaunch 路径）。 */
function writeRelaunchRequest(asar) {
  try {
    const payload = {
      version: 1,
      asar: path.resolve(asar),
      argv: [process.execPath].concat(process.argv.slice(1)),
      cwd: process.cwd(),
      pid: process.pid,
      createdAt: Date.now(),
    };
    const tmp = RELAUNCH_REQUEST + ".tmp";
    // 0600（POSIX；Windows 继承目录 ACL）：argv/cwd/pid 是宿主运行环境信息，
    // 与 quota-secrets.json 同级的最小暴露面（review 安全审查）。
    fs.writeFileSync(tmp, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, RELAUNCH_REQUEST);
    return payload.createdAt;
  } catch (e) {
    LOG("relaunch request write failed:", e.message);
    return 0;
  }
}

/* 清请求；带 createdAt 时只清同一代（旧 15s 哨兵不得误删用户新点的请求）。 */
function clearRelaunchRequest(createdAt) {
  try {
    if (typeof createdAt === "number") {
      let current = null;
      try { current = JSON.parse(fs.readFileSync(RELAUNCH_REQUEST, "utf8")); } catch (e) { current = null; }
      if (current && current.createdAt !== createdAt) return;
    }
    fs.unlinkSync(RELAUNCH_REQUEST);
  } catch (e) {
    if (e.code !== "ENOENT") LOG("relaunch request clear failed:", e.message);
  }
}

/* 启动即清掉上一进程可能遗留的交接请求：用户手动重开时 monitor 不应再拉起第二个实例。 */
clearRelaunchRequest();
/* ---------- issue #372 交接结束 ---------- */

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
    if (m === known) continue;   // mtime 未变：不读文件（心跳零读盘）
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
  if (!isMainWindowState(wc) || wc.isDestroyed() || !isLocalHostPage(wc) || !payload || typeof payload !== "object") return;
  /* isLocalHostPage：用量快照是数据出口，与 pollPluginRequests 的信任边界同口径——
   * 主窗导航到外部页面后不再注入/推送（外部页不可读取本机用量与插件状态）。 */
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
const sysmonSubs = new Map();   // v356 系统状态订阅：webContents.id → true（want）；声明前置——maybeSpawn 启动首拉（:866 附近）早于模块尾部声明会踩 TDZ
let sysmonClient = null;        // v356 系统状态采样器实例（onFrame 闭包读它做存活判断）
let sysmonSubMeta = null;       // v358 最近一次 want 请求的 {cfg, hasProjectPath, projectPath}：采样器缺席（热模块未部署）时也保留，实例建好/热换重建时回放，格自愈不丢配置与项目卷标注。单例「最后写者胜」——与 v356 既有 applyConfig 每次覆盖实例配置的语义一致，跨热换延续同一限制
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
    invalidateMobileTarget(e.sender.id);
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
    invalidateMobileTarget(e.sender.id);
    let remoteTask = false;
    for (const scopes of tasks.values()) {
      if ([...scopes].some((id) => REMOTE_IDENTITY_RE.test(id))) { remoteTask = true; break; }
    }
    if (remoteTask) remoteEvidence.set(e.sender.id, true);
    scheduleRetry(300);
  });
  ipcMain.on(IPC_ACTIVE_SID, (e, sid) => {
    if (!trustedSender(e)) return;   // 同源宿主通道同款门控：非主窗口/外部页面不得改写本窗会话归属
    const s = typeof sid === "string" ? sid.trim() : "";
    const val = s && s.length <= 255 && /^[A-Za-z0-9_-]+$/.test(s) ? s : "";
    const prev = activeSid.get(e.sender.id);
    activeSid.set(e.sender.id, val);
    if (prev !== val) scheduleRetry(800);   // 会话切换/窗口就绪：尽快按新会话拉一次（限频器仍生效）
  });
} catch (e) { LOG("ipc hook failed:", e.message); }

/* db 活动戳：db.sqlite / -wal / -shm 的最新 mtime。WAL 模式下写入主要落在 -wal。
 * v279 及查漏补缺：dbDir 镜像宿主 agent 会话库解析（v3.17.1
 * onboarding/localUsageEvidence.resolveAgentSessionDbPath——写库方是 agent 进程，
 * 其链不消费 dataBaseDir）：env ZCODE_SESSION_DB_PATH / ZCODE_SESSION_DB（宿主双
 * 别名按 env 键序取后；~/ 展开与绝对采纳，相对不可镜像忽略）→
 * <home>/.zcode/cli/config.json 的 storage.sessionDbPath（CLI config 恒在 HOME
 * 不随迁）→ dataBaseDir 迁移目录存在性兼容（setting.json 恒在 <home>/.zcode/v2
 * 不随迁移，dataBaseDir 绝对值优先于 ZCODE_DATA_BASE_DIR env；copyDataDirectory
 * 不搬 .zcode/cli）+ issue #294 陈旧候选仲裁——3.18.0 宿主源码复核写库方恒写
 * HOME，候选「存在」不等于「真实写入位」，与 HOME 默认库并存时按 db.sqlite/-
 * wal 最新 mtime 取舍（-shm 只读连接也会更新不算）：候选不落后才采纳，HOME 库
 * 未建仍采纳（#279 真迁移）；Python 侧 _adopt_migration_candidate 内联同款
 * → 默认 <home>/.zcode/cli/db。解析一次随进程生效；运行期变更需完全重启。 */
function dbWriteFreshMs(db) {
  let m = 0;
  for (const f of [db, db + "-wal"]) {
    try { m = Math.max(m, fs.statSync(f).mtimeMs); } catch (e) { }
  }
  return m;
}
function adoptsMigrationCandidate(db, home) {
  const homeDb = path.join(home, ".zcode", "cli", "db", "db.sqlite");
  if (!fs.existsSync(homeDb)) return true;   // #279 真迁移：候选是唯一数据源
  return dbWriteFreshMs(db) >= dbWriteFreshMs(homeDb);
}
function resolveHostDbDir() {
  const env = process.env || {};
  const home = env.ZCODE_DESKTOP_HOME_DIR || app.getPath("home");
  const mirrored = (v) => {   // 宿主 resolveMirroredSessionDbPath 同款：~/ 展开与绝对采纳
    const s = String(v || "").trim();
    if (!s) return "";
    if (s.startsWith("~/")) return path.join(home, s.slice(2));
    return (/^(?:[a-z]:[\\/]|\\\\)/i.test(s) || s.startsWith("/")) ? s : "";
  };
  let picked = "";
  for (const [k, v] of Object.entries(env)) {
    if (k === "ZCODE_SESSION_DB_PATH" || k === "ZCODE_SESSION_DB") picked = v || "";   // 键序取后（含空值，空即弃用）
  }
  const fromEnv = mirrored(picked);
  if (fromEnv) return path.dirname(fromEnv);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(home, ".zcode", "cli", "config.json"), "utf8").replace(/^\uFEFF/, ""));
    const fromCfg = mirrored(cfg && typeof cfg === "object" && cfg.storage && cfg.storage.sessionDbPath);
    if (fromCfg) return path.dirname(fromCfg);
  } catch (e) { }
  try {
    const file = path.join(home, ".zcode", "v2", "setting.json");
    if (fs.existsSync(file)) {
      const s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      let v = String((s && typeof s === "object" && s.dataBaseDir) || "").trim();
      if (v && (/^(?:[a-z]:[\\/]|\\\\)/i.test(v) || v.startsWith("/"))) {
        const db = path.join(v, ".zcode", "cli", "db", "db.sqlite");
        if (fs.existsSync(db) && adoptsMigrationCandidate(db, home)) return path.dirname(db);
      }
    }
  } catch (e) { LOG("[db] setting.json unreadable:", e && e.message); }
  let envBase = String(env.ZCODE_DATA_BASE_DIR || "").trim();   // 宿主与 Python 侧同款 trim 后判空
  if (envBase && (/^(?:[a-z]:[\\/]|\\\\)/i.test(envBase) || envBase.startsWith("/"))) {
    const db = path.join(envBase, ".zcode", "cli", "db", "db.sqlite");
    if (fs.existsSync(db) && adoptsMigrationCandidate(db, home)) return path.dirname(db);
  }
  return path.join(home, ".zcode", "cli", "db");
}
/* issue #314 同源契约补齐：主进程 dbDir/dbStamp 叠一层 config.json 的 hosts.zcode.db_path
 * 覆盖（两跳：脚本同目录 CONFIG → <home>/.zcode/zcode-token-usage-statusbar/config.json，
 * 先到者整段胜出，支持 ~ 与 $VAR/${VAR}/%VAR% 展开，UTF-8 BOM 按损坏忽略），与
 * zusage.zcode_db_path() 及 token_rate._configured_db_path() 完全对齐；resolveHostDbDir()
 * 保持纯净的四层宿主会话库镜像不变。 */
function expandDbPathVars(raw, env, home) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)|%([^%]+)%/g, (m, b, u, w) => {
    const k = b || u || w;
    return Object.prototype.hasOwnProperty.call(env, k) && env[k] != null ? String(env[k]) : m;
  });
  let out;
  if (s === "~") out = home;
  else if (s.startsWith("~/") || s.startsWith("~\\")) out = path.join(home, s.slice(2));
  else if (s.startsWith("~")) return "";   // ~otheruser 在无 passwd 解析时按不可展开忽略（同 token_rate 规则 4）
  else out = s;
  /* 归一分隔符对齐 Python 端 Path(expandvars(...)) 的字符串化语义：模板字面量 "/" 混入
   * Windows 展开值（反斜杠）时三端同形，否则 zusage/token_rate 与本端解析出异形同文件路径。
   * normalize 亦折叠 `..`（Python 保留），无符号链接时指向同一文件，仅 dbStamp/watch 对
   * 不存在路径得空/落空，不产生错误数据。 */
  return out ? path.normalize(out) : "";
}
function resolveConfiguredDbPath(scriptConfigPath) {
  const env = process.env || {};
  const home = env.ZCODE_DESKTOP_HOME_DIR || env.HOME || env.USERPROFILE || app.getPath("home");
  const firstHop = typeof scriptConfigPath === "string" && scriptConfigPath
    ? scriptConfigPath
    : (typeof CONFIG === "string" && CONFIG ? CONFIG : "");
  const secondHop = path.join(home, ".zcode", "zcode-token-usage-statusbar", "config.json");
  const candidates = firstHop ? [firstHop, secondHop] : [secondHop];
  for (const file of candidates) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch (e) { continue; }
    if (!text || text.charCodeAt(0) === 0xFEFF) continue;   // UTF-8 BOM 按损坏跳过（同 Python utf-8 严格解码）
    let data;
    try { data = JSON.parse(text); } catch (e) { continue; }
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const hosts = data.hosts;
    if (!hosts || typeof hosts !== "object" || Array.isArray(hosts)) continue;
    const zcode = hosts.zcode;
    if (!zcode || typeof zcode !== "object" || Array.isArray(zcode)) continue;
    const raw = zcode.db_path;
    if (typeof raw !== "string" || !raw.trim()) return "";   // 先到者整段胜出：空值也遮蔽第二跳
    return expandDbPathVars(raw, env, home);
  }
  return "";
}
let DB_FILE = null;
function dbFile() {
  if (!DB_FILE) {
    const configured = resolveConfiguredDbPath();
    DB_FILE = configured || path.join(resolveHostDbDir(), "db.sqlite");
  }
  return DB_FILE;
}
let DB_DIR = null;
function dbDir() {
  if (!DB_DIR) DB_DIR = path.dirname(dbFile());
  return DB_DIR;
}
function dbStamp() {
  let m = 0;
  const file = dbFile();
  const dir = path.dirname(file);
  const base = path.basename(file) || "db.sqlite";
  for (const f of [base, base + "-wal", base + "-shm"]) {
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
let lastQueryMs = 0;  // 上一帧实际耗时（规则 16：慢帧自适应冷却，占空比封顶约 50%）
let lastDoneAt = 0;   // 上一帧结算时刻（冷却从结算起算：从发起起算时慢帧结算瞬间间隔已满，仍会无缝连发）
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
/* 额度开关真值：config.json 的 quota_enabled（v111 起缺省开，显式 false 才关）——与
 * answer_rate_line 同款真值方向。凭据仍只在内存、只发官方域，关闭即停解密与联网。 */
function quotaEnabled() { return readCfgCached().quota_enabled !== false; }
/* v135 重置卡徽标开关：config.json 的 reset_badge_enabled（缺省开，显式 false 才关）。
 * 独立于 quota_enabled——额度 chip 关闭时本开关仍允许主进程解密凭据、仅查询
 * reset/status 只读端点维护徽标（联网语义已在 ⚙ 面板披露）。 */
function resetBadgeEnabled() { return readCfgCached().reset_badge_enabled !== false; }
/* v344 增强提示词开关：config.json 的 enhance_enabled（缺省开，显式 false 才关）。
 * 关闭即停按钮渲染与 prompt-enhance 动作入口（动作入口 fail-closed 双保险）；
 * 调用仍按用户主动点击发起，不加任何后台周期行为。 */
function enhanceEnabled() { return readCfgCached().enhance_enabled !== false; }
function quotaDataEnabled() { return quotaEnabled() || resetBadgeEnabled(); }
function clearRemoteRecovery() {
  remoteSids.clear();
  pendingSids.clear();
  lastHadRemote = false;
  clearTimeout(retryTimer);
  retryTimer = 0;
}
function syncQuotaProviders() {
  if (shuttingDown || !quotaClient || !quotaDataEnabled()) return;
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
  webContents.getAllWebContents().forEach((target) => pushPluginState(target, pluginUpdater ? pluginUpdater.status() : {}));
  if (lastGoodPayload && quotaClient && quotaDataEnabled()) {
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
  if (quotaClient && quotaDataEnabled()) {
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
  // 定位诊断：每 ~15 次拉取收集每个窗口各自的 __zusageDiag，附加泵侧证据后写 diag-<n>.json
  // （多窗口互不覆盖）。config.diag 显式 false 关闭（省常驻 executeJavaScript + 同步写盘，
  // 排障时设回 true 或删键即恢复，缺省开）。
  if (++pushCount % 15 === 1 && readCfgCached().diag !== false) {
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
              obj.enginePatch = enginePatcher ? enginePatcher.status() : null;
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
    if (state.buf.length > 8 * 1024 * 1024) {   // 无 newline 的异常输出不再无界累积（超时哨兵兜底前先止血）
      LOG("resident stdout overflow, dropping buffer");
      state.buf = "";
      return;
    }
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
  const startedAt = Date.now();
  let settled = false;
  const done = (payload) => {
    if (settled) return;
    settled = true;
    busy = false;
    /* 规则 16（specs/perf-lag-reduction.md）：记录本帧实耗与结算时刻，供 maybeSpawn 做慢帧冷却。
     * 大库/长会话单帧可能远慢于 activity_min_ms：限频若只从「发起」起算，慢帧结算瞬间间隔
     * 已满，下一帧零间隔紧接着发出，serve 连续执行把单核占满（占空比 ≈100%）。上限 15s
     * 防异常值把刷新频率永久拖死。 */
    const nowDone = Date.now();
    const spent = nowDone - startedAt;
    if (spent >= 0) { lastQueryMs = Math.min(15000, spent); lastDoneAt = nowDone; }
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
      /* 规则 16：慢帧场景下 15s 硬超时会杀掉仍在正常计算（但更慢）的常驻进程，
       * 连带丢掉全部内存缓存、下一帧从冷启动重来（8,237 条消息的会话可达此量级）。
       * 放宽到 max(15s, 2×上帧耗时)；lastQueryMs 封顶 15s，故上限实为 30s；快帧时仍是原 15000ms。 */
      const timer = setTimeout(() => {
        LOG("resident query timeout, restarting it");
        stopResident(true);
      }, Math.max(15000, lastQueryMs * 2));
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
  let out = "", finished = false;   // out 上限 8MB：异常输出止血（15s 超时兜底前不无界累积）
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
  py.stdout.on("data", (d) => { if (out.length < 8 * 1024 * 1024) out += d; });
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
  /* 已销毁窗口的映射一并修剪（destroyed 回调漏注册时兜底），防长进程内按死 wc.id 无界累积 */
  for (const id of windowWorkspaces.keys()) if (!liveIds.has(id)) windowWorkspaces.delete(id);
  for (const id of windowTasks.keys()) if (!liveIds.has(id)) windowTasks.delete(id);
  for (const id of scopeBindings.keys()) if (!liveIds.has(id)) scopeBindings.delete(id);
  for (const id of windowQuotaSelections.keys()) if (!liveIds.has(id)) windowQuotaSelections.delete(id);
  let sysmonPruned = false;   // v356：兜底清订阅（destroyed 常规路径之外）；删过要补一次同步，否则渲染端请求在队列中时窗口销毁会留下泄漏订阅
  for (const id of sysmonSubs.keys()) if (!liveIds.has(id)) { sysmonSubs.delete(id); sysmonPruned = true; }
  if (sysmonPruned) sysmonSyncSubscribed();
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
      /* 规则 16 慢帧冷却：结算后须再等 ≥ 上帧实耗才放行 → 占空比 T/(T+T) ≤ 50%。对所有帧生效、
       * 不设「T > 有效间隔」门槛：真库实测冷帧 ~1.05s 低于 activity_min_ms(1.5s)，有门槛时冷却不介入，
       * 占空比仍达 ~70%（T 贴近间隔时近 100%），且在 T 跨过间隔处从 ~100% 骤降到 50%（不连续）。
       * T ≤ 有效间隔/2 时该门被上面的旧限频门覆盖（下一帧 ≥ 发起+间隔 ≥ 结算+T），行为逐字不变。 */
      const cool = lastDoneAt + lastQueryMs - now;
      if (cool > 0) { scheduleRetry(cool + 50); return; }
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
    const base = path.basename(dbFile()) || "db.sqlite";
    dbWatcher = fs.watch(dbDir(), (ev, f) => {
      if (f && !String(f).startsWith(base)) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        maybeSpawn();
        /* v348：手机远控与桌面同款触发模型——DB 写入（每次请求落库）即对账推送，
         * 不再由 mobile-relay 自己 1.5s 轮询；查询节流在其内部（MIN_PUSH_INTERVAL_MS）。 */
        try { if (mobileRelay) mobileRelay.pump(); } catch (e) { }
      }, 300);
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
 * zusage.py 变化时重启常驻进程（serve 进程驻内存的是旧代码）；顺带 stat config mtime。
 * 间隔启动时定死（仿下方 heartbeat 注册期读配置先例）：显式 true 是开发档 2s，缺省 5s
 * 收敛常驻 stat 开销（热更新最晚多等 3s 生效）；false 仍每次 tick 现读、即时禁用。 */
let overlayMtimeKnown = false;
let zusageMtime = 0;
let pricingMtime = 0;
const hotTickMs = readCfg().hot_reload === true ? 2000 : 5000;
setInterval(() => {
  const cfg = readCfgCached();
  if (!residentAllowed()) stopResident();
    if (cfg.hot_reload === false) return;
    hotReloadIfChanged();
    hotReloadMainModules();   // v258：主进程 .cjs 子模块同拍热换（八个：六基础模块 + sysmon-client.cjs + mobile-relay.cjs；mtime 轮询，与 renderer 资产同节奏）
  try {
    const m = fs.statSync(ZUSAGE).mtimeMs;
    if (overlayMtimeKnown && m !== zusageMtime && pyRes) {
      LOG("zusage.py changed, restarting resident python");
      killResidentForUpgrade();
    }
    zusageMtime = m;
    // v202：token_pricing.py 被 zusage.py import（常驻进程驻内存旧代码），同款热重启
    try {
      const pm = fs.statSync(path.join(path.dirname(ZUSAGE), "token_pricing.py")).mtimeMs;
      if (overlayMtimeKnown && pricingMtime !== 0 && pm !== pricingMtime && pyRes) {
        LOG("token_pricing.py changed, restarting resident python");
        killResidentForUpgrade();
      }
      pricingMtime = pm;
    } catch (e2) {
      pricingMtime = 0;   // 文件未部署（旧运行目录）：随 zusage.py 重启自然加载
    }
    overlayMtimeKnown = true;
  } catch (e) { }
}, hotTickMs);
setInterval(maybeSpawn, Math.max(10000, readCfg().heartbeat_ms | 0 || 30000));   // 兜底心跳：防文件事件丢失
watchDb();
maybeSpawn();   // 启动先拉一次

let modelPuller = null;
let pluginUpdater = null;
let enginePatcher = null;   // v179：声明前置——updater createUpdater 同步 notify→pushPluginState 会读它（TDZ）
let pluginRequestBusy = false;
let lastGoodPayload = null;   // 额度结算后无需重查库即可向各窗口补推（payload 已含 quota）
let quotaClient = null;
function pushPluginState(wc, state) {
  if (!isMainWindowState(wc) || wc.isDestroyed() || !isLocalHostPage(wc)) return;
  /* rateLine / quotaEnabled / restartNotice / enginePatch 随插件状态一起推送：⚙ 面板开关的真值都来自 config.json */
  const payload = { ...state, rateLine: readCfgCached().answer_rate_line !== false, quotaEnabled: quotaEnabled(),
    resetBadgeEnabled: resetBadgeEnabled(), restartNotice: readCfgCached().restart_notice !== false,
    enhanceEnabled: enhanceEnabled(), enhanceProvider: enhanceProviderView(), mobileRelayEnabled: mobileEnabled(), mobileRelaySupported: true,
    quotaSources: quotaClient ? quotaClient.sourcesConfig() : [], enginePatch: enginePatcher ? enginePatcher.status() : null, feedbackVersion: 1,
    relaunchSupported: true };   // v180 issue #158：能力标记与下方 relaunch 分支同文件（inject-main），缺标记=旧主进程必然没有该动作分支
  wc.executeJavaScript(`window.__zusagePluginUpdate && window.__zusagePluginUpdate(${JSON.stringify(payload)})`, true).catch(() => { });
}
/* ack 必须先于更新器初始化：createUpdater 会在创建瞬间快照 marker 状态并作为首帧
 * 推送——若 ack 后跑，已清除的「待重启」会在重启后的第一分钟被误报（实测 2026-11-01）。 */
acknowledgeRestart();
/* v258：初始化提炼为可重入函数——同名热替换循环（文件尾 hotReloadMainModules）复用
 * 同一套装配代码重建实例；require 失败时模块级变量保留旧实例，行为与首装失败一致。 */
function initPluginUpdater() {
  try {
    const prevState = pluginUpdater && typeof pluginUpdater.status === "function" ? pluginUpdater.status() : null;
    const { createUpdater } = require("./plugin-updater.cjs");
    pluginUpdater = createUpdater({ runtime: HERE, home: app.getPath("home"),
      resourcesPath: process.resourcesPath, executable: process.execPath,
      initialState: prevState,
      notify: (state) => webContents.getAllWebContents().forEach((wc) => pushPluginState(wc, state)),
      /* v258：安装同步落盘且 busy 释放后先把变更模块热换进内存并销账 marker，再让更新器
       * 发布终态——已热加载的模块不再要求重启，⚙ 红点零闪烁（G3）。 */
      onRuntimeSynced: async () => { await hotReloadMainModules(); },
    });
    return pluginUpdater;
  } catch (e) {
    pluginUpdater = null;
    delete loadedHashes["plugin-updater.cjs"];
    delete loadedHashes["plugin-release.cjs"];
    delete loadedHashes["plugin-storage.cjs"];
    LOG("plugin updater unavailable:", e.message);
    return null;
  }
}
initPluginUpdater();

/* ---------- v179 自动压缩阈值引擎补丁：默认关。开启后启动时按 ENGINE_TARGETS 的
 * SHA256 白名单给 <resources>/glm/zcode.cjs 打阈值改道补丁（fail-open/fail-closed
 * 语义详见 engine-patch.cjs 头注）。补丁冷生效（引擎子进程下次 spawn 起用，已运行
 * 会话保持旧阈值）；阈值数值走 autocompact.json 热生效（引擎每轮决策读该文件）。
 * 关闭开关=还原引擎字节。加载失败只少该功能，不拖垮主链。 */
function initEnginePatcher() {
  try {
    const { createEnginePatcher } = require("./engine-patch.cjs");
    enginePatcher = createEnginePatcher({
      runtime: HERE,
      resourcesPath: process.resourcesPath,
      appVersion: app.getVersion(),   // issue #191：引擎 sha 漂移时按桌面 build 判"引擎被单独热更"
      isEnabled: () => readCfgCached().auto_compact_patch !== false,   // v188：缺省开（验收反馈），显式 false 关闭
      log: (...a) => LOG("[engine-patch]", ...a),
    });
    enginePatcher.syncStartup();   // 幂等：已 applied 且引擎未变时只重读字节设状态，不重复写盘
    return enginePatcher;
  } catch (e) {
    enginePatcher = null;
    LOG("engine patcher unavailable:", e.message);
    return null;
  }
}
initEnginePatcher();
/* v331：mobile-relay（手机远控中继，热换模块 #7）。stash 由 mobile_relay_patch.py
 * 注入主 bundle；本模块只消费——加载失败只少推送，不拖垮主链。
 * 目标发现与发送前复验均读取宿主 mobileTaskView，并绑定唯一官方 live 桥；
 * config mobile_relay.enabled 仅显式 true 开启。 */
let mobileRelay = null;
let mobileTarget = null;
let mobileDiscovery = 0;
function mobileEnabled() {
  const cfg = readCfgCached().mobile_relay;
  return !!(cfg && typeof cfg === "object" && !Array.isArray(cfg) && cfg.enabled === true);
}
function mobileWindows() {
  return webContents.getAllWebContents().filter((wc) => trustedSender({ sender: wc }));
}
function mobileBridgeBinding() {
  const stash = Array.isArray(globalThis.__zusageRelayStash) ? globalThis.__zusageRelayStash : [];
  const bridges = stash.filter((e) => e && e.p && e.b && e.b.readyAnnounced === true &&
    !e.b.degraded && !e.b.closed && !e.b.destroyed && e.b.relayProtocol && e.b.relayProtocol.protocol === e.p);
  if (bridges.length !== 1) return null;
  const { b, p } = bridges[0];
  let identity;
  if (b.kind === "local" && (b.workspaceIdentity === undefined || b.workspaceIdentity === "")) identity = "";
  else if (b.kind === "remote" && typeof b.workspaceIdentity === "string" && REMOTE_IDENTITY_RE.test(b.workspaceIdentity)) identity = b.workspaceIdentity;
  else return null;
  if (typeof b.workspacePath !== "string") return null;
  const remoteSessionId = b.remoteSessionId;
  if (remoteSessionId !== undefined && (typeof remoteSessionId !== "string" || !remoteSessionId)) return null;
  return { workspacePath: b.workspacePath, workspaceIdentity: identity, remoteSessionId,
    bridge: p, bridgeState: b, relay: b.relayProtocol };
}
function resolveMobileTarget(target) {
  if (!target || typeof target.taskId !== "string" || typeof target.workspacePath !== "string") return null;
  const binding = mobileBridgeBinding();
  if (!binding || binding.workspacePath !== target.workspacePath) return null;
  if (target.workspaceIdentity !== binding.workspaceIdentity &&
      !(binding.workspaceIdentity === "" && target.workspaceIdentity === undefined)) return null;
  if (target.remoteSessionId !== binding.remoteSessionId) return null;
  return { taskId: target.taskId, ...binding };
}
function sameMobileTarget(a, b) {
  return !!a && !!b && a.taskId === b.taskId && a.workspacePath === b.workspacePath &&
    a.workspaceIdentity === b.workspaceIdentity && a.remoteSessionId === b.remoteSessionId &&
    a.bridge === b.bridge && a.bridgeState === b.bridgeState && a.relay === b.relay;
}
function resolveMobileStatus(raw) {
  let status;
  try { status = JSON.parse(raw || "null"); } catch (e) { return null; }
  return resolveMobileTarget(status && status.mobileConnected === true ? status.mobileTaskView : null);
}
function mobileTargetTrusted(wc, target) {
  if (shuttingDown || !mobileEnabled() || !wc || !trustedSender({ sender: wc })) return false;
  const windows = mobileWindows();
  if (windows.length !== 1 || windows[0] !== wc) return false;
  if (!target || typeof target.taskId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(target.taskId) ||
      typeof target.workspaceIdentity !== "string" || typeof target.workspacePath !== "string" ||
      target.workspaceIdentity.length > 2048 || target.workspacePath.length > 4096) return false;
  if (!sameMobileTarget(resolveMobileTarget(target), target)) return false;
  const tasks = windowTasks.get(wc.id);
  const scopes = tasks && tasks.get(target.taskId);
  /* 手机可打开未出现在桌面 tabs 的动态项目；身份由官方 live 桥确认，任务明确矛盾仍拒绝。
   * 普通桌面 pane 继续使用 maybeSpawn 中的 windowWorkspaces 白名单。 */
  return !scopes || scopes.has(target.workspaceIdentity);
}
function revokeMobileTarget() {
  mobileTarget = null;
  if (mobileRelay) { try { mobileRelay.push({ zm: 1, target: null }); } catch (e) { } }
}
function invalidateMobileTarget(id) {
  if (mobileTarget && mobileTarget.wc.id === id && !mobileTargetTrusted(mobileTarget.wc, mobileTarget.target)) {
    mobileDiscovery++;
    revokeMobileTarget();
  }
}
function initMobileRelay() {
  if (mobileRelay) { try { mobileRelay.dispose(); } catch (e) { } mobileRelay = null; }
  mobileTarget = null;
  mobileDiscovery++;
  try {
    const { createMobileRelay } = require("./mobile-relay.cjs");
    mobileRelay = createMobileRelay({
      log: (...a) => LOG("[mobile-relay]", ...a),
      getMinIntervalMs: () => readCfgCached().activity_min_ms | 0 || 1500,
      getRemotePollMs: remotePollMs,
      strictOptIn: true, // 旧 cold loader 缺此能力时，新 relay 必须关闭。
      isEnabled: mobileEnabled,
      getPythonCmd: () => readCfgCached().python_path,
    });
    return mobileRelay;
  } catch (e) {
    mobileRelay = null;
    LOG("mobile relay unavailable:", e.message);
    return null;
  }
}
initMobileRelay();
/* 目标发现独立于 DB 事件，重复目标的查询去重由 relay 负责。 */
const MOBILE_VERIFY_JS = `(async () => {
  try {
    if (!window.zcode || typeof window.zcode.getWebRemoteControlStatus !== "function") return null;
    return JSON.stringify(await window.zcode.getWebRemoteControlStatus());
  } catch (e) { return null; }
})()`;
const MOBILE_PUMP_MS = 1500;
setInterval(() => {
  try {
    if (shuttingDown || !mobileRelay) return;
    const seq = ++mobileDiscovery;
    if (!mobileEnabled()) { revokeMobileTarget(); return; }
    const windows = mobileWindows();
    if (windows.length !== 1 || !trustedSender({ sender: windows[0] })) { revokeMobileTarget(); return; }
    const wc = windows[0], relay = mobileRelay, binding = mobileBridgeBinding();
    if (!binding) { revokeMobileTarget(); return; }
    Promise.resolve().then(() => wc.executeJavaScript(MOBILE_VERIFY_JS, true))
      .then((v) => {
        if (seq !== mobileDiscovery || relay !== mobileRelay || shuttingDown || !mobileEnabled()) return;
        const target = resolveMobileStatus(v);
        if (!sameMobileTarget(binding, mobileBridgeBinding()) || !mobileTargetTrusted(wc, target)) { revokeMobileTarget(); return; }
        const old = mobileTarget;
        if (!old || old.wc !== wc || !sameMobileTarget(old.target, target)) mobileTarget = { wc, target };
        const current = mobileTarget;
        const validate = () => relay === mobileRelay && mobileTarget === current && mobileTargetTrusted(wc, current.target);
        const verifyTarget = async () => {
          try {
            if (!validate()) return false;
            const verified = resolveMobileStatus(await wc.executeJavaScript(MOBILE_VERIFY_JS, true));
            return sameMobileTarget(verified, current.target) && validate();
          } catch (e) { return false; }
        };
        try { relay.push({ zm: 1, target: current.target }, validate, verifyTarget); } catch (e) { }
      })
      .catch(() => { if (seq === mobileDiscovery && relay === mobileRelay) revokeMobileTarget(); });
  } catch (e) { }
}, MOBILE_PUMP_MS);


/* ---------- v229 宿主路径解析（额度 / 模型拉取共用，issue #205）：主进程 env 没有
 * ZCODE_*（宿主只注入 CLI 子进程），数据目录迁移（setting.json dataBaseDir）后
 * ~/.zcode/v2 下读不到 provider_config/credentials。与宿主 bootstrap 同源解析：
 * setting.json 恒在 <home>/.zcode/v2（不跟随迁移，desktopDataBaseDirBootstrap.ts），
 * dataBaseDir 只采纳绝对路径（宿主对相对值无稳定基准）且优先于 ZCODE_DATA_BASE_DIR
 * env（同宿主 setDataBaseDir > env）；builtin 模板回落打包副本
 * resources/config/provider/zcode-builtin.json（模板创建供应商 baseUrl 的唯一来源），
 * 宿主显式指定 ZCODE_BUILTIN_PROVIDER_CONFIG_FILE 时让位。运行期迁移与其它冷路径
 * 一样需完全重启生效。 */
function resolveHostQuotaPaths() {
  const env = process.env || {};
  const home = env.ZCODE_DESKTOP_HOME_DIR || app.getPath("home");
  let dataBaseDir = "";
  try {   // 缺文件静默（默认用户恒走此路）；损坏只丢该字段并留一条诊断，不拖垮额度链
    const file = path.join(home, ".zcode", "v2", "setting.json");
    if (fs.existsSync(file)) {
      const s = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      const v = String((s && typeof s === "object" && s.dataBaseDir) || "").trim();
      if (v && (/^(?:[a-z]:[\\/]|\\\\)/i.test(v) || v.startsWith("/"))) dataBaseDir = v;
    }
  } catch (e) { LOG("[quota] setting.json unreadable:", e && e.message); }
  let bundled = "";
  try {
    if (!env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE) {
      const p = path.join(process.resourcesPath || "", "config", "provider", "zcode-builtin.json");
      if (fs.existsSync(p)) bundled = p;
    }
  } catch (e) { }
  const { resolveQuotaPaths } = require("./quota-client.cjs");
  return resolveQuotaPaths({ env, defaultHome: home,
    dataBaseDir: dataBaseDir || undefined, builtinCfgPath: bundled || undefined });
}

/* ---------- v96 额度客户端（BigModel/Z.ai 个人编码套餐）：解密宿主 OAuth 凭据 →
 * monitor 端点 → 归一化 → 快照 quota 字段。独立模块，加载失败只少额度不拖垮主链
 * （overlay 收不到 quota 字段即隐藏 chip）。凭据只在 quota-client 进程内存流转；
 * 诊断只记 status/HTTP code/错误摘要，token 与请求头绝不进日志。 */
/* ---------- v96 额度客户端（BigModel/Z.ai 个人编码套餐）：解密宿主 OAuth 凭据 →
 * monitor 端点 → 归一化 → 快照 quota 字段。独立模块，加载失败只少额度不拖垮主链
 * （overlay 收不到 quota 字段即隐藏 chip）。凭据只在 quota-client 进程内存流转；
 * 诊断只记 status/HTTP code/错误摘要，token 与请求头绝不进日志。
 * v258：装配提炼为 createQuotaClientInstance()（热替换循环复用）；凭据目录 watcher
 * 一次注册（initQuotaWatchers），回调现读模块级 quotaClient——热替换实例无需重建
 * watcher，重绑自动生效；disposeQuotaSubsystem 供退出与清理。 */
const QUOTA_SECRETS = path.join(HERE, "quota-secrets.json");
let quotaWatchers = [];   // 全部凭据目录 fs.watch 句柄
let quotaCredDebounce = 0;
let quotaInited = false;
let quotaWatchGeneration = 0;   // disposeQuotaSubsystem 递增：让在途的 5s 重试定时器不再复活 watcher
function createQuotaClientInstance() {
  try {
    const { createQuotaClient } = require("./quota-client.cjs");
    const quotaPaths = resolveHostQuotaPaths();
    quotaClient = createQuotaClient({
      ...quotaPaths,
      secretsPath: QUOTA_SECRETS,
      quotaEnabled,
      resetEnabled: resetBadgeEnabled,
      resetList: true,   // v135：bigmodel 族并行查网页控制台列表端点（近 7 天过期卡 + 上次重置）

      log: (...a) => LOG("[quota]", ...a),
      onUpdate: () => {   // 刷新开始/结算及解冻时同步源状态与最近成功快照
        broadcastPluginState();
        if (!lastGoodPayload || !quotaClient) return;   // dispose 在途 settle 竞窗：旧实例回调到已置空引用
        const withQuota = Object.assign({}, lastGoodPayload, { quota: quotaClient.view() });
        for (const wc of webContents.getAllWebContents()) pushOnce(wc, withQuota);
      },
    });
    return quotaPaths;
  } catch (e) {
    quotaClient = null;   // 热换路径旧实例已 dispose：不留僵尸引用（冷启动本就是 null）
    delete loadedHashes["quota-client.cjs"];
    LOG("quota client unavailable:", e.message);
    return null;
  }
}
function initQuotaWatchers(quotaPaths) {
  /* 监听实际凭据与 builtin/personal 目录（原子替换文件也能收到），配置变更重判归属并解冻。 */
  const generation = quotaWatchGeneration;
  const retryWatch = (watchQuotaCredentials) => setTimeout(() => {
    if (generation === quotaWatchGeneration) watchQuotaCredentials();
  }, 5000);
  const quotaWatchDirs = new Map();
  for (const [file, dir] of [[quotaPaths.credsPath, quotaPaths.credsDir],
    [quotaPaths.customCfgPath, quotaPaths.customCfgDir], [quotaPaths.builtinCfgPath, quotaPaths.builtinCfgDir]]) {
    if (!file) continue;
    if (!quotaWatchDirs.has(dir)) quotaWatchDirs.set(dir, new Set());
    const filePath = /^(?:[a-z]:[\\/]|\\\\)/i.test(file) ? path.win32 : path.posix;
    quotaWatchDirs.get(dir).add(filePath.basename(file));
  }
  for (const [dir, names] of quotaWatchDirs) {
    const watchQuotaCredentials = () => {
      try {
        const watcher = fs.watch(dir, (ev, f) => {
          if (f && !names.has(String(f))) return;
          clearTimeout(quotaCredDebounce);
          quotaCredDebounce = setTimeout(() => {
            if (!quotaClient || !quotaDataEnabled()) return;
            quotaClient.credentialsChanged();
            syncQuotaProviders();   // 重读配置后重判 provider 绑定（内含 tick）
          }, 300);
        });
        watcher.on("error", () => {
          quotaWatchers = quotaWatchers.filter((w) => w !== watcher);
          try { watcher.close(); } catch (e) { }
          retryWatch(watchQuotaCredentials);
        });
        quotaWatchers.push(watcher);
      } catch (e) { retryWatch(watchQuotaCredentials); }
    };
    watchQuotaCredentials();
  }
  setInterval(() => {   // 兜底：not_configured 低频重探/退避到点补拉（活跃时 handlePayload 也会 tick）
    if (hasWindows() && quotaDataEnabled()) syncQuotaProviders();
  }, 60000);
}
function initQuotaSubsystem() {
  if (quotaInited) return;
  quotaInited = true;
  const quotaPaths = createQuotaClientInstance();
  if (quotaPaths) initQuotaWatchers(quotaPaths);
}
function disposeQuotaSubsystem() {
  quotaWatchGeneration += 1;   // 取消在途 watcher 重试定时器（退出瞬间触发不再重建）
  clearTimeout(quotaCredDebounce);
  for (const watcher of quotaWatchers) { try { watcher.close(); } catch (e) { } }
  quotaWatchers = [];
  if (quotaClient) quotaClient.dispose();
}
initQuotaSubsystem();

/* ---------- v129 模型拉取：自定义供应商 /models 一键拉取并写回 provider_config.json。
 * 独立模块独立 try：拉取失败只少该功能，不拖垮额度链与主泵。
 * v258：装配提炼为 initModelPuller()——decryptValue 来自 quota-client（本文件注入，
 * model-puller 不自带），热替换 quota-client 后必须重建本实例以换用新解密函数。 */
function initModelPuller() {
  if (modelPuller && typeof modelPuller.dispose === "function") modelPuller.dispose();
  try {
    const { createModelPuller } = require("./model-puller.cjs");
    const { decryptValue, deriveCipherKey } = require("./quota-client.cjs");
    const pullPaths = resolveHostQuotaPaths();
    modelPuller = createModelPuller({
      customCfgPath: pullPaths.customCfgPath,
      builtinCfgPath: pullPaths.builtinCfgPath,   // 模板供应商（如 opencode-go-chat）的 baseUrl/protocol 在打包 templateRules
      credentialsPath: pullPaths.credsPath,   // v229：迁移后 ~/.zcode/v2/credentials.json 是宿主不读的死目录（issue #205）
      decryptValue: (enc) => decryptValue(enc, deriveCipherKey(process.env)),   // 套餐源：内存解密，同额度链纪律
      cachePath: path.join(__dirname, "model-efforts-cache.json"),   // #236：档位索引落运行目录（pricing-cache.json 同款先例），跨重启复用
      log: (...a) => LOG("[model-pull]", ...a),
    });
    return modelPuller;
  } catch (e) {
    modelPuller = null;
    LOG("model puller unavailable:", e.message);
    return null;
  }
}
initModelPuller();

/* ---------- v339 pending 更新包清理自愈（macOS，issue #298）：旧 v228 预注入（Squirrel
 * 取包前改写 pending zip 内 app.asar）废除——宿主 electron-updater 6.8.10 +
 * autoInstallOnAppQuit=false 下，Squirrel 经 MacUpdater 本地代理按「下载完成时固化的
 * 官方 Content-Length」拉流，改写后的 zip 总大小必然偏离该长度（实测 3.18.0 官方
 * 305,360,451 B → 重写后 317,024,560 B），拉包被截断即 Squirrel 解析失败，宿主静默
 * relaunch 回旧版；restage 缓存命中同一坏包，连续重试全部复现。现反转为清理：
 * 旧版改写留有运行目录 pending-zip-patch.json 账本，这里只在「账本有记录且 zip 仍在
 * pending」时触发 pending_zip_patch.py 按 sha256 对账删除（宿主自动重下官方字节），
 * 无记录的 zip（含官方包）绝不触碰。清理是纠错自愈，恒开；没有候选时零 spawn。
 * Windows 走 NSIS 安装器，本就无 pending zip 链。 */
let pendingZipWatcher = null;
let pendingZipTimer = null;
let pendingZipDebounce = 0;
let pendingZipBusy = false;
let pendingZipFails = 0;
let pendingZipLastFailAt = 0;
function updaterCacheDirName() {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8");
    const m = yml.match(/^updaterCacheDirName:\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  } catch (e) { }
  return "@zcodedesktop-updater";   // 官方 app-update.yml 实测值；读不到时兜底
}
function pendingZipDir() {
  return path.join(app.getPath("home"), "Library", "Caches", updaterCacheDirName(), "pending");
}
function pendingZipCandidate() {
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(path.join(HERE, "pending-zip-patch.json"), "utf8"));
  } catch (e) { return null; }
  const files = state && typeof state === "object" ? state.files : null;
  if (!files || typeof files !== "object") return null;
  let names = [];
  try { names = fs.readdirSync(pendingZipDir()); } catch (e) { return null; }
  for (const name of Object.keys(files)) {
    // 账本是本插件写的，仍按防御处理：带路径分隔符/相对段的记录名绝不解析出 pending 目录
    if (typeof name !== "string" || !name.endsWith(".zip")) continue;
    if (name.includes("/") || name.includes("\\") || name.includes("..")) continue;
    if (!names.includes(name)) continue;
    const rec = files[name];
    if (!rec || typeof rec !== "object" || rec.runtime !== HERE) continue;   // 他运行目录名下的记录归他清
    return path.join(pendingZipDir(), name);
  }
  return null;
}
function cleanupPendingZip() {
  if (pendingZipBusy || shuttingDown) return;
  if (process.platform !== "darwin") return;
  if (pendingZipFails >= 3 && Date.now() - pendingZipLastFailAt < 600000) return;   // 失败退避 10 分钟
  const zip = pendingZipCandidate();
  if (!zip) return;
  pendingZipBusy = true;
  const py = spawn(readCfgCached().python_path,
    [path.join(HERE, "pending_zip_patch.py"), "--zip", zip, "--runtime", HERE],
    { windowsHide: true, timeout: 900000 });   // 看门狗：300MB zip 慢盘 sha256 余量取 15 分钟，卡死不再占住 in-flight
  let out = "";
  py.stdout.on("data", (d) => { out += d; if (out.length > 4000) out = out.slice(-4000); });
  py.stderr.on("data", (d) => { out += d; if (out.length > 4000) out = out.slice(-4000); });
  py.on("error", (e) => {
    pendingZipBusy = false; pendingZipFails++; pendingZipLastFailAt = Date.now();
    LOG("pending zip cleanup spawn failed:", e.message);
  });
  py.on("close", (code) => {
    pendingZipBusy = false;
    if (code === 0) { pendingZipFails = 0; LOG("pending update zip cleanup:", path.basename(zip)); return; }
    pendingZipFails++; pendingZipLastFailAt = Date.now();
    LOG("pending zip cleanup failed (exit " + code + "):", out.trim().slice(-400));
  });
}
{
  if (process.platform === "darwin") {
    pendingZipTimer = setInterval(cleanupPendingZip, 60000);   // 兜底轮询：fs.watch 事件不保证送达
    try {
      pendingZipWatcher = fs.watch(pendingZipDir(), () => {
        clearTimeout(pendingZipDebounce);
        pendingZipDebounce = setTimeout(cleanupPendingZip, 3000);   // 宿主清缓存/重下落盘的去抖
      });
      pendingZipWatcher.on("error", () => {
        try { pendingZipWatcher.close(); } catch (e) { }
        pendingZipWatcher = null;   // 缓存目录被清后由 60s 兜底轮询接管
      });
    } catch (e) { /* 目录尚不存在：等 60s 兜底轮询 */ }
  }
}

/* ---------- v356 系统状态采样（issue #338 / specs/statusbar-system-status.md）：主进程单例
 * 采样器（sysmon-client.cjs 热模块），订阅制轮询——渲染端经 pluginRequest sysmon-sub 声明兴趣
 * {want, cfg, projectPath}，want>0 才轮询；帧经 pushOnce 同款信任门推 window.__zusageSysmon。
 * 只推订阅窗口：未订阅窗口不收帧，收帧的信任边界与 pushOnce/isLocalHostPage 同口径。 */
function pushSysmonTo(wc, frame) {
  if (!isMainWindowState(wc) || wc.isDestroyed() || !isLocalHostPage(wc) || !frame || typeof frame !== "object") return;
  /* U+2028/2029 转义同 pushOnce：卷名/挂载点可能含任意文本 */
  const js = `window.__zusageSysmon && window.__zusageSysmon(${JSON.stringify(frame).replace(/[\u2028\u2029]/g, (c) => c === "\u2028" ? "\\u2028" : "\\u2029")})`;
  wc.executeJavaScript(js, true).catch(() => { });
}
function sysmonWantAny() {
  for (const v of sysmonSubs.values()) { if (v) return true; }
  return false;
}
function sysmonSyncSubscribed() {
  const client = sysmonClient || createSysmonClientInstance();
  if (client) client.setSubscribed(sysmonWantAny());
}
function createSysmonClientInstance() {
  try {
    const { createSysmonClient } = require("./sysmon-client.cjs");
    sysmonClient = createSysmonClient({
      log: (...a) => LOG("[sysmon]", ...a),
      onFrame: (frame) => {
        if (!sysmonClient) return;   // dispose 在途竞窗：旧实例回调不再外发
        for (const wc of webContents.getAllWebContents()) {
          if (sysmonSubs.get(wc.id) !== true) continue;
          pushSysmonTo(wc, frame);
        }
      },
    });
    if (sysmonSubMeta) {   // v358 热换重建/缺席后补建：回放最近一次 want 请求的 cfg 与项目卷（未订阅态只写字段，不触发采样）
      try { sysmonClient.applyConfig(sysmonSubMeta.cfg, sysmonSubMeta.hasProjectPath ? sysmonSubMeta.projectPath : undefined); } catch (e) { LOG("sysmon meta replay failed:", (e && e.message) || e); }
    }
    return sysmonClient;
  } catch (e) {
    sysmonClient = null;   // 热换路径旧实例已 dispose：不留僵尸引用（冷启动本就是 null）
    delete loadedHashes["sysmon-client.cjs"];
    LOG("sysmon client unavailable:", e.message);
    return null;
  }
}
function handleSysmonRequest(req, wc) {
  const want = req.want === true;
  if (typeof req.projectPath === "string" && req.projectPath !== "" && !gitPathOk(req.projectPath)) {
    deliverPluginRequest(wc, req.requestId, { ok: false, error: "invalid project path" });
    return;
  }
  if (want) {
    /* v358 先留档再建实例：sysmon-client.cjs 是热模块，运行目录尚未部署（或热换前）时
     * require 失败——此时仍把 want 记进 sysmonSubs 并返回 ok:false。否则热换路径
     * 「按现存订阅重放」永远等不到订阅者，渲染端签名守卫又不重发，格停在 loading
     * 直到用户开关一次或重开窗口（Windows 实测：部署采样器后格不自愈的根因）。 */
    sysmonSubMeta = {
      cfg: req.cfg && typeof req.cfg === "object" && !Array.isArray(req.cfg) ? req.cfg : null,
      hasProjectPath: typeof req.projectPath === "string",
      projectPath: typeof req.projectPath === "string" ? req.projectPath : "",
    };
    const client = sysmonClient || createSysmonClientInstance();
    if (!client) {
      sysmonSubs.set(wc.id, true);   // 记账先于可用性：热模块补上后 sysmonWantAny() 即为真，自动采样补帧
      deliverPluginRequest(wc, req.requestId, { ok: false, error: "sysmon unavailable; fully restart ZCode to load it" });
      return;
    }
    client.applyConfig(sysmonSubMeta.cfg, sysmonSubMeta.hasProjectPath ? sysmonSubMeta.projectPath : undefined);
  }
  sysmonSubs.set(wc.id, want);
  sysmonSyncSubscribed();
  deliverPluginRequest(wc, req.requestId, { ok: true });
}

/* ---------- v202 更新日志：⚙ 更新页按需拉取当前 Release 渠道的发布说明。独立 try：
 * 拉取/缓存失败只少日志卡片，不拖垮更新链。渲染进程只传 version/force，flavor 与
 * repository 一律取自主进程读到的注册渠道，绝不接收页面提供的地址。缓存落运行目录
 * plugin-notes-cache.json（身份键 flavor|repo|version，TTL 1h，非发布素材不进分发链）。 */
let releaseNotes = null;
function initReleaseNotes() {
  try {
    const { createNotesService, createNotesCache } = require("./plugin-release.cjs");
    releaseNotes = createNotesService({ cache: createNotesCache({ file: path.join(HERE, "plugin-notes-cache.json") }) });
    return releaseNotes;
  } catch (e) {
    releaseNotes = null;
    LOG("release notes unavailable:", e.message);
    return null;
  }
}
initReleaseNotes();

/* ---------- v258 主进程子模块热替换（G3：更新除 inject-main.cjs 引导壳以外的主进程
 * 模块后零重启生效、零红点闪烁）。冷文件名单里 overlay/turn-stats/zusage 之外的 .cjs
 * 在这里按 mtime 轮询热换（六基础模块自 v258；sysmon-client.cjs 自 v356、
 * mobile-relay.cjs 自 v331 加入）：
 * 语法预检（读到半截/被 Windows 独占锁住则跳过本轮）→
 * dispose 旧实例 → 清 require.cache → 重建实例（依赖方向：quota-client 先落，重装
 * modelPuller 的 decryptValue 注入；release/storage 变更联动重建 updater 与 notes）→
 * 刷新 loadedHashes 与 _hotLoadedAt → acknowledgeRestart 销账 → 广播状态。
 * watcher/定时器一次注册：回调全部现读模块级实例变量，热换不需要也不得重建
 * （quotaWatchers 重复注册会翻倍）。engine-patch 热换后 syncStartup 幂等，
 * 已 applied 且引擎未变不重复写盘。inject-main.cjs 自身不在热换面内：
 * 它持有 ipcMain/web-contents-created 注册与常驻泵，只能随客户端完全重启生效。 */
const HOT_MAIN_MODULES = ["plugin-storage.cjs", "plugin-release.cjs", "plugin-updater.cjs", "quota-client.cjs", "model-puller.cjs", "engine-patch.cjs", "mobile-relay.cjs", "sysmon-client.cjs"];
const hotModuleMtimes = {};
for (const name of HOT_MAIN_MODULES) {
  try { hotModuleMtimes[name] = fs.statSync(path.join(HERE, name)).mtimeMs; } catch (e) { }
}
let hotMainBusy = false;
function hotReloadMainModules() {
  if (hotMainBusy) return Promise.resolve(false);   // 与在途热替换/销账互斥：顺延下一 tick
  if (readCfgCached().hot_reload === false) return Promise.resolve(false);
  // 显式关闭热重载时一律回退为重启生效：mtime 轮询与更新链 onRuntimeSynced 两条路径都必须被门挡住
  hotMainBusy = true;
  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  let result;
  try {
    result = hotReloadMainModulesOnce();
  } catch (e) {
    LOG("hot reload failed:", (e && e.message) || e);
    hotMainBusy = false;
    done(false);
    return finished;
  }
  Promise.resolve(result)
    .then((v) => done(v), (e) => { LOG("hot reload failed:", (e && e.message) || e); done(false); })
    .then(() => { hotMainBusy = false; });
  return finished;
}
function hotReloadMainModulesOnce() {
  const changed = [], mtimes = {};
  for (const name of HOT_MAIN_MODULES) {
    let m = 0;
    try { m = fs.statSync(path.join(HERE, name)).mtimeMs; } catch (e) { continue; }
    if (hotModuleMtimes[name] === m) continue;
    changed.push(name);
    mtimes[name] = m;   // 启动时缺文件后来补齐的也会进 changed：热换路径顺带恢复缺失的子系统
  }
  if (!changed.length) return Promise.resolve(false);
  const sources = {};
  for (const name of changed) {
    try {
      const src = fs.readFileSync(path.join(HERE, name), "utf8");
      new Function(src);   // 语法预检：半截文件/独占锁（EBUSY/EPERM）留到下轮重试
      sources[name] = src;
    } catch (e) {
      LOG("hot reload skipped (unreadable or invalid):", name, (e && e.message) || e);
      return Promise.resolve(false);   // 不更新 mtime：保留旧实例，下轮重试
    }
  }
  if (changed.some((n) => n === "plugin-updater.cjs" || n === "plugin-release.cjs" || n === "plugin-storage.cjs") &&
      pluginUpdater && pluginUpdater.status().busy) {
    LOG("hot reload deferred: updater busy");   // 旧更新链还持有旧实例闭包，等 busy=false 再换
    return Promise.resolve(false);
  }
  const purge = (name) => { try { delete require.cache[require.resolve("./" + name)]; } catch (e) { } };
  const ok = {};   // 模块名 -> 重建是否成功：销账与 mtime 只认成功换入者（防「语法过、装配炸」被销账成已加载）
  if (changed.includes("quota-client.cjs")) {
    if (quotaClient) { try { quotaClient.dispose(); } catch (e) { } }   // watcher 保留（回调现读模块级变量）
    purge("quota-client.cjs");
    ok["quota-client.cjs"] = !!createQuotaClientInstance();
    purge("model-puller.cjs");
    ok["model-puller.cjs"] = !!initModelPuller();   // 联动重建：decryptValue 注入须跟随新 quota-client
    if (ok["quota-client.cjs"]) syncQuotaProviders();   // 新实例从零起步：立即重建 provider 绑定并触发首轮查询
  } else if (changed.includes("model-puller.cjs")) {
    purge("model-puller.cjs");
    ok["model-puller.cjs"] = !!initModelPuller();
  }
  if (changed.includes("engine-patch.cjs")) {
    purge("engine-patch.cjs");
    ok["engine-patch.cjs"] = !!initEnginePatcher();
  }
  if (changed.includes("sysmon-client.cjs")) {   // v356：dispose 停定时器 → purge → 重建 → 按现存订阅重放
    if (sysmonClient) { try { sysmonClient.dispose(); } catch (e) { } }
    sysmonClient = null;
    purge("sysmon-client.cjs");
    ok["sysmon-client.cjs"] = !!createSysmonClientInstance();
    if (ok["sysmon-client.cjs"] && sysmonWantAny()) sysmonSyncSubscribed();
  }
  if (changed.includes("mobile-relay.cjs")) {
    purge("mobile-relay.cjs");
    ok["mobile-relay.cjs"] = !!initMobileRelay();
  }
  const updaterGroup = changed.filter((n) => n === "plugin-updater.cjs" || n === "plugin-release.cjs" || n === "plugin-storage.cjs");
  if (updaterGroup.length) {
    // updater 顶层解构捕获 release/storage 导出（CJS 加载期绑定）：单改依赖时也必须
    // 让 updater 自身重求值，否则新实例仍绑旧导出、ok 传播与销账都会说谎。
    for (const name of ["plugin-updater.cjs", ...updaterGroup]) purge(name);
    ok["plugin-release.cjs"] = !!initReleaseNotes();
    ok["plugin-updater.cjs"] = !!initPluginUpdater();
    if (updaterGroup.includes("plugin-storage.cjs")) ok["plugin-storage.cjs"] = ok["plugin-updater.cjs"];
  }
  const succeeded = changed.filter((name) => ok[name]);
  const failed = changed.filter((name) => !ok[name]);
  if (!succeeded.length) {
    LOG("hot reload failed, keeping old instances:", failed.join(", "));   // mtime 保留旧值：下轮重试
    return Promise.resolve(false);
  }
  const hotAt = Date.now();
  const prevHot = Object.assign({}, loadedHashes._hotLoadedAt);
  for (const key of Object.keys(prevHot)) {
    if (!failed.includes(key)) prevHot[key] = hotAt;   // 多轮热换：刷新既有已热加载条目的证据戳，使其跨过合并 marker 的 createdAt
  }
  for (const name of succeeded) {
    hotModuleMtimes[name] = mtimes[name];
    try { loadedHashes[name] = createHash("sha256").update(sources[name]).digest("hex"); } catch (e) { }
    prevHot[name] = hotAt;
  }
  loadedHashes._hotLoadedAt = prevHot;
  LOG("hot reloaded main modules:", succeeded.join(", ") + (failed.length ? "（失败保留待重启: " + failed.join(", ") + "）" : ""));
  if (failed.length) {
    // 部分失败：不销账（marker 原样保留，重启兜底仍在），只广播让 UI 用上已换入的模块
    broadcastPluginState();
    return Promise.resolve(true);
  }
  // 销账先行完成再广播：runtime_lock ack_restart 凭 _hotLoadedAt+digest 清除已热加载
  // 条目的 marker；noteRuntimeAcked（新更新器）同步撤下红点，旧更新器自然衰减到下轮。
  return acknowledgeRestart(() => {
    if (pluginUpdater && typeof pluginUpdater.noteRuntimeAcked === "function") {
      try { pluginUpdater.noteRuntimeAcked(); } catch (e) { }
    }
    broadcastPluginState();
  }).then(() => true);
}
function modelPullerProviderOk(v) {
  return typeof v === "string" && v.length > 0 && v.length <= 160 && !/[\x00-\x1f\x7f]/.test(v);
}
function handleModelPullRequest(req, wc) {
  const respond = (result) => deliverPluginRequest(wc, req.requestId, result);
  if (!modelPuller) { respond({ ok: false, error: "model puller unavailable; fully restart ZCode to load it" }); return; }
  if (req.action === "model-pull-list") { respond(modelPuller.listProviders()); return; }
  if (!modelPullerProviderOk(req.providerId)) { respond({ ok: false, error: "invalid provider" }); return; }
  if (req.action === "model-pull-fetch") {
    modelPuller.fetchModels(req.providerId)
      .then(respond)
      .catch((e) => { LOG("model pull fetch failed:", e.message); respond({ ok: false, error: "fetch failed" }); });
    return;
  }
  if (req.action === "model-pull-probe") {   // v309：确认添加前单模型探测（镜像宿主 URL 语义，主进程发 key 只到配置本域）；v312 caps=确认流能力实测
    const model = typeof req.model === "string" && req.model.length <= 200 && !/[\x00-\x1f\x7f]/.test(req.model) ? req.model : "";
    modelPuller.probeModel(req.providerId, model, { caps: req.caps === true })
      .then(respond)
      .catch((e) => { LOG("model pull probe failed:", e.message); respond({ ok: false, kind: "network", error: "probe failed" }); });
    return;
  }
  modelPuller.applyModels(req.providerId, Array.isArray(req.models) ? req.models : [])
    .then(respond)
    .catch((e) => { LOG("model pull apply failed:", e.message); respond({ ok: false, error: "apply failed" }); });
}

/* v344 增强提示词：渲染端按钮 → 一次性非流式改写。开关在动作入口 fail-closed（渲染端
 * 显隐只是第一层）；负载 {providerId, modelId, text} 形状校验同 model-pull 域口径。
 * draft 只进当前供应商请求体，凭据/响应摘要不进日志。 */
function enhanceRequestTextOk(v) {
  return typeof v === "string" && v.trim().length > 0 && v.length <= 20000;
}
const enhanceInFlight = new Map();   // webContents → Map<requestId, entry>，不同窗口的请求身份隔离
function readEnhanceProvider() {
  try {
    const file = path.join(HERE, "enhance-provider.json");
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || (process.platform !== "win32" && (st.mode & 0o077))) return { version: 1, revision: 0, mode: "default", unreadable: true };
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    return d && d.version === 1 && Number.isSafeInteger(d.revision) && ["default", "custom"].includes(d.mode) ? d : { version: 1, revision: 0, mode: "default", unreadable: true };
  } catch (e) { return e.code === "ENOENT" ? { version: 1, revision: 0, mode: "default" } : { version: 1, revision: 0, mode: "default", unreadable: true }; }
}
function enhanceProviderView() {
  const d = readEnhanceProvider();
  return { capability: 1, allowDowngrade: d.allowDowngrade !== false, saveHistory: d.saveHistory !== false, available: process.platform !== "win32" && !!modelPuller && modelPuller.enhanceProviderVersion === 1, platformLimited: process.platform === "win32", version: 1, revision: d.revision, mode: d.mode, unreadable: !!d.unreadable, source: d.source || "manual", providerId: d.providerId || "", target: d.target || "", baseUrl: d.baseUrl || "", protocol: d.protocol || "openai-chat-completions", model: d.model || "", keyConfigured: !!d.apiKey };
}
function validEnhanceUrl(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) && !!u.hostname && !u.username && !u.password && !u.search && !u.hash;
  } catch (e) { return false; }
}
function enhanceTargetRisk(value) {
  try {
    const u = new URL(value);
    let h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (h.startsWith("::ffff:")) h = h.slice(7);   // IPv4-mapped IPv6 还原为点分四段再判私网
    const parts = h.split(".").map(Number);
    return u.protocol === "http:" || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") || h === "::1" || /^(fc|fd|fe[89ab])/i.test(h) || (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && (parts[0] === 10 || parts[0] === 127 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 169 && parts[1] === 254));
  } catch (_) { return false; }
}
async function confirmEnhanceTarget(wc, provider) {
  if (!enhanceTargetRisk(provider.baseUrl)) return true;
  if (!dialog || typeof dialog.showMessageBox !== "function") return false;
  const owner = BrowserWindow.fromWebContents(wc);
  if (!owner) return false;
  const result = await dialog.showMessageBox(owner, { type: "warning", buttons: ["Cancel", "Continue"], defaultId: 0, cancelId: 0, noLink: true, message: "Send data to this HTTP or local network service?", detail: provider.baseUrl + "\nThe service may receive your API key or draft. Continue only if you trust it." });
  return result.response === 1;
}
function resolveEnhanceDraftProvider(settings, draft, formApiKey) {
  if (!draft || typeof draft !== "object") return null;
  if (draft.source === "host" && draft.providerId) {
    const host = modelPuller.resolveEnhanceHost(String(draft.providerId));
    return host && host.baseUrl === draft.baseUrl && host.protocol === draft.protocol && validEnhanceUrl(host.baseUrl) && host.apiKey && ["openai-chat-completions", "openai-responses", "anthropic-messages"].includes(host.protocol) ? host : null;
  }
  if (draft.source === "manual") {
    const sameTarget = settings.source !== "host" && settings.baseUrl === draft.baseUrl && settings.protocol === draft.protocol;
    const apiKey = typeof formApiKey === "string" && formApiKey ? formApiKey : (sameTarget ? settings.apiKey || "" : "");
    return validEnhanceUrl(draft.baseUrl) && apiKey && ["openai-chat-completions", "openai-responses", "anthropic-messages"].includes(draft.protocol) ? { baseUrl: draft.baseUrl, protocol: draft.protocol, apiKey: apiKey } : null;
  }
  return null;
}
function resolveEnhanceProvider(d) {
  if (!d || d.mode !== "custom" || !modelPuller) return null;
  let result;
  if (d.source === "host") {
    result = typeof modelPuller.resolveEnhanceHost === "function" ? modelPuller.resolveEnhanceHost(d.providerId) : null;
    if (!result || JSON.stringify([result.baseUrl, result.protocol]) !== d.target) return null;
  } else result = { baseUrl: d.baseUrl, protocol: d.protocol, apiKey: d.apiKey };
  return result && validEnhanceUrl(result.baseUrl) && result.apiKey && ["openai-chat-completions", "openai-responses", "anthropic-messages"].includes(result.protocol) ? result : null;
}
async function handlePromptEnhanceRequest(req, wc) {
  let entry = null;
  let entries = enhanceInFlight.get(wc);
  if (entries && entries.has(req.requestId)) return;   // 同 ID 回执会误消费原请求的回调
  const respond = (result) => {
    const entries = enhanceInFlight.get(wc);
    const owned = !!(entry && entries && entries.get(req.requestId) === entry);
    if (owned) {
      entries.delete(req.requestId);
      if (!entries.size) enhanceInFlight.delete(wc);
      if (entry.onDestroyed && typeof wc.removeListener === "function") wc.removeListener("destroyed", entry.onDestroyed);
    }
    if (!entry || owned) deliverPluginRequest(wc, req.requestId, result);
  };
  if (!enhanceEnabled()) { respond({ ok: false, kind: "disabled", error: "prompt enhance is disabled" }); return; }
  if (!modelPuller || typeof modelPuller.enhanceText !== "function") { respond({ ok: false, kind: "unavailable", error: "model puller unavailable; fully restart ZCode to load it" }); return; }   // 含热换错位窗
  const settings = readEnhanceProvider();
  if (settings.unreadable) { respond({ ok: false, kind: "unavailable", error: "enhance settings unreadable" }); return; }
  const custom = req.action === "prompt-enhance-v2";
  if (req.action === "prompt-enhance-v2" && (!modelPuller || modelPuller.enhanceProviderVersion !== 1)) { respond({ ok: false, kind: "unavailable", error: "restart required" }); return; }
  if (req.action === "prompt-enhance-v2" && req.revision !== settings.revision) { respond({ ok: false, kind: "unavailable", error: "enhance provider settings changed" }); return; }
  if (req.action !== "prompt-enhance-v2" && settings && settings.mode === "custom") { respond({ ok: false, kind: "unavailable", error: "restart required" }); return; }
  const draftForm = custom && req.form && typeof req.form === "object" ? req.form : null;   // 设置页测试：允许未保存的表单快照（不要求已保存模式），凭据仅本次请求在主进程解析
  let provider = custom && settings.mode === "custom" ? resolveEnhanceProvider(settings) : null;
  if (draftForm) provider = resolveEnhanceDraftProvider(settings, draftForm, typeof req.formApiKey === "string" ? req.formApiKey : "");
  if (custom && (!provider || !(draftForm ? draftForm.model : settings.model))) { respond({ ok: false, kind: "provider", error: "enhance provider unavailable" }); return; }
  if (!custom && !modelPullerProviderOk(req.providerId)) { respond({ ok: false, kind: "invalid_input", error: "invalid provider" }); return; }
  const model = custom ? (draftForm ? draftForm.model : settings.model) : (typeof req.modelId === "string" && req.modelId.length <= 200 && !/[\x00-\x1f\x7f]/.test(req.modelId) ? req.modelId : "");
  if (!enhanceRequestTextOk(req.text)) { respond({ ok: false, kind: "invalid_input", error: "draft length out of range" }); return; }
  if (typeof req.requestId !== "string" || !req.requestId) { respond({ ok: false, kind: "invalid_input", error: "invalid requestId" }); return; }   // 与 cancel 分支口径一致
  if (!entries) { entries = new Map(); enhanceInFlight.set(wc, entries); }
  const controller = new AbortController();
  entry = { controller: controller, wc: wc, onDestroyed: null };
  entry.onDestroyed = () => {
    const current = enhanceInFlight.get(wc);
    if (current && current.get(req.requestId) === entry) {
      current.delete(req.requestId);
      if (!current.size) enhanceInFlight.delete(wc);
      controller.abort();
    }
  };
  entries.set(req.requestId, entry);
  if (wc && typeof wc.once === "function") wc.once("destroyed", entry.onDestroyed);
  if (custom && enhanceTargetRisk(provider.baseUrl)) {
    let confirmed = false;
    try { confirmed = await confirmEnhanceTarget(wc, provider); } catch (_) { }
    if (controller.signal.aborted || enhanceInFlight.get(wc)?.get(req.requestId) !== entry) return;
    if (!confirmed) { respond({ ok: false, kind: "cancelled" }); return; }
    const current = readEnhanceProvider(), latest = draftForm ? resolveEnhanceDraftProvider(current, draftForm, typeof req.formApiKey === "string" ? req.formApiKey : "") : resolveEnhanceProvider(current);
    if (!current || current.revision !== settings.revision || !latest || latest.baseUrl !== provider.baseUrl || latest.protocol !== provider.protocol || latest.apiKey !== provider.apiKey) { respond({ ok: false, kind: "unavailable", error: "enhance provider settings changed" }); return; }
  }
  modelPuller.enhanceText(custom ? "enhance-custom" : req.providerId, model, req.text, { signal: controller.signal, ...(custom ? { enhanceProvider: provider } : {}) })
    .then((result) => {
      const current = readEnhanceProvider();
      if (!current || current.revision !== settings.revision || current.mode !== settings.mode) respond({ ok: false, kind: "cancelled" });
      else if (result.ok && current.allowDowngrade === false && typeof result.serverModel === "string" && result.serverModel && result.serverModel !== model) respond({ ok: false, kind: "downgraded", error: "model downgraded", detail: result.serverModel });
      else respond(result);
    })
    .catch((e) => { LOG("prompt enhance failed:", e.message); respond({ ok: false, kind: "network", error: "enhance failed", detail: String((e && e.message) || "").slice(0, 500) }); });
}
/* ---------- 增强历史（spec: 增强历史记录）---------- */
const enhanceHistory = [];   // 内存常驻；saveHistory 开启时才落盘 enhance-history.json
let enhanceHistoryLoaded = false;
function loadEnhanceHistoryDisk() {
  if (enhanceHistoryLoaded || process.platform === "win32") return;
  if (readEnhanceProvider().saveHistory === false) return;   // 显式关闭时不读盘：契约=关闭态重启即清空（缺省视为开启，v363）
  enhanceHistoryLoaded = true;
  try {
    const st = fs.lstatSync(path.join(HERE, "enhance-history.json"));
    if (!st.isFile() || st.isSymbolicLink() || st.mode & 0o077) return;
    const arr = JSON.parse(fs.readFileSync(path.join(HERE, "enhance-history.json"), "utf8"));
    if (Array.isArray(arr)) {
      // 读回同走 30 天/100 条裁剪（v363 review：缺省开启后该文件对全体用户生效，清理时机不再依赖下一次成功增强）
      const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
      const trimmed = arr.filter(r => { if (!r || typeof r !== "object") return false; const t = Date.parse(r.createdAt || ""); return !(t && t < cutoff); }).slice(0, 100);
      enhanceHistory.push(...trimmed);
      if (trimmed.length !== arr.length) persistEnhanceHistory();
    }
  } catch (e) { }
}
function persistEnhanceHistory() {
  if (readEnhanceProvider().saveHistory === false || process.platform === "win32") return;
  try {
    const file = path.join(HERE, "enhance-history.json");
    const tmp = file + ".tmp";
    fs.rmSync(tmp, { force: true });   // 防预置符号链接重定向写入
    fs.writeFileSync(tmp, JSON.stringify(enhanceHistory), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) { LOG("enhance history persist failed:", e.message); }
}
function addEnhanceHistory(record) {
  loadEnhanceHistoryDisk();
  if (!record || typeof record !== "object") return { ok: false, error: "invalid record" };
  const clean = {
    id: typeof record.id === "string" && record.id ? record.id.slice(0, 80) : "h-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    requestId: typeof record.requestId === "string" ? record.requestId.slice(0, 120) : "",
    source: record.source === "test" ? "test" : "chat",
    status: "success",
    providerName: typeof record.providerName === "string" ? record.providerName.slice(0, 160) : "",
    modelId: typeof record.modelId === "string" ? record.modelId.slice(0, 200) : "",
    originalText: typeof record.originalText === "string" ? record.originalText.slice(0, 20000) : "",
    enhancedText: typeof record.enhancedText === "string" ? record.enhancedText.slice(0, 40000) : "",
    usage: record.usage && typeof record.usage === "object" ? { inputTokens: Number.isFinite(record.usage.inputTokens) ? record.usage.inputTokens : null, outputTokens: Number.isFinite(record.usage.outputTokens) ? record.usage.outputTokens : null, totalTokens: Number.isFinite(record.usage.totalTokens) ? record.usage.totalTokens : null } : { inputTokens: null, outputTokens: null, totalTokens: null },
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    durationMs: Number.isFinite(record.durationMs) ? record.durationMs : null
  };
  if (clean.requestId && enhanceHistory.some(r => r.requestId === clean.requestId && r.source === clean.source)) return { ok: true, deduped: true };
  enhanceHistory.unshift(clean);
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  for (let i = enhanceHistory.length - 1; i >= 0; i--) {
    const t = Date.parse(enhanceHistory[i].createdAt || "");
    if (enhanceHistory.length > 100 || (t && t < cutoff)) enhanceHistory.splice(i, 1);
  }
  persistEnhanceHistory();
  return { ok: true, record: clean };
}
function handleEnhanceHistoryAction(req, wc) {
  const reply = result => deliverPluginRequest(wc, req.requestId, result);
  if (req.action === "enhance-history-list") {
    loadEnhanceHistoryDisk();
    const limit = Number.isFinite(req.limit) && req.limit > 0 ? Math.min(req.limit, 100) : enhanceHistory.length;
    reply({ ok: true, records: enhanceHistory.slice(0, limit), total: enhanceHistory.length, saveHistory: readEnhanceProvider().saveHistory !== false });
    return;
  }
  if (req.action === "enhance-history-add") { reply(addEnhanceHistory(req.record)); return; }
  if (req.action === "enhance-history-delete") {
    loadEnhanceHistoryDisk();
    const id = typeof req.id === "string" ? req.id : "";
    const idx = enhanceHistory.findIndex(r => r.id === id);
    if (idx >= 0) { enhanceHistory.splice(idx, 1); persistEnhanceHistory(); }
    reply({ ok: true, deleted: idx >= 0 });
    return;
  }
  if (req.action === "enhance-history-clear") {
    loadEnhanceHistoryDisk();
    enhanceHistory.length = 0;
    persistEnhanceHistory();
    reply({ ok: true });
    return;
  }
}
/* 取消在途增强（fire-and-forget，不回执）：abort 后 enhanceText 以 kind:"cancelled" 收口，
 * 渲染端在取消时已置 settled 并丢弃回执，两侧状态各自收敛。 */
async function handleEnhanceProviderAction(req, wc) {
  const reply = result => deliverPluginRequest(wc, req.requestId, result);
  if (!modelPuller || modelPuller.enhanceProviderVersion !== 1 || typeof modelPuller.listEnhanceHosts !== "function") { reply({ ok: false, error: "restart required" }); return; }
  if (req.action === "enhance-provider-list") {
    if (req.cached) {   // 硬盘缓存：设置页打开时秒出列表，随后仍会拉取新鲜数据并回写
      try {
        const cached = JSON.parse(fs.readFileSync(path.join(HERE, "enhance-providers-cache.json"), "utf8"));
        if (Array.isArray(cached.providers)) { reply({ ok: true, providers: cached.providers, cached: true }); return; }
      } catch (e) { }
    }
    const providers = modelPuller.listEnhanceHosts();
    try {
      const cacheFile = path.join(HERE, "enhance-providers-cache.json");
      fs.writeFileSync(cacheFile, JSON.stringify({ providers: providers, at: Date.now() }), { mode: 0o600 });
    } catch (e) { LOG("enhance provider cache write failed:", e.message); }
    reply({ ok: true, providers: providers });
    return;
  }
  if (req.action === "enhance-provider-models") {
    const settings = readEnhanceProvider();
    if (!settings || settings.unreadable || process.platform === "win32") { reply({ ok: false, error: "provider unavailable" }); return; }
    const draft = req.form && typeof req.form === "object" ? req.form : null;
    let provider = draft ? resolveEnhanceDraftProvider(settings, draft, typeof req.formApiKey === "string" ? req.formApiKey : "") : resolveEnhanceProvider(settings);
    if (!provider) { reply({ ok: false, error: "provider unavailable" }); return; }
    if (req.revision !== settings.revision) { reply({ ok: false, error: "settings changed" }); return; }
    if (enhanceTargetRisk(provider.baseUrl)) {
      if (!await confirmEnhanceTarget(wc, provider)) { reply({ ok: false, error: "cancelled" }); return; }
      const current = readEnhanceProvider();
      if (!current || current.unreadable || current.revision !== settings.revision) { reply({ ok: false, error: "settings changed" }); return; }
      if (draft) {
        const latest = resolveEnhanceDraftProvider(current, draft, typeof req.formApiKey === "string" ? req.formApiKey : "");
        if (!latest || latest.baseUrl !== provider.baseUrl || latest.protocol !== provider.protocol || latest.apiKey !== provider.apiKey) { reply({ ok: false, error: "provider changed" }); return; }
      }
    }
    const result = await modelPuller.listEnhanceModels(provider);
    const now = readEnhanceProvider();
    reply(now && !now.unreadable && now.revision === (req.revision != null ? req.revision : now.revision) ? result : { ok: false, error: "settings changed" });
    return;
  }
  if (req.action !== "enhance-provider-save" || !req.changes || typeof req.changes !== "object") return;
  if (process.platform === "win32") { reply({ ok: false, error: "unsupported platform" }); return; }   // 与 models 分支对称：Windows 无 POSIX 安全落盘（runtime_lock 平台门恒拒），早退省一次必败 python 子进程
  const changes = req.changes;
  if (changes.source === "host") {
    const host = modelPuller.resolveEnhanceHost(changes.providerId);
    if (!host || !validEnhanceUrl(host.baseUrl)) { reply({ ok: false, error: "provider unavailable" }); return; }
    changes.target = JSON.stringify([host.baseUrl, host.protocol]);
    changes.baseUrl = host.baseUrl; changes.protocol = host.protocol; changes.keyAction = "clear";
  } else if (changes.baseUrl && !validEnhanceUrl(changes.baseUrl)) { reply({ ok: false, error: "invalid URL" }); return; }
  const python = readCfgCached().python_path || (process.platform === "win32" ? "python" : "python3");
  const child = execFile(python, [path.join(HERE, "runtime_lock.py"), "--update-enhance-provider", HERE], { timeout: 15000, windowsHide: true }, (error) => {
    if (error) { reply({ ok: false, error: "save failed; refresh settings" }); return; }
    for (const entries of enhanceInFlight.values()) for (const item of entries.values()) item.controller.abort();
    broadcastPluginState(); reply({ ok: true, provider: enhanceProviderView() });
  });
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify({ revision: req.revision, changes }));
}
function handlePromptEnhanceCancel(req, wc) {
  const entries = enhanceInFlight.get(wc);
  const entry = entries && entries.get(req.requestId);
  if (entry) {
    entries.delete(req.requestId);
    if (!entries.size) enhanceInFlight.delete(wc);
    if (entry.onDestroyed && typeof wc.removeListener === "function") wc.removeListener("destroyed", entry.onDestroyed);
    try { entry.controller.abort(); } catch (e) { LOG("prompt enhance cancel failed:", e.message); }
  }
}
/* 增强开关（⚙ 面板）：原子写 config.json 的 enhance_enabled（缺省开）。参照
 * setQuotaEnabled 同款事务与广播；失败回执让渲染端回滚勾选态。 */
async function setEnhanceEnabled(enabled, wc, requestId) {
  try {
    const { updateConfig } = require("./plugin-updater.cjs");
    await updateConfig(HERE, { enhance_enabled: enabled }, readCfgCached().python_path || (process.platform === "win32" ? "python" : "python3"));
    cfgCache = null;
    broadcastPluginState();
    deliverPluginRequest(wc, requestId, { ok: true });
  } catch (e) {
    LOG("enhance_enabled toggle failed:", e.message);
    deliverPluginRequest(wc, requestId, { ok: false, error: e.message });
  }
}

/* 渠道门控：Release 渠道取本渠道 Release；market（源码）渠道取注册仓库的同号 Release，
 * 响应带 verified:false 由浮层标注「参考/未核实」；local 无仓库身份回 unsupported-channel。 */
async function handleReleaseNotesRequest(req, wc) {
  const respond = (result) => deliverPluginRequest(wc, req.requestId, result);
  try {
    if (!releaseNotes) { respond({ ok: false, reason: "unsupported" }); return; }
    let channel = null;
    try { channel = require("./plugin-release.cjs").readChannel(app.getPath("home")); } catch (e) { channel = null; }
    // release 渠道取本渠道 Release；market（源码）渠道取注册仓库的**同号 Release** 作参考正文
    // （响应带 verified:false，浮层据此标注「未核实与本渠道一致」）；local 无仓库身份仍拒绝。
    if (!channel || channel.kind === "local" || !channel.repository) { respond({ ok: false, reason: "unsupported-channel" }); return; }
    const flavor = channel.flavor === "gitcode" ? "gitcode" : "github";
    const repository = channel.repository || "";
    const verified = channel.kind === "release";
    if (req.action === "release-notes-list") {
      const result = await releaseNotes.getList({ flavor, repository, force: req.force === true });
      respond(result.ok ? { ...result, verified } : result);
      return;
    }
    const version = typeof req.version === "string" ? req.version.slice(0, 32) : "";
    const result = await releaseNotes.getNotes({ flavor, repository, version, force: req.force === true });
    respond(result.ok ? { ...result, verified } : result);
  } catch (e) {
    LOG("release notes request failed:", e.message);
    respond({ ok: false, reason: "error", message: String((e && e.message) || e).slice(0, 300) });
  }
}

/* 逐问速率行开关（⚙ 面板）：原子写运行时 config.json 的 answer_rate_line（缺省=开启）。
   prompt-submit hook 每次提问时读同一文件——开关下一问即生效，无需重启客户端。 */
function broadcastPluginState() {
  const base = pluginUpdater ? pluginUpdater.status() : {};
  webContents.getAllWebContents().forEach((wc) => pushPluginState(wc, base));
}
function deliverPluginRequest(wc, requestId, result) {
  /* v244：返回已处理的 promise（true=渲染端已执行回调），relaunch 分支据此在回执送达后尽快 quit；
   * 其余调用方忽略返回值，行为不变。 */
  if (!wc || wc.isDestroyed() || !isLocalHostPage(wc) || typeof requestId !== "string" || requestId.length > 120) return Promise.resolve(false);
  const js = "window.__zusagePluginResult && window.__zusagePluginResult(" + JSON.stringify(Object.assign({ id: requestId }, result || {})) + ")";
  return wc.executeJavaScript(js, true).then(() => true).catch(() => false);
}
async function setAnswerRateLine(enabled, wc, requestId) {
  try {
    const { updateConfig } = require("./plugin-updater.cjs");
    await updateConfig(HERE, { answer_rate_line: enabled }, readCfgCached().python_path || (process.platform === "win32" ? "python" : "python3"));
    cfgCache = null;   // 写后置空，下一次 readCfgCached 立即重读（mtime 判变的双保险）
    broadcastPluginState();
    deliverPluginRequest(wc, requestId, { ok: true });
  } catch (e) {
    LOG("answer_rate_line toggle failed:", e.message);
    deliverPluginRequest(wc, requestId, { ok: false, error: e.message });
  }
}
/* 重启提醒开关（⚙ 面板，issue #139）：原子写运行时 config.json 的 restart_notice（缺省=开启）。
   v172 起该键只门控 ⚙ 红点（不再有任何会话文字出口）：写回后 broadcastPluginState() 即时生效，
   无需等新会话。 */
async function setRestartNotice(enabled, wc, requestId) {
  try {
    const { updateConfig } = require("./plugin-updater.cjs");
    await updateConfig(HERE, { restart_notice: enabled }, readCfgCached().python_path || (process.platform === "win32" ? "python" : "python3"));
    cfgCache = null;
    broadcastPluginState();
    deliverPluginRequest(wc, requestId, { ok: true });
  } catch (e) {
    LOG("restart_notice toggle failed:", e.message);
    deliverPluginRequest(wc, requestId, { ok: false, error: e.message });
  }
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
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { }
    const error = new Error("Unable to save quota settings");
    error.code = "quota_secrets_write_failed";
    throw error;
  }
  if (quotaClient) {
    quotaClient.credentialsChanged();
    if (quotaDataEnabled()) {
      quotaClient.tick();   // 总开关关闭时不触发联网（与手动刷新同口径）
      if (lastGoodPayload) {
        const withQuota = Object.assign({}, lastGoodPayload, { quota: quotaClient.view() });
        for (const wc of webContents.getAllWebContents()) pushOnce(wc, withQuota);
      }
    }
  }
  broadcastPluginState();   // 面板状态无论开关都要刷新（写入结果回显）
}
function handleQuotaSourceRequest(req, wc) {
  const id = String(req.id || "");
  const requestId = req.requestId;
  const respond = (result) => deliverPluginRequest(wc, requestId, result);
  if (!id || !/^[a-z][a-z0-9-]{0,31}$/.test(id)) { respond({ ok: false, error: "invalid source" }); return; }
  if (req.action === "quota-src-refresh") {
    if (!quotaClient || !quotaEnabled()) { respond({ ok: false, error: "quota refresh unavailable" }); return; }
    if (!quotaClient.refreshSource(id)) { respond({ ok: false, error: "query already running or unavailable" }); return; }
    respond({ ok: true, pending: true });
    return;
  }
  try {
    if (req.action === "quota-src" && typeof req.enabled === "boolean") {
      writeQuotaSecrets((sec) => { sec[id] = Object.assign({}, sec[id] || {}, { enabled: req.enabled }); });
      respond({ ok: true });
      return;
    }
    if (req.action === "quota-src-key") {
      const field = String(req.field || "");
      if (!QUOTA_SECRET_FIELDS.has(field)) { respond({ ok: false, error: "invalid field" }); return; }
      const value = req.value == null ? "" : String(req.value).slice(0, 4096);
      writeQuotaSecrets((sec) => {
        sec[id] = Object.assign({}, sec[id] || {});
        const isCred = field === "apiKey" || field === "cookie" || field === "token" || field === "secretAccessKey";
        if (value === "" && (isCred || field === "modelPatterns")) { delete sec[id][field]; return; }
        if (field === "planCredits") { if (value === "") delete sec[id][field]; else sec[id][field] = Number(value) || 0; }
        else if (field === "planStart" || field === "region" || field === "baseUrl") { if (value === "") delete sec[id][field]; else sec[id][field] = value; }
        else if (field === "modelPatterns") {
          try { const parsed = JSON.parse(value); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) sec[id][field] = parsed; } catch (e) { /* 非法 JSON 忽略，保持字段原值 */ }
        }
        else sec[id][field] = value;
      });
      respond({ ok: true });
    }
  } catch (e) {
    LOG("quota source update failed");
    respond({ ok: false, error: "Unable to save quota settings" });
  }
}
/* 套餐额度开关（⚙ 面板）：原子写 config.json 的 quota_enabled（v111 起缺省开）。开启即刻 tick
 * 一次（结算后经 onUpdate 补推）；关闭后 handlePayload 不再 tick/附加，chip 随之隐藏。 */
async function setQuotaEnabled(enabled, wc, requestId) {
  try {
    const { updateConfig } = require("./plugin-updater.cjs");
    await updateConfig(HERE, { quota_enabled: enabled }, readCfgCached().python_path || (process.platform === "win32" ? "python" : "python3"));
    cfgCache = null;
    broadcastPluginState();
    if (enabled && quotaClient) syncQuotaProviders();
    deliverPluginRequest(wc, requestId, { ok: true });
  } catch (e) {
    LOG("quota_enabled toggle failed:", e.message);
    deliverPluginRequest(wc, requestId, { ok: false, error: e.message });
  }
}
/* v135 重置卡徽标开关（⚙ 面板）：原子写 config.json 的 reset_badge_enabled（缺省开）。
 * 与 quota_enabled 独立——额度关 + 本开关开时仍解密凭据仅查 reset/status。 */
async function setResetBadgeEnabled(enabled, wc, requestId) {
  try {
    const { updateConfig } = require("./plugin-updater.cjs");
    await updateConfig(HERE, { reset_badge_enabled: enabled }, readCfgCached().python_path || (process.platform === "win32" ? "python" : "python3"));
    cfgCache = null;
    broadcastPluginState();
    if (enabled && quotaClient) quotaClient.tick();
    deliverPluginRequest(wc, requestId, { ok: true });
  } catch (e) {
    LOG("reset_badge_enabled toggle failed:", e.message);
    deliverPluginRequest(wc, requestId, { ok: false, error: e.message });
  }
}
/* 移动端推送开关：锁内只合并 enabled；关闭时撤销代际、回收中继查询，不干预宿主远控。 */
async function setMobileRelayEnabled(enabled, wc, requestId) {
  try {
    const { updateConfig } = require("./plugin-updater.cjs");
    await updateConfig(HERE, {}, readCfgCached().python_path, undefined, { mobile_relay: { enabled } });
    cfgCache = null;
    const saved = readCfgCached().mobile_relay;
    if (!saved || typeof saved !== "object" || Array.isArray(saved) || saved.enabled !== enabled) {
      throw new Error("mobile_relay configuration was not saved; update or restart the desktop plugin");
    }
    mobileDiscovery++;
    revokeMobileTarget();
    if (!mobileEnabled() && mobileRelay && typeof mobileRelay.disable === "function") mobileRelay.disable();
    broadcastPluginState();
    deliverPluginRequest(wc, requestId, { ok: true, mobileRelayEnabled: mobileEnabled() });
  } catch (e) {
    LOG("mobile_relay toggle failed:", e.message);
    deliverPluginRequest(wc, requestId, { ok: false, error: e.message });
  }
}
/* v179 自动压缩阈值开关（⚙ 面板）：写 config.json 的 auto_compact_patch（v188 起缺省开，显式 false 关闭），
 * 并即时打补丁/还原引擎——引擎子进程下次 spawn 起用，无需改 asar。 */
async function setAutoCompactPatch(enabled, wc, requestId) {
  try {
    const { updateConfig } = require("./plugin-updater.cjs");
    await updateConfig(HERE, { auto_compact_patch: enabled }, readCfgCached().python_path || (process.platform === "win32" ? "python" : "python3"));
    cfgCache = null;
    if (enginePatcher) { if (enabled) enginePatcher.ensure(); else enginePatcher.restore(); }
    broadcastPluginState();
    deliverPluginRequest(wc, requestId, { ok: true, enginePatch: enginePatcher ? enginePatcher.status() : null });
  } catch (e) {
    LOG("auto_compact_patch toggle failed:", e.message);
    deliverPluginRequest(wc, requestId, { ok: false, error: e.message });
  }
}
/* v179 阈值数值（⚙ 面板）：白名单归一后写运行目录 autocompact.json。引擎 hook
 * 每轮决策读该文件——写完下一轮即生效，无需重启。 */
function handleAutoCompactConfig(req, wc) {
  const respond = (result) => deliverPluginRequest(wc, req.requestId, result);
  if (!enginePatcher) { respond({ ok: false, error: "engine patcher unavailable; fully restart ZCode to load it" }); return; }
  try {
    const config = enginePatcher.writeConfig(String(req.mode || ""), req.value);
    broadcastPluginState();
    respond({ ok: true, config });
  } catch (e) {
    respond({ ok: false, error: e.message });
  }
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
 * 这一轮已被新提问越过）时回推空串，不是错误，渲染端据此限流重试。
 * v343（issue #321）：空交付带原因标签（第 4 参："spawn"=解释器拉不起、"timeout"=15s
 * 超时、"pyerr"=Python 非零退出、"empty"=exit 0 空输出即「库没追上」），渲染端据此把
 * 失败层细分进 diag（旧渲染端忽略第 4 参，双向兼容）。 */
function queryTurnText(sid, wc, plainUnits, forceKmb, unitEpoch, noCost) {
  const deliver = (text, reason) => {
    if (!wc || wc.isDestroyed() || !isLocalHostPage(wc)) return;
    wc.executeJavaScript("window.__zusageDeliverTurnText && window.__zusageDeliverTurnText(" +
      JSON.stringify(sid) + "," + JSON.stringify(text || "") + "," + JSON.stringify(typeof unitEpoch === "string" && /^\d{1,15}:\d{1,15}$/.test(unitEpoch) ? unitEpoch : null) + "," + JSON.stringify(reason || null) + ")", true).catch(() => { });
  };
  if (typeof sid !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(sid)) return;
  let py;
  try {
    /* --no-cn-units：渲染端万/亿开关（localStorage，主进程无真值）显式关闭时才传；
       缺省（含旧渲染端不带 cn 字段）与产品默认一致，Python 侧自行用万/亿。
       --no-cost：v376 预估费用开关（localStorage zusage3.cost）显式关闭时才传；
       缺省（含旧渲染端不带 cost 字段）保持产品默认开启，统计行带费用段。 */
    py = spawn(readCfgCached().python_path,
      [TOKEN_RATE, "--turn", "--current", "--session", sid].concat(plainUnits ? ["--no-cn-units"] : [], forceKmb ? ["--force-kmb"] : [], noCost ? ["--no-cost"] : []), { windowsHide: true });
  } catch (e) { LOG("turn text spawn failed:", e.message); deliver("", "spawn"); return; }
  let finished = false;
  const finish = (text, reason) => {
    if (finished) return;
    finished = true;
    clearTimeout(killTimer);
    deliver(text, reason);
  };
  const killTimer = setTimeout(() => {
    LOG("turn text query timeout, killing");
    try { py.kill(); } catch (e) { }
    finish("", "timeout");
  }, 15000);
  const chunks = [];
  py.stdout.on("data", (d) => { chunks.push(d); });   // Buffer 收集、close 时一次性解码：多字节字符跨 chunk 不截断
  py.stderr.on("data", () => { });
  py.on("error", (e) => { LOG("turn text spawn failed:", e.message); finish("", "spawn"); });
  py.on("close", (code) => {
    const text = Buffer.concat(chunks).toString("utf8").trim();
    // #321：空交付区分 Python 失败与「库没追上」；code 仅在正常退出时为 0，信号杀死
    //（外部 kill/OOM，非本方 timeout——那条路已先行 finish("timeout")）为 null，归 pyerr
    finish(text, text ? null : (code === 0 ? "empty" : "pyerr"));
  });   // 空串 = 库里还没这一轮，不是错误
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
function gitRefreshResult(requestedPath, results) {
  if (typeof requestedPath !== "string" || !requestedPath) return { ok: false, error: "no paths" };
  if (!results || !results.has(requestedPath)) return { ok: false, error: "no paths" };
  const status = results.get(requestedPath);
  if (status.ok !== true || (status.kind === "multi" && status.repos.some(repo => repo.err || repo.stale))) {
    return { ok: false, error: "query failed" };
  }
  return { ok: true, pending: false };
}
const gitRefreshWaiters = [];
function finishGitRefreshWaiters(results) {
  for (const [wc, requestId, requestedPath] of gitRefreshWaiters.splice(0)) {
    pushGitRefreshResult(wc, requestId, gitRefreshResult(requestedPath, results));
  }
}

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
  let timer;
  try {
    const raw = await Promise.race([
      wc.executeJavaScript('(function(){var p=window.__zusageGitPaths;return JSON.stringify(Array.isArray(p)?p.slice(0,8):[])})()', true),
      new Promise((resolve) => { timer = setTimeout(() => resolve("[]"), 1000); }),
    ]).finally(() => { if (typeof clearTimeout === "function") clearTimeout(timer); });
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
function pushGitRefreshResult(wc, requestId, result) {
  if (!wc || wc.isDestroyed() || typeof requestId !== "string" || requestId.length > 120) return;
  const js = "window.__zusagePluginResult && window.__zusagePluginResult(" + JSON.stringify(Object.assign({ id: requestId }, result || {})) + ")";
  wc.executeJavaScript(js, true).catch(() => { });
}
async function gitTick(fromRefresh, requestId, requestWc, requestPath) {
  if (fromRefresh && requestId) gitRefreshWaiters.push([requestWc, requestId, requestPath || ""]);
  if (gitTickBusy) {
    if (fromRefresh) gitRefreshPending = true;
    return;
  }   // 在途时的手动刷新：结束后补跑一轮
  if (shuttingDown || !hasWindows()) {
    if (fromRefresh) finishGitRefreshWaiters(new Map());
    return;
  }
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
    const results = new Map();
    const refreshPaths = new Set();
    if (requestPath && requestWc && wants.some(([wc]) => wc === requestWc)) refreshPaths.add(requestPath);
    for (const [, , path] of gitRefreshWaiters) if (path) refreshPaths.add(path);
    if (!fromRefresh) for (const p of all) refreshPaths.add(p);
    await Promise.all([...all].map(async (p) => {   // 同一仓库多窗口/多 pane 只查一次，结果分发
      const st = await queryGitStatus(p);
      results.set(p, st);
      for (const [wc, ps] of wants) if (ps.includes(p)) pushGitState(wc, p, st);
    }));
    if (requestId && !gitRefreshWaiters.some(([, waiterId]) => waiterId === requestId)) {
      pushGitRefreshResult(requestWc, requestId, gitRefreshResult(requestPath, results));
    }
    if (!gitRefreshPending) finishGitRefreshWaiters(results);
  } catch (e) {
    LOG("git status tick failed:", e.message);
    if (!gitRefreshPending) finishGitRefreshWaiters(new Map());
  } finally {
    gitTickBusy = false;
    if (gitRefreshPending) {
      gitRefreshPending = false;
      gitTick(true).catch(() => { });
    }
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
      let reqTimer;
      const requests = await Promise.race([
        wc.executeJavaScript('(function(){var q=window.__zusagePluginRequests;return Array.isArray(q)?q.splice(0,8):[]})()', true),
        new Promise((resolve) => { reqTimer = setTimeout(() => resolve([]), 1000); }),
      ]).finally(() => { if (typeof clearTimeout === "function") clearTimeout(reqTimer); });
      if (!Array.isArray(requests)) continue;
      for (const req of requests) {
        if (req && ["auto", "check", "update"].includes(req.action)) {
          if (pluginUpdater) pluginUpdater.request(req).catch((e) => LOG("plugin update action failed:", e.message));
        } else if (req && req.action === "rate-line" && typeof req.enabled === "boolean") {
          setAnswerRateLine(req.enabled, wc, req.requestId);
        } else if (req && req.action === "restart-notice" && typeof req.enabled === "boolean") {
          setRestartNotice(req.enabled, wc, req.requestId);
        } else if (req && req.action === "quota-providers") {
          handleQuotaProviders(wc, req);
        } else if (req && req.action === "quota" && typeof req.enabled === "boolean") {
          setQuotaEnabled(req.enabled, wc, req.requestId);
        } else if (req && req.action === "quota-reset" && typeof req.enabled === "boolean") {
          setResetBadgeEnabled(req.enabled, wc, req.requestId);
        } else if (req && req.action === "mobile-relay") {
          if (typeof req.enabled === "boolean") await setMobileRelayEnabled(req.enabled, wc, req.requestId);
          else deliverPluginRequest(wc, req.requestId, { ok: false, error: "invalid enabled" });
        } else if (req && req.action === "autocompact-patch" && typeof req.enabled === "boolean") {
          setAutoCompactPatch(req.enabled, wc, req.requestId);
        } else if (req && req.action === "autocompact-config") {
          handleAutoCompactConfig(req, wc);
        } else if (req && (req.action === "quota-src" || req.action === "quota-src-key" || req.action === "quota-src-refresh")) {
          handleQuotaSourceRequest(req, wc);
        } else if (req && (req.action === "model-pull-list" || req.action === "model-pull-fetch" || req.action === "model-pull-apply" || req.action === "model-pull-probe")) {
          handleModelPullRequest(req, wc);
        } else if (req && (req.action === "prompt-enhance" || req.action === "prompt-enhance-v2")) {
          handlePromptEnhanceRequest(req, wc);
        } else if (req && ["enhance-history-list", "enhance-history-add", "enhance-history-delete", "enhance-history-clear"].includes(req.action)) {
          handleEnhanceHistoryAction(req, wc);
        } else if (req && ["enhance-provider-list", "enhance-provider-models", "enhance-provider-save"].includes(req.action)) {
          handleEnhanceProviderAction(req, wc).catch(() => deliverPluginRequest(wc, req.requestId, { ok: false, error: "provider operation failed" }));
        } else if (req && req.action === "prompt-enhance-cancel" && typeof req.requestId === "string") {   // v344.1：增强中再点=取消在途请求
          handlePromptEnhanceCancel(req, wc);
        } else if (req && req.action === "enhance" && typeof req.enabled === "boolean") {   // ⚙ 面板开关（同 rate-line/quota 族命名）
          setEnhanceEnabled(req.enabled, wc, req.requestId);
        } else if (req && (req.action === "release-notes" || req.action === "release-notes-list")) {   // v202 ⚙ 更新日志：按需拉取当前 Release 渠道的发布说明
          handleReleaseNotesRequest(req, wc);
        } else if (req && req.action === "quota-refresh") {   // ⚙/chip 手动刷新：绕过 TTL 与软冻结
          const started = quotaClient && quotaEnabled() && (typeof req.sourceId === "string" && req.sourceId.length <= 256
            ? quotaClient.refreshSource(req.sourceId) : quotaClient.refresh());
          deliverPluginRequest(wc, req.requestId, started ? { ok: true, pending: true } : { ok: false, error: "quota query already running or unavailable" });
        } else if (req && req.action === "quota-poke") {   // v361 重置卡软强刷（窗口恢复可见/悬停徽标）：30s 防抖，门控与退避语义在 pokeReset 内
          const poked = quotaClient ? quotaClient.pokeReset() : 0;
          deliverPluginRequest(wc, req.requestId, { ok: true, poked });
        } else if (req && req.action === "turn-text" && typeof req.sid === "string") {
          queryTurnText(req.sid, wc, req.cn === 0, req.forceKmb === true, req.unitEpoch, req.cost === 0);
        } else if (req && req.action === "git-refresh") {   // v96：Git chip 点击 / 快照后节流：立即重查全部已关注路径
          gitTick(true, req.requestId, wc, req.path).catch(() => { });
        } else if (req && req.action === "sysmon-sub") {   // v356：系统状态订阅（want+cfg+projectPath 合一）
          handleSysmonRequest(req, wc);
        } else if (req && req.action === "sysmon-refresh") {   // v356：Tooltip 手动刷新（仅订阅中生效）
          const refreshed = !!(sysmonClient && sysmonWantAny());
          if (refreshed) sysmonClient.refreshNow();
          deliverPluginRequest(wc, req.requestId, refreshed ? { ok: true, pending: true } : { ok: false, error: "sysmon not subscribed" });
        } else if (req && req.action === "relaunch") {   // v172：⚙ 更新页「重启 ZCode」按钮（浮层已二次确认）
          if (pluginUpdater && pluginUpdater.status().busy) {   // 更新进行中拒绝重启：quit 会打断下载/安装
            deliverPluginRequest(wc, req.requestId, { ok: false, error: "update in progress" });
          } else {
            // v244：回执送达（executeJavaScript 已在渲染端执行回调）后 30ms 即退出，替代固定 300ms——
            // 真正的等待在宿主 app.quit 优雅退出链（关窗+逐个终止会话/扩展子进程），插件侧不再叠加固定延迟；
            // 渲染端无响应时 800ms 硬兜底也必须退出。quit 走 before-quit 清理钩子。
            let quitArmed = false;
            let relaunchRequestAt = 0;
            let relaunchQuitCancelled = false;   // 宿主 before-quit 会话保护 preventDefault 后置位（见 quitNow）
            /* v245 review 修复：quit 同步失败或被拦截时不能让窗口消失、进程还活着——
             * 恢复全部窗口可见性（渲染端 90s 还原兜底此时才对用户可见）。 */
            const unhideWindows = () => {
              try {
                for (const win of BrowserWindow.getAllWindows()) {
                  try { if (!win.isVisible()) win.show(); } catch (e2) { }
                }
              } catch (e2) { LOG("relaunch unhide windows failed:", e2.message); }
            };
            const quitNow = () => {
              if (quitArmed) return;
              quitArmed = true;
              /* issue #372：有合法待收尾 asar 时不能 app.relaunch()——Windows 的
               * relauncher 助手本身也是 ZCode.exe，monitor 的「全部进程退出」判据在
               * 应用内重启期间永不成立，TMP 永远不 rename、marker 永不销账。
               * 改为写交接请求 + quit-only：monitor 换包完成后按请求拉起新实例。
               * 该路径不隐藏窗口，宿主 before-quit 的「确认退出」弹窗需要可见父窗口。 */
              const pendingAsar = pendingAsarPath();
              relaunchRequestAt = pendingAsar ? writeRelaunchRequest(pendingAsar) : 0;
              if (relaunchRequestAt) {
                relaunchQuitCancelled = false;
                /* 宿主会话保护在 before-quit 里 showMessageBoxSync + preventDefault：
                 * 用户取消后 quit 中止、进程继续运行。once 监听捕获该事实，15s 哨兵
                 * 据此撤回交接请求——慢退出/弹窗阻塞没有 preventDefault，请求必须保留
                 * 给 monitor（退出链可超过 15s，届时清掉会让收尾后无人拉起，review MAJOR）。 */
                try { app.once("before-quit", (e) => { relaunchQuitCancelled = !!(e && e.defaultPrevented); }); } catch (e2) { LOG("relaunch cancel watch failed:", e2.message); }
                try { app.quit(); } catch (e) {
                  LOG("relaunch handover quit failed:", e.message);
                  clearRelaunchRequest(relaunchRequestAt);   // quit 未发生：撤回请求，防 monitor 收尾后误拉起
                  relaunchRequestAt = 0;
                  unhideWindows();
                }
                return;
              }
              /* v245：宿主退出屏障（prepareAppQuit 等 host 子进程树回收，macOS 7.5s 强杀/9s 上限）
               * 期间窗口全程可见——先隐藏全部窗口给出「立即退出」的视觉反馈，清理链后台照常，
               * relaunch 后由宿主重建窗口。 */
              try {
                for (const win of BrowserWindow.getAllWindows()) {
                  try { if (win.isVisible()) win.hide(); } catch (e2) { }
                }
              } catch (e2) { LOG("relaunch hide windows failed:", e2.message); }
              try { app.relaunch(); app.quit(); } catch (e) {
                LOG("relaunch failed:", e.message);
                unhideWindows();
              }
            };
            const quitFallback = setTimeout(quitNow, 800);
            /* v245 review 修复：屏障有硬上限（9s），15s 后进程仍在=quit 未发生——恢复窗口可见性；
             * unref 确保哨兵绝不拖住退出（正常路径随进程消亡，测试中不延滞事件循环）。
             * app.isQuitting 非 Electron 内建（宿主不设置）→ 条件恒真兜回 unhide；此时 relaunch
             * 标记已留存，用户随后手动退出会被宿主转成重启——与待重启语义一致，属已知取舍。
             * 交接请求只在「退出被会话保护取消」（relaunchQuitCancelled）时撤回：quit 请求撤回
             * 或 15s 哨兵对慢退出误判都会让 monitor 收尾后无人拉起（issue #372 review）。 */
            const unhideSentinel = setTimeout(() => {
              if (!app.isQuitting && quitArmed) {
                unhideWindows();
                if (relaunchRequestAt && relaunchQuitCancelled) {
                  clearRelaunchRequest(relaunchRequestAt);
                  relaunchRequestAt = 0;
                }
              }
            }, 15000);
            if (unhideSentinel && typeof unhideSentinel.unref === "function") unhideSentinel.unref();
            Promise.resolve(deliverPluginRequest(wc, req.requestId, { ok: true })).then(() => {
              clearTimeout(quitFallback);
              setTimeout(quitNow, 30);
            });
          }
        } else if (req && typeof req.requestId === "string") {   // v180 issue #158：白名单外动作兜底回执——
          // 浮层热更/主进程冷加载的版本错位窗口里，未知动作不再静默丢弃，浮层据此给出「主进程是旧版本」的明确指引
          deliverPluginRequest(wc, req.requestId, { ok: false, error: "unknown action: " + String(req.action).slice(0, 60) });
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
  if (!overlaySrc || !isMainWindowState(wc) || wc.isDestroyed() || !isLocalHostPage(wc)) return;   // 外部页面不注入（数据面门控，同 pollPluginRequests）
  const cleanup = '(function(){if(window.__zusageDispose)window.__zusageDispose();else{document.querySelectorAll(".zusage-root,.zusage-tip-root,.zusage-exc").forEach(function(e){e.remove()});if(window.__zusageRateCleanup)window.__zusageRateCleanup()}window.__zusageOverlay=false;})();\n';
  /* turn-stats.js 先于 overlay.js 注入（IIFE 幂等，重复执行只是重挂 ZUsageTurnStats）：
   * overlay 启动即读取该全局做实时/确定性统计；overlay 缺它时自动降级为 DB 轮询路径。 */
  wc.executeJavaScript((reload ? cleanup : "") + turnStatsSrc + "\n" + overlaySrc, true).then(() => {
    /* 无条件推送：updater 不可用时也要让面板拿到 rateLine 真值（缺省开） */
    pushPluginState(wc, pluginUpdater ? pluginUpdater.status() : {});
    /* 注入即补推最近一次成功快照（v13）：maybeSpawn 的去重在 wants/db mtime 均未变化时
     * 直接短路，新窗口/整页重载后若无新写入就没有下一次推送，条只能停在零值。overlay
     * 装好立刻喂上一帧，数据随后由正常查询链刷新；quota 合并与 onUpdate 补推同款。 */
    if (lastGoodPayload) {
      const warm = (quotaClient && quotaEnabled())
        ? Object.assign({}, lastGoodPayload, { quota: quotaClient.view() }) : lastGoodPayload;
      pushOnce(wc, warm);
    }
  }).catch(() => { });
}

const hook = (wc) => {
  if (!isMainWindowState(wc)) return;
  startResident();   // 首个主窗出现即预热常驻 python：与其后 ≤1s 的 wants-eval/页面装载重叠，
                     // 省重启后首查的串行解释器启动；pyRes 已在/无窗/不稳定时内部自拒，
                     // 预热后无查询则随 30s 空闲自停回收（空闲零进程契约不变）。
  wc.on("destroyed", () => {
    activeSid.delete(wc.id);
    windowWorkspaces.delete(wc.id);
    windowTasks.delete(wc.id);
    scopeBindings.delete(wc.id);
    remoteEvidence.delete(wc.id);
    windowQuotaSelections.delete(wc.id);
    if (sysmonSubs.delete(wc.id)) sysmonSyncSubscribed();   // v356：窗口销毁摘订阅，末窗关闭即停采样
    invalidateMobileTarget(wc.id);
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
    if (mobileTarget && mobileTarget.wc === wc) { mobileDiscovery++; revokeMobileTarget(); }
    windowQuotaSelections.set(wc.id, {});
    syncQuotaProviders();
  });
  /* dom-ready 即注入（v13）：did-finish-load 要等全部子资源（图片/字体/懒加载）结束才
   * 触发，重启后条晚出现数秒；dom-ready 在 DOM 可用时到达，overlay 自带输入框轮询等待，
   * 早注入无副作用；did-finish-load 保留兜底（SPA 内部导航后重新装载的情况）。 */
  wc.on("dom-ready", () => injectOverlay(wc));
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
    ipcState: () => ({ activeSid, windowWorkspaces, windowTasks, scopeBindings, remoteEvidence }),
    hotReloadMainModules,   // v258：热替换循环测试入口
    disposeQuotaSubsystem,   // v258：退出清理测试入口（watcher 关闭断言）
    quotaWatcherCount: () => quotaWatchers.length,
    hotModuleState: () => ({ mtimes: { ...hotModuleMtimes }, busy: hotMainBusy, hashes: { ...loadedHashes } }),
  };
}

LOG("injected v15 (dom-ready inject + snapshot warm-push after injection, auto remote targets + per-sid multi-server routing, per-pane wants array, resident query mode with idle shutdown + first-window warm-up, renderer bridge probe, answer_rate_line config write, plugin request polling, quota entitlement client, git status chip, diag config switch + default 5s hot tick, plugin request/response protocol with per-request result delivery and quota source feedback, git refresh busy lifecycle)");

app.on("before-quit", () => {
  shuttingDown = true;
  mobileDiscovery++;
  mobileTarget = null;
  if (mobileRelay) { try { mobileRelay.dispose(); } catch (e) { } mobileRelay = null; }
  clearTimeout(retryTimer);
  clearTimeout(debounceTimer);
  clearTimeout(pendingZipDebounce);
  stopResident();
  disposeQuotaSubsystem();   // v258：连同凭据目录 watcher 一并释放（此前 watcher 从不关闭）
  if (dbWatcher) { try { dbWatcher.close(); } catch (e) { } dbWatcher = null; }
  if (pendingZipWatcher) { try { pendingZipWatcher.close(); } catch (e) { } pendingZipWatcher = null; }
  if (pendingZipTimer) { clearInterval(pendingZipTimer); pendingZipTimer = null; }
});
