/* sysmon-client.cjs —— 系统资源采样器（主进程热模块，issue #338 / specs/statusbar-system-status.md）。
 * 单例采样：CPU（os.cpus() tick 差分）、内存（平台口径）、磁盘（fs.statfs + 卷枚举）。
 * 订阅制：setSubscribed(true) 才启动轮询（CPU/内存 intervalMs、磁盘 diskIntervalMs 双链独立）；
 * want→0 停表，最近一帧保留供 view() 回读（渲染端按 ts 判过期）。多窗口/多分栏共享同一份缓存，
 * 绝不为每个 Tooltip/设置页单独采样。配置由渲染端经 inject-main 透传（normalizeSysmonConfig
 * clamp 后运行时生效），不落 config.json。容量一律原始字节，未知值显式 null/降级，绝不用 0 冒充。
 * 数据出口 onFrame(view())——由 inject-main 经 pushOnce 同款信任门推 window.__zusageSysmon。 */
"use strict";
const os = require("os");
const fs = require("fs");
const fsp = fs.promises;
const { execFile } = require("child_process");

const CPU_DEFAULT_MS = 5000, DISK_DEFAULT_MS = 60000;
const CPU_MIN_MS = 2000, CPU_MAX_MS = 60000, DISK_MIN_MS = 30000, DISK_MAX_MS = 600000;
const MAX_VOLS = 8;               // 系统卷/项目卷恒保留，其余本地卷裁到此上限
const STATFS_TIMEOUT_MS = 3000;   // 断连网络盘/慢卷不拖垮采样链

function clampInt(v, lo, hi, dflt) {
  const n = Math.floor(Number(v));
  if (!isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
/* 渲染端 normalizeSysmonCfg（00 分片）与这里语义对齐：一处管展示持久化、一处管采样运行时。 */
function normalizeSysmonConfig(raw) {
  const c = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const bool = (v, dflt) => (v === 0 || v === false ? false : v === 1 || v === true ? true : dflt);
  const th = c.thresholds && typeof c.thresholds === "object" ? c.thresholds : {};
  return {
    metrics: {
      cpu: bool(c.metrics && c.metrics.cpu, true),
      mem: bool(c.metrics && c.metrics.mem, true),
      disk: bool(c.metrics && c.metrics.disk, true),
    },
    format: ["auto", "full", "compact", "minimal"].indexOf(c.format) >= 0 ? c.format : "auto",
    intervalMs: clampInt(c.intervalMs, CPU_MIN_MS, CPU_MAX_MS, CPU_DEFAULT_MS),
    diskIntervalMs: clampInt(c.diskIntervalMs, DISK_MIN_MS, DISK_MAX_MS, DISK_DEFAULT_MS),
    warnColors: bool(c.warnColors, true),
    projectVol: bool(c.projectVol, true),
    systemVol: bool(c.systemVol, true),
    thresholds: {
      cpuWarn: clampInt(th.cpuWarn, 1, 100, 80),
      cpuCrit: clampInt(th.cpuCrit, 1, 100, 90),
      memWarn: clampInt(th.memWarn, 1, 100, 85),
      memCrit: clampInt(th.memCrit, 1, 100, 90),
      diskFreeWarn: clampInt(th.diskFreeWarn, 0, 100, 15),
      diskFreeCrit: clampInt(th.diskFreeCrit, 0, 100, 10),
    },
  };
}
function r1(n) { return Math.round(n * 10) / 10; }
function r2(n) { return Math.round(n * 100) / 100; }

function runCmd(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs || 4000, windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ""), stderr: String(stderr || "") }));
    } catch (e) { resolve({ error: e, stdout: "", stderr: "" }); }
  });
}

