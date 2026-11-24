// Browser Bridge 通用启动层（阶段 A）：任意本地 stdio MCP 宿主启动 mcp-stdio 时自动准备桥接与首次引导
// 纯 Node：无 Bash/Homebrew 依赖；stdout 铁律为空（本模块从不写 stdout，诊断走 stderr/日志文件）
// ensureReady（单飞合并、有界预算）：
//   ① 端点统一解析（server/endpoint.js 唯一实现：BRIDGE_PORT/BRIDGE_URL 严格校验，非法即报错不回退；
//      远程/HTTPS 端点只连接、不拉起本地服务、不触发本地引导）
//   ② 桥接幂等：健康则复用（绝不杀）；端口被无关程序占用/响应停滞 → 明确报错（绝对时限+体积上限）
//   ③ 扩展稳定副本（R3 事务化更新）：源清单校验（manifest+必需文件+manifest 声明的 icons 全部必需，
//      缺任何必需源明确失败且不触发引导）→ 完整暂存候选（逐文件复制后哈希回读校验）→ 整目录原子交换；
//      交换失败恢复完整旧目录，禁止新旧混杂；未知文件保留；marker 输入验证（schema/白名单/哈希格式/
//      路径不得逃逸/拒绝符号链接），非法 marker 拒绝接管且绝不按其清单删除任何文件；
//      清理仅限自身命名模式的 stage/old 临时目录；崩溃恢复（dest 缺失而 old 存在时先还原）
//   ④ 完成标记迁移（旧安装根只读复制）；首次引导按「共享 home + 桥接端点」去重（跨安装目录单次）
// 稳定目录（默认 ~/.browser-bridge，BROWSER_BRIDGE_HOME 可覆盖）：extension/ state/ logs/ locks/
// 布局：bridge/onboard 始终取自「本次运行的安装目录」（layoutRoot 指定或本文件所在 server 目录），
// 保证多客户端各自运行自己安装副本的代码，同时共享同一 home/端点的服务与会话

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const onboard = require("./onboard");
const endpoint = require("./endpoint");
const { rmOwnedSync } = require("./fsutil");

const BRIDGE_WAIT_MS = 6000;
const LOCK_GRACE_MS = 10000;
const EXT_LOCK_WAIT_MS = 15000;
const EXT_REQUIRED = ["manifest.json", "background.js", "popup.html", "popup.js"];
const EXT_WHITELIST = [
  "manifest.json", "background.js", "popup.html", "popup.js",
  "icons/icon16.png", "icons/icon48.png", "icons/icon128.png", "icons/icon256.png",
];
const MARKER_NAME = ".source-manifest.json";

const log = (...a) => { try { process.stderr.write("[launcher] " + a.join(" ") + "\n"); } catch (e) {} };
const sha256File = (f) => {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(f));
  return h.digest("hex");
};
const filesSig = (files) => Object.keys(files).sort().map((k) => k + ":" + files[k]).join("\n");

// ---------- 相对路径安全：无绝对路径、无 .. 逃逸 ----------
function isSafeRel(rel) {
  if (typeof rel !== "string" || rel === "" || rel.includes("\0")) return false;
  if (path.isAbsolute(rel)) return false;
  const norm = path.normalize(rel);
  if (norm === "." || norm.startsWith("..")) return false;
  return true;
}

