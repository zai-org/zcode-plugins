#!/usr/bin/env node
// cc-browser-bridge 首次连接引导：独立本机 HTTP 服务 + 启动器（随插件分发，无新增依赖）
//   服务模式：node onboard.js           监听 127.0.0.1，提供引导页与受控 API
//   启动器：  node onboard.js --launch  复用/拉起服务并打开引导页（macOS open / Windows chrome.exe）；stdout 只输出带令牌的 URL
//   自动模式：node onboard.js --auto    会话钩子用：未展示过且扩展未连接时打开一次（退避+并发去重，stdout 恒空）
// 安全边界（与 bridge.js 同风格，互相独立）：
//   - 只监听 127.0.0.1；Host 仅限 127.0.0.1/localhost/[::1]+端口（防 DNS 重绑定）
//   - /api/* 拒绝一切网页 Origin，唯一例外是本服务自身 Origin（引导页同源 fetch）
//   - 一次性会话令牌：crypto.randomBytes(24)，timing-safe 比较；会话文件 0600
//   - 副作用仅三个固定动作：open_extensions / reveal_folder 由 platform-actions 平台适配层
//     产出 spawn 固定参数数组（不经 shell、不接受客户端传入的路径/命令）；win32 的 GUI 打开
//     （chrome.exe）按「spawn 确认已发起打开 + 有界观察」处理——绝不因浏览器主进程常驻而 kill；
//     ensure_bridge 复用阶段 A 纯 Node 启动层（无 Bash/Git Bash/WSL 依赖，Windows 原生可运行）
//   - 不代理 /tool /mcp，不提供通用命令执行；空闲 30 分钟或寿命 2 小时自动退出

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { spawn } = require("child_process");
const { rmOwnedSync } = require("./fsutil");
const platformActions = require("./platform-actions");
const endpoint = require("./endpoint");

const VERSION = "0.6.0";
const SERVICE = "cc-browser-onboard";
const DEFAULT_PORT = Number(process.env.ONBOARD_PORT || 8791);
const PORT_SPAN = 10;
const BRIDGE_URL = (process.env.ONBOARD_BRIDGE_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
const SHELL_DISABLED = process.env.ONBOARD_SHELL_DISABLED === "1";
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LIFE_MS = 2 * 60 * 60 * 1000;
const TABS_CACHE_MS = 5000;
// 桥接 home 默认与 launcher.ensureReady 同一规则：ONBOARD_HOME（launcher 注入）优先，
// 其次 BROWSER_BRIDGE_HOME，最后 ~/.browser-bridge；ensure_bridge 动作按此复用纯 Node 启动能力
const bridgeHomeOf = () =>
  (HOME_SCOPE && String(HOME_SCOPE).trim()) ||
  (process.env.BROWSER_BRIDGE_HOME && String(process.env.BROWSER_BRIDGE_HOME).trim()) ||
  path.join(os.homedir(), ".browser-bridge");

// ---------- 布局自定位：插件目录（plugins/cc-browser-bridge/server）或项目仓库（server） ----------
function resolveLayout(baseDir) {
  const root = path.resolve(baseDir, "..");
  const pluginScript = path.join(root, "hooks", "start-bridge.sh");
  const repoScript = path.join(root, "plugins", "cc-browser-bridge", "hooks", "start-bridge.sh");
  if (fs.existsSync(path.join(root, ".zcode-plugin")))
    return { mode: "plugin", root, extDir: path.join(root, "extension"),
      startBridge: fs.existsSync(pluginScript) ? { cmd: "bash", args: [pluginScript, path.join(root, "server"), root] } : null };
  if (fs.existsSync(repoScript))
    return { mode: "repo", root, extDir: path.join(root, "extension"),
      startBridge: { cmd: "bash", args: [repoScript, path.join(root, "plugins", "cc-browser-bridge", "server"), path.join(root, "plugins", "cc-browser-bridge")] } };
  return { mode: "unknown", root, extDir: null, startBridge: null };
}
const LAYOUT = resolveLayout(__dirname);
// 稳定扩展目录覆盖（阶段 A 通用启动层传入 ~/.browser-bridge/extension，升级后加载路径不变；不设置时沿用安装目录）
const EXT_DIR = process.env.ONBOARD_EXT_DIR || null;
const extDirOf = () => EXT_DIR || LAYOUT.extDir;
const UI_FILE = path.join(__dirname, "onboard-ui.html");
const STATE_FILE = path.join(__dirname, "onboard-state.js");

// 会话身份（R3）：launcher 注入 ONBOARD_SESSION_FILE（位于共享 home/state）+ ONBOARD_HOME 时，
// 会话按「共享 home + 桥接端点」去重——不同安装目录的客户端复用同一引导实例；
// 独立运行（未注入 home）时保持按「规范化安装根」隔离
const ROOT_NORM = (() => { try { return fs.realpathSync(LAYOUT.root); } catch (e) { return LAYOUT.root; } })();
const HOME_SCOPE = (process.env.ONBOARD_HOME && String(process.env.ONBOARD_HOME).trim()) || null;
function sessionFileFor(rootNorm) {
  const h = crypto.createHash("sha256").update(String(rootNorm) + "|" + SERVICE).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), "cc-onboard-" + h + ".json");
}
const SESSION_FILE = process.env.ONBOARD_SESSION_FILE || sessionFileFor(ROOT_NORM);