/* ---------- CPU：整机 tick 差分。首帧只有计数没有窗口 → loading；绝不把累计 tick 当百分比。 */
function cpuUsageFromTicks(prev, cur) {
  if (!Array.isArray(prev) || !Array.isArray(cur)) return null;
  let total = 0, idle = 0;
  const n = Math.min(prev.length, cur.length);
  for (let i = 0; i < n; i++) {
    const t = cur[i], p = prev[i];
    if (!t || !p) continue;
    const dt = (t.user - p.user) + (t.nice - p.nice) + (t.sys - p.sys) + (t.idle - p.idle) + (t.irq - p.irq);
    const di = t.idle - p.idle;
    if (dt > 0) { total += dt; idle += di; }
  }
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, r1((total - idle) / total * 100)));
}
function loadavgOr(work) {
  if (work === null) return null;                     // 平台无负载（win32）
  if (!isFinite(work[0]) || !isFinite(work[1]) || !isFinite(work[2])) return null;
  return [r2(work[0]), r2(work[1]), r2(work[2])];
}
function cpuSnapshot(prevTicks) {
  const cur = os.cpus();
  const cores = cur.length;
  const load = process.platform === "win32" ? null : loadavgOr(os.loadavg());
  const pct = cpuUsageFromTicks(prevTicks, cur.map((c) => c.times));
  if (pct === null) return { state: "loading", pct: null, cores, load, nextTicks: cur.map((c) => c.times) };
  return { state: "ok", pct, cores, load, nextTicks: cur.map((c) => c.times) };
}

/* ---------- 内存：三平台口径分立，缺字段显式 null（渲染端整行隐藏），不伪造。 */
function parseMemInfo(txt) {
  const kb = (k) => {
    const m = new RegExp("^" + k + ":\\s+(\\d+) kB", "m").exec(txt);
    return m ? parseInt(m[1], 10) * 1024 : null;
  };
  const total = kb("MemTotal");
  if (!total) return null;
  let avail = kb("MemAvailable");
  if (avail === null) {   // 旧内核无 MemAvailable：MemFree + Buffers + Cached + SReclaimable 近似
    avail = (kb("MemFree") || 0) + (kb("Buffers") || 0) + (kb("Cached") || 0) + (kb("SReclaimable") || 0);
  }
  const used = Math.max(0, total - avail);
  const st = kb("SwapTotal"), sf = kb("SwapFree");
  return {
    total, used, avail, pct: r1(used / total * 100), wired: null,
    swap_total: st || null,
    swap_used: st ? Math.max(0, st - (sf === null ? st : sf)) : null,
  };
}
function parseSwapusage(out) {
  /* "total = 3072.00M used = 2101.25M free = 970.75M"（M/G 档） */
  const unit = { K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024, T: 1024 * 1024 * 1024 * 1024 };
  const pick = (k) => {
    const m = new RegExp(k + " = ([\\d.]+)([KMGT])").exec(out);
    return m ? Math.round(parseFloat(m[1]) * unit[m[2]]) : null;
  };
  const total = pick("total"), used = pick("used");
  if (total === null || used === null) return null;
  return { total, used: Math.min(total, used) };
}
function parseVmStat(out) {
  /* 页计数解析：行形如 "Pages active: 123456."（尾点属 macOS 输出格式，只取数字段）。
   * 页大小解析失败返回 0（不猜默认——arm 16384 / Intel 4096 差 4 倍），由调用方降 error。 */
  const page = (name) => {
    const m = new RegExp(name + ":\\s+(\\d+)").exec(out);
    return m ? parseInt(m[1], 10) : 0;
  };
  const ps = /page size of (\d+) bytes/.exec(out);
  return {
    pageSize: ps ? parseInt(ps[1], 10) : 0,
    active: page("Pages active"),
    wired: page("Pages wired down"),
    compressor: page("Pages occupied by compressor"),
  };
}
async function sampleMem() {
  try {
    if (process.platform === "linux") {
      const info = parseMemInfo(fs.readFileSync("/proc/meminfo", "utf8"));
      return info ? Object.assign({ state: "ok" }, info) : { state: "error", err: "meminfo parse" };
    }
    if (process.platform === "darwin") {
      const [vm, sw] = await Promise.all([runCmd("vm_stat", [], 3000), runCmd("sysctl", ["-n", "vm.swapusage"], 2000)]);
      if (vm.error || !vm.stdout) return { state: "error", err: "vm_stat unavailable" };
      const v = parseVmStat(vm.stdout);
      /* 页大小解析失败不猜（arm 16384 / Intel 4096，猜错即 4 倍失真）；页计数全零是解析
       * 成功形状假象（输出格式变体），一并降 error 不产假零（review m4）。 */
      if (!v.pageSize) return { state: "error", err: "vm_stat page size unparsed" };
      if (!(v.active + v.wired + v.compressor > 0)) return { state: "error", err: "vm_stat pages empty" };
      /* 已用对齐活动监视器主口径：active + wired + compressor；可用=总量−已用（与已用/百分比
       * 口径互补自洽；spec 的 avail=free+inactive+speculative 为另一等价面，展示层不混用）。 */
      const total = os.totalmem();
      const used = Math.min(total, (v.active + v.wired + v.compressor) * v.pageSize);
      const swap = sw.error ? null : parseSwapusage(sw.stdout);
      return { state: "ok", total, used, avail: Math.max(0, total - used), pct: r1(used / total * 100), wired: v.wired * v.pageSize, swap_total: swap ? swap.total : null, swap_used: swap ? swap.used : null };
    }
    if (process.platform === "win32") {
      const total = os.totalmem(), avail = os.freemem();   // GlobalMemoryStatusEx：dwAvailPhys 即可用物理内存
      const used = Math.max(0, total - avail);
      return { state: "ok", total, used, avail, pct: r1(used / total * 100), wired: null, swap_total: null, swap_used: null };
    }
  } catch (e) {
    return { state: "error", err: String((e && e.message) || e) };
  }
  return { state: "unavailable" };
}