// ---------- 桥接健康探测：绝对时限 + 响应体积上限 + abort/error 全路径收敛 ----------
// state: ours（本服务）/ foreign（有响应但不是本服务）/ stalled（监听存在但超时/超大/异常，视为占用）/ down（无监听）
function bridgeStatus(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let done = false, size = 0, res = null, req = null;
    const chunks = [];
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (res) res.destroy(); } catch (e) {}
      try { if (req) req.destroy(); } catch (e) {}
      resolve(v);
    };
    const timer = setTimeout(() => finish({ state: "stalled", reason: "deadline" }), timeoutMs);
    try {
      req = http.get({ host: "127.0.0.1", port, path: "/status" }, (r) => {
        res = r;
        res.on("data", (c) => {
          size += c.length;
          if (size > 65536) return finish({ state: "stalled", reason: "oversize" });
          chunks.push(c);
        });
        res.on("end", () => {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const svc = j && j.service;
            const name = svc && typeof svc === "object" ? svc.name : svc;
            if (name === "cc-browser-bridge" && j.ok === true) return finish({ state: "ours", info: j });
          } catch (e) {}
          finish({ state: "foreign" });
        });
        res.on("aborted", () => finish({ state: "stalled", reason: "aborted" }));
        res.on("error", () => finish({ state: "stalled", reason: "response-error" }));
      });
      req.on("error", () => finish({ state: "down" }));
    } catch (e) { finish({ state: "down" }); }
  });
}
const notOurs = (st, port) =>
  st.state === "foreign"
    ? "端口 " + port + " 已被其他程序占用（不是 Browser Bridge 桥接）。请释放该端口，或用 BRIDGE_PORT 指定其他端口后重启客户端。"
    : "端口 " + port + " 有监听但响应异常/超时（可能被其他程序占用）。请检查该端口或改用 BRIDGE_PORT。";

// ---------- 原子锁（初始化宽限 + 死 pid 接管 + 所有权释放） ----------
// 删除一律用 fsutil.rmOwnedSync：unlink+rmdir、不跟随符号链接、删除后验证，
// 失败可见（Windows 中文路径下 fs.rmSync 存在「返回成功但仍存在」的实机证据）
function lockStep(dir, ttlMs) {
  const pidFile = path.join(dir, "pid.json");
  const take = () => {
    try { fs.mkdirSync(dir); } catch (e) { return false; }
    try { fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, at: Date.now() })); } catch (e) {}
    return true;
  };
  if (take()) return "acquired";
  let info = null;
  try { info = JSON.parse(fs.readFileSync(pidFile, "utf8")); } catch (e) {}
  if (info && Number.isInteger(info.pid)) {
    let alive = false;
    try { process.kill(info.pid, 0); alive = true; } catch (e) {}
    if (alive && Date.now() - (info.at || 0) < ttlMs) return "held";
    try { rmOwnedSync(dir); } catch (e) { return "busy"; } // 接管失败（删不掉）如实报告，不假装成功
    return take() ? "acquired" : "busy";
  }
  let age = Infinity;
  try { age = Date.now() - fs.statSync(dir).mtimeMs; } catch (e) {}
  if (age < LOCK_GRACE_MS) return "held";
  try { rmOwnedSync(dir); } catch (e) { return "busy"; }
  return take() ? "acquired" : "busy";
}
function lockRelease(dir) {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(dir, "pid.json"), "utf8"));
    if (info.pid === process.pid) {
      try { rmOwnedSync(dir); }
      catch (e) { log("锁目录释放失败（他人将按陈旧锁接管重试）：" + e.message); }
    }
  } catch (e) {}
}
async function lockAcquireWait(dir, ttlMs, waitMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const r = lockStep(dir, ttlMs);
    if (r === "acquired") return "acquired";
    if (Date.now() > deadline) return r;
    await new Promise((r2) => setTimeout(r2, 120));
  }
}