// ---------- 自动引导（--auto）：完成状态 / 节流退避 / 并发去重 ----------
// autoOpenedAt 只表示引导已展示，不代表用户完成引导或客户端验收通过。
// 已完成/已展示不因版本变化重开；--launch 始终允许用户主动重开。
const AUTO_STATE_FILE = process.env.ONBOARD_STATE_FILE || path.join(LAYOUT.root, ".onboard-state.json");
const AUTO_ATTEMPT_FILE = SESSION_FILE + ".auto-attempt.json";
const AUTO_LOCK_DIR = SESSION_FILE + ".auto.lock";
const AUTO_BACKOFF_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000]; // 连续失败退避（封顶 15 分钟）
const AUTO_WAIT_MS = Number(process.env.ONBOARD_AUTO_WAIT_MS || 12000);
const AUTO_LOCK_TTL_MS = 120 * 1000;
const AUTO_INIT_GRACE_MS = 10 * 1000; // pid.json 未写出的初始化宽限：不得把并发者的新锁当陈旧互删

function readJsonFile(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } }

// 兼容旧版成功 attempt：以前只有十分钟节流，现在成功展示过就不再自动弹。
function shouldAutoOpen(o) {
  const s = o.state, a = o.attempt;
  if (s && s.completedAt) return { open: false, reason: "completed" };
  if (s && s.autoOpenedAt) return { open: false, reason: "shown" };
  if (a && Number.isFinite(a.at)) {
    if (a.failures === 0) return { open: false, reason: "shown" };
    const wait = AUTO_BACKOFF_MS[Math.min(a.failures, AUTO_BACKOFF_MS.length) - 1];
    if (o.now - a.at < wait) return { open: false, reason: "backoff" };
  }
  return { open: true, reason: "first" };
}

function noteShown(at = Date.now()) {
  const s = readJsonFile(AUTO_STATE_FILE) || {};
  if (s.autoOpenedAt || s.completedAt) return;
  try {
    fs.mkdirSync(path.dirname(AUTO_STATE_FILE), { recursive: true });
    fs.writeFileSync(AUTO_STATE_FILE, JSON.stringify({ autoOpenedAt: new Date(at).toISOString(), version: VERSION }, null, 2), { mode: 0o600, flag: "wx" });
  } catch (e) {
    // 用户可能同时点完成：独占创建避免覆盖另一个进程刚写入的完成状态。
    if (e.code !== "EEXIST") console.error("引导展示记录写入失败: " + e.message);
  }
}

// 打开动作的并发去重：mkdir 原子锁。与 R2 服务锁同策略：
//   - 初始化宽限：pid.json 未写出且锁龄 <10s 视为他人持有（并发启动不得互删新锁）
//   - 接管仅限：持锁进程已死、或锁龄超 TTL 的滞留锁
//   - 所有权释放：只删除 pid.json 中是自己 pid 的锁，绝不删别人的
let autoLockOwned = false;
function autoLockAcquire() {
  const tryTake = () => {
    try { fs.mkdirSync(AUTO_LOCK_DIR); } catch (e) { return false; }
    try { fs.writeFileSync(path.join(AUTO_LOCK_DIR, "pid.json"), JSON.stringify({ pid: process.pid, at: Date.now() })); } catch (e) {}
    autoLockOwned = true;
    return true;
  };
  if (tryTake()) return "acquired";
  const info = readJsonFile(path.join(AUTO_LOCK_DIR, "pid.json"));
  if (info && Number.isInteger(info.pid)) {
    if (pidAlive(info.pid) && Date.now() - (info.at || 0) < AUTO_LOCK_TTL_MS) return "held";
    try { rmOwnedSync(AUTO_LOCK_DIR); } catch (e) { return "busy"; } // 接管失败如实报告（不假装成功）
    return tryTake() ? "acquired" : "busy";
  }
  let age = Infinity;
  try { age = Date.now() - fs.statSync(AUTO_LOCK_DIR).mtimeMs; } catch (e) {}
  if (age < AUTO_INIT_GRACE_MS) return "held";
  try { rmOwnedSync(AUTO_LOCK_DIR); } catch (e) { return "busy"; }
  return tryTake() ? "acquired" : "busy";
}
function autoLockRelease() {
  if (!autoLockOwned) return;
  autoLockOwned = false;
  const info = readJsonFile(path.join(AUTO_LOCK_DIR, "pid.json"));
  if (info && info.pid === process.pid) {
    try { rmOwnedSync(AUTO_LOCK_DIR); }
    catch (e) { console.error("auto 锁释放失败（他人将按陈旧锁接管重试）：" + e.message); }
  }
}