/* ---------- 磁盘：卷枚举（平台分立）+ fs.statfs 实测容量。禁递归扫描；同名设备去重。 */
const LINUX_REAL_FS = ["ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "f2fs", "ntfs", "ntfs3", "exfat", "apfs", "ufs"];
function parseProcMounts(txt) {
  /* /proc/self/mounts：device mount type opts…。真实文件系统白名单；同设备留最短挂载点。 */
  const rows = [];
  for (const line of String(txt || "").split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    if (LINUX_REAL_FS.indexOf(parts[2]) < 0) continue;
    rows.push({ device: parts[0], mount: parts[1] });
  }
  rows.sort((a, b) => a.mount.length - b.mount.length);
  const seen = new Set(), out = [];
  for (const r of rows) {
    if (seen.has(r.device)) continue;
    seen.add(r.device);
    out.push(r);
  }
  return out;
}
function parseDfLocal(out) {
  /* df -klP：仅本地卷。跳过 devfs/map 自动挂载；同设备留最短挂载点。 */
  const rows = [];
  for (const line of String(out || "").split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const dev = parts[0], mount = parts.slice(5).join(" ");
    if (/^(devfs|map|fdesc)/.test(dev)) continue;
    rows.push({ device: dev, mount });
  }
  rows.sort((a, b) => a.mount.length - b.mount.length);
  const seen = new Set(), outRows = [];
  for (const r of rows) {
    if (seen.has(r.device)) continue;
    seen.add(r.device);
    outRows.push(r);
  }
  return outRows;
}
function volNameOf(mount) {
  if (!mount || mount === "/" || mount === "\\") return "";
  const base = String(mount).replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return base || "";   // Windows 盘符挂载 "C:\" → "C:"（盘符即卷名，平台语义如此）
}
/* 项目卷解析：路径前缀粗定位后，POSIX 用 st_dev 精确归卷——macOS firmlink 下 /Users 实际
 * 落在 /System/Volumes/Data（Data 卷），纯路径前缀会错判到系统快照卷。 */
function pickProjectMount(cands, projectPath) {
  const prefix = longestMountPrefix(cands, projectPath);
  if (process.platform === "win32") return prefix;
  let pdev = null;
  try { pdev = fs.statSync(projectPath).dev; } catch (e) { }
  if (pdev === null || pdev === undefined) return prefix;
  let best = null;
  for (const c of cands) {
    let dev;
    try { dev = fs.statSync(c.mount).dev; } catch (e) { continue; }
    if (dev === pdev && (!best || c.mount.length > best.mount.length)) best = c;
  }
  return best || prefix;
}
function longestMountPrefix(mounts, p) {
  let best = null;
  for (const m of mounts) {
    const mount = m.mount || m;
    if (p === mount || p.startsWith(mount.endsWith("/") || mount.endsWith("\\") ? mount : mount + (process.platform === "win32" ? "\\" : "/"))) {
      if (!best || mount.length > (best.mount || best).length) best = m;
    }
  }
  return best;
}
/* macOS 卷白名单（review M2）：df -klP 会列出 VM/Preboot/Update/Recovery/CoreSimulator
 * 等系统内部卷（实测 12 候选），只留根卷、Data 卷与 /Volumes/* 用户卷，防噪声挤占
 * MAX_VOLS 名额。 */
function darwinVolAllowed(mount) {
  const m = String(mount || "");
  return m === "/" || m === "/System/Volumes/Data" ||
    (m.startsWith("/Volumes/") && m !== "/Volumes/Recovery");   // Recovery 为系统噪声卷（若被挂载）
}
/* 编排核心（纯函数，供单测注入候选；sampleDisk 枚举后调用）：系统/项目角色标注 → 目标过滤
 * （other 恒过；带角色的卷任一角色开关开着即保留——同卷双角色只关其一时不消失，review M1）
 * → 同挂载去重（Windows 盘符大小写不敏感，review m5）→ 系统卷→项目卷→其余排序 → 上限裁剪。 */
function pickVolumes(cands, platform, projectPath, cfg) {
  const useSystem = cfg.systemVol !== false, useProject = cfg.projectVol !== false;
  if (platform !== "win32") {
    const root = cands.find((c) => c.mount === "/");
    if (root && root.roles.indexOf("system") < 0) root.roles.push("system");
  }
  let projectMount = null;
  if (projectPath && typeof projectPath === "string") {
    const hit = pickProjectMount(cands, projectPath);
    if (hit) projectMount = hit;
  }
  if (projectMount && projectMount.roles.indexOf("project") < 0) projectMount.roles.push("project");
  else if (projectMount === null && projectPath && typeof projectPath === "string" && useProject) {
    const probe = platform === "win32" ? pathDriveMount(projectPath) : projectPath;
    if (probe) cands.push({ device: probe, mount: probe, roles: ["project"] });
  }
  let picked = cands.filter((c) => {
    if (c.roles.indexOf("system") < 0 && c.roles.indexOf("project") < 0) return true;
    return (c.roles.indexOf("system") >= 0 && useSystem) || (c.roles.indexOf("project") >= 0 && useProject);
  });
  const seenMount = new Set();
  picked = picked.filter((c) => {
    const key = platform === "win32" ? c.mount.toUpperCase() : c.mount;
    if (seenMount.has(key)) return false;
    seenMount.add(key);
    return true;
  });
  const roleRank = (c) => (c.roles.indexOf("system") >= 0 ? 0 : c.roles.indexOf("project") >= 0 ? 1 : 2);
  picked.sort((a, b) => roleRank(a) - roleRank(b));
  if (picked.length > MAX_VOLS) picked = picked.slice(0, MAX_VOLS);
  return picked;
}
/* APFS 共享容器标注（v362）：macOS firmlink 下 /（系统快照卷）与 /System/Volumes/Data
 * 共享同一 APFS 容器空间，fs.statfs 对两者返回相同容量——前端两行重复数值会误导
 * 「磁盘容量翻倍」。仅当两卷同时入选且设备名同 diskN 前缀（/dev/disk3s1s1 与
 * /dev/disk3s5 → disk3）才标 container；容量相同不作为判据（不同盘可能巧合相等），
 * 外置卷之间无法与「非 APFS 多分区盘」区分，保守不标（保留真实容量，前端不合并）。 */
function apfsContainerOf(dev) {
  const m = /^\/dev\/disk(\d+)s/.exec(String(dev || ""));
  return m ? "disk" + m[1] : null;
}
function markDarwinContainer(vols) {
  const root = vols.find((v) => v.mount === "/");
  const data = vols.find((v) => v.mount === "/System/Volumes/Data");
  if (!root || !data) return;
  const c = apfsContainerOf(root.dev);
  if (c && c === apfsContainerOf(data.dev)) { root.container = c; data.container = c; }
}
/* statfs 探测复用表（B1，review 2026-11-16）：fs.promises.statfs 底层 uv_fs_statfs 跑在
 * 共享 libuv 线程池上，Promise.race 超时只放弃 await 不取消底层调用——Windows 断连 SMB
 * 盘符挂死时逐 tick 重发会把线程池（默认 4 线程）堆满，拖停宿主进程全部异步 fs。
 * 三层防御：在途复用（同 mount 未返回前不再发）→ 连续超时计数 → 2 次超时进 5 分钟黑名单。
 * 模块级 Map：热换 purge 后随新模块实例自然清零。 */
const probeState = { pending: new Map(), timeouts: new Map(), blockedUntil: new Map() };
const PROBE_BLOCK_MS = 5 * 60 * 1000, PROBE_TIMEOUT_LIMIT = 2;
function statfsWithTimeout(mount, timeoutMs) {
  const blocked = probeState.blockedUntil.get(mount) || 0;
  if (blocked > Date.now()) return Promise.resolve(null);   // 黑名单内：跳过底层调用
  const inflight = probeState.pending.get(mount);
  if (inflight) return inflight;   // 在途复用：不重发 uv 工作项
  let timer = null, timedOut = false;
  const p = Promise.race([
    fsp.statfs(mount).then(
      (st) => { probeState.timeouts.delete(mount); return st; },
      () => null),
    new Promise((resolve) => { timer = setTimeout(() => { timedOut = true; resolve(null); }, timeoutMs || STATFS_TIMEOUT_MS); }),
  ]).finally(() => {
    if (timer && typeof clearTimeout === "function") clearTimeout(timer);
    if (timer && typeof timer.unref === "function") timer.unref();
    probeState.pending.delete(mount);
    if (timedOut) {
      const n = (probeState.timeouts.get(mount) || 0) + 1;
      probeState.timeouts.set(mount, n);
      if (n >= PROBE_TIMEOUT_LIMIT) probeState.blockedUntil.set(mount, Date.now() + PROBE_BLOCK_MS);
    }
  });
  p.catch(() => { });
  probeState.pending.set(mount, p);
  return p;
}
async function sampleDisk(projectPath, cfg) {
  try {
    if (typeof fsp.statfs !== "function") return { state: "unavailable", vols: [] };
    let cands = [];   // [{device, mount, roles:[...]}]
    if (process.platform === "linux") {
      cands = parseProcMounts(fs.readFileSync("/proc/self/mounts", "utf8")).map((r) => ({ device: r.device, mount: r.mount, roles: [] }));
    } else if (process.platform === "darwin") {
      const df = await runCmd("df", ["-klP"], 4000);
      if (df.error) return { state: "error", err: "df unavailable", vols: [] };
      /* macOS 白名单（review M2）：df -klP 会列出 VM/Preboot/Update/Recovery/CoreSimulator
       * 等系统内部卷（实测 12 候选），只留根卷、Data 卷与 /Volumes/* 用户卷，防噪声挤占
       * MAX_VOLS 名额。 */
      cands = parseDfLocal(df.stdout)
        .filter((r) => darwinVolAllowed(r.mount))
        .map((r) => ({ device: r.device, mount: r.mount, roles: [] }));
    } else if (process.platform === "win32") {
      const sysDrive = String(process.env.SystemDrive || "C:").replace(/:$/, "").toUpperCase();
      for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
        const mount = letter + ":\\";
        const st = await statfsWithTimeout(mount, 900);
        if (st && st.blocks) cands.push({ device: letter + ":", mount, roles: letter === sysDrive ? ["system"] : [] });
      }
      if (!cands.length) return { state: "error", err: "no volumes", vols: [] };
    } else {
      return { state: "unavailable", vols: [] };
    }
    /* 角色/过滤/去重/排序/裁剪全部在 pickVolumes 纯编排核心（可单测注入候选）。 */
    const picked = pickVolumes(cands, process.platform, projectPath, cfg);
    const vols = [];
    for (const c of picked) {
      const st = await statfsWithTimeout(c.mount, STATFS_TIMEOUT_MS);
      if (!st || !st.blocks || !(st.bsize > 0)) continue;
      const total = st.blocks * st.bsize;
      const avail = st.bavail * st.bsize;   // bavail=非特权可用（df Avail 同源）
      vols.push({
        id: c.mount, name: volNameOf(c.mount), mount: c.mount,
        role: c.roles.indexOf("project") >= 0 ? "project" : c.roles.indexOf("system") >= 0 ? "system" : "other",
        total, used: Math.max(0, (st.blocks - st.bfree) * st.bsize), avail,
        free_pct: total > 0 ? r1(avail / total * 100) : null,
        dev: c.device || null,
      });
    }
    if (process.platform === "darwin") markDarwinContainer(vols);   // v362：仅 macOS 系统卷对判 APFS 共享容器
    if (!vols.length) return { state: "error", err: "statfs failed", vols: [] };
    return { state: "ok", vols };
  } catch (e) {
    return { state: "error", err: String((e && e.message) || e), vols: [] };
  }
}
function pathDriveMount(p) {
  const m = /^([a-zA-Z]):[\\/]/.exec(String(p));
  return m ? m[1].toUpperCase() + ":\\" : null;
}