// ---------- 桥接幂等启动 ----------
let launchCount = 0;
async function ensureBridge(o) {
  const st = await bridgeStatus(o.port);
  if (st.state === "ours") return { ok: true, reused: true };
  if (st.state !== "down") return { ok: false, reason: notOurs(st, o.port) };

  fs.mkdirSync(path.join(o.home, "locks"), { recursive: true });
  const lockDir = path.join(o.home, "locks", "bridge-" + o.port + ".lock");
  const lock = await lockAcquireWait(lockDir, BRIDGE_WAIT_MS + LOCK_GRACE_MS, BRIDGE_WAIT_MS);
  if (lock !== "acquired") {
    const deadline = Date.now() + BRIDGE_WAIT_MS; // 他人正在启动：有界等待其就绪
    while (Date.now() < deadline) {
      const s2 = await bridgeStatus(o.port);
      if (s2.state === "ours") return { ok: true, reused: true };
      if (s2.state !== "down") return { ok: false, reason: notOurs(s2, o.port) };
      await new Promise((r) => setTimeout(r, 250));
    }
    return { ok: false, reason: "等待其他进程启动桥接超时；日志见 " + path.join(o.home, "logs") };
  }
  try {
    const s2 = await bridgeStatus(o.port);
    if (s2.state === "ours") return { ok: true, reused: true };
    if (s2.state !== "down") return { ok: false, reason: notOurs(s2, o.port) };

    fs.mkdirSync(path.join(o.home, "logs"), { recursive: true });
    const logFile = path.join(o.home, "logs", "bridge-" + o.port + ".log");
    const fd = fs.openSync(logFile, "a");
    launchCount++;
    const child = spawn(process.execPath, [o.bridgePath], {
      cwd: path.dirname(o.bridgePath),
      env: { ...process.env, PORT: String(o.port) },
      detached: true, stdio: ["ignore", fd, fd],
    });
    child.unref();
    try { fs.closeSync(fd); } catch (e) {}
    try { fs.writeFileSync(path.join(o.home, "state", "bridge-" + o.port + ".pid"), JSON.stringify({ pid: child.pid, at: Date.now() })); } catch (e) {}

    const deadline = Date.now() + BRIDGE_WAIT_MS;
    for (;;) {
      const s3 = await bridgeStatus(o.port);
      if (s3.state === "ours") return { ok: true, pid: child.pid };
      if (s3.state !== "down") return { ok: false, reason: notOurs(s3, o.port) };
      if (Date.now() > deadline) return { ok: false, reason: "桥接启动超时（端口 " + o.port + "）；日志 " + logFile };
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    lockRelease(lockDir);
  }
}

// ---------- 扩展稳定副本：源清单校验 / marker 输入验证 / 事务化整目录交换 ----------
function declaredIcons(manifest) {
  const out = new Set();
  const push = (v) => {
    if (typeof v !== "string" || v === "") throw new Error("manifest 声明的 icon 路径非法：" + JSON.stringify(v));
    if (!isSafeRel(v)) throw new Error("manifest 声明的 icon 路径越界：" + v);
    out.add(path.normalize(v).split(path.sep).join("/"));
  };
  if (manifest.icons !== undefined) {
    if (!manifest.icons || typeof manifest.icons !== "object" || Array.isArray(manifest.icons)) throw new Error("manifest.icons 结构非法");
    for (const k of Object.keys(manifest.icons)) push(manifest.icons[k]);
  }
  const act = manifest.action;
  if (act && act.default_icon !== undefined) {
    const di = act.default_icon;
    if (typeof di === "string") push(di);
    else if (di && typeof di === "object" && !Array.isArray(di)) for (const k of Object.keys(di)) push(di[k]);
    else throw new Error("manifest.action.default_icon 结构非法");
  }
  return out;
}

// marker 是外部输入，必须完整验证后才能信任：
//   schema / 版本格式 / files 至少包含全部 EXT_REQUIRED（空 files 或缺关键条目不认定受管）/
//   白名单 / 哈希格式 / 路径逃逸 / 符号链接（含受管路径的父级目录，绝不跟随）
const MARKER_VERSION_RE = /^\d+\.\d+(\.\d+)?(-[0-9A-Za-z.]+)?$/; // 兼容 0.5.2 / 9.9.8 等真实历史版本
function readMarker(destDir) {
  const markerFile = path.join(destDir, MARKER_NAME);
  let st;
  try { st = fs.lstatSync(markerFile); } catch (e) { return { status: "none" }; }
  if (st.isSymbolicLink()) return { status: "invalid", reason: "指纹标记是符号链接" };
  let m;
  try { m = JSON.parse(fs.readFileSync(markerFile, "utf8")); } catch (e) { return { status: "invalid", reason: "指纹标记不是合法 JSON" }; }
  if (!m || typeof m !== "object" || Array.isArray(m)) return { status: "invalid", reason: "指纹标记结构非法" };
  if (typeof m.version !== "string" || !MARKER_VERSION_RE.test(m.version)) return { status: "invalid", reason: "指纹标记 version 非法：" + JSON.stringify(m.version) };
  if (!m.files || typeof m.files !== "object" || Array.isArray(m.files)) return { status: "invalid", reason: "指纹标记缺少 files" };
  for (const req of EXT_REQUIRED) {
    if (!(req in m.files)) return { status: "invalid", reason: "指纹标记 files 缺少必需受管条目：" + req };
  }
  const destReal = path.resolve(destDir);
  const files = {};
  for (const rel of Object.keys(m.files)) {
    if (!isSafeRel(rel)) return { status: "invalid", reason: "受管文件路径越界：" + rel };
    if (!EXT_WHITELIST.includes(rel)) return { status: "invalid", reason: "受管文件不在合法白名单：" + rel };
    const h = m.files[rel];
    if (typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h)) return { status: "invalid", reason: "受管文件哈希格式非法：" + rel };
    const f = path.resolve(destDir, rel);
    if (!f.startsWith(destReal + path.sep)) return { status: "invalid", reason: "受管文件路径逃逸：" + rel };
    // 受管路径的每个父级目录（destDir 内部）必须是真实目录：符号链接一律拒绝，绝不跟随
    const segs = rel.split("/");
    let cur = destDir;
    for (let i = 0; i < segs.length - 1; i++) {
      cur = path.join(cur, segs[i]);
      let pst = null;
      try { pst = fs.lstatSync(cur); } catch (e) {}
      if (pst && (pst.isSymbolicLink() || !pst.isDirectory())) return { status: "invalid", reason: "受管路径的父级不是真实目录（拒绝符号链接跟随）：" + rel };
    }
    let fst = null;
    try { fst = fs.lstatSync(f); } catch (e) {}
    if (fst && fst.isSymbolicLink()) return { status: "invalid", reason: "受管文件是符号链接：" + rel };
    files[rel] = h;
  }
  return { status: "valid", version: m.version, files };
}