let completionNoted = false;
// 完成状态只能由用户在引导页明确点「完成引导」（POST /api/done）写入；
// 后台健康/连接探测（含只读 tabs 通过）不算用户引导完成，绝不写 completed
function markComplete() {
  if (completionNoted) return;
  completionNoted = true;
  try {
    fs.writeFileSync(AUTO_STATE_FILE, JSON.stringify({ completedAt: new Date().toISOString(), version: VERSION, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  } catch (e) { console.error("完成状态写入失败: " + e.message); }
}

function writeAutoAttempt(failures) {
  try { fs.writeFileSync(AUTO_ATTEMPT_FILE, JSON.stringify({ at: Date.now(), failures }, null, 2), { mode: 0o600 }); } catch (e) {}
}

async function autoLaunch() {
  const dbg = (...a) => { if (process.env.ONBOARD_AUTO_DEBUG === "1") console.error("[auto] " + a.join(" ")); };
  const decide = () => shouldAutoOpen({ state: readJsonFile(AUTO_STATE_FILE), attempt: readJsonFile(AUTO_ATTEMPT_FILE), version: VERSION, now: Date.now() });
  const pre = decide(); // 锁前预判只是快速路径
  if (!pre.open) {
    // 把旧版成功 attempt 迁入持久状态，临时会话文件清理后仍不重复弹。
    if (pre.reason === "shown") noteShown((readJsonFile(AUTO_ATTEMPT_FILE) || {}).at);
    dbg("skip:", pre.reason); return 0;
  }
  const lock = autoLockAcquire();
  if (lock !== "acquired") { dbg("skip: lock " + lock); return 0; }
  try {
    // 锁内必须重判：等锁期间前一个进程可能已完成打开并写了 attempt/状态，
    // 用旧判定的排队者不得再打开（真实并发只允许一次打开动作）
    const decision = decide();
    if (!decision.open) { dbg("skip after lock:", decision.reason); return 0; }
    const bridge = await bridgeStatus();
    if (bridge.up && bridge.extension_connected) { dbg("skip: connected"); return 0; }
    let url = await existingUrl();
    if (!url) {
      const child = spawn(process.execPath, [__filename], { detached: true, stdio: ["ignore", "ignore", "ignore"], env: process.env });
      child.unref();
      url = await waitForExistingSession(AUTO_WAIT_MS);
    }
    if (!url) {
      const prev = readJsonFile(AUTO_ATTEMPT_FILE);
      writeAutoAttempt(((prev && prev.failures) || 0) + 1);
      dbg("server not healthy");
      return 0;
    }
    const opened = await openUrl(url);
    if (!opened || !opened.ok) {
      // 打开失败必须可观测：记失败进入退避；绝不把失败当成功、绝不升级完成状态
      const prev = readJsonFile(AUTO_ATTEMPT_FILE);
      writeAutoAttempt(((prev && prev.failures) || 0) + 1);
      dbg("open failed:", (opened && opened.reason) || "unknown");
      return 0;
    }
    writeAutoAttempt(0);
    noteShown();
    dbg("opened");
    return 0;
  } finally {
    autoLockRelease();
  }
}

// ---------- 固定动作表（唯一的副作用入口；参数全部来自安装位置计算） ----------
// open_extensions / reveal_folder：platform-actions 适配层按真实平台产出参数数组
//   macOS：open -a "Google Chrome" chrome://extensions/ 与 open -R <目录>
//   Windows：标准位置查找 chrome.exe 后 --new-window 打开；explorer.exe <目录>（固定路径参数）
// ensure_bridge：复用阶段 A 纯 Node 启动层（见 ensureBridgeViaLauncher）
const ACTIONS = {
  open_extensions: {},
  reveal_folder: {},
  ensure_bridge: {},
};

// ---------- Windows GUI 进程寿命（阶段 B R2）：spawn 确认「已发起打开」+ 有界观察，绝不因常驻 kill ----------
// chrome.exe 打开 chrome://extensions/ 或引导页时有两种真实寿命：冷启动时该进程就是浏览器主进程
// （长驻）；已有实例时移交 URL 后很快退出 0。旧的「等 close + 15s SIGKILL」会把常驻当挂起：
// 误杀用户浏览器并谎报失败；openUrl 等 close 则无限挂起（--auto 永不返回）。
// 语义（仅用于 gui:true 的动作）：spawn error → 失败（无法创建进程）；观察窗内退出 0 → 成功（移交）；
// 观察窗内非零退出 → 失败（即时失败）；观察窗结束仍存活 → 成功（已发起打开，绝不代表 Chrome 已连接）。
// stdio 全 ignore + detached + 立即 unref：解除子进程/管道/父寿命引用（Windows 上仅 unref 不够，
// 父启动器退出会连带关闭 GUI 子进程），子进程不阻塞本进程事件循环也从不过继父寿命；从不调用 kill。
const GUI_ACTION_WATCH_MS = 4000;   // 按钮动作观察窗（远小于引导页 15s 请求截止，页面不会超时）
const GUI_OPENURL_WATCH_MS = 15000; // 自动/启动器打开 URL 的观察窗（有界；移交场景通常几百毫秒内即返回）
function spawnGuiBounded(cmd, args, watchMs) {
  return new Promise((res) => {
    let settled = false, timer = null;
    let p;
    try {
      // Windows 实机证据（stage-b-gui-parent-exit-findings）：仅 unref 不足以脱离父寿命——
      // 启动器退出时 GUI 子进程仍被连带关闭（Chrome 冷启动窗口随 --launch 返回而消失）。
      // Node 语义：Windows 上 detached:true 使子进程在父退出后继续运行；stdio 全 ignore
      // 避免新控制台窗口并解除管道引用；unref 解除事件循环引用。三者组合=脱离父寿命且不阻塞本进程。
      p = spawn(cmd, args, { detached: true, stdio: ["ignore", "ignore", "ignore"] });
    } catch (e) {
      // Windows 实机证据（stage-b-r2-windows-findings）：spawn 对不可执行文件等会同步抛异常
      // （UNKNOWN/EINVAL）。executor 内的同步 throw 会把 Promise 变成 raw rejection，
      // 调用边界一旦未处理即崩溃——这里与异步 error 事件一致返回结构化错误，本函数绝不 reject
      return res({ ok: false, reason: "无法执行 " + cmd + ": " + (e && e.code ? e.code + " " : "") + (e && e.message || e) });
    }
    try { p.unref(); } catch (e) {}
    const finish = (v) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { p.removeListener("exit", onExit); p.removeListener("error", onError); } catch (e) {}
      res(v);
    };
    const onExit = (code, signal) => {
      if (code === 0) return finish({ ok: true, handedOff: true });
      finish({ ok: false, reason: "退出码 " + code + (signal ? "（信号 " + signal + "）" : "") + "（浏览器进程立即退出）" });
    };
    const onError = (e) => finish({ ok: false, reason: "无法执行 " + cmd + ": " + (e && e.message || e) });
    p.on("spawn", () => {
      if (!(Number(watchMs) > 0)) return finish({ ok: true, launched: true });
      timer = setTimeout(() => finish({ ok: true, launched: true }), watchMs); // 仍存活=已发起打开；绝不 kill
    });
    p.on("exit", onExit);
    p.on("error", onError);
  });
}

// Chrome 可执行文件（仅 Windows 需要显式查找；macOS 由 open -a 定位）
const chromePathOf = () => (process.platform === "win32" ? platformActions.findChromeWin() : null);

// ensure_bridge 动作：惰性 require launcher，规避 launcher↔onboard 循环依赖
// （launcher 顶层 require 本模块；运行期再取 launcher 时两边均已加载完成，也不会重复拉起：
//   复用 ensureReady 的健康检查/原子锁/幂等语义，且 noOnboarding 阻止引导自触发）
async function ensureBridgeViaLauncher() {
  const ep = endpoint.parseEndpoint({ BRIDGE_URL });
  if (!ep.ok) return { ok: false, reason: "桥接端点配置非法：" + ep.error };
  if (!ep.manageable)
    return { ok: false, reason: "桥接端点 " + ep.url + " 为远程/HTTPS 端点，引导不启动本地服务；请确认该端点可达" };
  const launcher = require("./launcher");
  const r = await launcher.ensureReady({
    home: bridgeHomeOf(), port: ep.port, layoutRoot: LAYOUT.root,
    noOnboarding: true, env: process.env,
  });
  if (!r.ok) return { ok: false, reason: r.reason }; // 端口被无关程序占用/启动超时等，如实报告
  return { ok: true, reused: !!(r.bridge && r.bridge.reused), home: bridgeHomeOf(), port: ep.port };
}

function runAction(name) {
  if (name === "ensure_bridge") {
    if (SHELL_DISABLED)
      return Promise.resolve({ ok: false, reason: "本地打开/启动动作已被禁用（ONBOARD_SHELL_DISABLED=1）" });
    return ensureBridgeViaLauncher().catch((e) => ({ ok: false, reason: "启动桥接失败：" + (e && e.message || e) }));
  }
  return new Promise((res) => {
    const def = ACTIONS[name];
    if (!def) return res({ ok: false, reason: "未知动作: " + name });
    if (SHELL_DISABLED) return res({ ok: false, reason: "本地打开/启动动作已被禁用（ONBOARD_SHELL_DISABLED=1）" });
    const ed = extDirOf();
    if (name === "reveal_folder" && (!ed || !fs.existsSync(ed)))
      return res({ ok: false, reason: "扩展目录不存在: " + ed });
    let argv = null;
    if (name === "open_extensions") {
      const plan = platformActions.openExtensionsPlan(process.platform);
      if (!plan) return res({ ok: false, reason: platformActions.UNSUPPORTED_REASON });
      if (plan.kind === "manual")
        // Windows（R5）：Chromium 拒绝 chrome:// 命令行导航——如实返回人工导航契约（非服务错误），
        // 绝不发起只会得到空白新标签页的无效 Chrome 子进程
        return res({ ok: true, manualRequired: true, url: plan.url, reason: plan.reason });
      argv = [plan.cmd, ...plan.args]; // darwin：open 短命命令，退出码语义
    } else {
      const built = platformActions.revealFolderArgs(process.platform, ed);
      if (!built) return res({ ok: false, reason: platformActions.UNSUPPORTED_REASON });
      argv = [built.cmd, ...built.args];
    }
    const p = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stdout.on("data", () => {});
    p.stderr.on("data", (d) => { err += String(d); });
    const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch (e) {} }, 15000);
    p.on("error", (e) => { clearTimeout(timer); res({ ok: false, reason: "无法执行 " + argv[0] + ": " + e.message }); });
    p.on("close", (code) => {
      clearTimeout(timer);
      // explorer.exe 把打开请求移交给既有资源管理器进程后常以退出码 1 结束（即使成功打开窗口），
      // 这是 Windows 既有行为；除该组合外，非零退出码一律如实视为失败
      const lenient = name === "reveal_folder" && process.platform === "win32" && code === 1;
      if (code !== 0 && !lenient)
        return res({ ok: false, reason: "退出码 " + code + (err.trim() ? "：" + err.trim().slice(0, 300) : "") });
      res({ ok: true });
    });
  });
}

