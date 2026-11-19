/* mobile-relay：官方中继目标快照推送（主进程热换模块）。
 * inject-main 以宿主 mobileTaskView 与唯一活跃桥校验目标，按 SID + identity 查询；
 * wire 只发送数值投影和随机 binding，远控页调用桌面同一份 overlay.js。
 * seq/ack/分片仍由官方 AcknowledgedRelayProtocol 管理，不直接写 socket。
 * 目标代次、发送前复验与隐私契约见 specs/mobile-unified-overlay.md。 */
"use strict";

const MAGIC_ID = 2147483647;
const MAX_JSON_BYTES = 262144;
/* 查询/推送限频：与桌面主泵同源同值（config.activity_min_ms，缺省 1500ms，下限 300）。
 * 实际值由 inject-main 创建本模块时传入（options.minIntervalMs），此常量仅兜底/测试用。 */
const DEFAULT_ACTIVITY_MIN_MS = 1500;
/* 同一目标的数据刷新节奏：远控页看的是「当前会话」，1s 级刷新才像桌面。
 * 每次查询走常驻 `zusage.py serve`（见下方 residentQuery），单次 ~5-20ms，
 * 不再每次 spawn 新解释器（Windows 冷启动 0.5~1.5s 是此前「更新慢」的主因之一）。 */
/* 桌面同款触发模型（v346）：DB 写入事件驱动（inject-main 的 fs.watch 300ms 去抖调 pump），
 * 30s 兜底心跳防事件丢失；查询节流 = config.activity_min_ms（与桌面同一配置项）。 */
const FALLBACK_HEARTBEAT_MS = 30000;
const ANNOUNCE_MS = 2500;  // 能力公告节奏（握手起点；极小帧，不影响数据推送节流）
const UPLINK_CAP = 2;      // 上行能力/帧代际（与油猴 zuUp 配对；握手成功油猴才上行）
const HEARTBEAT_MS = 15000;          // 内容不变也至少 15s 一帧（消费端 30s 标灰阈值的一半）
/* 数据心跳：本地目标没有 remoteTimer 的周期驱动，只靠 30s 桥兜底会踩手机端
 * DATA_TTL_MS=30s 标灰边界。10s tick + HEARTBEAT_MS=15s 内容去重：去重只在距上次
 * 发送 <15s 时跳过，因此相邻 tick 至多被跳过一次，最坏间隔 <25s（首 tick 落在 ≥15s 处），
 * 不会形成 >30s 空档。`bridgeTimer`（30s）兼作桥维护与兜底心跳（通常被内容去重），
 * 本 tick 只做本地目标的数据对账。 */
const DATA_HEARTBEAT_MS = 10000;
const RESIDENT_IDLE_MS = 60000;      // 无查询 60s 回收常驻解释器
const RESIDENT_TIMEOUT_MS = 15000;   // 单请求超时（与主泵同值）
const PY_FAIL_LIMIT = 3;             // 连续快速早退/拉起异常达到该次数判不稳定
const PY_RETRY_MS = 60000;           // 不稳定后的冷却时长；到期清零并重试常驻

/* @zcode/rpc serialization.ts 的最小编码器（只写方向）：
 * [1B tag][VQL len][data]；tag 4=array 5=object(JSON) 6=int。消息 = header + body，
 * header=[204(EventFire), MAGIC_ID]，body=Object JSON。协议 send 只解包 .buffer
 * （`send: (buffer) => this.reserveMessage(buffer.buffer)`），VSBuffer shim 只需 buffer。 */
function writeVQL(out, value) {
  let v = value >>> 0;
  for (;;) {
    const b = v & 0x7f;
    v = v >>> 7;
    if (v === 0) { out.push(b); return; }
    out.push(b | 0x80);
  }
}
function encodeEventFireFrame(payloadJson) {
  const bodyBytes = Buffer.from(payloadJson, "utf8");
  const head = [];
  head.push(4);                    // Array
  writeVQL(head, 2);               // 长度 2
  head.push(6); writeVQL(head, 204);            // Int 204 = ResponseType.EventFire
  head.push(6); writeVQL(head, MAGIC_ID);       // Int 魔数 id
  const headBytes = Buffer.from(head);
  const out = Buffer.alloc(headBytes.length + 1 + 5 + bodyBytes.length);   // 5=长度 VQL 上界
  let off = 0;
  headBytes.copy(out, off); off += headBytes.length;
  out[off++] = 5;                  // Object（JSON fallback）
  const lenBytes = [];
  writeVQL(lenBytes, bodyBytes.length);
  const lb = Buffer.from(lenBytes);
  lb.copy(out, off); off += lb.length;
  bodyBytes.copy(out, off);
  return { buffer: out.subarray(0, off + bodyBytes.length) };
}