// 把旧目录中的「未知文件」复制进暂存目录（R4 fail closed）：
//   - 任何读取/复制失败都必须让整次更新失败，完整保留旧目录——绝不吞错、绝不静默丢弃未知数据
//   - 符号链接不跟随、不读目标内容：以链接自身形式原样重建保留（安全保留，防逃逸）
//   - 不使用宽泛的「*.tmp-数字」模式跳过用户未知文件（历史残留一律按未知数据保留）
//   - 目录不可读/特殊文件（FIFO 等）→ 明确失败
function copyUnknownInto(srcDir, stageDir, skip) {
  const walk = (rel) => {
    const abs = rel ? path.join(srcDir, rel) : srcDir;
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); }
    catch (e) { throw new Error("未知数据目录不可读：" + (rel || ".") + "（" + (e.message || e) + "），拒绝更新以保留旧目录"); }
    for (const e of entries) {
      const childRel = rel ? rel + "/" + e.name : e.name;
      const childAbs = path.join(srcDir, childRel);
      const target = path.join(stageDir, childRel);
      let st;
      try { st = fs.lstatSync(childAbs); }
      catch (e2) { throw new Error("未知数据状态读取失败：" + childRel + "（" + (e2.message || e2) + "），拒绝更新以保留旧目录"); }
      if (st.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(childAbs); // 只读链接本身，绝不解析/跟随目标
        try { fs.symlinkSync(linkTarget, target); }
        catch (e2) { throw new Error("未知符号链接保留失败：" + childRel + "（" + (e2.message || e2) + "），拒绝更新以保留旧目录"); }
        continue;
      }
      if (st.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        walk(childRel);
        continue;
      }
      if (!st.isFile()) throw new Error("未知条目不是常规文件/目录/符号链接：" + childRel + "，拒绝更新以保留旧目录");
      if (childRel === MARKER_NAME) continue;
      if (skip.has(childRel)) continue;
      try { fs.copyFileSync(childAbs, target); }
      catch (e2) { throw new Error("未知文件复制失败：" + childRel + "（" + (e2.message || e2) + "），拒绝更新以保留旧目录"); }
    }
  };
  walk("");
}