// ---------- 与桥接的受控交互（本机进程身份：无 Origin 头，不触碰 bridge 安全边界） ----------
// 有界响应：绝对截止（AbortSignal.timeout）+ 体积上限（超限即失败，绝不无限累积）
async function fetchJsonBounded(url, init, timeoutMs, maxBytes) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { try { await reader.cancel(); } catch (e) {} throw new Error("响应体积超过上限 " + maxBytes + " 字节"); }
    chunks.push(Buffer.from(value));
  }
  return { status: res.status, ok: res.ok, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
}

async function bridgeStatus() {
  try {
    const r = await fetchJsonBounded(BRIDGE_URL + "/status", {}, 2000, 64 * 1024);
    if (!r.ok) return { up: false };
    return { up: !!r.json.ok, extension_connected: !!r.json.extension_connected };
  } catch (e) { return { up: false }; }
}

// 结构校验：绝不只看 ok 字符串；每个条目都要有有限数字 tab_id；结果只保留数量，不含标题/网址
function validateTabsPayload(body) {
  const text = body && body.result && Array.isArray(body.result.content) && body.result.content[0] && body.result.content[0].text;
  if (!body || typeof body !== "object" || body.ok !== true)
    return { state: "fail", error: String(text || (body && body.error) || "工具调用未成功"), paused: /已被暂停/.test(String(text || "")) };
  if (!text || body.result.content[0].type !== "text")
    return { state: "fail", error: "返回结构缺少 text 内容", paused: false };
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return { state: "fail", error: "标签页结果不是合法 JSON", paused: false }; }
  if (!parsed || !Array.isArray(parsed.tabs)) return { state: "fail", error: "返回结构中没有 tabs 数组", paused: false };
  for (const t of parsed.tabs) {
    if (!t || typeof t !== "object" || !Number.isFinite(t.tab_id))
      return { state: "fail", error: "标签页条目缺少有效的数字型 tab_id", paused: false };
  }
  return { state: "pass", count: parsed.tabs.length }; // 空数组是合法结构（count 0）
}