function createMobileRelay(options) {
  const log = (options && options.log) || (() => { });
  const stash = () => {
    try { const s = globalThis.__zusageRelayStash; return Array.isArray(s) ? s : []; } catch (e) { return []; }
  };
  let live = [];
  let lastPushAt = 0, lastSnapAt = 0, lastSnapKey = "";
  let pushed = 0, droppedOversize = 0, skippedDup = 0, throttled = 0, sendErr = 0, lastError = "";
  let skippedNoTarget = 0, queryRuns = 0;

  const { spawn: realSpawn } = require("child_process");
  const path = require("path");
  const zusagePath = path.join(__dirname, "zusage.py");
  /* 测试接缝：configPath（配置文件落点）与 spawnProc（进程拉起替身）可注入，
   * 默认走真实路径/child_process.spawn。 */
  const spawn = (options && options.spawnProc) || realSpawn;
  /* 限频 = config.activity_min_ms（与桌面主泵同源）。用 getter 形态：inject-main 传入
   * () => readCfgCached().activity_min_ms（自带 mtime 缓存，改配置下一拍即生效），
   * 避免创建时快照常量导致「改了配置要重启才生效」。options.minIntervalMs 供测试注入。 */
  const getMinIntervalMs = (() => {
    const fixed = Math.floor(Number(options && options.minIntervalMs));
    if (fixed > 0) return () => Math.max(300, fixed);
    const fn = options && typeof options.getMinIntervalMs === "function" ? options.getMinIntervalMs : null;
    return () => {
      let v = 0;
      try { v = Math.floor(Number(fn && fn())); } catch (e) { v = 0; }
      return Math.max(300, v > 0 ? v : DEFAULT_ACTIVITY_MIN_MS);
    };
  })();
  const defaultPython = process.platform === "win32" ? "python" : "python3";
  /* 主进程拥有配置真值；只接受同步 getter 返回的显式 true。观察到关闭即失效
   * 本代状态，setter 仍须在写 false 后同步调用 disable，覆盖两次检查间的快速关开。 */
  const readEnabled = () => {
    try { return !!(options && options.strictOptIn === true &&
      typeof options.isEnabled === "function" && options.isEnabled() === true); }
    catch (e) { return false; }
  };
  let enabledState = readEnabled(), enabledEpoch = 0;
  function discardUplinkQueue() {
    try {
      const q = globalThis.__zusageRelayUplinkQueue;
      if (Array.isArray(q)) q.splice(0, q.length);
    } catch (e) { }
  }
  const isEnabled = () => {
    const enabled = readEnabled();
    if (!enabled && !disposed) disable();
    else if (enabled && !enabledState && !disposed) {
      /* 持久 onRawTransportPayload 在 dispatcher 前无条件入队，无法标记接收代际。
       * 重新开启的首个观察点保守丢弃积压，随后只接受新握手，绝不复用关闭期间偏好。 */
      discardUplinkQueue();
      enabledEpoch++;
      enabledState = true;
    }
    return enabled && !disposed;
  };
  const getPythonCmd = () => {
    try { return (options && typeof options.getPythonCmd === "function" && options.getPythonCmd()) || defaultPython; }
    catch (e) { return defaultPython; }
  };

  let currentTarget = null;
  let targetBinding = "", bindingBridge = null;
  function bindingFor(bridge) {
    if (!targetBinding || bindingBridge !== bridge) {
      targetBinding = require("crypto").randomBytes(16).toString("hex");
      bindingBridge = bridge;
    }
    return targetBinding;
  }
  let targetEpoch = 0, validateTarget = null, verifyTarget = null, disposed = false, readyBridge = null;
  let queryBusy = false, activeQuery = null, lastQueryAt = 0, queryPending = false;
  /* 手机端已上报配置 = 有消费者（v346 门控）：只有收到手机上行配置后才开始查库推送，
   * 单纯建立远控通道不推（避免无消费者盲推占带宽）。 */
  let clientReady = false, clientCfg = null, clientCfgGen = 0, uplinkFrames = 0;
  /* v1 持久钩子推裸帧（无 {frame,b,relay} 外壳，直接带 zuUp/zuCfg）：识别后停发能力公告，
   * 等待 disable/重开重新检测。绝不用裸帧绑定当前桥——旧代帧无法证明属于当前连接代次。 */
  let legacyUplinkSeen = false;
  let lastMode = "";
  let lastQueryRecord = null;   // 诊断只记录目标数值统计

  function refreshBridges() {
    const seen = new Set(), next = [];
    for (const e of stash()) {
      if (!e || !e.p || !e.b || e.b.readyAnnounced !== true) continue;
      if (e.b.degraded || e.b.closed || e.b.destroyed) continue;
      if (!e.b.relayProtocol || e.b.relayProtocol.protocol !== e.p) continue;
      if (seen.has(e.p)) continue;
      seen.add(e.p); next.push(e);
    }
    live = next;
    if (readyBridge && (live.length !== 1 || live[0].p !== readyBridge)) {
      targetEpoch++; clientReady = false; clientCfg = null; clientCfgGen = 0; readyBridge = null;
      targetBinding = ""; bindingBridge = null; lastSnapKey = ""; lastSnapAt = 0;
    }
  }

  function targetIsCurrent(target, epoch, bridge) {
    if (disposed || !isEnabled() || !clientReady || epoch !== targetEpoch || currentTarget !== target) return false;
    if (typeof validateTarget === "function") {
      try { if (!validateTarget(target)) return false; } catch (e) { return false; }
    }
    refreshBridges();
    return live.length === 1 && live[0].p === readyBridge && (!bridge || live[0].p === bridge);
  }

  /* 上行排空：宿主钩子（mobile_relay_patch 的 injection）把带 zuUp 标记的帧推进
   * globalThis.__zusageRelayUplinkQueue——帧在 acceptPayload 严格 seq 校验前被消费，
   * 官方 ack 水位零接触。载荷 = 手机端 overlay 偏好（zusage3.* 同键），gen 单调幂等。 */
  function drainUplink(schedule) {
    /* 先观察启用边沿/丢弃旧队列，再取帧；仅清全局队列不能撤销已经 splice 的 frames。 */
    if (disposed || !isEnabled()) return;
    const epoch = enabledEpoch;
    let q;
    try { q = globalThis.__zusageRelayUplinkQueue; } catch (e) { return; }
    if (!Array.isArray(q) || !q.length) return;
    const frames = q.splice(0, q.length);
    refreshBridges();
    /* v1 持久钩子直接入队裸帧（无 frame 字段）：只做识别与诊断，不绑定当前桥。
     * 扫描必须先于唯一桥守卫——多桥瞬态也会把队列 splice 清空，若先 return 就丢掉了
     * 「旧代存在」证据，之后恢复单桥时仍会发一次假公告。公告停发直到 disable/重开。 */
    for (const item of frames) {
      uplinkFrames++;
      if (!item || typeof item !== "object" || item.frame) continue;
      if (item.zuUp || item.zuCfg) {
        legacyUplinkSeen = true;
        lastError = "legacy uplink frame ignored";
      }
    }
    if (live.length !== 1 || disposed || !isEnabled() || epoch !== enabledEpoch) return;
    for (const item of frames) {
      /* 非对象、无帧体或旧代裸帧都不参与 v2 配置消费（裸帧已在上面识别）。 */
      if (!item || typeof item !== "object" || !item.frame) continue;
      if (item.b !== live[0].b || item.relay !== live[0].b.relayProtocol ||
          item.relay.protocol !== live[0].p) continue;
      const p = item.frame;
      const cfg = p && typeof p === "object" ? p.zuCfg : null;
      if (!isEnabled() || disposed || epoch !== enabledEpoch) return;
      if (!cfg || typeof cfg !== "object") continue;
      const gen = Math.floor(Number(cfg.gen)) || 0;
      if (gen <= clientCfgGen) continue;
      clientCfgGen = gen;
      clientCfg = cfg;
      clientReady = true;
      readyBridge = live[0].p;
      diag({ uplinkApplied: gen, clientReady, clientCfg });
      /* 首次拿到配置（或配置变化）：立即按新偏好推一帧 */
      if (schedule !== false) { try { schedulePump(0); } catch (e) { } }
    }
  }

  /* 热修层（与 asar 持久层等价的双保险）：稳定 dispatcher 保留在宿主桥上，
   * 当前实例只拥有可替换的 handler。热换不能让旧实例的 disposed/getter 永久拦掉上行。 */
  const uplinkHooks = new Set();
  function acceptUplink(payload, bridge, relay) {
    if (!isEnabled()) return; // 关闭仍先于宿主 seq 校验消费，但不应用或排队
    const q = globalThis.__zusageRelayUplinkQueue = globalThis.__zusageRelayUplinkQueue || [];
    if (q.length >= 64) q.splice(0, q.length - 63);
    q.push({ frame: payload, b: bridge, relay });
  }
  function wrapUplinkHooks() {
    if (disposed) return;
    for (const e of stash()) {
      const relay = e && e.b && e.b.relayProtocol;
      if (!relay || typeof relay.acceptPayload !== "function") continue;
      if (relay.__zusageUplinkDispatcherV2 !== relay.acceptPayload) {
        let orig;
        try { orig = relay.acceptPayload.bind(relay); } catch (e2) { continue; }
        const wrapped = function (payload) {
          try {
            if (payload && payload.zuUp) {
              const handler = relay.__zusageUplinkHandlerV2;
              try { if (handler) handler.accept(payload, handler.bridge, relay); } catch (e2) { }
              return true;
            }
          } catch (e2) { }
          return orig(payload);
        };
        try {
          relay.acceptPayload = wrapped;
          if (relay.acceptPayload === wrapped) {
            relay.__zusageUplinkDispatcherV2 = wrapped;
            relay.__zusageUplinkWrappedV2 = wrapped;
          }
        } catch (e2) { }
      }
      if (relay.__zusageUplinkDispatcherV2 !== relay.acceptPayload) continue;
      try {
        const handler = relay.__zusageUplinkHandlerV2;
        if (!handler || handler.accept !== acceptUplink || handler.bridge !== e.b) {
          relay.__zusageUplinkHandlerV2 = { accept: acceptUplink, bridge: e.b };
        }
        uplinkHooks.add(relay);
      } catch (e2) { }
    }
  }

  const bridgeTimer = setInterval(() => {
    refreshBridges();
    wrapUplinkHooks();
    drainUplink();
    if (isEnabled() && live.length === 1 && currentTarget && clientReady) { try { pump(); } catch (e) { } }
  }, FALLBACK_HEARTBEAT_MS);
  if (typeof bridgeTimer.unref === "function") bridgeTimer.unref();
  /* 能力公告节拍：只做握手（有桥就发，不管有没有 target/配置） */
  const remoteTimer = setInterval(() => {
    if (currentTarget && currentTarget.workspaceIdentity && isEnabled()) {
      const configured = options && typeof options.getRemotePollMs === "function" ? Number(options.getRemotePollMs()) : 3000;
      const interval = Math.max(1000, Number.isFinite(configured) && configured > 0 ? configured : 3000, getMinIntervalMs());
      if (Date.now() - lastQueryAt >= interval) pump();
    }
  }, 1000);
  if (typeof remoteTimer.unref === "function") remoteTimer.unref();
  /* 数据心跳（仅本地目标）：远端目标由 remoteTimer 严格按 poll_ms 驱动，10s tick 不能
   * 绕过它（poll_ms=60000 的远端会因此被拉到 10s 查询）。本地目标原本只有 DB 事件与
   * 30s 桥兜底——空闲时恰好踩手机端 30s 标灰阈值。10s tick 只做数据对账，配合
   * HEARTBEAT_MS 去重保证最坏间隔 <25s；桥维护与兜底心跳仍由 bridgeTimer（30s，通常
   * 被内容去重）负责。 */
  const dataTimer = setInterval(() => {
    if (disposed || !isEnabled()) return;
    refreshBridges();
    if (live.length === 1 && currentTarget && !currentTarget.workspaceIdentity && clientReady) {
      try { pump(); } catch (e) { }
    }
  }, DATA_HEARTBEAT_MS);
  if (typeof dataTimer.unref === "function") dataTimer.unref();
  const announceTimer = setInterval(() => { try { announce(); } catch (e) { } }, ANNOUNCE_MS);
  if (typeof announceTimer.unref === "function") announceTimer.unref();
  refreshBridges();
  wrapUplinkHooks();

  function entryInfo(e) {
    try {
      return {
        id: e.b && e.b.bridgeSessionId ? String(e.b.bridgeSessionId).slice(0, 16) : null,
        degraded: !!(e.b && e.b.degraded),
        relay: !!(e.b && e.b.relayProtocol),
        keys: e.b ? Object.keys(e.b).slice(0, 24) : null,
        ready: !!(e.b && e.b.readyAnnounced),
        closed: !!(e.b && e.b.closed),
        destroyed: !!(e.b && e.b.destroyed),
        connected: e.b && typeof e.b.connected !== "undefined" ? !!e.b.connected : null,
      };
    } catch (err) { return { err: String(err && err.message || err).slice(0, 40) }; }
  }

  function diag(extra) {
    /* 生产默认零写盘：诊断文件无读取方（仅人工排查），每次成功推送后同步写盘反而
     * 增加 IO。只有显式注入 options.diagPath（测试接缝/定向排查）时才落盘。 */
    const diagPath = options && options.diagPath;
    if (!diagPath) return;
    try {
      const fs = require("fs");
      fs.writeFileSync(diagPath, JSON.stringify(Object.assign({
        ts: Date.now(), stashCount: stash().length, liveCount: live.length,
        live: live.map(entryInfo), stashAll: stash().map(entryInfo),
        pushed, droppedOversize, skippedDup, throttled, sendErr, skippedNoTarget,
        queryRuns, lastPushAt, lastError, lastMode, clientReady, clientCfgGen, uplinkFrames, clientCfg,
        legacyUplinkSeen,
        target: !!currentTarget,
        lastQueryRecord,
      }, extra || {}), null, 2));
    } catch (e) { }
  }
  /* 自调度空转时也要能观测（推送被内容去重跳过时不写 diag）：最多 10s 落一次 */
  let lastDiagAt = 0;
  function diagThrottled() {
    const t = Date.now();
    if (t - lastDiagAt < 10000) return;
    lastDiagAt = t;
    diag();
  }


  /* 常驻查询进程（`zusage.py serve`，与主泵同一行协议）：每 1.5s 刷新一次数据时，
   * 每次 spawn 新 Python 在 Windows 要 0.5~1.5s 且吃 CPU——这是远控端「更新慢」的
   * 主因。常驻进程下同一查询 5~20ms。空闲 60s 回收；连续 3 次快速早退/拉起异常进
   * 60s 冷却（冷却期走一次性 spawn，到期清零重试），单次成功回包不清零。
   * turns:true 不再携带（逐轮统计块随回答统计行一并回退）。
   * lean:true：手机 projection 不消费 speed_history/all_projects，serve 侧跳过计算与传输；
   * 一次性 json 回退复用同一 request 字符串，因此同样享受 lean。 */
  const RESIDENT_LINE = (target) => JSON.stringify(Object.assign({ lean: true },
    target.workspaceIdentity
      ? { sids: [], scopes: [{ sid: target.taskId, workspaceIdentity: target.workspaceIdentity }] }
      : { sids: [target.taskId], scopes: [] }));
  let pyRes = null, pyFail = 0, pyRetryAt = 0, pyIdle = 0;
  function noteServeFailure() {
    pyFail++;
    if (pyFail >= PY_FAIL_LIMIT) {
      pyRetryAt = Date.now() + PY_RETRY_MS;
      lastError = "serve unstable, retry after cooldown";
    }
  }
  const legacyQueries = new Set();
  function stopResident() {
    if (pyIdle) { clearTimeout(pyIdle); pyIdle = 0; }
    const c = pyRes;
    if (!c) return;
    pyRes = null;
    c.intentional = true;
    try { c.proc.kill(); } catch (e) { }
    const ws = c.waiters; c.waiters = [];
    ws.forEach((w) => { try { w(null); } catch (e) { } });
  }
  function armIdle() {
    if (pyIdle) clearTimeout(pyIdle);
    pyIdle = setTimeout(() => { pyIdle = 0; stopResident(); }, RESIDENT_IDLE_MS);
    if (pyIdle && typeof pyIdle.unref === "function") pyIdle.unref();
  }
  function startResident() {
    const pythonCmd = getPythonCmd();
    if (pyRes && pyRes.pythonCmd === pythonCmd) return pyRes;
    if (pyRes) stopResident();
    let proc;
    try { proc = spawn(pythonCmd, [zusagePath, "serve"], { windowsHide: true }); }
    catch (e) {
      lastError = "serve spawn: " + e.message;
      noteServeFailure();
      return null;
    }
    const c = { proc, pythonCmd, buf: "", waiters: [], born: Date.now(), intentional: false, finished: false };
    pyRes = c;
    c.finish = () => {
      if (c.finished) return;
      c.finished = true;
      if (pyRes === c) pyRes = null;
      const ws = c.waiters; c.waiters = [];
      ws.forEach((w) => { try { w(null); } catch (e) { } });
      if (c.intentional) return;
      if (Date.now() - c.born < 30000) noteServeFailure();
      else { pyFail = 0; pyRetryAt = 0; }
    };
    proc.on("error", () => { try { proc.kill(); } catch (e) { } c.finish(); });
    proc.stdin.on("error", () => { try { proc.kill(); } catch (e) { } c.finish(); });
    proc.on("close", c.finish);
    proc.stderr.on("data", () => { });
    proc.stdout.on("data", (d) => {
      if (c.finished || c.intentional) return;
      c.buf += d.toString("utf8");
      if (c.buf.length > 8 * 1024 * 1024) { c.buf = ""; return; }
      let i;
      while ((i = c.buf.indexOf("\n")) >= 0) {
        const line = c.buf.slice(0, i);
        c.buf = c.buf.slice(i + 1);
        const w = c.waiters.shift();
        if (!w) continue;
        let payload = null;
        try { payload = JSON.parse(line); } catch (e) { }
        w(payload);
      }
    });
    armIdle();
    return c;
  }
  /* 一次查询：常驻优先，不稳定时一次性 spawn 回退；只结算一次。 */
  function queryJson(target, done) {
    let settled = false;
    const finish = (payload) => { if (!settled) { settled = true; done(payload); } };
    const request = RESIDENT_LINE(target);
    /* 不稳定降级带冷却：pyFail 达限后只在冷却期内走一次性 spawn；冷却到期清零并
     * 重新尝试常驻。单次成功响应不清零（避免「回包后立刻崩溃」被误判稳定）。 */
    if (pyFail >= PY_FAIL_LIMIT && Date.now() >= pyRetryAt) { pyFail = 0; pyRetryAt = 0; }
    if (pyFail < PY_FAIL_LIMIT) {
      const c = startResident();
      if (c && c.proc.stdin.writable) {
        const waiter = (payload) => { clearTimeout(timer); finish(payload); };
        const timer = setTimeout(() => { stopResident(); finish(null); }, RESIDENT_TIMEOUT_MS);
        if (timer && typeof timer.unref === "function") timer.unref();
        c.waiters.push(waiter);
        try { c.proc.stdin.write(request + "\n"); }
        catch (e) { try { c.proc.kill(); } catch (e2) { } c.finish(); }
        armIdle();
        return;
      }
    }
    let proc;
    try { proc = spawn(getPythonCmd(), [zusagePath, "json", request], { windowsHide: true }); }
    catch (e) { lastError = "json spawn: " + e.message; finish(null); return; }
    let out = "";
    const query = { cancel: () => { try { proc.kill(); } catch (e) { } complete(null); } };
    const complete = (payload) => {
      clearTimeout(timer);
      legacyQueries.delete(query);
      finish(payload);
    };
    const timer = setTimeout(() => query.cancel(), RESIDENT_TIMEOUT_MS);
    if (timer && typeof timer.unref === "function") timer.unref();
    legacyQueries.add(query);
    proc.stdout.on("data", (d) => { if (!settled && out.length < 8 * 1024 * 1024) out += d.toString("utf8"); });
    proc.on("error", () => complete(null));
    proc.on("close", (code) => {
      if (settled) return;
      if (code !== 0) { complete(null); return; }
      try { complete(JSON.parse(out)); } catch (e) { complete(null); }
    });
  }

  /* 投影数值统计，不转发标题、路径、任务正文或其他会话。 */
  function numericProjection(value) {
    const numeric = ["total", "input", "output", "cache_read", "cache_write", "reasoning",
      "requests", "turns", "sessions", "tool_calls", "tool_errors", "errors", "retries",
      "avg_tps", "tps", "rate_avg", "tps_avg", "tps_out", "tps_gen", "rated_output",
      "unrated_output", "gen_ms", "duration_ms", "avg_duration_ms", "avg_ttft_ms", "ttft_ms",
      "started", "ended", "startedAt", "endedAt", "last_at", "ctx", "ctx_exc",
      "context_window", "cost_usd", "count"];
    const models = new Map(), tools = new Map();
    function label(map, raw, prefix) {
      if (typeof raw !== "string" || !raw) return undefined;
      if (!map.has(raw)) map.set(raw, prefix + " " + (map.size + 1));
      return map.get(raw);
    }
    function object(v) { return v && typeof v === "object" && !Array.isArray(v); }
    function scalars(v, keys) {
      const out = {};
      for (const key of keys) if (typeof v[key] === "number" && Number.isFinite(v[key])) out[key] = v[key];
      return out;
    }
    function modelList(v) {
      if (!Array.isArray(v)) return undefined;
      return v.slice(0, 16).filter(object).map((m) => {
        const out = scalars(m, ["total", "requests", "cost_usd"]);
        const name = label(models, m.model, "Model");
        if (name) out.model = name;
        if (object(m.rates)) out.rates = scalars(m.rates, ["input", "output", "cache_read", "cache_write"]);
        return out;
      });
    }
    function project(v, kind) {
      if (!object(v)) return undefined;
      const out = scalars(v, numeric);
      if (kind === "subItem" && typeof v.last === "number" && Number.isFinite(v.last)) out.last = v.last;
      for (const key of ["active", "completed", "context_auto"]) {
        if (typeof v[key] === "boolean") out[key] = v[key];
      }
      if (Array.isArray(v.models)) out.models = modelList(v.models);
      if (kind === "last") {
        const name = label(models, v.model, "Model");
        if (name) out.model = name;
        if (object(v.rates)) out.rates = scalars(v.rates, ["input", "output", "cache_read", "cache_write"]);
      }
      if (kind === "root") {
        for (const key of ["last", "last_turn", "project", "sub", "tools"]) {
          const child = project(v[key], key);
          if (child) out[key] = child;
        }
        if (Array.isArray(v.speed_segs)) out.speed_segs = v.speed_segs.slice(-20).filter(object).map((s) => {
          const seg = scalars(s, ["v", "t", "i", "o", "n", "c"]);
          const name = label(models, s.m, "Model");
          if (name) seg.m = name;
          return seg;
        });
      }
      if (kind === "sub" && Array.isArray(v.list)) out.list = v.list.slice(0, 32).filter(object).map((s, i) => {
        const item = project(s, "subItem");
        item.sid = "agent-" + (i + 1);
        return item;
      });
      if (kind === "tools" && Array.isArray(v.list)) out.list = v.list.slice(0, 32).filter(object).map((t) => {
        const item = scalars(t, ["count", "duration_ms", "errors"]);
        item.name = label(tools, t.name, "Tool") || "Tool";
        return item;
      });
      return out;
    }
    return project(value, "root");
  }

  function queryAndPush(target, epoch, bridge) {
    if (queryBusy || !targetIsCurrent(target, epoch, bridge)) return;
    const query = {};
    activeQuery = query;
    queryBusy = true;
    const runId = ++queryRuns;
    queryJson(target, (d) => {
      /* disable 先撤销请求身份再回收子进程；旧回调不能释放重开后的 busy 或补拍。 */
      if (activeQuery !== query) return;
      activeQuery = null;
      queryBusy = false;
      lastQueryAt = Date.now();
      if (!isEnabled()) return;
      if (queryPending) { queryPending = false; schedulePump(0); }
      if (!targetIsCurrent(target, epoch, bridge)) return;
      if (!d || d.error) { lastError = "query failed"; diag(); sendUnavailable(target, epoch, bridge, runId); return; }
      try {
        const remote = !!target.workspaceIdentity;
        const r = (d.recent || []).find((x) => x && x.sid === target.taskId &&
          (remote ? x.workspace_identity === target.workspaceIdentity && x.remote &&
            x.remote_target && !x.remote_error && !x.remote_missing
            : !x.remote && !x.workspace_identity));
        if (!r || (!remote && d.local_error)) { lastError = "session unavailable"; diag(); sendUnavailable(target, epoch, bridge, runId); return; }
        const today = remote ? (d.remote_today || {})[r.remote_target] : d.today;
        lastQueryRecord = {
          ts: Date.now(), total: r.total, turns: r.turns, requests: r.requests,
          tool_calls: r.tool_calls, avg_tps: r.avg_tps,
          today_total: today ? today.total : null,
          today_turns: today ? today.turns : null,
          today_requests: today ? today.requests : null,
        };
        const row = numericProjection(r);
        row.sid = target.taskId;
        if (remote) row.remote = true;
        const snap = {
          recent: [row], session: row, today: numericProjection(today), remote_evidence: remote,
          last: row.last, last_turn: row.last_turn,
        };
        sendSnapshot(target, epoch, bridge, snap, runId);
      } catch (e) { lastError = "parse failed"; diag(); sendUnavailable(target, epoch, bridge, runId); }
    });
  }

  /* 能力公告帧（v346 握手起点，打破死锁）：桌面等手机配置才推、手机等 zuUpCap 才发配置，
   * 两者互等。这里在「有活跃桥」时不依赖 target/clientReady 周期发极小公告
   * （~80B，仅能力声明），手机收到即上行配置 → 桌面门控打开 → 开始推数据。
   * 无补丁宿主不会发此帧，油猴因此绝不会对无钩子连接上行（安全门不受影响）。 */
  let lastAnnounceAt = 0;
  function announce() {
    refreshBridges();
    wrapUplinkHooks();
    if (disposed || !isEnabled() || live.length !== 1) return;
    /* 已观察到 v1 裸帧：不能对旧代上行能力做假握手，等 disable/重开重新检测。 */
    if (legacyUplinkSeen) return;
    const relay = live[0].b.relayProtocol;
    if (!relay || typeof relay.acceptPayload !== "function") return;
    /* 上行能力两路证据：运行时包裹成功（本实例 hook 可用），或补丁链注入的持久 v2
     * 标记（acceptPayload 只读时会走后者，持久钩子在各模块实例前消费裸帧）。 */
    let persistentV2 = false;
    try { persistentV2 = globalThis.__zusageRelayUplinkGeneration === 2; } catch (e) { }
    if (relay.__zusageUplinkWrappedV2 !== relay.acceptPayload && !persistentV2) return;
    const now = Date.now();
    if (now - lastAnnounceAt < ANNOUNCE_MS) return;
    lastAnnounceAt = now;
    const body = { zm: 1, ts: now, zuUpCap: UPLINK_CAP, cfgGen: clientCfgGen };
    let frame;
    try { frame = encodeEventFireFrame(JSON.stringify(body)); }
    catch (e) { sendErr++; lastError = "announce encode: " + ((e && e.message) || e); return; }
    for (const e of live.slice()) {
      try { e.p.send(frame); }
      catch (err) {
        sendErr++; lastError = ((err && err.message) || String(err)).slice(0, 160);
        const idx = live.indexOf(e);
        if (idx >= 0) live.splice(idx, 1);
      }
    }
  }

  /* 本地与远端均只发送受限快照，手机复用同一桌面 overlay；不再生成第二种状态条。
   * 超限只裁可选明细，仍超限则发送目标专属不可用状态，不能更改目标类型。 */
  async function sendUnavailable(target, epoch, bridge, runId) {
    if (runId !== queryRuns || !targetIsCurrent(target, epoch, bridge)) return;
    if (typeof verifyTarget === "function") {
      try { if (!await verifyTarget()) return; } catch (e) { return; }
      if (runId !== queryRuns || !targetIsCurrent(target, epoch, bridge)) return;
    }
    const body = { zm: 1, ts: Date.now(), target: { taskId: target.taskId }, mine: target.taskId,
      scopeKind: target.workspaceIdentity ? "remote" : "local", state: "unavailable",
      binding: bindingFor(bridge), zuUpCap: UPLINK_CAP, cfgGen: clientCfgGen };
    try { live[0].p.send(encodeEventFireFrame(JSON.stringify(body))); lastSnapKey = ""; }
    catch (e) { sendErr++; }
  }

  async function sendSnapshot(target, epoch, bridge, snap, runId) {
    if (runId !== queryRuns || !targetIsCurrent(target, epoch, bridge)) return;
    if (typeof verifyTarget === "function") {
      try { if (!await verifyTarget()) return; } catch (e) { return; }
      if (runId !== queryRuns || !targetIsCurrent(target, epoch, bridge)) return;
    }
    const mine = target.taskId;
    const now = Date.now();
    const binding = bindingFor(bridge);
    const key = JSON.stringify({ binding, s: snap });
    if (key === lastSnapKey && now - lastSnapAt < HEARTBEAT_MS) { skippedDup++; return; }
    const body = { zm: 1, ts: now, target: { taskId: mine }, mine, binding,
      scopeKind: target.workspaceIdentity ? "remote" : "local",
      zuUpCap: UPLINK_CAP, cfgGen: clientCfgGen, snap };
    let json = JSON.stringify(body);
    if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) {
      // 保留主统计；明细是可选的，不能通过更改 scopeKind 或换渲染器绕过大小边界。
      const row = Object.assign({}, snap.session);
      for (const field of ["models", "speed_segs", "tools", "sub", "project"]) delete row[field];
      for (const field of ["last", "last_turn"]) if (row[field]) {
        row[field] = Object.assign({}, row[field]); delete row[field].models;
      }
      const today = snap.today && Object.assign({}, snap.today);
      if (today) delete today.models;
      body.snap = Object.assign({}, snap, { recent: [row], session: row, today,
        last: row.last, last_turn: row.last_turn });
      json = JSON.stringify(body);
    }
    if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) {
      droppedOversize++; lastError = "snap oversize"; diag();
      sendUnavailable(target, epoch, bridge, runId); return;
    }
    if (now - lastSnapAt < getMinIntervalMs()) { throttled++; schedulePump(getMinIntervalMs() - (now - lastSnapAt)); return; }
    let frame;
    try { frame = encodeEventFireFrame(json); }
    catch (e) { sendErr++; lastError = "encode failed"; return; }
    if (runId !== queryRuns || !targetIsCurrent(target, epoch, bridge)) return;
    try { live[0].p.send(frame); }
    catch (err) { sendErr++; lastError = "send failed"; return; }
    pushed++; lastPushAt = now; lastSnapAt = now; lastSnapKey = key; lastMode = "snap";
    diag();
  }

  /* 事件驱动（v346，与桌面同款）：inject-main 的 DB watcher（300ms 去抖）与兜底心跳
   * 都调 pump()；查询节流 = activity_min_ms（getter 实时读，改配置即生效），
   * 不满足时补一拍，保证限频窗口内的最后一笔写入一定被取到（scheduleRetry 同款）。 */
  let pumpTimer = 0, pumpTimerDue = 0;
  /* 已有排程时允许「更早的重排」：改小 activity_min_ms 或目标切换后应立即补拍，
   * 不能被先前按旧限频排下的长等待拖住（桌面 scheduleRetry 只保留最后一次，
   * 这里取更早者——语义上是「最早可查时刻」，两者等价且不受旧值牵制）。 */
  function schedulePump(delayMs) {
    if (disposed || !isEnabled()) return;
    const due = Date.now() + Math.max(0, delayMs || 0);
    if (pumpTimer) {
      if (pumpTimerDue <= due) return;   // 已有更早的排程
      clearTimeout(pumpTimer);
      pumpTimer = 0;
    }
    pumpTimerDue = due;
    pumpTimer = setTimeout(function () {
      pumpTimer = 0;
      try { pump(); } catch (e) { }
    }, Math.max(0, due - Date.now()));
    if (pumpTimer && typeof pumpTimer.unref === "function") pumpTimer.unref();
  }
  function clearPump() {
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpTimer = 0; pumpTimerDue = 0;
  }
  /* 由主进程 setter 在写入 false 后同步调用；不 dispose，重开由新目标与上行重新握手。
   * 不发撤销帧、不移除安全上行拦截，也不触碰宿主拥有的 stash/远控协议。 */
  function disable() {
    enabledState = false; enabledEpoch++;
    targetEpoch++;
    currentTarget = null; validateTarget = null; verifyTarget = null;
    clientReady = false; clientCfg = null; clientCfgGen = 0; readyBridge = null;
    activeQuery = null; queryBusy = false; queryPending = false;
    clearPump();
    lastQueryAt = 0; lastSnapAt = 0; lastSnapKey = ""; lastAnnounceAt = 0;
    lastQueryRecord = null; lastMode = "";
    /* 重开允许重新检测上行代际；v1 裸帧仍只做识别，不会被当 v2 消费。 */
    legacyUplinkSeen = false;
    discardUplinkQueue();
    stopResident();
    for (const query of Array.from(legacyQueries)) query.cancel();
  }
  /* 一次对账：门控（clientReady）→ 目标 → 节流 → 查询推送。 */
  function pump() {
    drainUplink(false);
    if (disposed || !isEnabled() || !currentTarget || !clientReady) return false;
    const target = currentTarget, epoch = targetEpoch;
    if (!targetIsCurrent(target, epoch)) return false;
    const bridge = live[0].p;
    if (queryBusy) { queryPending = true; return false; }
    const now = Date.now();
    const limit = getMinIntervalMs();
    if (now - lastQueryAt < limit) { schedulePump(limit - (now - lastQueryAt)); return false; }
    queryAndPush(target, epoch, bridge);
    diagThrottled();
    return true;
  }

  /* 主进程目标发现上报：{zm:1, target}。目标变化立即 pump；同一目标等 DB 事件。
   * 无手机配置（clientReady=false）时不查库不推——门控在 pump 内。 */
  function push(payload, validator, verifier) {
    if (disposed || !payload || payload.zm !== 1 || !isEnabled()) return false;
    const input = payload.target;
    const sid = input && typeof input.taskId === "string" ? input.taskId : "";
    const identity = input && typeof input.workspaceIdentity === "string" ? input.workspaceIdentity : null;
    const tgt = /^[A-Za-z0-9_-]{1,256}$/.test(sid) &&
      identity !== null && (!identity || /^remote:(?:ssh|wsl|docker|server):/.test(identity))
      ? { taskId: sid, workspaceIdentity: identity, workspacePath: input.workspacePath || "",
        bridge: input.bridge, bridgeState: input.bridgeState, relay: input.relay,
        remoteSessionId: input.remoteSessionId } : null;
    const prevKey = currentTarget && JSON.stringify([currentTarget.taskId, currentTarget.workspaceIdentity, currentTarget.workspacePath]);
    const nextKey = tgt && JSON.stringify([tgt.taskId, tgt.workspaceIdentity, tgt.workspacePath]);
    if (prevKey === nextKey && tgt && currentTarget.bridge === tgt.bridge &&
        currentTarget.bridgeState === tgt.bridgeState && currentTarget.relay === tgt.relay &&
        currentTarget.remoteSessionId === tgt.remoteSessionId) {
      validateTarget = validator || null; verifyTarget = verifier || null;
      drainUplink();
      return true;
    }
    targetEpoch++;
    targetBinding = ""; bindingBridge = null;
    clearPump();
    currentTarget = tgt;
    validateTarget = validator || null;
    verifyTarget = verifier || null;
    if (!tgt) { skippedNoTarget++; return false; }
    lastQueryAt = 0; lastSnapAt = 0; lastSnapKey = "";
    schedulePump(0);
    return true;
  }

  diag();

  return {
    push,
    status: () => ({
      bridges: live.length, pushed, droppedOversize, skippedDup, throttled, sendErr,
      skippedNoTarget, queryRuns, lastPushAt, lastError, lastMode,
      clientReady, clientCfgGen, uplinkFrames, legacyUplinkSeen,
      target: currentTarget ? currentTarget.taskId : null,
    }),
    /* 测试接缝：DB 事件正常由 inject-main 调用（冷文件），测试直调 */
    pump,
    disable,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disable();
      for (const relay of uplinkHooks) {
        try {
          if (relay.__zusageUplinkHandlerV2 && relay.__zusageUplinkHandlerV2.accept === acceptUplink) {
            delete relay.__zusageUplinkHandlerV2;
          }
        } catch (e) { }
      }
      uplinkHooks.clear();
      if (bridgeTimer) clearInterval(bridgeTimer);
      if (announceTimer) clearInterval(announceTimer);
      if (remoteTimer) clearInterval(remoteTimer);
      if (dataTimer) clearInterval(dataTimer);
      live = [];
    },
  };
}

module.exports = { createMobileRelay };