// 崩溃恢复 + 只清理「自身命名模式」的交换临时目录（持锁期间无并发同步者）
function recoverSwapDirs(parent, base, destDir) {
  let entries = [];
  try { entries = fs.readdirSync(parent); } catch (e) { return; }
  const pat = new RegExp("^\\." + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.(stage|old)-\\d+-\\d+$");
  let oldFound = null;
  for (const n of entries) {
    if (!pat.test(n)) continue;
    if (n.includes(".old-")) oldFound = n;
    else { try { rmOwnedSync(path.join(parent, n)); } catch (e) { log("残留 stage 清理失败（下次启动重试）：" + e.message); } }
  }
  if (oldFound) {
    // 上一进程死在「旧目录已让位、新目录未就位」之间：先完整还原旧目录再继续
    if (!fs.existsSync(destDir)) {
      try { fs.renameSync(path.join(parent, oldFound), destDir); return; } catch (e) {}
    }
    try { rmOwnedSync(path.join(parent, oldFound)); } catch (e) { log("残留 old 备份清理失败（下次启动重试）：" + e.message); }
  }
}

function syncExtensionTo(srcDir, destDir, opts = {}) {
  // ---- 源清单校验（进入锁前；缺任何必需源——包括 manifest 声明的 icons——都明确失败，绝不 ok:skip）----
  if (!srcDir || typeof srcDir !== "string") return { ok: false, reason: "扩展源目录未提供（无法定位安装布局），保留现有副本" };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(srcDir, "manifest.json"), "utf8")); }
  catch (e) { return { ok: false, reason: "扩展源缺少可解析的 manifest.json（" + (e.message || e) + "），保留现有副本" }; }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return { ok: false, reason: "扩展源 manifest.json 结构非法，保留现有副本" };
  if (typeof manifest.version !== "string" || manifest.version === "") return { ok: false, reason: "扩展源 manifest.json 缺少有效 version，保留现有副本" };
  let declared;
  try { declared = declaredIcons(manifest); } catch (e) { return { ok: false, reason: "扩展源 " + (e.message || e) + "，保留现有副本" }; }
  const required = new Set(EXT_REQUIRED);
  for (const ic of declared) required.add(ic);
  for (const rel of required) {
    let isFile = false;
    try { isFile = fs.statSync(path.join(srcDir, rel)).isFile(); } catch (e) {}
    if (!isFile) return { ok: false, reason: "扩展源缺少必需文件 " + rel + "（manifest 声明的 icons 同样必需），保留现有副本" };
  }
  const cand = [];
  for (const rel of EXT_WHITELIST) {
    let isFile = false;
    try { isFile = fs.statSync(path.join(srcDir, rel)).isFile(); } catch (e) {}
    if (isFile) cand.push(rel);
  }
  cand.sort();
  const fp = { version: manifest.version, files: {} };
  for (const rel of cand) fp.files[rel] = sha256File(path.join(srcDir, rel));

  const lockDir = destDir + ".sync.lock";
  return (async () => {
    const lock = await lockAcquireWait(lockDir, EXT_LOCK_WAIT_MS, EXT_LOCK_WAIT_MS);
    if (lock !== "acquired") return { ok: false, reason: "扩展目录同步忙（其他进程持有锁），本次跳过，下次启动重试" };
    try {
      const parent = path.dirname(destDir);
      const base = path.basename(destDir);
      fs.mkdirSync(parent, { recursive: true });
      recoverSwapDirs(parent, base, destDir);

      const destExists = fs.existsSync(destDir);
      let mk = { status: "none" };
      if (destExists) {
        let dst = null;
        try { dst = fs.lstatSync(destDir); } catch (e) {}
        if (dst && dst.isSymbolicLink()) return { ok: false, reason: "目标目录是符号链接，拒绝接管：" + destDir };
        mk = readMarker(destDir);
        if (mk.status === "none") return { ok: false, reason: "目标目录已存在且缺少本组件指纹标记，拒绝接管（保留未知数据）：" + destDir };
        if (mk.status === "invalid")
          return { ok: false, reason: "目标目录指纹标记非法/损坏（" + mk.reason + "），拒绝接管（保留未知数据，绝不按其清单删除任何文件）：" + destDir };
        if (mk.version === fp.version && filesSig(mk.files) === filesSig(fp.files)) {
          let intact = true;
          for (const rel of Object.keys(fp.files)) {
            const f = path.join(destDir, rel);
            let actual = null;
            try { actual = fs.readFileSync(f); } catch (e) {}
            if (!actual || sha256File(f) !== fp.files[rel]) { intact = false; break; }
          }
          if (intact) return { ok: true, updated: false, dir: destDir };
        }
      }

      // ---- 事务化更新：完整暂存（哈希回读校验）→ 整目录交换 → 失败恢复完整旧目录 ----
      const tag = process.pid + "-" + Date.now();
      const stage = path.join(parent, "." + base + ".stage-" + tag);
      const backup = path.join(parent, "." + base + ".old-" + tag);
      let swapped = false;
      try {
        fs.mkdirSync(stage);
        for (const rel of cand) {
          const target = path.join(stage, rel);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(path.join(srcDir, rel), target);
          if (sha256File(target) !== fp.files[rel]) throw new Error("暂存副本哈希校验失败：" + rel);
        }
        if (destExists) copyUnknownInto(destDir, stage, new Set([...Object.keys(mk.files), ...cand]));
        fs.writeFileSync(path.join(stage, MARKER_NAME), JSON.stringify(fp, null, 2));
        if (destExists) fs.renameSync(destDir, backup);
        try {
          fs.renameSync(stage, destDir);
          swapped = true;
        } catch (e) {
          if (destExists) fs.renameSync(backup, destDir); // 交换失败：完整恢复旧目录，禁止新旧混杂
          throw e;
        }
        let backupWarning = null;
        if (destExists) {
          try { rmOwnedSync(backup); }
          catch (e) { backupWarning = "旧备份清理失败（下次启动自动重试）：" + e.message; log(backupWarning); }
        }
        return backupWarning ? { ok: true, updated: true, dir: destDir, warning: backupWarning } : { ok: true, updated: true, dir: destDir };
      } catch (e) {
        try { rmOwnedSync(stage); } catch (e2) {} // stage 为自身暂存目录；清理失败时它匹配自身命名模式，下次启动恢复清理
        if (!swapped && destExists && !fs.existsSync(destDir) && fs.existsSync(backup)) {
          try { fs.renameSync(backup, destDir); } catch (e3) {} // 最后保险：任何路径下都不允许丢失旧目录
        }
        return { ok: false, reason: "扩展副本更新失败（保留完整旧内容，下次启动重试）：" + (e && e.message || e) };
      }
    } finally {
      lockRelease(lockDir);
    }
  })();
}