async function bridgeTabs() {
  let body = null;
  try {
    const r = await fetchJsonBounded(BRIDGE_URL + "/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "browser_tabs", arguments: { action: "list" } }),
    }, 12000, 8 * 1024 * 1024);
    if (!r.ok) return { state: "fail", error: "桥接 HTTP " + r.status, paused: false }; // HTTP 错误即使正文像 ok 也判失败
    body = r.json;
  } catch (e) {
    return { state: "fail", error: "无法调用桥接 /tool：" + (e.message || e), paused: false };
  }
  return validateTabsPayload(body);
}

let tabsCache = { at: 0, val: { state: "skip" } };
let tabsInFlight = null;
async function tabsChecked(fresh) {
  if (!fresh && Date.now() - tabsCache.at < TABS_CACHE_MS) return tabsCache.val;
  if (tabsInFlight) return tabsInFlight;
  tabsInFlight = bridgeTabs().then((v) => { tabsCache = { at: Date.now(), val: v }; tabsInFlight = null; return v; });
  return tabsInFlight;
}

async function statusPayload(fresh) {
  const b = await bridgeStatus();
  if (!b.up || !b.extension_connected) {
    tabsCache = { at: 0, val: { state: "skip" } }; // 扩展离线后缓存作废，重连即重查
    return { bridge: { ...b, url: BRIDGE_URL }, tabs: { state: "skip" } };
  }
  // 注意：后台连接健康/只读验证通过不写完成状态——完成只能由用户在引导页点「完成引导」
  return { bridge: { ...b, url: BRIDGE_URL }, tabs: await tabsChecked(fresh) };
}

// ---------- 请求边界 ----------
function hostOk(req, port) {
  const h = String(req.headers.host || "").toLowerCase();
  return h === "127.0.0.1:" + port || h === "localhost:" + port || h === "[::1]:" + port;
}
function originOk(req, port) {
  const o = req.headers.origin;
  if (o === undefined || o === "") return true; // 本机进程（curl/测试）不发 Origin
  return o === "http://127.0.0.1:" + port || o === "http://localhost:" + port; // 仅引导页自身
}
function ctJson(req) {
  const ct = String(req.headers["content-type"] || "").trim();
  if (ct === "") return true;
  return /^application\/json\b/i.test(ct);
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("body too large")); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------- HTTP 服务 ----------
let TOKEN = null, PORT = 0, UI_HTML = null, STATE_JS = null;
let startedAt = 0, lastTouch = 0;

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}
const deny = (res, msg) => sendJson(res, 403, { ok: false, error: msg });

