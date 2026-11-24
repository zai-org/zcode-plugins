// cc-browser-bridge 引导页状态机（浏览器与 node --test 共用；无 DOM、无定时器依赖）
// 页面通过 createStateMachine(io) 注入渲染/请求能力；行为测试直接驱动 handle/poll/performDone。
// 关键行为：
//   - 每次状态迁移都由真实 /api/status 结果驱动；成功状态可被失败/断开撤回
//   - 暂停恢复、服务恢复（含未装扩展回到等待安装）、pass→fail 撤回均有明确迁移
//   - 轮询单飞（不堆叠）、旧响应丢弃、连续失联进入 offlineNet 并自动重试恢复
//   - /api/done 必须以 POST 成功才宣告完成，失败不假装已关闭
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OnboardState = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TITLES = {
    loading: ["正在检查连接状态", "确认桥接服务与 Chrome 扩展的当前状态，稍等…", 1],
    start: ["为客户端连接 Chrome", "首次设置一次，以后直接在 ZCode 等客户端聊天中调用浏览器。", 1],
    install: ["加载 Chrome 扩展", "只需完成下面的操作，加载后引导会自动继续。", 2],
    checking: ["验证浏览器连接", "保留这个窗口，正在确认浏览器工具能否正常访问。", 3],
    success: ["开始在客户端使用浏览器", "", 3],
    offline: ["与 Chrome 的连接断开了", "请确认 Chrome 已打开且扩展处于启用状态，我们会持续检测。", 3],
    paused: ["已连接，控制已暂停", "在 Chrome 中打开 Browser Bridge 扩展面板，关闭「暂停」开关后，点重新检测继续。", 3],
    svcdown: ["本地桥接服务未运行", "引导需要桥接服务在客户端与 Chrome 扩展之间转发调用。", 2],
    offlineNet: ["与引导服务的连接中断", "引导服务可能已退出或正在重启，正在自动重试；也可重跑 /cc-browser-setup 获取新页面。", 2],
    expired: ["引导会话不可用", "页面令牌缺失或已过期（引导服务可能已重启）。请重新运行 /cc-browser-setup，或在 Finder 双击 setup.command。", 2],
    done: ["引导完成", "可以关闭此页面，回到客户端继续聊天。", 3],
  };
  const MISSES_TO_OFFLINE = 3;

  function createStateMachine(io) {
    let state = "loading", prevStep = 1, reentryNote = false, deepPhase = false;
    let ensureTried = false, doneSent = false, installSince = 0, slowShown = false;
    let lastTabsKey = "", svcFrom = "", last = null;
    let missCount = 0, inFlight = null, seq = 0, infoObj = null;
    const sleep = io.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const isExpired = (e) => String((e && e.message) || e) === "expired";

    function titlesFor(next) {
      const conf = TITLES[next] || TITLES.loading;
      let step = conf[2];
      if (next === "svcdown" || next === "offlineNet" || next === "expired") step = prevStep;
      else prevStep = step;
      const subtitle = next === "success"
        ? (reentryNote ? "检测到 Chrome 扩展已连接，无需重复安装。" : "读取、点击、填写和截图，都从你的客户端聊天开始。")
        : conf[1];
      return { title: conf[0], subtitle, step };
    }

    function setState(next) {
      state = next;
      if (next === "install") { installSince = Date.now(); slowShown = false; }
      io.setTitles(titlesFor(next));
      io.render(next, { status: last, reentry: reentryNote });
      return next;
    }

    function renderChecking(t) {
      io.render("checking", { tabs: t, bridge: last && last.bridge, reentry: reentryNote });
    }

    function updateChecking(s) {
      const t = s.tabs || { state: "pending" };
      const key = t.state + ":" + (t.paused ? "p" : "") + (t.count != null ? ":" + t.count : "") + ":" + (t.error || "");
      if (key !== lastTabsKey) { lastTabsKey = key; renderChecking(t); }
      if (t.state === "pass") { deepPhase = true; setState("success"); }
      else if (t.paused) setState("paused");
    }

    function updateInstallWait() {
      if (!slowShown && Date.now() - installSince > 120000) { slowShown = true; io.installWaitSlow(); }
    }

    function handle(s) {
      last = s;
      const b = s.bridge || {};
      if (!b.up) {
        if (state !== "svcdown" && state !== "offlineNet" && state !== "expired") {
          if (!ensureTried) { ensureTried = true; io.ensureBridge(); }
          else { svcFrom = state; setState("svcdown"); }
        }
        return;
      }
      ensureTried = false;
      const ext = !!b.extension_connected;
      if (state === "loading" || state === "start") {
        if (ext) { reentryNote = true; setState("checking"); updateChecking(s); }
        else if (state === "loading") setState("start");
        return;
      }
      if (state === "install") {
        if (ext) setState("checking");
        else updateInstallWait();
        return;
      }
      if (state === "checking") {
        if (!ext) setState(deepPhase ? "offline" : "install");
        else updateChecking(s);
        return;
      }
      if (state === "svcdown" || state === "offlineNet") {
        if (ext) { setState("checking"); updateChecking(s); }
        else if (deepPhase) setState("offline");
        else if (svcFrom === "install") setState("install");
        else setState("start");
        return;
      }
      if (state === "paused") {
        if (!ext) setState("offline");
        else if (s.tabs && !s.tabs.paused) { setState("checking"); updateChecking(s); }
        return;
      }
      if (state === "success") {
        if (!ext) { reentryNote = false; setState("offline"); return; }
        const t = s.tabs;
        if (t && t.paused) { setState("paused"); return; }
        if (t && t.state === "fail") { setState("checking"); updateChecking(s); return; }
        return;
      }
      if (state === "offline") {
        if (ext) { setState("checking"); updateChecking(s); }
        return;
      }
    }

    async function pollOnce(fresh) {
      if (doneSent || state === "expired") return { dropped: true };
      if (io.isHidden && io.isHidden()) return { skipped: true }; // 页面隐藏时停轮询，恢复可见补检
      const my = ++seq;
      try {
        const s = await io.request("/api/status" + (fresh ? "?fresh=1" : ""));
        if (doneSent || my !== seq) return { dropped: true };
        missCount = 0;
        // R2-2：info 曾失败（offlineNet 恢复路径）时必须重新取得，否则页面误判平台/目录为空
        if (!infoObj) {
          try {
            const j = await io.request("/api/info");
            if (j && j.ok) { infoObj = j; if (io.setInfo) io.setInfo(j); }
          } catch (e) {
            if (isExpired(e)) { setState("expired"); return { ok: false, error: "expired" }; }
          }
        }
        if (state === "offlineNet") setState(svcFrom && svcFrom !== "offlineNet" ? svcFrom : "loading");
        handle(s);
        return { ok: true };
      } catch (e) {
        if (doneSent || my !== seq) return { dropped: true };
        if (isExpired(e)) { setState("expired"); return { ok: false, error: "expired" }; }
        missCount++;
        if (missCount >= MISSES_TO_OFFLINE && state !== "offlineNet" && state !== "expired") {
          svcFrom = state;
          setState("offlineNet");
        }
        return { ok: false, error: String((e && e.message) || e) };
      }
    }

    function poll(fresh) {
      if (inFlight) return inFlight;
      inFlight = pollOnce(fresh).finally(() => { inFlight = null; });
      return inFlight;
    }

    async function start() {
      setState("loading");
      for (let i = 0; i < 3; i++) {
        try {
          const j = await io.request("/api/info");
          if (j && j.ok) { infoObj = j; break; }
        } catch (e) {
          if (isExpired(e)) { setState("expired"); return; }
        }
        if (i < 2) await sleep(500);
      }
      if (!infoObj) { svcFrom = "loading"; setState("offlineNet"); return; }
      if (io.setInfo) io.setInfo(infoObj);
      await poll(true);
    }

    async function prepare() {
      try {
        const r = await io.request("/api/prepare", { method: "POST", body: "{}" });
        const fails = [r.opened, r.revealed].filter((x) => x && !x.ok);
        if (fails.length) { io.showPrepareError(fails.map((x) => x.reason).join("；")); return false; }
        setState("install");
        return true;
      } catch (e) {
        if (isExpired(e)) { setState("expired"); return false; }
        io.showPrepareError("请求失败：" + String((e && e.message) || e));
        return false;
      }
    }

    async function performDone() {
      try {
        const j = await io.request("/api/done", { method: "POST", body: "{}" });
        if (!j || j.ok !== true) throw new Error("bad response");
        doneSent = true;
        setState("done");
        return true;
      } catch (e) {
        if (isExpired(e)) { setState("expired"); return false; }
        io.notice("完成请求失败，引导服务可能仍在运行；可直接关闭本页，服务稍后会自动退出");
        return false;
      }
    }

    return {
      get state() { return state; },
      get info() { return infoObj; },
      get doneSent() { return doneSent; },
      setState, handle, poll, start, prepare, performDone,
      recheck() { lastTabsKey = ""; setState("checking"); poll(true); },
    };
  }

  return { createStateMachine, TITLES };
});