// ---------- 完成标记迁移（旧安装根 → 稳定目录；只读复制，不删旧） ----------
function migrateStateTo(legacyFile, targetFile) {
  try {
    if (!fs.existsSync(legacyFile) || fs.existsSync(targetFile)) return false;
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(legacyFile, targetFile);
    return true;
  } catch (e) { return false; }
}

// ---------- 首次引导触发（去重键 = 共享 home + 桥接端点，跨安装目录单次） ----------
function onboardPreGate(stateFile) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (s && (s.completedAt || s.autoOpenedAt)) return false;
  } catch (e) {}
  return true;
}
function triggerOnboarding(o) {
  const sessionFile = path.join(o.home, "state", "onboard-session-" + o.port + ".json");
  try {
    fs.mkdirSync(path.join(o.home, "logs"), { recursive: true });
    const fd = fs.openSync(path.join(o.home, "logs", "onboard.log"), "a");
    const child = spawn(process.execPath, [o.onboardPath, "--auto"], {
      cwd: path.dirname(o.onboardPath),
      env: {
        ...process.env,
        ONBOARD_STATE_FILE: o.stateFile,
        ONBOARD_SESSION_FILE: sessionFile,
        ONBOARD_HOME: o.home, // 会话身份绑定共享 home（跨安装目录复用同一引导实例）
        ONBOARD_EXT_DIR: o.extDir,
        ONBOARD_BRIDGE_URL: "http://127.0.0.1:" + o.port, // 引导服务探测与桥接同端点（自定义端口一致）
      },
      detached: true, stdio: ["ignore", fd, fd],
    });
    child.on("error", (e) => { log("触发引导失败: " + e.message); });
    child.unref();
    try { fs.closeSync(fd); } catch (e) {}
    return true;
  } catch (e) { log("触发引导失败: " + e.message); return false; }
}