async function handler(req, res) {
  try {
    const u = new URL(req.url, "http://127.0.0.1");
    const pathname = u.pathname.replace(/\/{2,}/g, "/");
    if (!hostOk(req, PORT)) return deny(res, "不可信的 Host（仅限 127.0.0.1/localhost 本机调用，防 DNS 重绑定）");

    // /api/* 一律先拒绝网页来源（含 health；本机进程不发 Origin，不受影响）
    if (pathname.startsWith("/api/") && !originOk(req, PORT))
      return deny(res, "不可信的 Origin（仅限本机进程与引导页自身）");

    if (req.method === "OPTIONS") {
      // 与 bridge 相同策略：过完 Host/Origin 检查；不返回任何 CORS 授权头（本服务唯一的浏览器客户端是同源引导页）
      res.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Cache-Control": "no-store" });
      return res.end();
    }

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
      });
      return res.end(UI_HTML);
    }

    if (req.method === "GET" && pathname === "/onboard-state.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end(STATE_JS);
    }

    if (req.method === "GET" && pathname === "/api/health")
      return sendJson(res, 200, { ok: true, service: SERVICE, version: VERSION });

    if (!pathname.startsWith("/api/")) return sendJson(res, 404, { ok: false, error: "not found" });

    if (!tokenOk(req, u)) return deny(res, "会话令牌缺失或无效");
    lastTouch = Date.now();

    if (req.method === "GET" && pathname === "/api/info") {
      // 真实平台/可用性：不把「Windows 平台」假设为已装 Chrome——chrome_found 每次如实探测；
      // open_supported 只表示管理页可自动导航；Windows 需人工粘贴地址，文件夹动作另行报告。
      const ep = endpoint.parseEndpoint({ BRIDGE_URL });
      const chromePath = chromePathOf();
      const extOk = !!extDirOf() && fs.existsSync(extDirOf());
      return sendJson(res, 200, {
        ok: true, platform: process.platform,
        open_supported: process.platform === "darwin" && extOk,
        manual_navigation: process.platform === "win32",
        reveal_supported: (process.platform === "darwin" || process.platform === "win32") && extOk,
        chrome_found: process.platform === "win32" ? !!chromePath : null,
        chrome_path: chromePath,
        ext_dir: extDirOf(), ext_dir_exists: extOk,
        bridge_url: BRIDGE_URL, bridge_port: ep.ok ? ep.port : null, bridge_home: bridgeHomeOf(),
        mode: LAYOUT.mode,
      });
    }

    if (req.method === "GET" && pathname === "/api/status")
      return sendJson(res, 200, { ok: true, ...(await statusPayload(u.searchParams.get("fresh") === "1")) });

    if (req.method === "POST" && (pathname === "/api/prepare" || pathname === "/api/action" || pathname === "/api/done")) {
      if (!ctJson(req)) return sendJson(res, 415, { ok: false, error: "Content-Type 必须是 application/json" });
      let parsed = {};
      try { const raw = await readBody(req); parsed = raw ? JSON.parse(raw) : {}; }
      catch (e) { return sendJson(res, 400, { ok: false, error: "非法请求正文" }); }
      if (pathname === "/api/done") {
        markComplete();
        sendJson(res, 200, { ok: true });
        setTimeout(() => cleanupExit(0), 200);
        return;
      }
      if (pathname === "/api/prepare") {
        const opened = await runAction("open_extensions");
        const revealed = await runAction("reveal_folder");
        return sendJson(res, 200, { ok: !!(opened.ok && revealed.ok), opened, revealed });
      }
      const name = String((parsed && parsed.action) || "");
      if (!ACTIONS[name])
        return sendJson(res, 400, { ok: false, error: "未知 action（允许: " + Object.keys(ACTIONS).join(", ") + "）" });
      return sendJson(res, 200, await runAction(name));
    }

    return sendJson(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    try { sendJson(res, 500, { ok: false, error: String(e && e.message || e) }); } catch (e2) {}
  }
}