/* ---------- 采样器实例：订阅启停 + 双链调度 + 帧组装。 */
function createSysmonClient(opts) {
  const onFrame = typeof (opts && opts.onFrame) === "function" ? opts.onFrame : null;
  const log = (opts && opts.log) || (() => { });
  /* 采样函数注入缝（单测 mock timers 驱动订阅启停用，生产不传走真实现） */
  const memFn = (opts && typeof opts.memFn === "function") ? opts.memFn : sampleMem;
  const diskFn = (opts && typeof opts.diskFn === "function") ? opts.diskFn : sampleDisk;
  let cfg = normalizeSysmonConfig(null);
  let projectPath = "";
  let subscribed = false;
  let disposed = false;
  let cpuTimer = null, diskTimer = null, cpuBusy = false, diskBusy = false;
  let prevCpuTicks = null;
  let lastCpu = null, lastMem = null, lastDisk = null;
  let lastFrame = null;

  const buildFrame = () => {
    lastFrame = {
      v: 1, ts: Date.now(),
      cpu: lastCpu || { state: "loading", pct: null, cores: os.cpus().length, load: process.platform === "win32" ? null : loadavgOr(os.loadavg()) },
      mem: lastMem || { state: "loading" },
      disk: lastDisk || { state: "loading", vols: [] },
    };
    return lastFrame;
  };
  const emit = () => {
    if (!subscribed || disposed || !onFrame) return;
    try { onFrame(buildFrame()); } catch (e) { log("sysmon onFrame failed:", (e && e.message) || e); }
  };
  const schedCpu = () => {
    if (!subscribed || disposed || cpuTimer) return;
    cpuTimer = setTimeout(() => { cpuTimer = null; cpuTick(); }, cfg.intervalMs);
    if (cpuTimer && typeof cpuTimer.unref === "function") cpuTimer.unref();
  };
  const schedDisk = () => {
    if (!subscribed || disposed || diskTimer) return;
    diskTimer = setTimeout(() => { diskTimer = null; diskTick(); }, cfg.diskIntervalMs);
    if (diskTimer && typeof diskTimer.unref === "function") diskTimer.unref();
  };
  const cpuTick = async () => {
    if (!subscribed || disposed || cpuBusy) { schedCpu(); return; }
    cpuBusy = true;
    try {
      const snap = cpuSnapshot(prevCpuTicks);
      prevCpuTicks = snap.nextTicks;
      lastCpu = { state: snap.state, pct: snap.pct, cores: snap.cores, load: snap.load };
      lastMem = await memFn();
    } catch (e) {
      log("sysmon cpu/mem tick failed:", (e && e.message) || e);
    } finally {
      cpuBusy = false;
    }
    emit();
    schedCpu();
  };
  const diskTick = async () => {
    if (!subscribed || disposed || diskBusy) { schedDisk(); return; }
    diskBusy = true;
    try {
      lastDisk = await diskFn(projectPath, cfg);
    } catch (e) {
      log("sysmon disk tick failed:", (e && e.message) || e);
    } finally {
      diskBusy = false;
    }
    emit();
    schedDisk();
  };
  const stopTimers = () => {
    if (cpuTimer) { clearTimeout(cpuTimer); cpuTimer = null; }
    if (diskTimer) { clearTimeout(diskTimer); diskTimer = null; }
  };
  const kick = () => { cpuTick(); diskTick(); };
  return {
    setSubscribed(want) {
      want = !!want;
      if (disposed || want === subscribed) return;
      subscribed = want;
      if (subscribed) {
        prevCpuTicks = null;   // 重新订阅从新差分窗口起步，避免长窗均值冒充实测
        kick();
      } else {
        stopTimers();   // 最近一帧保留：view() 仍可回读，渲染端按 ts 判过期
      }
    },
    applyConfig(rawCfg, rawProjectPath) {
      let changed = false;
      if (rawCfg && typeof rawCfg === "object" && !Array.isArray(rawCfg)) { cfg = normalizeSysmonConfig(rawCfg); changed = true; }
      if (typeof rawProjectPath === "string") {
        if (rawProjectPath && rawProjectPath.length <= 4096) { projectPath = rawProjectPath; changed = true; }
        else if (rawProjectPath === "" && projectPath) { projectPath = ""; changed = true; }
      }
      if (changed && subscribed && !disposed) { stopTimers(); kick(); }   // 间隔/目标变化立即按新配置重采；纯 want 抖动不重置
    },
    refreshNow() {
      if (subscribed && !disposed) kick();
    },
    view() { return lastFrame; },
    dispose() {
      disposed = true;
      subscribed = false;
      stopTimers();
      lastFrame = null;
    },
  };
}

module.exports = {
  createSysmonClient,
  normalizeSysmonConfig,
  /* 纯函数导出（单测注入文本/计数，不碰真实系统）： */
  _internals: {
    cpuUsageFromTicks, cpuSnapshot, loadavgOr,
    parseMemInfo, parseSwapusage, parseVmStat,
    parseProcMounts, parseDfLocal, longestMountPrefix, pickProjectMount, volNameOf, pathDriveMount, statfsWithTimeout,
    sampleMem, sampleDisk, pickVolumes, darwinVolAllowed, apfsContainerOf, markDarwinContainer,
    LIMITS: { CPU_DEFAULT_MS, DISK_DEFAULT_MS, CPU_MIN_MS, CPU_MAX_MS, DISK_MIN_MS, DISK_MAX_MS, MAX_VOLS },
  },
};