// ---------- 总入口：单飞合并 ----------
let inFlight = null;
function ensureReady(opts = {}) {
  if (inFlight) return inFlight;
  inFlight = runEnsure(opts).finally(() => { inFlight = null; });
  return inFlight;
}
async function runEnsure(opts) {
  const ep = endpoint.parseEndpoint(opts.env || process.env);
  if (!ep.ok) return { ok: false, stage: "endpoint", reason: ep.error, endpoint: ep };

  const home = path.resolve(opts.home || process.env.BROWSER_BRIDGE_HOME || path.join(os.homedir(), ".browser-bridge"));
  const port = Number(opts.port || ep.port);
  // bridge/onboard 始终取自本次运行的安装目录（不同客户端副本各自运行自己的代码，仅共享 home/端点）
  const serverDir = opts.layoutRoot ? path.join(opts.layoutRoot, "server") : __dirname;
  const layout = onboard.resolveLayout(serverDir);
  const o = {
    home, port, layout,
    bridgePath: path.join(serverDir, "bridge.js"),
    onboardPath: path.join(serverDir, "onboard.js"),
    extDir: path.join(home, "extension"),
    stateFile: path.join(home, "state", "onboard-complete.json"),
  };
  fs.mkdirSync(path.join(home, "state"), { recursive: true });

  if (!ep.manageable) {
    const why = ep.secure ? "HTTPS" : "远程";
    log("BRIDGE_URL=" + ep.url + " 为" + why + "端点：仅连接该地址，不启动/管理本地桥接，也不触发本地引导");
    return { ok: true, skipped: ep.secure ? "secure-bridge" : "remote-bridge", endpoint: ep, onboarding: { skipped: ep.secure ? "secure" : "remote" } };
  }

  const br = await ensureBridge(o);
  if (!br.ok) return { ok: false, stage: "bridge", reason: br.reason, endpoint: ep };

  const ext = await syncExtensionTo(layout.extDir, o.extDir, opts);
  migrateStateTo(path.join(layout.root, ".onboard-state.json"), o.stateFile);

  if (!ext.ok) {
    // 源损坏/同步失败：明确失败并保留旧版，绝不引导用户加载不完整目录（下次启动自动重试）
    log(ext.reason);
    return { ok: true, bridge: br, ext, onboarding: { skipped: "ext-sync-failed" }, endpoint: ep };
  }

  let onboarding = { skipped: "complete" };
  if (opts.noOnboarding !== true && onboardPreGate(o.stateFile)) {
    onboarding = { triggered: triggerOnboarding(o) };
  }
  return { ok: true, bridge: br, ext, onboarding, endpoint: ep };
}

module.exports = {
  ensureReady,
  _test: { bridgeStatus, ensureBridge, syncExtensionTo, migrateStateTo, onboardPreGate, parseEndpoint: endpoint.parseEndpoint, lockStep, launchCount: () => launchCount },
};