function tokenOk(req, u) {
  const m = /^Bearer ([0-9a-f]{16,128})$/.exec(String(req.headers.authorization || ""));
  const given = String((m ? m[1] : u.searchParams.get("t")) || "").toLowerCase();
  if (!given) return false;
  const a = Buffer.from(TOKEN), b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function writeSession(url) {
  const data = JSON.stringify({
    service: SERVICE, version: VERSION, root: ROOT_NORM, home: HOME_SCOPE, bridge_url: BRIDGE_URL,
    port: PORT, token: TOKEN, pid: process.pid, url, startedAt: Date.now(),
  });
  try {
    try { rmOwnedSync(SESSION_FILE); } catch (e) { /* 会话文件不存在或删除失败：写覆盖前尽力清理，写失败另有报错 */ }
    fs.writeFileSync(SESSION_FILE, data, { mode: 0o600 });
  } catch (e) { console.error("会话文件写入失败: " + e.message); }
}
function cleanupExit(code) {
  try {
    const s = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    if (s.pid === process.pid) { try { rmOwnedSync(SESSION_FILE); } catch (e) { console.error("会话文件清理失败: " + e.message); } }
  } catch (e) {}
  try {
    const info = JSON.parse(fs.readFileSync(path.join(LOCK_DIR, "pid.json"), "utf8"));
    if (info.pid === process.pid) { try { rmOwnedSync(LOCK_DIR); } catch (e) { console.error("锁目录清理失败: " + e.message); } }
  } catch (e) {}
  process.exit(code);
}

// ---------- 同安装根原子互斥（R2-1）----------
// mkdir 的原子性保证多进程并发启动时只有一个能获取锁；锁内容为 pid.json。
// 遗留锁处理：持锁进程已死 → 接管；空锁（启动中途崩溃）超过 10s → 接管；
// 超过强制接管时限（最大寿命+5min，防 pid 复用误判）→ 接管。
const LOCK_DIR = SESSION_FILE + ".lock";
const LOCK_STARTUP_GRACE_MS = 10000;
const LOCK_FORCE_TAKEOVER_MS = MAX_LIFE_MS + 5 * 60 * 1000;

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return false; } }
function readLockInfo() {
  try { return JSON.parse(fs.readFileSync(path.join(LOCK_DIR, "pid.json"), "utf8")); }
  catch (e) { return null; }
}
// 单步尝试：acquired=获得锁 / held=他人持有（进程存活）/ retry=已清理遗留锁可重试 / wait=他人刚建锁未写 pid
function lockStep() {
  try {
    fs.mkdirSync(LOCK_DIR); // 原子获取
    fs.writeFileSync(path.join(LOCK_DIR, "pid.json"), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    return "acquired";
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const info = readLockInfo();
  if (info && Number.isInteger(info.pid)) {
    if (pidAlive(info.pid)) {
      if (Date.now() - (info.startedAt || 0) > LOCK_FORCE_TAKEOVER_MS) {
        try { rmOwnedSync(LOCK_DIR); } catch (e) { /* 接管失败：下一轮按同样规则重试 */ }
        return "retry";
      }
      return "held";
    }
    try { rmOwnedSync(LOCK_DIR); } catch (e) { return "wait"; }
    return "retry";
  }
  try {
    if (Date.now() - fs.statSync(LOCK_DIR).mtimeMs > LOCK_STARTUP_GRACE_MS) {
      try { rmOwnedSync(LOCK_DIR); } catch (e) { return "wait"; }
      return "retry";
    }
  } catch (e) {}
  return "wait";
}
async function waitForExistingSession(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const url = await existingUrl();
    if (url) return url;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function startServer() {
  if (LAYOUT.mode === "unknown") { console.error("无法识别安装布局（既不是插件目录也不是项目仓库），退出"); process.exit(1); }
  try { UI_HTML = fs.readFileSync(UI_FILE, "utf8"); }
  catch (e) { console.error("缺少引导页面文件 " + UI_FILE + ": " + e.message); process.exit(1); }
  try { STATE_JS = fs.readFileSync(STATE_FILE, "utf8"); }
  catch (e) { console.error("缺少状态机文件 " + STATE_FILE + ": " + e.message); process.exit(1); }

  // 原子互斥（R2-1）：并发启动时只有一个实例能获得锁；其余等待会话文件出现后复用退出
  const t0 = Date.now();
  for (;;) {
    const r = lockStep();
    if (r === "acquired") break;
    if (r === "held") {
      const url = await waitForExistingSession(6000);
      if (url) { console.error("[" + SERVICE + "] 本安装已有引导服务在运行: " + url + "，复用退出"); process.exit(0); }
      // 会话迟迟未出现：持锁者可能刚死，回到锁竞争（下一轮将接管遗留锁）
    }
    if (Date.now() - t0 > 20000) { console.error("获取引导服务锁超时（锁目录: " + LOCK_DIR + "），可手动删除后重试"); process.exit(1); }
    await new Promise((res) => setTimeout(res, r === "wait" ? 120 : 300));
  }
  // 保险：获锁后再核对一次已有健康实例（如旧版本持会话未持锁），有则让位
  const existing = await existingUrl();
  if (existing) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(LOCK_DIR, "pid.json"), "utf8"));
      if (info.pid === process.pid) { try { rmOwnedSync(LOCK_DIR); } catch (e) { console.error("锁目录清理失败: " + e.message); } }
    } catch (e) {}
    console.error("[" + SERVICE + "] 本安装已有引导服务在运行: " + existing + "，复用退出");
    process.exit(0);
  }

  const server = http.createServer(handler);
  for (let p = DEFAULT_PORT; p < DEFAULT_PORT + PORT_SPAN; p++) {
    const ok = await new Promise((res) => {
      const onError = () => res(false);
      server.once("error", onError);
      server.listen(p, "127.0.0.1", () => { server.removeListener("error", onError); res(true); });
    });
    if (ok) { PORT = p; break; }
  }
  if (!PORT) { console.error("端口 " + DEFAULT_PORT + "-" + (DEFAULT_PORT + PORT_SPAN - 1) + " 均被占用，无法启动引导服务"); process.exit(1); }

  TOKEN = crypto.randomBytes(24).toString("hex");
  startedAt = Date.now(); lastTouch = Date.now();
  const url = "http://127.0.0.1:" + PORT + "/?t=" + TOKEN;
  writeSession(url);
  console.error("[" + SERVICE + "] 引导服务已启动: " + url + "（布局: " + LAYOUT.mode + "，扩展目录: " + extDirOf() + "）");

  process.on("SIGTERM", () => cleanupExit(0));
  process.on("SIGINT", () => cleanupExit(0));
  const idleTimer = setInterval(() => {
    if (Date.now() - lastTouch > IDLE_TIMEOUT_MS || Date.now() - startedAt > MAX_LIFE_MS) cleanupExit(0);
  }, 60000);
  idleTimer.unref();
}

// ---------- 启动器：复用活着的引导服务，否则拉起，然后打开引导页 ----------
// 会话复用身份（R3）：ctx.HOME（launcher 注入的共享 home）优先——home 必须一致（无 home 字段的
// 旧会话仅凭文件位置即在共享 home 内，允许迁移），安装根不再参与比较（跨安装目录复用正是目标）；
// 未注入 HOME 的独立运行仍绑定安装根。其余校验保持：服务名/版本/桥接端点/端口/令牌/pid 存活/健康端点。
// 返回的 URL 由已验证字段重建（127.0.0.1 + 校验过的端口与令牌），绝不采用会话文件里存储的 url 字符串
async function existingUrlFrom(file, ctx) {
  let s;
  try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
  if (!s || s.service !== ctx.SERVICE) return null;
  if (s.version !== ctx.VERSION) return null;
  if (ctx.HOME) {
    if (s.home !== undefined && s.home !== ctx.HOME) return null; // 共享 home 不一致：不是本 home 的会话
  } else if (ctx.ROOT_NORM && s.root !== ctx.ROOT_NORM) return null;
  if (s.bridge_url !== ctx.BRIDGE_URL) return null;
  if (!Number.isInteger(s.port) || s.port < 1024 || s.port > 65535) return null;
  if (!/^[0-9a-f]{48}$/.test(String(s.token || ""))) return null;
  try { process.kill(s.pid, 0); } catch (e) { return null; }
  const r = await fetch("http://127.0.0.1:" + s.port + "/api/health", { signal: AbortSignal.timeout(1200) }).catch(() => null);
  if (!r || !r.ok) return null;
  const b = await r.json().catch(() => null);
  if (!b || b.service !== ctx.SERVICE || b.version !== ctx.VERSION) return null;
  return "http://127.0.0.1:" + s.port + "/?t=" + s.token;
}
function existingUrl() {
  return existingUrlFrom(SESSION_FILE, { SERVICE, VERSION, ROOT_NORM, HOME: HOME_SCOPE, BRIDGE_URL });
}

async function openUrl(url) {
  if (SHELL_DISABLED) return { ok: false, reason: "已禁用（ONBOARD_SHELL_DISABLED=1）" };
  const built = platformActions.openUrlArgs(process.platform, url, chromePathOf());
  if (!built) {
    return {
      ok: false,
      reason: process.platform === "win32"
        ? platformActions.CHROME_MISSING_REASON + "；也可手动打开：" + url
        : platformActions.UNSUPPORTED_REASON,
    };
  }
  if (built.gui) // Windows chrome.exe 打开引导页：有界观察（常驻即已发起打开），绝不无限等也绝不 kill
    return spawnGuiBounded(built.cmd, built.args, GUI_OPENURL_WATCH_MS);
  return new Promise((res) => {
    const p = spawn(built.cmd, built.args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += String(d); });
    p.on("error", (e) => res({ ok: false, reason: "无法执行 " + built.cmd + ": " + e.message }));
    p.on("close", (code) => {
      if (code === 0) return res({ ok: true });
      res({ ok: false, reason: "退出码 " + code + (err.trim() ? "：" + err.trim().slice(0, 200) : "") });
    });
  });
}

async function launch() {
  let url = await existingUrl();
  if (!url) {
    const child = spawn(process.execPath, [__filename], { detached: true, stdio: ["ignore", "ignore", "ignore"] });
    child.unref();
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      url = await existingUrl();
      if (url) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (!url) { console.error("引导服务未能就绪（端口 " + DEFAULT_PORT + "-" + (DEFAULT_PORT + PORT_SPAN - 1) + " 可能被占用或启动失败），可重试"); return 1; }
  const opened = await openUrl(url);
  if (opened.ok) noteShown();
  if (!opened.ok) console.error("打开浏览器失败（" + opened.reason + "）；请手动打开 " + url);
  console.log(url);
  return 0;
}

if (require.main === module) {
  if (process.argv.includes("--launch")) launch().then((c) => process.exit(c));
  else if (process.argv.includes("--auto")) autoLaunch().then((c) => process.exit(c));
  else startServer();
}

module.exports = { SERVICE, VERSION, ACTIONS, validateTabsPayload, resolveLayout, sessionFileFor, existingUrlFrom, shouldAutoOpen, spawnGuiBounded, _guiWatch: { action: GUI_ACTION_WATCH_MS, openUrl: GUI_OPENURL_WATCH_MS } };
