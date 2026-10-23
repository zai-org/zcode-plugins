/* ZCode token 用量状态条 v58（渲染进程注入，自包含 IIFE）。
 * 形态：输入框视觉卡片正下方的悬浮胶囊条 —— 给卡片加 margin-bottom 上移让位，
 *       条 fixed 悬浮在卡片边框外、窗口底边上的空带里，rAF 每帧跟随，
 *       左右两缘都与卡片对齐（宽=卡片实测宽；内容超宽先藏「本轮/会话累计」
 *       的缓存命中率，仍装不下右缘渐隐）。
 *       （条不能放在输入框中心点所在矩形内：命中检测自遮挡 = 周期性闪烁，v12-v14 实测。）
 * 视觉（v28）：半透明胶囊底 + 组间 │ 分隔 + 上下文微进度条（三档色）+ 子代理呼吸灯；
 *       条面只放主数值，明细进 hover title。
 * 视觉（v54 重写）：玻璃拟态胶囊（blur+内高光+分层投影）、发丝分隔线替代 │ 字符、
 *       条目悬浮底色提示可交互、行内 SVG 线性图标、tabular 数字、exc 呼吸闪烁、
 *       面板/tooltip/气泡统一圆角玻璃系；行为机制（tooltip 生命周期/遮挡豁免/面板互斥）零改动。
 * 主题（v58）：配色全量跟随客户端主题 —— 颜色一律 var(--color-*, 兜底值) 引用客户端语义
 *       变量（<html> 的 .dark 类翻转整套值，zai-light/zai-dark 特殊主题同样适配），
 *       MutationObserver 观察该类同步 .zu-light（仅剩阴影/光晕程度性差异）。
 * 字体（v64）：字族/字号跟随客户端 —— font-family 一律 var(--font-mono, 旧硬编码栈兜底)
 *       （客户端 ：root 上的等宽令牌，macOS 解析为 SF Mono，含中文回退）；字号一律
 *       var(--ui-font-size, 14px) 按应用 text-ui 档位加减偏移（设置页「界面字号」
 *       运行时写 <html> 内联 --ui-font-size，改动实时联动），不再硬编码 px。
 * 数据：主进程泵推 window.__zusageUpdate；显示项可在 ⚙ 面板配置（localStorage 持久化）。
 * 分屏（v61.1）：协调器每 600ms 扫描可见输入框，按 pane（data-pane-id）派发实例——
 *       一个 pane 一条，各自显示 composer 祖先链 data-session-id 指向的会话；
 *       各 pane 会话 id 汇总挂 window.__zusageWantSids 交泵强制拉取（旧泵忽略）。
 * 当前会话（v34）：泵按窗口注入 payload.mine（客户端渲染端经 IPC 向主进程上报的焦点会话 id，
 *       可为空串）；overlay 优先显示 mine 对应的池条目，池里还没有（新会话没数据）就显示
 *       零值 —— 绝不回退到"别的会话"的数字（多窗口共享 localStorage 时旧启发式必错，实测）。
 *       mine 缺失（辅助窗口/旧泵）才走 localStorage 键启发式 pickCurrent。
 * 热更新：主进程 mtime 检测 + new Function 语法校验后重注入；代际守卫防旧实例打架。
 * 原生按钮增强（v92）：输入框工具行的原生上下文按钮（chat-context-usage-trigger）
 *       环填充改状态条 cbar 同款（r9/描边3/圆帽/四档色/超限闪烁），百分比数值挂在
 *       trigger 按钮内（环右侧，悬停自动享受原生 hover 效果与「上下文容量」面板）——
 *       档位口径沿用原状态条上下文格的 ctxBandOf（v93 起该格已删，口径唯一承载处）；仅注入
 *       data-* 属性与末尾追加节点（React 不清理），React 数据更新重写 dasharray 由
 *       render/heavy 双 reapply 兜回；cw 缺失还原原生形态。
 * Git 状态 chip（v96）：挂在工具行「电脑操作」按钮（v4-composer-cua-entry）右侧，样式移植
 *       cc-pretty-statusline 的 git 段：⎇ 分支 ↑领先 ↓落后 (+插入行 -删除行 ?未跟踪文件)。
 *       数据由主进程旁路 git 查询按工作区路径推送（window.__zusageGitState），渲染端把各 pane
 *       的本地路径写 window.__zusageGitPaths 供主进程取并集；远端 pane / 非仓库 / 无 git 不挂载。
 * 诊断：异常与挂载信息写 window.__zusageDiag，由主进程泵取回写 diag-<n>.json。 */
(function () {
  if (window.__zusageOverlay) return;
  /* 代际守卫保底；正常热更新先主动释放上一代资源。 */
  if (window.__zusageDispose) window.__zusageDispose();
  window.__zusageOverlay = true;
  var disposed = false, coordinatorTimer = 0, bootTimer = 0;
  var MY_GEN = (window.__zusageGen = (window.__zusageGen || 0) + 1);
  function stale() { return disposed || MY_GEN !== window.__zusageGen; }
  if (window.__zusageRateCleanup) window.__zusageRateCleanup();

  var FATAL = (window.__zusageDiag = {});
  /* 多实例（v61.1）：热更新时泵只按 id 清 0 号条，其余实例的 DOM（条/tip/气泡/面板）
   * 在新代码启动时按类名统一自清；旧实例闭包靠 stale() 罢工。
   * 确定性历史行（[data-zusage-deterministic]，挂在消息流 turn 容器末尾）一并自清。
   * v80：面板（.zusage-panel）挂 body 不随条走，清理选择器单列。 */
  try {
    document.querySelectorAll(".zusage-root,.zusage-tip-root,.zusage-exc,.zusage-rate-tip,.zusage-quota-tip,.zu-quota,.zu-git,.zu-compact-btn,.zu-compact-dlg,.zusage-git-tip,.zusage-panel,[data-zusage-deterministic],[data-zusage-loading-status]").forEach(function (el) { el.remove(); });
  } catch (e) { }

  try {
    document.querySelectorAll("[data-zu-pad],[data-zu-old-pad]").forEach(function (el) {
      el.style.paddingBottom = el.dataset.zuPad || el.dataset.zuOldPad || "";
      delete el.dataset.zuPad;
      delete el.dataset.zuOldPad;
    });
    document.querySelectorAll("[data-zu-cardpad]").forEach(function (el) {
      el.style.marginBottom = el.dataset.zuCardPad || "";
      delete el.dataset.zuCardPad;
    });
  } catch (e) { }

  /* ---------- 共享状态（多实例一致）：显示项/语言/上下文覆盖/最近一次数据 ---------- */
  var LS = { show: "zusage3.show", ctxOv: "zusage3.ctxOv", lang: "zusage3.lang", cnNum: "zusage3.cnNum", sec: "zusage3.sec" };
  var state = {
    show: { win: 1, turn: 1, today: 1, sub: 1, tools: 1, git: 1 },   // git：工具行 Git 状态 chip（v96，默认开）
    ctxOv: "", data: null,
    lang: "zh", pluginUpdate: window.__zusagePluginState || null,
    /* 万/亿单位开关：缺省开启，仅显式 "0" 关闭；只在中文界面展示并生效（英文始终 K/M/B） */
    cnNum: 1,
    /* v99 设置面板当前分区（非法值在 buildPanel 回退首分区，不在这里校验） */
    settingsSec: "display",
    /* 逐问速率行开关：真值在运行时 config.json 的 answer_rate_line（主进程随插件状态推送
       rateLine 字段），渲染端只做展示与请求转发；缺省开启 */
    rateLine: !(window.__zusagePluginState && window.__zusagePluginState.rateLine === false),
    /* v96 套餐额度开关：真值在 config.json 的 quota_enabled（主进程据此决定是否解密凭据
       联网查询，并随插件状态推送 quotaEnabled）；缺省关闭——读凭据联网属能力升级，须显式开启 */
    quotaEnabled: !!(window.__zusagePluginState && window.__zusagePluginState.quotaEnabled === true),
    /* 阶段 3 多源配置列表（id/label/enabled/keyConfigured/status...，主进程 sourcesConfig 推送） */
    quotaSources: (window.__zusagePluginState && Array.isArray(window.__zusagePluginState.quotaSources)
      ? window.__zusagePluginState.quotaSources : []),
  };
  /* ---------- i18n（v57）：L(中文, English) 内联双语文案，语言存 localStorage ---------- */
  function L(zh, en) { return state.lang === "en" ? en : zh; }
  /* 万/亿单位是否生效：状态条 fmt()、占位统计行与 turn-text 请求共用同一判定 */
  function cnUnits() { return state.lang !== "en" && !!state.cnNum; }
  function ls(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  try {
    var s0 = JSON.parse(ls(LS.show, "null"));
    if (s0 && typeof s0 === "object") {
      for (var k0 in state.show) if (k0 in s0) state.show[k0] = s0[k0] ? 1 : 0;
    }
    state.ctxOv = ls(LS.ctxOv, "");
    if (ls(LS.lang, "") === "en") state.lang = "en";
    if (ls(LS.cnNum, "") === "0") state.cnNum = 0;
    var s1 = ls(LS.sec, "");
    if (s1) state.settingsSec = s1;
  } catch (e) { }
  function persist() {
    lsSet(LS.show, JSON.stringify(state.show));
    lsSet(LS.ctxOv, state.ctxOv);
    lsSet(LS.lang, state.lang);
    lsSet(LS.cnNum, state.cnNum ? "1" : "0");
    lsSet(LS.sec, state.settingsSec);
  }

  /* ---------- 多实例注册表（v61.1）：每个分屏 pane 一个条实例 ---------- */
  var instances = [];   // spawnInstance 返回的 api：{pid, attach, render, ...}
  var nextSlot = 0;     // 实例序号；0 号保留兼容 id（#zusage-bar，泵热更新按它清理）
  function renderAll(rebuildPanels) {
    if (rateTipFor) showRateTip(rateTipFor);
    for (var i = 0; i < instances.length; i++) {
      if (rebuildPanels) instances[i].rebuild();   // 语言切换等文案重建（各实例面板独立 DOM）
      if (state.data) instances[i].render(state.data);
    }
  }
  var remoteCache = {};
  var remoteTodayCache = {};
  /* v84（issue #30）：渲染端当下读到的主叶工作台归属（refreshWants 每轮刷新）。泵推送的
   * scope_bindings 取自上一轮收集，主叶身份刚切换/撤销时旧绑定可能随迟到的远端响应到达；
   * sessionFor 以此做守卫，不让旧代际绑定重新点亮远端视图。 */
  var mainScopeNow = { sid: "", identity: "" };
  function sessionFor(d, sid, pid) {
    var binding = d.scope_bindings || {};
    // 空 identity 是显式本地绑定；真实 pane 缺绑定时也不能继承同 sid 的远端。
    var identity = Object.prototype.hasOwnProperty.call(binding, pid) ? binding[pid]
      : (pid === "auto" && Object.prototype.hasOwnProperty.call(binding, sid) ? binding[sid] : "");
    var current;
    if (pid !== "auto") {
      current = window.__zusagePaneScopes && window.__zusagePaneScopes[pid];
      for (var n = 0; n < instances.length; n++) {
        if (instances[n].pid !== pid || !instances[n].getScope) continue;
        var scope = instances[n].getScope();
        current = scope || { sid: sid };
        break;
      }
      if (current) {
        /* issue #40：无桥的客户端 refreshWants 只写 {sid}（拿不到身份），泵对同一
         * pane 只能查本地；但只有本窗完全没有远端证据（remote_evidence === false）
         * 才按本地身份匹配，否则本地会话仍会被误杀或误亮。泵绑定非空（远端）而渲染
         * 端看不到身份时保持 fail-closed，不借同 sid 的本地快照。 */
        var hasIdentity = Object.prototype.hasOwnProperty.call(current, "identity");
        var currentIdentity = hasIdentity ? current.identity : "";
        if (current.sid !== sid || currentIdentity !== identity) return null;
        if (!hasIdentity && d.remote_evidence !== false) return null;
      }
    }
    if (!current && pid === "workspace-main" && typeof mainScopeNow !== "undefined" && mainScopeNow && mainScopeNow.known === false) return null;
    /* v84（issue #30）主叶迟到载荷守卫。typeof 兼容测试夹具按源码片段抽取运行（无模块级声明）：
     * 夹具里 mainScopeNow 由 refreshWants 赋值成为全局；生产环境恒有模块级声明。 */
    if (!current && pid === "workspace-main" && identity &&
        (typeof mainScopeNow === "undefined" || !mainScopeNow ||
         mainScopeNow.sid !== sid || mainScopeNow.identity !== identity)) identity = "";
    var recent = d.recent || [], found = null;
    for (var i = 0; i < recent.length; i++) {
      var r = recent[i];
      if (r.sid === sid && (r.workspace_identity || "") === identity) { found = r; break; }
    }
    if (!identity) return found;
    var target = found && found.remote_target || "";
    var key = JSON.stringify([sid, identity, target]);
    if (found && found.remote && !found.remote_error && !found.remote_missing) {
      if (target) remoteCache[key] = found;
      return found;
    }
    // 只复用同目标的成功快照；identity 改指其它目标或目标未知时不能继承旧源数据。
    if (target && remoteCache[key]) return Object.assign({}, remoteCache[key], {
      remote_error: (found && found.remote_error) || "remote data unavailable; showing last successful snapshot",
      remote_missing: true, remote_stale: true,
    });
    return found || { sid: sid, workspace_identity: identity, remote: true, remote_missing: true };
  }
  window.__zusageUpdate = function (d) {
    if (stale() || !d || d.error) return;
    if (d.remote_today) for (var key in d.remote_today) {
      if (d.remote_today[key] && typeof d.remote_today[key] === "object") remoteTodayCache[key] = d.remote_today[key];
    }
    state.data = d;
    for (var i = 0; i < instances.length; i++) {
      try { instances[i].render(d); } catch (e) { FATAL.updateErr = String((e && e.stack) || e); }
    }
  };
  window.__zusagePluginRequests = [];
  function pluginRequest(action, extra) {
    var o = { action: action };
    if (extra !== undefined) {
      if (extra && typeof extra === "object") Object.assign(o, extra);
      else o.enabled = extra;   // 旧调用（action, boolean）线格式不变
    }
    window.__zusagePluginRequests.push(o);
  }
  /* ---------- Git 状态 chip 数据通道（v96）：主进程旁路 git 查询 → 按工作区路径缓存 ----------
   * 主进程每 10s 取各窗口 window.__zusageGitPaths 并集逐路径查询，结果推 window.__zusageGitState；
   * 渲染端只缓存与分发，实例按自身 scope.workspacePath 取用。失败不清空最近成功态（标 stale），
   * 只有明确「非仓库 / 无 git」才视为无数据不挂载。 */
  var gitStateByPath = {}, gitLastGood = {}, gitAskedAt = 0;
  var GIT_ASK_MIN_MS = 5000;   // 快照驱动的重查节流；点击刷新与路径集变化不受限
  function gitViewFor(p) {
    var cur = gitStateByPath[p];
    if (!cur) return null;
    if (cur.ok) return { st: cur, stale: false };
    if (cur.reason === "notrepo" || cur.reason === "nogit") return null;
    var good = gitLastGood[p];
    return good ? { st: good, stale: true } : null;
  }
  function askGitRefresh(force) {
    var paths = window.__zusageGitPaths;
    if (!paths || !paths.length) return;
    var now = Date.now();
    if (!force && now - gitAskedAt < GIT_ASK_MIN_MS) return;
    gitAskedAt = now;
    pluginRequest("git-refresh");
  }
  window.__zusageGitState = function (p, st) {
    if (stale() || typeof p !== "string" || !st || typeof st !== "object") return;
    gitStateByPath[p] = st;
    if (st.ok) gitLastGood[p] = st;
    for (var i = 0; i < instances.length; i++) {
      try { instances[i].gitTouch(); } catch (e) { FATAL.gitErr = String((e && e.stack) || e); }
    }
  };
  window.__zusagePluginUpdate = function (s) {
    if (stale() || JSON.stringify(state.pluginUpdate) === JSON.stringify(s)) return;
    window.__zusagePluginState = state.pluginUpdate = s;
    if (s && typeof s.rateLine === "boolean") state.rateLine = s.rateLine;
    if (s && typeof s.quotaEnabled === "boolean") state.quotaEnabled = s.quotaEnabled;
    if (s && Array.isArray(s.quotaSources)) state.quotaSources = s.quotaSources;   // v95：chip 门控随主进程真值（heavy 对账点内生效）
    scanRateLines();
    instances.forEach(function (inst) { inst.syncUpdate(); });
  };
  /* 工作区身份来自当前会话节点；共享 localStorage 不能证明本窗口的 pane 归属。 */
  function collectSidWs() {
    var map = {};
    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i], sid = inst.getSid();
      var scope = inst.getScope && inst.getScope();
      if (!sid || !scope || scope.sid !== sid || !REMOTE_IDENTITY_RE.test(scope.identity)) continue;
      if (!map[sid]) map[sid] = [];
      if (map[sid].indexOf(scope.identity) < 0) map[sid].push(scope.identity);
    }
    return map;
  }
  /* 可信远端身份前缀白名单（与泵侧 REMOTE_IDENTITY_RE 同族）：ssh/wsl/docker/server。
   * v3.16 客户端把所有传输连接握手后统一升级为 remote:server:，wsl/docker 是直接传输身份。 */
  var REMOTE_IDENTITY_RE = /^remote:(?:ssh|wsl|docker|server):/;
  function readPaneScope(el, sid, pid) {
    if (!el || !sid || sid === "draft" || !el.isConnected) return null;
    try {
      var root = el;
      while (root && !(root.hasAttribute && root.hasAttribute("data-session-id"))) root = root.parentElement;
      if (!root || root.getAttribute("data-session-id") !== sid ||
          root.getAttribute("data-zusage-scope-version") !== "1" ||
          root.getAttribute("data-zusage-pane-id") !== pid) return null;
      var path = root.getAttribute("data-zusage-workspace-path");
      var identity = root.getAttribute("data-zusage-workspace-identity");
      var remote = root.getAttribute("data-zusage-remote-session-id");
      if (typeof path !== "string" || !path.trim() || typeof identity !== "string" ||
          typeof remote !== "string" || /[\x00-\x1f\x7f]/.test(path + identity + remote)) return null;
      identity = identity.trim();
      if (remote && (!identity || /\s/.test(remote))) return null;
      if (identity && !REMOTE_IDENTITY_RE.test(identity)) return null;
      return { sid: sid, identity: identity, workspacePath: path, remoteSessionId: remote };
    } catch (e) { return null; }
  }
  var quotaSelectionsSig = "";
  function reportQuotaSelections() {
    if (stale()) return;
    var panes = {};
    for (var i = 0; i < instances.length; i++) {
      var selection = instances[i].getQuotaSelection && instances[i].getQuotaSelection();
      if (selection) panes[instances[i].pid] = selection;
    }
    var sig = JSON.stringify(panes);
    if (sig === quotaSelectionsSig) return;
    quotaSelectionsSig = sig;
    FATAL.quotaSelections = { time: new Date().toISOString(), panes: panes };
    var queue = window.__zusagePluginRequests || [];
    for (var j = queue.length - 1; j >= 0; j--) if (queue[j].action === "quota-providers") queue.splice(j, 1);
    pluginRequest("quota-providers", { panes: panes });
  }
  function refreshWants() {
    try {
      var arr = [], panes = {};
      mainScopeNow = { sid: "", identity: "", known: false };
      for (var i = 0; i < instances.length; i++) {
        var inst = instances[i], sid = inst.getSid();
        if (!sid) continue;
        if (arr.indexOf(sid) < 0) arr.push(sid);
        var scope = inst.getScope && inst.getScope();
        if (!scope || scope.sid !== sid) scope = null;
        panes[inst.pid] = scope ? { sid: sid, identity: scope.identity } : { sid: sid };
        if (inst.pid === "workspace-main") mainScopeNow = { sid: sid, identity: scope ? scope.identity : "", known: !!scope };
      }
      window.__zusageWantSids = arr;
      window.__zusageWantSid = arr[0] || "";
      window.__zusageSidWs = collectSidWs();
      window.__zusagePaneScopes = panes;
      publishGitPaths();
    } catch (e) { }
  }
  /* v96：Git chip 关注的本地工作区路径集 → window.__zusageGitPaths（主进程每 10s 取并集查询）。
   * identity 为空才是本地；远端 pane 不上报（主进程不替宿主跨机跑 git）；开关关闭为空集。
   * 每次 render 都经 refreshWants 到这里：路径集变化立即请求首查，否则按快照节奏节流重查
   * （快照到达 = 刚有请求落库，模型可能刚改过文件）。 */
  function publishGitPaths() {
    try {
      var gitPaths = [];
      if (state.show.git) for (var i = 0; i < instances.length; i++) {
        var inst = instances[i], sid = inst.getSid();
        var scope = sid && inst.getScope ? inst.getScope() : null;
        if (scope && scope.sid === sid && !scope.identity && gitPaths.indexOf(scope.workspacePath) < 0) gitPaths.push(scope.workspacePath);
      }
      var changed = JSON.stringify(gitPaths) !== JSON.stringify(window.__zusageGitPaths || []);
      window.__zusageGitPaths = gitPaths;
      askGitRefresh(changed);
    } catch (e) { }
  }

  /* ---------- 回复末尾速率行的悬停解释（v67）：给消息流里的统计行挂同款 tooltip ----------
   * 统计行是模型贴的 Markdown 引用块（⚡ … tok/s(本轮)），本身没有 hover 能力；
   * 浮层是注入 DOM 的，所以由它扫描消息流、给匹配节点挂自绘 tooltip（与状态条同套路：
   * 挂 body 的 fixed 浮层，免疫消息流层叠上下文）。document 级、只此一份，不随 pane 实例走。 */
  var rateTip = document.createElement("div");
  rateTip.className = "tip zusage-rate-tip";
  /* .tip 的类样式挂在条实例的 <style> 里（样式随条走）——本浮层是 document 级的，
   * 实例销毁/重建的间隙会失去类样式。内联关键属性兜底（值与 .tip 类一致，含主题 var），
   * 类样式在位时两者相同、不冲突；display 由 show/hide 控制。 */
  rateTip.style.cssText =
    "position:fixed;display:none;background:var(--color-tooltip,#171717);" +
    "border:1px solid var(--color-border,transparent);border-radius:10px;padding:10px 14px;" +
    "font-family:var(--font-mono,Consolas,'Microsoft YaHei UI',monospace);" +
    "font-size:calc(var(--ui-font-size,14px) - 1px);line-height:1.55;color:var(--color-tooltip-foreground,#fafafa);" +
    "box-shadow:0 10px 28px rgba(0,0,0,.5),0 2px 6px rgba(0,0,0,.3);" +
    "white-space:normal;z-index:2147483646;max-width:520px;box-sizing:border-box";
  document.body.appendChild(rateTip);
  var rateTipFor = null;
  /* 结构化内容：样式内嵌本浮层（选择器带 .zusage-rate-tip 前缀，随元素清理），
   * 不依赖条实例的 <style>；全部为静态双语文案，无任何插值。 */
  function rateTipHTML() {
    var row = function (label, text) {
      return '<div class="rt-row"><b>' + label + "</b><span>" + text + "</span></div>";
    };
    return '<style>.zusage-rate-tip .rt-h{font-weight:600;color:var(--color-tooltip-foreground,#fafafa);margin:0 0 7px}' +
      ".zusage-rate-tip .rt-row{display:flex;gap:10px;margin:3px 0}" +
      ".zusage-rate-tip .rt-row b{flex:0 0 auto;min-width:78px;color:var(--color-tooltip-foreground,#fafafa);font-weight:600}" +
      ".zusage-rate-tip .rt-row span{color:var(--color-tooltip-tag-foreground,#a6a6a6)}" +
      '.zusage-rate-tip .rt-note{margin-top:8px;padding-top:7px;border-top:1px solid var(--color-border,transparent);color:var(--color-tooltip-tag-foreground,#a6a6a6)}</style>' +
      '<div class="rt-h">⚡ ' + L("本问速率 · 各数值含义", "Rate line · what each figure means") + "</div>" +
      row("token/s", L("本问各段加权平均：总输出 ÷ 总生成时长，工具等待不计入", "weighted average of all segments: total output ÷ total generation time, tool waits excluded")) +
      row(L("首字", "TTFT"), L("第一段从发出请求到首个 token 的等待", "wait from request to the first token of the first segment")) +
      row(L("输出", "Output"), L("本问各段输出合计（思考 token 已含其中）", "sum of segment output (thinking tokens already included)")) +
      row(L("生成", "Gen"), L("各段生成窗口合计：含思考（含 Claude 这类不单独上报思考的模型）用 completed_at − started_at，否则用 completed_at − first_token_at；不含段间工具等待", "sum of segment generation windows: with thinking (including models such as Claude that don't report it separately) use completed_at − started_at, otherwise completed_at − first_token_at; tool waits between segments excluded")) +
      row(L("段 / 峰", "Seg/Peak"), L("段＝模型请求次数；峰＝最快一段的速率", "segments = model requests; peak = fastest segment")) +
      row(L("累计", "Session"), L("本会话已完成请求的输出总量（不含子代理）", "cumulative output of completed requests (sub-agents excluded)")) +
      row("⏱", L("采样时刻——写正文前自测，收尾正文段未计入", "sample time — self-tested before the final text, so that segment is excluded")) +
      '<div class="rt-note">' + L("状态条「生成速度」是最近一段的瞬时值，与本行的整问均值不同，数值有差异属正常。⚙ 设置可关。",
        "The bar's \"generation speed\" is the latest segment's instant value; this line is the whole-answer average — a difference is expected. Toggle in ⚙ settings.") + "</div>";
  }
  function showRateTip(el) {
    if (stale() || !state.rateLine || !isRateLine(el)) { hideRateTip(); return; }
    rateTip.innerHTML = rateTipHTML();
    rateTip.style.display = "block";
    var r = el.getBoundingClientRect(), tw = rateTip.offsetWidth, th = rateTip.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.max(8, Math.min(r.left, vw - tw - 8));
    var top = r.top - th - 8;               // 优先弹在统计行上方
    if (top < 8) top = Math.min(r.bottom + 8, vh - th - 8);   // 上方放不下改下方
    rateTip.style.left = Math.round(left) + "px";
    rateTip.style.top = Math.round(top) + "px";
    rateTipFor = el;
  }
  function hideRateTip() {
    rateTip.style.display = "none";
    rateTipFor = null;
  }

  /* ---------- v96 套餐额度 chip 的悬停说明：rateTip 同款 document 级独立浮层 ----------
   * chip 挂在宿主工具栏（条外），状态条 .it 的 tooltip 事件委托覆盖不到它；mouseenter/
   * leave 自管理，内容按 chip.__zuQ（render 时写入的最近快照）在悬停时即时生成。 */
  var quotaTip = document.createElement("div");
  quotaTip.className = "tip zusage-quota-tip";
  quotaTip.style.cssText = rateTip.style.cssText;
  document.body.appendChild(quotaTip);
  var quotaTipFor = null;
  function qTime(v) {   // 统一 yyyy-MM-dd HH:mm；接受毫秒数或 ISO 字符串
    if (v == null || v === "") return "";
    var d = typeof v === "number" ? new Date(v) : new Date(String(v));
    if (isNaN(d.getTime())) return "";
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function quotaFamilyOf(provider) {   // 内置套餐家族：OAuth 的 account:* 与 apiKey 模式的 bigmodel-api[-N] / zai-api[-N]
    var p = String(provider || "");
    if (p.indexOf("account:zai") === 0 || /^zai-api(-\d+)?$/.test(p)) return "zai";
    if (p.indexOf("account:bigmodel") === 0 || /^bigmodel-api(-\d+)?$/.test(p)) return "bigmodel";
    return "";
  }
  function quotaFamilyLabel(provider) { return quotaFamilyOf(provider) === "zai" ? "Z.ai" : "BigModel"; }
  function quotaLevelLabel(level) {
    var m = { max: "Max", pro: "Pro", lite: "Lite" };
    return m[String(level || "").toLowerCase()] || String(level || "");
  }
  function quotaStatusText(st) {
    return {
      auth_failed: L("认证失效：重新登录 ZCode 后自动恢复", "Authentication failed: recovers after signing in to ZCode again"),
      rate_limited: L("接口限流，稍后自动重试", "Rate limited; retrying later"),
      network_error: L("网络错误，稍后自动重试", "Network error; retrying later"),
      parse_error: L("接口返回格式变化，已降低查询频率", "Unexpected response format; polling slowed down"),
      no_plan: L("当前账号未订阅编码套餐", "No coding plan on this account"),
    }[st] || "";
  }
  function quotaTipHTML(d) {
    var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var row = function (label, text) { return '<div class="qt-row"><b>' + label + "</b><span>" + text + "</span></div>"; };
    var css = '<style>.zusage-quota-tip .qt-h{font-weight:600;color:var(--color-tooltip-foreground,#fafafa);margin:0 0 7px}' +
      ".zusage-quota-tip .qt-row{display:flex;gap:10px;margin:3px 0}" +
      ".zusage-quota-tip .qt-row b{flex:0 0 auto;min-width:78px;color:var(--color-tooltip-foreground,#fafafa);font-weight:600}" +
      ".zusage-quota-tip .qt-row span{color:var(--color-tooltip-tag-foreground,#a6a6a6)}" +
      ".zusage-quota-tip .qt-cur{color:var(--color-tooltip-foreground,#fafafa);font-weight:600}" +
      ".zusage-quota-tip .qt-warn{color:#f5b944}" +
      '.zusage-quota-tip .qt-note{margin-top:8px;padding-top:7px;border-top:1px solid var(--color-border,transparent);color:var(--color-tooltip-tag-foreground,#a6a6a6)}</style>';
    if (d.mode.kind === "team") {
      return css + '<div class="qt-h">⊘ ' + L("团队套餐额度", "Team plan quota") + "</div>" +
        '<div class="qt-note">' + L("团队套餐需要组织/项目维度的查询，当前版本暂不支持；个人编码套餐已支持。", "Team plans need organization/project-scoped queries, which this version does not support yet; individual coding plans are supported.") + "</div>";
    }
    var q = d.q || {};
    var isBalance = d.mode.kind === "balance";
    var title = isBalance ? L("账户余额", "Account balance") : L("套餐额度", "Plan quota");
    /* 标题：有订阅元数据（productName/version/valid）时拼成一行；缺失回退 family+档位 */
    var pl = q.plan;
    /* 周期标签：renewAt=自动续费的下次扣费日（不是最终到期，宿主同款互斥语义）；
     * validEnd=非自动续费的当前权益结束日；两者都缺（周期无法确认）只显示套餐名。 */
    var periodLabel = pl && pl.renewAt
      ? L(" · 下次续费 ", " · renews ") + esc(pl.renewAt)
      : pl && pl.validEnd ? L(" · 有效期至 ", " · valid until ") + esc(pl.validEnd) : "";
    var head = (pl && (pl.productName || pl.version))
      ? [pl.productName, pl.version].filter(Boolean).map(esc).join(" · ") + periodLabel
      : esc(q.label || (String(d.provider || "").indexOf("account:") === 0 || quotaFamilyOf(d.provider) ? quotaFamilyLabel(d.provider) : L("自定义供应商", "Custom provider"))) +
        (q.level ? " " + esc(quotaLevelLabel(q.level)) : "");
    var out = css + '<div class="qt-h">' + title + " · " + head + "</div>";
    var w = q.windows || {};
    var winRow = function (label, e) {
      if (!e) return "";
      var pct = typeof e.percent === "number" ? (Math.round(e.percent * 10) / 10) + "%" : "—";
      var rs = qTime(e.resetsAt);
      var detail = (e.used != null && e.total != null && e.remaining != null)
        ? " · " + quotaBalanceText({ amount: e.used, currency: e.currency }) + " / " +
          quotaBalanceText({ amount: e.total, currency: e.currency }) + " · " + L("剩余 ", "remaining ") +
          quotaBalanceText({ amount: e.remaining, currency: e.currency })
        : "";   // sub2api 等带金额明细的窗口拼进行内；BigModel 套餐窗只有百分比则不拼
      return row(label, L("已用 ", "used ") + pct + detail + (rs ? " · " + L("重置 ", "resets ") + rs : ""));
    };
    out += winRow(L("每日窗口", "Daily window"), w.daily) + winRow(L("5小时窗口", "5-hour window"), w.fiveHour) +
      winRow(L("本周窗口", "This week"), w.weekly) + winRow(L("月度窗口", "Monthly"), w.monthly);
    if (q.quotaSummary) {
      var summary = q.quotaSummary;
      out += row(L("Key 总额度", "Key quota"), L("已用 ", "used ") +
        quotaBalanceText({ amount: summary.used, currency: summary.currency }) + " / " +
        quotaBalanceText({ amount: summary.limit, currency: summary.currency }) + " · " + L("剩余 ", "remaining ") +
        quotaBalanceText({ amount: summary.remaining, currency: summary.currency }));
    }
    if (q.subscription && q.subscription.expiresAt) {
      out += row(L("订阅截止", "Subscription ends"), esc(q.subscription.expiresAt));
    }
    if (q.balance && typeof q.balance.amount === "number" && isFinite(q.balance.amount)) {
      var balTxt = quotaBalanceText(q.balance);
      if (q.balance.parts && q.balance.parts.length) {
        balTxt += "（" + q.balance.parts.map(function (pp) { return esc(pp.label) + " " + pp.amount; }).join(" / ") + "）";
      }
      out += row(L("余额", "Balance"), esc(balTxt));
    }
    if (d.all && d.all.sources && typeof d.all.sources === "object") {   // 其余启用源的摘要（tooltip 分家列全）
      var others = [];
      for (var sid in d.all.sources) {
        if (!Object.prototype.hasOwnProperty.call(d.all.sources, sid) || sid === d.all.active) continue;
        var sv = d.all.sources[sid];
        if (!sv || sv.status !== "ok") continue;
        var sum = sv.balance && typeof sv.balance.amount === "number" ? quotaBalanceText(sv.balance)
          : (sv.windows ? ["fiveHour", "weekly", "monthly"].map(function (k) {
              return sv.windows[k] && typeof sv.windows[k].percent === "number" ? Math.round(sv.windows[k].percent) + "%" : null;
            }).filter(Boolean).join(" ") : "✓");
        others.push((d.srcLabels && d.srcLabels[sid] || sid) + " " + sum);
      }
      if (others.length) out += row(L("其他源", "Other sources"), esc(others.join(" · ")));
    }
    if (q.tools && (q.tools.total != null || q.tools.used != null)) {
      var tr = qTime(q.tools.resetsAt);
      out += row(L("内置工具", "Built-in tools"), (q.tools.used == null ? "—" : q.tools.used) + " / " + (q.tools.total == null ? "—" : q.tools.total) +
        L(" 次", " calls") + (tr ? " · " + L("重置 ", "resets ") + tr : ""));
    }
    var models = Array.isArray(q.models) ? q.models : [], cur = String(d.model || "");
    var scope = models.length
      ? models.map(function (m) { return String(m).toLowerCase() === cur.toLowerCase() ? '<span class="qt-cur">' + esc(m) + "</span>" : esc(m); }).join(", ")
      : L("套餐内全部模型", "all models in the plan") + (cur ? L("（当前 ", " (current ") + '<span class="qt-cur">' + esc(cur) + "</span>" + L("）", ")") : "");
    if (isBalance) out += row(L("当前模型", "Current model"), esc(cur || "—"));
    else out += row(L("覆盖范围", "Covers"), scope);
    var foot = (q.fetchedAt ? L("更新于 ", "updated ") + qTime(q.fetchedAt) : "") + (q.stale ? L("（已过期，等待刷新）", " (stale, refreshing)") : "");
    var err = q.status && q.status !== "ok" && q.status !== "idle" ? quotaStatusText(q.status) : "";
    if (err) foot += (foot ? " · " : "") + '<span class="qt-warn">⚠ ' + err + "</span>";
    out += '<div class="qt-note">' + (foot ? foot + "<br>" : "") +
      (isBalance
        ? L("余额属于当前供应商账号或 API Key，不是单模型独享。点击 chip 立即刷新。", "Balance belongs to the provider account or API key, not one model. Click the chip to refresh.")
        : L("套餐池为账号级：同账号所有模型共用，不是单个模型独享。点击 chip 立即刷新。", "The pool is account-level: shared by every model on this account, not per model. Click the chip to refresh.")) + "</div>";
    return out;
  }
  function showQuotaTip(el) {
    if (stale() || !el || !el.isConnected || !el.__zuQ) { hideQuotaTip(); return; }
    quotaTip.innerHTML = quotaTipHTML(el.__zuQ);
    quotaTip.style.display = "block";
    var r = el.getBoundingClientRect(), tw = quotaTip.offsetWidth, th = quotaTip.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.max(8, Math.min(r.left, vw - tw - 8));
    var top = r.top - th - 8;               // 优先弹在 chip 上方
    if (top < 8) top = Math.min(r.bottom + 8, vh - th - 8);
    quotaTip.style.left = Math.round(left) + "px";
    quotaTip.style.top = Math.round(top) + "px";
    quotaTipFor = el;
  }
  function hideQuotaTip() {
    quotaTip.style.display = "none";
    quotaTipFor = null;
  }
  function onQuotaEnter() { showQuotaTip(this); }
  /* 余额文本（文档级：tooltip 与实例 chip 共用）。CNY→¥、USD→$，其它带代码前缀。 */
  function quotaBalanceText(bal) {
    var cur = String(bal.currency || "");
    var sym = cur === "CNY" ? "¥" : cur === "USD" ? "$" : (cur ? cur + " " : "");
    return sym + Number(bal.amount).toFixed(2);
  }
  /* 客户端会过滤回复 HTML 的 style/class；提醒先用 Markdown 加粗，加载浮层后再着色。 */
  var noticeStyle = document.createElement("style");
  noticeStyle.textContent = '[data-zusage-notice="' + MY_GEN + '"], [data-zusage-notice="' + MY_GEN + '"] * {' +
    "color:#ef4444!important;font-weight:700!important}";
  document.body.appendChild(noticeStyle);
  var noticeNodes = [];
  function isPluginNotice(el) {
    var parent = el.parentElement;
    return document.body.contains(el) && parent && /^(P|BLOCKQUOTE)$/.test(parent.tagName) &&
      (el.textContent || "").trim().indexOf("🔴 zcode-token-usage-statusbar 插件提醒：") === 0 &&
      (parent.textContent || "").trim() === (el.textContent || "").trim() &&
      el.closest('blockquote') && el.closest('[class~="group/assistant-row"]') &&
      !el.closest('pre, code, [data-v4-user-input-bubble], [data-markdown-preview], .zusage-root, .zusage-rate-tip');
  }
  function clearNotice(el) {
    if (el.dataset.zusageNotice === String(MY_GEN)) delete el.dataset.zusageNotice;
  }
  function scanPluginNotices() {
    noticeNodes = noticeNodes.filter(function (el) {
      if (isPluginNotice(el)) return true;
      clearNotice(el);
      return false;
    });
    document.querySelectorAll("blockquote strong").forEach(function (el) {
      if (el.dataset.zusageNotice === String(MY_GEN) || !isPluginNotice(el)) return;
      el.dataset.zusageNotice = String(MY_GEN);
      noticeNodes.push(el);
    });
  }
  var rateBindings = [];
  function isRateLine(el) {
    var t = el.textContent || "";
    /* 「tok/s(本轮)」是 v85 前的旧标记：模型时代贴进历史的行与升级前已缓存的富文本仍带它 */
    return document.body.contains(el) && (t.indexOf("token/s(本轮)") >= 0 || t.indexOf("tok/s(本轮)") >= 0) && t.indexOf("⚡") >= 0 &&
      !(el.tagName === "BLOCKQUOTE" && el.querySelector("p"));
  }
  function unbindRateLine(binding) {
    var el = binding.el;
    el.removeEventListener("mouseenter", onRateEnter);
    el.removeEventListener("mouseleave", hideRateTip);
    if (el.dataset.zusageRateTip === String(MY_GEN)) delete el.dataset.zusageRateTip;
    if (el.style.cursor === "help") el.style.cursor = binding.cursor;
  }
  function onRateEnter() { showRateTip(this); }
  function scanRateLines() {
    if (stale()) { cleanupRateTip(); return; }
    /* chip 随宿主重建被替换时浏览器不发 mouseleave，tooltip 会悬挂；豁免滚动收起（v106）
     * 后此处是 detach 场景的兜底健康检查（500ms 周期，与速率行扫描共用足迹） */
    if (quotaTipFor && !quotaTipFor.isConnected) hideQuotaTip();
    scanPluginNotices();
    rateBindings = rateBindings.filter(function (binding) {
      if (state.rateLine && isRateLine(binding.el)) return true;
      unbindRateLine(binding);
      return false;
    });
    if (!state.rateLine) { hideRateTip(); return; }
    var nodes = document.querySelectorAll("blockquote p, blockquote, p");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.dataset.zusageRateTip === String(MY_GEN) || !isRateLine(el)) continue;
      rateBindings.push({ el: el, cursor: el.style.cursor });
      el.dataset.zusageRateTip = String(MY_GEN);
      el.style.cursor = "help";
      el.addEventListener("mouseenter", onRateEnter);
      el.addEventListener("mouseleave", hideRateTip);
    }
    if (rateTipFor && !isRateLine(rateTipFor)) hideRateTip();
  }
  function cleanupRateTip() {
    clearInterval(rateScanTimer);
    rateBindings.forEach(unbindRateLine);
    rateBindings = [];
    noticeNodes.forEach(clearNotice);
    noticeNodes = [];
    noticeStyle.remove();
    hideRateTip();
    rateTip.remove();
    hideQuotaTip();
    quotaTip.remove();
    window.removeEventListener("scroll", hideTipsOnScroll, true);
    if (window.__zusageRateCleanup === cleanupRateTip) delete window.__zusageRateCleanup;
  }
  /* 捕获：任意容器滚动即收——仅速率行浮层需要（宿主在消息流正文内，滚动即移位，fixed 浮层
   * 不跟随即指向错误位置）。额度 chip 与 git chip 同款固定在 composer 工具行，消息流滚动
   * 不移动它，豁免（v106）：思考中流式输出驱动聊天容器持续自动滚动，若一并收起则 tooltip
   * 悬停弹出即灭。quotaTip 由 mouseleave/blur/代际清理/开关关闭收起；chip 随宿主重建被
   * 替换（无 mouseleave）由 scanRateLines 的 isConnected 健康检查兜底。 */
  function hideTipsOnScroll() { hideRateTip(); }
  window.addEventListener("scroll", hideTipsOnScroll, true);
  /* v88：扫描与心跳统一 0.5s（用户要求计时 0.5s 步进；富文本重试上限同步放大保持 ~12s 等库窗口） */
  var rateScanTimer = setInterval(scanRateLines, 500);
  window.__zusageRateCleanup = cleanupRateTip;
  scanRateLines();

  /* ---------- Git chip 的悬停说明（v96）：document 级单例，同 rateTip 套路（挂 body、内联兜底样式） ----------
   * 内容按 chip.__zuGit（{path, st, stale}）渲染；分支名/上游/路径是用户数据，一律过 gitEsc。 */
  var gitTip = document.createElement("div");
  gitTip.className = "tip zusage-git-tip";
  gitTip.style.cssText = rateTip.style.cssText;
  document.body.appendChild(gitTip);
  var gitTipFor = null;
  function gitEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function gitTimeStr(ts) {   // yyyy-MM-dd HH:mm:ss（与额度 chip 的 tooltip 时间格式约定一致，用户要求带秒）
    try {
      var t = new Date(ts), p = function (n) { return ("0" + n).slice(-2); };
      return t.getFullYear() + "-" + p(t.getMonth() + 1) + "-" + p(t.getDate()) + " " + p(t.getHours()) + ":" + p(t.getMinutes()) + ":" + p(t.getSeconds());
    } catch (e) { return ""; }
  }
  /* 进行中 Git 操作的展示名（主进程 fs 探针 detectGitOp 的代码 → 双语标签；am 主栏短标签「补丁」） */
  var GIT_OP_LABELS = { rebase: ["变基", "rebase"], merge: ["合并", "merge"], "cherry-pick": ["拣选", "cherry-pick"], revert: ["还原", "revert"], bisect: ["二分", "bisect"], am: ["补丁", "patch"] };
  function gitOpLabel(code) { var m = GIT_OP_LABELS[code]; return m ? L(m[0], m[1]) : code; }
  /* v96 multi：多仓库聚合口径（chip/aria/tooltip 共用）——总数、脏仓数（成功仓 changed>0 或
   * untracked>0）、改动/未跟踪文件求和、失败仓数、任一成功仓有冲突；聚合数由渲染端算，主进程不提供。 */
  function gitMultiAgg(st) {
    var repos = st && Array.isArray(st.repos) ? st.repos : [];
    /* known=已确认仓库（成功或携带旧快照的失败仓）；changed/conflict/op 只在确认数据上统计；
     * 旧缓存（stale）里的冲突不汇总为已确认冲突，但其改动计入已知改动。 */
    var agg = { total: repos.length, known: 0, changed: 0, conflict: 0, op: 0, failed: 0, staleAny: false, m: 0, q: 0 };
    for (var i = 0; i < repos.length; i++) {
      var r = repos[i];
      if (r.err) {
        agg.failed++;
        if (r.stale) {
          agg.known++; agg.staleAny = true;
          if ((r.changed | 0) > 0 || (r.untracked | 0) > 0) agg.changed++;
        }
        continue;
      }
      agg.known++;
      if (r.stale) agg.staleAny = true;
      if ((r.changed | 0) > 0 || (r.untracked | 0) > 0) agg.changed++;
      if ((r.conflicts | 0) > 0 && !r.stale) agg.conflict++;
      if (r.op && !r.stale) agg.op++;
      agg.m += r.changed | 0;
      agg.q += r.untracked | 0;
    }
    return agg;
  }
  /* tooltip 行样式单/多仓共用：rt-row 补 min-width:0 允许 flex 行收缩防长仓库名溢出；
   * zu-gname=多仓行仓库名（可收缩断行，main 前景色 600 字重），zu-gconf=冲突红，
   * c-mod/c-unt=已跟踪变更/未跟踪（黄），c-warn=失败/过期/未知（黄），c-op=操作名（中性），
   * zu-git-rows=多仓逐仓列表滚动容器；data-zusage-light 切浅色语义档（showGitTip 随 chip 同步）。 */
  var GIT_TIP_CSS = '<style>.zusage-git-tip .rt-h{font-weight:600;color:var(--color-tooltip-foreground,#e6e6e6);margin:0 0 7px}' +
    ".zusage-git-tip .rt-row{display:flex;gap:10px;margin:3px 0;min-width:0}" +
    ".zusage-git-tip .rt-row b{flex:0 0 auto;min-width:78px;color:var(--color-tooltip-foreground,#e6e6e6);font-weight:600}" +
    ".zusage-git-tip .rt-row span{color:var(--color-tooltip-tag-foreground,#a6a6a6);word-break:break-all}" +
    ".zusage-git-tip b.zu-gname{flex:0 1 auto;min-width:0;word-break:break-all;font-weight:600}" +
    ".zusage-git-tip .zu-gbr{color:var(--color-tooltip-tag-foreground,#afafb2)}" +
    ".zusage-git-tip .c-mod,.zusage-git-tip .c-unt,.zusage-git-tip .c-warn{color:#f0e6a0}" +
    ".zusage-git-tip .zu-gconf{color:#f09696}" +
    ".zusage-git-tip .c-op{color:var(--color-tooltip-tag-foreground,#afafb2)}" +
    ".zusage-git-tip .zu-gsep{opacity:.6}" +
    ".zusage-git-tip .zu-gdiv{color:var(--color-tooltip-tag-foreground,#afafb2);opacity:.85}" +
    ".zusage-git-tip .zu-git-rows{max-height:60vh;overflow-y:auto;overscroll-behavior:contain}" +
    ".zusage-git-tip[data-zusage-light] .rt-h,.zusage-git-tip[data-zusage-light] .rt-row b,.zusage-git-tip[data-zusage-light] b.zu-gname{color:var(--color-tooltip-foreground,#2e3440)}" +
    ".zusage-git-tip[data-zusage-light] .c-mod,.zusage-git-tip[data-zusage-light] .c-unt,.zusage-git-tip[data-zusage-light] .c-warn{color:#946200}" +
    ".zusage-git-tip[data-zusage-light] .zu-gconf{color:#d20f39}" +
    '.zusage-git-tip .rt-note{margin-top:8px;padding-top:7px;border-top:1px solid var(--color-border,transparent);color:var(--color-tooltip-tag-foreground,#afafb2)}</style>';
  function gitTipHTML(view) {
    if (view.st.kind === "multi") return gitMultiTipHTML(view);
    var st = view.st, row = function (label, text) { return '<div class="rt-row"><b>' + label + "</b><span>" + text + "</span></div>"; };
    var items = function (n) { return n + L(" 项", n === 1 ? " entry" : " entries"); };   // porcelain 条目：重命名计 1、未跟踪目录折叠计 1，不冒充文件数
    var up = st.upstream ? gitEsc(st.upstream) + (st.ahead > 0 ? " ↑" + st.ahead : "") + (st.behind > 0 ? " ↓" + st.behind : "") : L("未设置上游分支（↑↓ 不可用）", "no upstream set (ahead/behind unavailable)");
    var when = gitTimeStr(st.ts);
    return GIT_TIP_CSS +
      '<div class="rt-h">⎇ ' + L("Git 状态", "Git status") + (view.stale ? ' <span class="c-warn">' + L("· 上次查询失败，显示的是最近成功结果", "· last query failed; showing the last good result") + "</span>" : "") + "</div>" +
      row(L("分支", "Branch"), st.detached ? L("游离 HEAD（不在任何分支上）", "detached HEAD (on no branch)") : gitEsc(st.branch || "") + (st.noCommits ? L("（尚无首次提交）", " (no initial commit yet)") : "")) +
      row(L("上游", "Upstream"), up) +
      row(L("已暂存", "Staged"), items(st.staged)) +
      row(L("未暂存", "Unstaged"), items(st.unstaged)) +
      row(L("未跟踪", "Untracked"), items(st.untracked) + L("（目录折叠计 1）", " (collapsed dirs count as 1)")) +
      (st.conflicts > 0 ? row(L("冲突", "Conflicts"), '<span class="zu-gconf">!' + items(st.conflicts) + "</span>") : "") +
      (st.op ? row(L("进行中操作", "Git operation"), gitEsc(gitOpLabel(st.op))) : "") +
      row(L("改动行数", "Diff lines"), "+" + st.ins + " / -" + st.del + L(" 行（工作区相对 HEAD 的合计口径，非净差异）", " lines (worktree vs HEAD, combined—not a net diff)")) +
      row(L("目录", "Directory"), gitEsc(st.repoPath || view.path)) +   // v96：repoPath=真实仓库绝对路径，缺省回退工作区路径
      (when ? row(L("更新于", "Updated"), when) : "") +
      '<div class="rt-note">' + L("只读本地仓库，不自动 fetch（上游比较基于本地引用）；远端会话不显示。⚙ 设置可关。",
        "Local repositories read-only, never auto-fetches (upstream compares against local refs); hidden for remote sessions. Toggle in ⚙ settings.") + "</div>";
  }
  /* v96 multi tooltip：概览（标题 / 有改动仓库与非零冲突·操作·失败 / 覆盖行）→ 逐仓全量列表
   * （优先级：冲突 0 < 失败或过期 1 < 操作中 2 < 有改动 3 < 上游差异 4 < 干净 5；同级码点序，
   * 不用 localeCompare；干净组前插分隔行，所有行都在滚动容器内可访问）→ 元信息（工作目录 /
   * 更新时间 / 口径）。失败仓携带的旧快照标「过期」，其冲突不汇总为已确认。仓库名/分支/路径
   * 是用户数据，一律过 gitEsc/属性转义。 */
  function gitMultiTipHTML(view) {
    var st = view.st, agg = gitMultiAgg(st);
    var row = function (label, text) { return '<div class="rt-row"><b>' + label + "</b><span>" + text + "</span></div>"; };
    var attr = function (s) { return gitEsc(s).replace(/"/g, "&quot;"); };   // title 属性需转义引号
    var rrow = function (name, text, title) { return '<div class="rt-row"><b class="zu-gname"' + (title ? ' title="' + title + '"' : "") + ">" + name + '</b><span>' + text + "</span></div>"; };
    var rank = function (r) {
      if (r.err || r.stale) return 1;
      if ((r.conflicts | 0) > 0) return 0;
      if (r.op) return 2;
      if ((r.changed | 0) > 0 || (r.untracked | 0) > 0) return 3;
      if ((r.ahead | 0) > 0 || (r.behind | 0) > 0) return 4;
      return 5;
    };
    var repos = (st.repos || []).slice();   // 排序不动主进程推送的原数组；与 gitMultiAgg 同款防御
    repos.sort(function (a, b) { var ra = rank(a), rb = rank(b); return ra !== rb ? ra - rb : a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    var h = GIT_TIP_CSS + '<div class="rt-h">⎇ ' + L("Git 状态", "Git status") + L(" · " + agg.total + " 个仓库", " · " + agg.total + " repos") + "</div>";
    var ov = L("有改动 <b class=\"c-mod\">" + agg.changed + "</b> 个仓库", "<b class=\"c-mod\">" + agg.changed + "</b> repos with changes");
    if (agg.conflict > 0) ov += '<span class="zu-gsep"> · </span><span><b class="zu-gconf">!' + agg.conflict + '</b>' + L(" 个仓库冲突", " repos conflicted") + "</span>";
    if (agg.op > 0) ov += '<span class="zu-gsep"> · </span><span><b class="c-op">' + agg.op + '</b>' + L(" 个仓库操作中", " repos mid-operation") + "</span>";
    if (agg.failed > 0) ov += '<span class="zu-gsep"> · </span><span><b class="c-warn">' + agg.failed + '</b>' + L(" 个查询失败", " failed") + "</span>";
    if (view.stale) ov += '<span class="zu-gsep"> · </span><span class="c-warn">' + L("上次查询失败，显示的是最近成功结果", "last query failed; showing the last good result") + "</span>";
    h += '<div class="rt-ov">' + ov + "</div>";
    if (agg.m > 0 || agg.q > 0) {
      var sm = [];
      if (agg.m > 0) sm.push(L("已跟踪变更 <b class=\"c-mod\">" + agg.m + "</b> 项", "<b class=\"c-mod\">" + agg.m + "</b> tracked-change entries"));
      if (agg.q > 0) sm.push(L("未跟踪 <b class=\"c-unt\">" + agg.q + "</b> 项", "<b class=\"c-unt\">" + agg.q + "</b> untracked entries"));
      h += '<div class="rt-ov">' + sm.join('<span class="zu-gsep"> · </span>') + "</div>";
    }
    if (agg.known < agg.total) h += '<div class="rt-ov"><span class="c-warn">' + L("已确认 " + agg.known + "/" + agg.total + " 个仓库", "Confirmed " + agg.known + "/" + agg.total + " repos") + (agg.failed ? " · " + L(agg.failed + " 个查询失败", agg.failed + " failed") : "") + "</span></div>";
    var cleanTotal = 0, focused = 0, divDone = false, rows = "";
    for (var i = 0; i < repos.length; i++) { if (rank(repos[i]) === 5) cleanTotal++; else focused++; }
    for (var j = 0; j < repos.length; j++) {
      var r = repos[j], rk = rank(r);
      if (rk === 5 && focused > 0 && cleanTotal > 0 && !divDone) {   // 干净组分隔行（其余仓仍全部可访问）
        rows += '<div class="rt-row zu-gdiv"><span>' + L("其余 " + cleanTotal + " 个仓库，无本地改动", cleanTotal + " more repos with no local changes") + "</span></div>";
        divDone = true;
      }
      if (r.err) {
        var msg = { notrepo: L("非 Git 仓库", "not a git repository"), nogit: L("未找到 git", "git not found"), timeout: L("超时", "timed out"), error: L("出错", "error") }[r.err] || r.err;
        var t = '<span class="c-warn">⚠ ' + L("查询失败", "query failed") + "（" + gitEsc(msg) + "）</span>";
        if (r.stale) {   // 携带旧快照：标注历史属性并展示上次分支与改动（旧冲突不作已确认，不在此渲染）
          t += ' <span class="c-warn">' + L("过期；以下为上次结果", "stale; showing last good result") + "</span>";
          if (r.branch) t += ' <span class="zu-gbr">' + gitEsc(r.branch) + "</span>";
          if ((r.changed | 0) > 0) t += ' <span class="c-mod">' + L("改 " + r.changed + " 项", r.changed + " mod") + "</span>";
          if ((r.untracked | 0) > 0) t += ' <span class="c-unt">' + L("新 " + r.untracked + " 项", r.untracked + " new") + "</span>";
        }
        rows += rrow(gitEsc(r.name), t, attr(r.path));
        continue;
      }
      var seg = '<span class="zu-gbr">' + (r.detached ? L("HEAD（游离）", "HEAD (detached)") : gitEsc(r.branch || (r.noCommits ? L("初始", "init") : ""))) + (r.noCommits && !r.detached ? L("（尚无首次提交）", " (no initial commit yet)") : "") + "</span>";
      if (r.op && !r.stale) seg += ' <span class="c-op">' + gitEsc(gitOpLabel(r.op)) + "</span>";
      if (r.stale) seg += ' <span class="c-warn">' + L("过期", "stale") + "</span>";
      if ((r.conflicts | 0) > 0) seg += ' <span class="zu-gconf">!' + r.conflicts + L(" 冲突", " conflicted") + "</span>";
      if ((r.changed | 0) > 0) seg += ' <span class="c-mod">' + L("改 " + r.changed + " 项", r.changed + " mod") + "</span>";
      if ((r.untracked | 0) > 0) seg += ' <span class="c-unt">' + L("新 " + r.untracked + " 项", r.untracked + " new") + "</span>";
      if ((r.ahead | 0) > 0) seg += " ↑" + r.ahead;
      if ((r.behind | 0) > 0) seg += " ↓" + r.behind;
      rows += rrow(gitEsc(r.name), seg, attr(r.path));   // title=完整路径（宿主原生提示可访问完整值）
    }
    if (st.more > 0) rows += '<div class="rt-row"><span class="zu-gmore">' + L("另有 " + st.more + " 个子仓库未统计", st.more + " more repos not scanned") + "</span></div>";
    h += '<div class="zu-git-rows">' + rows + "</div>";
    h += row(L("工作目录", "Work dir"), gitEsc(view.path) + L("，下含 " + agg.total + " 个仓库", " · " + agg.total + " repos"));
    var when = gitTimeStr(st.ts);
    h += when ? row(L("更新于", "Updated"), when + L(" · 每 10 秒及每轮回复后自动刷新，点击 chip 立即刷新", " · auto-refreshes every 10s and after each reply; click chip to refresh now")) : "";
    return h + '<div class="rt-note">' + L("口径：改=已跟踪变更条目（含增删改名与冲突文件），新=未跟踪条目（目录折叠计 1，文件与目录混合计数）。仓库列表全量展开，超出屏幕可滚动。",
      "Units: mod = tracked-change entries (add/delete/rename/conflict), new = untracked entries (collapsed dirs count as 1). The repo list is fully expanded and scrolls when taller than the screen.") + "</div>";
  }
  function showGitTip(chip) {
    var view = chip && chip.__zuGit;
    if (stale() || !view || !chip.isConnected) { hideGitTip(); return; }
    /* 内容签名不变就跳过重建：enhanceGitChip 每 600ms 对账、每次推送都会走到这里，
     * 无条件重写 innerHTML 会打断滚动条拖拽并与滚轮滚动互抢（卡顿根因）；数据本身
     * 10 秒才变一次， hover 期间几乎总是跳过。浅色档与位置每帧照常同步。 */
    var html = gitTipHTML(view);
    if (gitTip.__zuTipSig !== html) {
      var keep = 0;   // 重建时保持列表滚动位置（不重置阅读位置）
      if (gitTipFor === chip) { try { var prevRows = gitTip.querySelector(".zu-git-rows"); if (prevRows) keep = prevRows.scrollTop; } catch (e) { } }
      gitTip.innerHTML = html;
      gitTip.__zuTipSig = html;
      try { var rowsEl = gitTip.querySelector(".zu-git-rows"); if (rowsEl && keep) rowsEl.scrollTop = keep; } catch (e) { }
    }
    if (chip.getAttribute("data-zusage-light") === "1") gitTip.setAttribute("data-zusage-light", "1");   // 语义色浅色档随 chip 主题（与内容无关，每次同步）
    else gitTip.removeAttribute("data-zusage-light");
    gitTip.style.display = "block";
    var r = chip.getBoundingClientRect(), tw = gitTip.offsetWidth, th = gitTip.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.max(8, Math.min(r.left, vw - tw - 8));
    var top = r.top - th - 8;   // 优先弹在 chip 上方（工具行贴窗口底部）
    if (top < 8) top = Math.min(r.bottom + 8, vh - th - 8);
    gitTip.style.left = Math.round(left) + "px";
    gitTip.style.top = Math.round(top) + "px";
    gitTipFor = chip;
  }
  function hideGitTip() {
    clearTimeout(gitTipHideTimer);
    gitTip.style.display = "none";
    gitTipFor = null;
  }
  /* 鼠标从 chip 移入 tooltip 的宽限桥：延迟收起，移入即取消（支持移入悬浮内容继续阅读）；
   * Esc 关闭后 gitTipFor 已空，普通数据刷新不会重新弹出（只有再次悬停 chip 才会）。 */
  var gitTipHideTimer = 0;
  function hideGitTipSoon() { clearTimeout(gitTipHideTimer); gitTipHideTimer = setTimeout(hideGitTip, 200); }
  function onGitTipEnter() { clearTimeout(gitTipHideTimer); }
  function onGitKeydown(e) { if (e && e.key === "Escape") hideGitTip(); }
  window.addEventListener("keydown", onGitKeydown, true);
  gitTip.addEventListener("mouseenter", onGitTipEnter);
  gitTip.addEventListener("mouseleave", hideGitTip);
  /* chip 固定在 composer 工具行，消息流滚动不移动它，无需 rateTip 那样的 scroll 收起；离开/失焦即收 */
  function cleanupGitTip() {
    window.removeEventListener("keydown", onGitKeydown, true);
    clearTimeout(gitTipHideTimer);
    hideGitTip();
    gitTip.remove();
  }

  /* ---------- renderer 会话 store 桥（v71）：实时统计 + 确定性历史行 ----------
   * 只读桥由 renderer 侧资产注入：__zusageGetExistingConversationStore(scope) 返回
   * {getState,subscribe,off}|null；__zusageConversationDiagnostics() 枚举存活 registry
   * （sessions[].key = "<remoteSessionId> <workspace>"，topic = "conversation/<sid>"）。
   * 统计内核在 turn-stats.js（先于本文件注入，globalThis.ZUsageTurnStats）。
   * API 缺失 / 无匹配 session / 无内核：整体降级为 DB 轮询路径（悬浮条行为不变）。 */
  var TURN_STATS = null;   // 注入序保证先于本文件；缺失即禁用桥功能
  try { TURN_STATS = window.ZUsageTurnStats || globalThis.ZUsageTurnStats || null; } catch (e) { }
  function zuBridgeApi() {
    try {
      var diag = window.__zusageConversationDiagnostics, get = window.__zusageGetExistingConversationStore;
      if (typeof diag !== "function" || typeof get !== "function") return null;
      return { diag: diag, get: get };
    } catch (e) { return null; }
  }
  /* scope 的 workspace 半边从 diagnostics 的 key 解析（renderer_live_check 实测格式：
   * "<remote> <workspace>"，本地会话 remote="__base__"）。workspacePath / workspaceIdentity
   * 两种键各试一次，命中即返回 store。 */
  function zuTryBindStore(sid) {
    var api = zuBridgeApi();
    if (!api || !sid) return null;
    var diag = null;
    try { diag = api.diag(); } catch (e) { return null; }
    var sessions = (diag && diag.sessions) || [];
    var topic = "conversation/" + sid;
    for (var i = 0; i < sessions.length; i++) {
      var entry = sessions[i];
      if (!entry || entry.topic !== topic) continue;
      var key = String(entry.key || ""), sp = key.indexOf(" ");
      if (sp < 0) continue;
      var remote = key.slice(0, sp), workspace = key.slice(sp + 1);
      if (!remote || !workspace.trim()) continue;
      var scopes = remote === "__base__"
        ? [{ sessionId: sid, workspacePath: workspace }, { sessionId: sid, workspaceIdentity: workspace }]
        : [{ sessionId: sid, workspacePath: workspace, remoteSessionId: remote },
           { sessionId: sid, workspaceIdentity: workspace, remoteSessionId: remote }];
      for (var j = 0; j < scopes.length; j++) {
        try { var store = api.get(scopes[j]); if (store) return store; } catch (e) { }
      }
    }
    return null;
  }
  /* 活跃 turn：快照窗口里最后一个 turnHeader（key 与 turn-stats 一致 = productTurnId 优先） */
  function zuActiveTurnId(snap) {
    var rows = snap && snap.rows && snap.rows.window;
    if (!Array.isArray(rows)) return "";
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      if (r && r.kind === "turnHeader" && typeof r.turnId === "string") return r.productTurnId || r.turnId;
    }
    return "";
  }
  /* 完成态摘要：与 Python 统计行同款标记「token/s(本轮)」——可被 isRateLine 识别并复用悬停解释 */
  function zuFinalText(stats) {
    var text = TURN_STATS.format(stats, cnUnits());
    return text.indexOf("token/s") >= 0 ? text.replace("token/s", "token/s(本轮)") : text + "(本轮)";
  }
  function zuUnavailableText() {
    return "⚡ " + L("本轮统计不可用", "turn stats unavailable") + "(本轮)";
  }
  function zuIsUnavailableText(t) {   // 不比对整串：行可能是另一语言下插的
    t = String(t || "");
    return t.indexOf("本轮统计不可用") >= 0 || t.indexOf("turn stats unavailable") >= 0;
  }
  /* v74：完成但零输出（如纯控制/后台轮次，无可见正文）时不编造"输出 0 token · 耗时
   * XXXs"这种无意义数字——与"记录已清"同样处理为不可用，而不是把字段值直接拼进文案。 */
  function zuHasMeaningfulOutput(stats) {
    return !!stats && typeof stats.outputTokens === "number" && stats.outputTokens > 0;
  }
  /* v73：悬浮条「生成速度」合并 chip 专用——与 zuFinalText（对话内确定性
   * 历史行用，格式不可变）分开。两态统一用 tok/s 单位，避免生成中/完成切换单位：
   * 生成中按「字符/s ÷ 每 token 字符数」估算（c2t），每 token 字符数由本会话最近一次
   * 完成的真实轮次自校准（bridge handle 级，session/store 换代即重置）；首轮尚无样本
   * 时退回 DEFAULT_CHARS_PER_TOKEN 粗略估计。完成态直接用 tracker 给出的真实 tok/s。 */
  var DEFAULT_CHARS_PER_TOKEN = 2;   // 校准前的粗略估计（中英混排粗略量级），有样本后立即被取代
  /* 返回 null = 调用方应把这当成"没有可展示的桥接视图"处理（回退 DB/不渲染），
   * 而不是当成"确定性地算出了没有速度"。v97：第三参 subSum = 子代理速率桥的合计
   * 视图（{rate, at, count}）——Agent 工具运行期优先展示**所有运行中子代理**的
   * 估算 tok/s 之和（并行 ≥2 个时动词后缀 ×N；运行中请求未入库，DB 无数据；
   * 3 秒未刷新即视为过期不显示），缺席时退回工具状态词 + 耗时。 */
  function zuBarSpeedView(stats, charsPerToken, subSum) {
    if (!stats.complete) {
      // 工具执行期间优先显示与消息流同款的状态词（正在读取/正在编辑…+已耗时），
      // 让悬浮条与 toolCall 行状态对应；没有工具在跑才退回字符估算/存活心跳。
      if (stats.runningTool) {
        var verb = zuToolVerb(stats.runningTool.name);
        if (stats.runningTool.name === "Agent" && subSum && subSum.rate != null && subSum.count > 0 &&
            typeof subSum.at === "number" && Date.now() - subSum.at <= 3000)
          return { cls: "dim",
                   text: verb + (subSum.count > 1 ? " ×" + subSum.count : "") +
                     L(" · 估 ", " · est ") + subSum.rate.toFixed(1) + L(" t/s", " t/s"),
                   phase: "tool" };
        var st = stats.runningTool.startedAt;
        if (typeof st === "number" && st > 0 && Date.now() >= st)
          verb += " · " + ((Date.now() - st) / 1000).toFixed(1) + "s";
        return { cls: "dim", text: verb, phase: "tool" };
      }
      // 无工具且无可测字符流（首段未流出/字符停滞>2s，多数模型思考期对桥不可见，
      // 看到的就是时间在走）：按用户语义定为"思考中"——动效脑图标 + 本轮存活时长。
      // 时长从首观测起算，不是精确思考时长。
      if (stats.characterRate == null) {
        var seconds = Math.floor(stats.observedMs / 1000);
        var hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
        seconds %= 60;
        // v99：计时随语言本地化——中文「1 时 2 分 3 秒」/英文「1 h 2 m 3 s」，空格分隔，零段照旧省略
        var uh = L("时", "h"), um = L("分", "m"), us = L("秒", "s");
        var parts = [];
        if (hours) parts.push(hours + " " + uh);
        if (minutes) parts.push(minutes + " " + um);
        if (seconds || !parts.length) parts.push(seconds + " " + us);
        return { cls: "dim", text: L("思考中…", "thinking…") + parts.join(" "),
                 phase: "thinking" };
      }
      var est = stats.characterRate / (charsPerToken || DEFAULT_CHARS_PER_TOKEN);
      return { cls: "dim", text: est.toFixed(1) + L(" t/s", " t/s"),
               /* phase 兜底 thinking：新轮刚开始（最后活动行还是 userInput）时
                * stats.phase 为 null，不兜底会让图标在这一瞬回闪电再切回脑（闪烁）。 */
               phase: stats.phase || "thinking" };
    }
    /* 切换/重新绑定到一个会话时，桥接首次订阅就可能直接捞到一个老早之前已完成的
     * 轮次（这次 ingest 从未见过它处于未完成状态）。这种"历史存量"不是我们亲历的
     * 完成过程，详细字段也可能已被宿主精简——不该把它当成"刚刚发生、算出来没速度"
     * 显示给用户（会被误读成这个会话突然坏了），交回调用方当作无桥数据处理。 */
    if (!stats.observedLive) return null;
    /* 完成但缺口径（宿主完成时 outputTokens/modelDurationMs 是可选字段，可能缺席）
     * 或零输出：同样回退 DB 最近一段值，绝不显示刺眼的"速度不可用"——那会被读成
     * "这个会话坏了"，而真相只是"这一轮的详细字段暂时没有"。DB 也没有值时调用方
     * 自然整枚 chip 不渲染。 */
    if (stats.tokenRate == null || !zuHasMeaningfulOutput(stats)) return null;
    var cls = stats.tokenRate >= 70 ? "ok" : stats.tokenRate >= 40 ? "warm" : "hot";
    return { cls: cls, text: stats.tokenRate.toFixed(1) + L(" t/s", " t/s"), phase: null };
  }
  /* 思考态动效图标（用户提供的设计稿）：呼吸脑轮廓 + 流动信号 + 脉冲节点，纯 CSS
   * 动画内嵌在 SVG 里（样式随节点走，不依赖外部样式表，宿主清 head 也不受影响）。
   * 类名一律 zu-tk-* 前缀，防与宿主/插件其它样式互相污染；prefers-reduced-motion
   * 时停播（动画 none，信号线半透明保持可读）。 */
  function zuIcoThinking() {
    return '<svg class="ico zu-think" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<style>' +
      '.zu-tk-brain{animation:zuTkBreathe 2.4s ease-in-out infinite}' +
      '.zu-tk-signal{stroke-dasharray:3 18;animation:zuTkFlow 2.4s linear infinite}' +
      '.zu-tk-node{transform-box:fill-box;transform-origin:center;animation:zuTkPulse 2.4s ease-in-out infinite}' +
      '.zu-tk-n2{animation-delay:-1.6s}.zu-tk-n3{animation-delay:-.8s}' +
      '@keyframes zuTkBreathe{0%,100%{opacity:.65}50%{opacity:1}}' +
      '@keyframes zuTkFlow{from{stroke-dashoffset:21}to{stroke-dashoffset:0}}' +
      '@keyframes zuTkPulse{0%,60%,100%{opacity:.35;transform:scale(.8)}25%{opacity:1;transform:scale(1.2)}}' +
      '@media(prefers-reduced-motion:reduce){.zu-tk-brain,.zu-tk-signal,.zu-tk-node{animation:none}.zu-tk-signal{opacity:.7}}' +
      '</style>' +
      '<g stroke-linecap="round" stroke-linejoin="round">' +
      '<g class="zu-tk-brain" stroke="#7e8899" stroke-width="1.5">' +
      '<path d="M12 5.3C12 2.2 7.5 2 6.8 5.2C4.2 4.8 2.7 7.3 3.6 9.5C1.5 11 1.6 14.1 3.8 15.4C3.1 18 5 20 7.2 19.5C8.2 22 12 21.2 12 18.5V5.3Z"/>' +
      '<path d="M12 5.3C12 2.2 16.5 2 17.2 5.2C19.8 4.8 21.3 7.3 20.4 9.5C22.5 11 22.4 14.1 20.2 15.4C20.9 18 19 20 16.8 19.5C15.8 22 12 21.2 12 18.5"/>' +
      '</g>' +
      '<g stroke="#8171E8" stroke-width="1.2" opacity=".45">' +
      '<path d="M7 7.5V10L9 12V16.5M17 7.5V10L15 12V16.5M5.5 14H7L9 16.5M18.5 14H17L15 16.5"/>' +
      '</g>' +
      '<g stroke="#A385E6" stroke-width="1.4">' +
      '<path class="zu-tk-signal" d="M7 7.5V10L9 12V16.5"/>' +
      '<path class="zu-tk-signal" style="animation-delay:-1.2s" d="M15 16.5V12L17 10V7.5"/>' +
      '</g>' +
      '</g>' +
      '<g fill="#A385E6">' +
      '<circle class="zu-tk-node" cx="7" cy="7.5" r="1.15"/>' +
      '<circle class="zu-tk-node zu-tk-n2" cx="17" cy="7.5" r="1.15"/>' +
      '<circle class="zu-tk-node zu-tk-n3" cx="9" cy="16.5" r="1.15"/>' +
      '<circle class="zu-tk-node" cx="15" cy="16.5" r="1.15"/>' +
      '</g>' +
      '</svg>';
  }
  /* v75：数据库富文本覆盖层。桥接数据只有 outputTokens/modelMs 等有限字段，拼不出
   * 模型时代那行（首字/分段/峰值/累计/采样时刻）——这些只在 usage 库里。所以完成态
   * 历史行先用桥接简化文案占位，同时按 session 向主进程要一次纯文本统计行；拿到后
   * 覆盖占位（见 zuRequestTurnText / window.__zusageDeliverTurnText）。
   * 查询刻意不带显式 turn-id：数据库 turn_id（turn_<uuid>）和渲染器投影的
   * turnId/productTurnId（msg_<uuid>，DOM data-turn-id 同源）是两套互不相通的标识，
   * 前端查不到后者对应的数据库主键。改用 token_rate.py 原本给 Hook 用的 --current
   * 时间戳推断（按 session 记录的"提问时刻"反查最新一轮），这正是模型以前实际在跑
   * 的同一条查询。key 用扫描循环里的 DOM tid（statsFor(tid) 的入参，虚拟列表重挂后
   * 还能对应回同一个容器）；请求/交付按 sid 关联（richTextRequestTids 是 sid→tid 的
   * 反向映射，同一 session 同一时刻只认最新发起的那个 tid——如果请求在途时又有新的
   * 一轮在同一 session 完成，交付结果可能被关联到新 tid 上而非发起时的旧 tid，这是
   * 一个已知的、极窄时间窗口内的小概率错位，权衡实现复杂度后不做进一步纠偏）。 */
  var richTextCache = {}, richTextAttempts = {}, richTextRequestTids = {};
  var RICH_TEXT_MAX_ATTEMPTS = 24;   // 0.5s 一 tick × 24 ≈ 12s 窗口等数据库追上（v88 扫描提速后按时间等价放大），之后永久用简化文案兜底
  function zuResetRichText() {
    richTextCache = {};
    richTextAttempts = {};
    richTextRequestTids = {};
  }
  /* 每个 scan tick 对「已完成 + 有输出 + 尚无富文本 + 未超重试上限」的 turn 补发一次请求：
   * 只靠首次完成时那一次会漏（主进程没收到/当时无窗口/查询失败），逐 tick 补发才能自愈。 */
  function zuRequestTurnText(tid, stats) {
    if (!tid || richTextCache[tid] || (richTextAttempts[tid] || 0) >= RICH_TEXT_MAX_ATTEMPTS) return;
    var sid = stats && typeof stats.sessionId === "string" ? stats.sessionId : "";
    if (!sid) return;
    richTextRequestTids[sid] = tid;
    /* cn：万/亿开关当前值；为 0 时主进程给 token_rate.py 加 --no-cn-units（Python 读不到渲染端 localStorage，缺省万/亿） */
    var req = { action: "turn-text", sid: sid, cn: cnUnits() ? 1 : 0 };
    if (window.__zusagePluginRequests) window.__zusagePluginRequests.push(req);
    else window.__zusagePluginRequests = [req];
    richTextAttempts[tid] = (richTextAttempts[tid] || 0) + 1;
  }
  /* 主进程回推：非空 = 富文本到位，写缓存并立即重扫（不等下一个 0.5s tick）；空 = 库里还没
   * 追到这一轮（或没有有效的提问时刻可推断），什么都不做——重试由 scanDeterministicLines
   * 的定时扫描自然驱动，这里绝不自建重试队列（否则两个驱动源叠加会绕开 attempts 上限）。 */
  window.__zusageDeliverTurnText = function (sid, text) {
    if (stale() || typeof sid !== "string") return;
    var tid = richTextRequestTids[sid];
    if (!tid || typeof text !== "string" || !text) return;
    richTextCache[tid] = text;
    delete richTextAttempts[tid];
    scanDeterministicLines();
  };
  /* ---------- 确定性历史行（v71）：完成的 turn 在消息流末尾插统计行 ----------
   * 数据来自 tracker（renderer store 投影），不再要求模型自跑统计脚本（hook 已去指令）。
   * 虚拟列表回收重挂后由扫描重建；旧消息（tracker 无记录）不补造；
   * 同容器已有模型历史统计行（isRateLine）则跳过，避免双行。 */
  var ZU_DET_FONT_SIZE = "0.8125rem";   // v78：宿主正文号偏大，用户要求缩小（13px）
  var detTimer = 0;
  /* v79：统计行在 turn 容器内的落点——hover 工具条之前、data-state="closed" 弹出层
   * 之后（工具条类名 opacity-0 … group-hover/assistant-turn:opacity-100，Tailwind
   * 类名含 : / [ ] 特殊字符，querySelector 转义易碎 → 按子节点 className 子串匹配）。
   * v82：新开会话的 turn 容器里工具条不在直接子层，嵌在 group/assistant-turn
   * flex w-full flex-col gap-5 → flex flex-col gap-5 内容列末尾——直接子层找不到时
   * 深度找工具条，insertBefore 落到锚点的父容器（即内容列内、工具条之上）。
   * 都找不到（宿主改版）回退 appendChild（旧行为，容器末尾）。 */
  function zuDetAnchor(box) {
    try {
      var kids = box.children, i, cls;
      for (i = kids.length - 1; i >= 0; i--) {
        cls = String(kids[i].className || "");
        if (cls.indexOf("group-hover/assistant-turn") >= 0 && cls.indexOf("opacity-0") >= 0)
          return kids[i];
      }
      var deep = box.querySelectorAll("div");
      for (var j = 0; j < deep.length; j++) {
        cls = String(deep[j].className || "");
        if (cls.indexOf("group-hover/assistant-turn") >= 0 && cls.indexOf("opacity-0") >= 0)
          return deep[j];
      }
      for (i = kids.length - 1; i >= 0; i--) {
        if (kids[i].getAttribute && kids[i].getAttribute("data-state") === "closed")
          return kids[i].nextSibling;   // null = 已到末尾，insertBefore(node, null) 即 append
      }
    } catch (e) { }
    return null;
  }
  function zuDetPlace(box, node) {
    try {
      var anchor = zuDetAnchor(box);
      if (anchor && anchor === node.nextSibling) return;   // 已在位（React 重排兜底快速路径）
      if (anchor) { anchor.parentElement.insertBefore(node, anchor); return; }   // v82：深度锚点挂锚的父容器
      if (node.parentElement !== box) box.appendChild(node);
    } catch (e) { FATAL.detErr = String((e && e.stack) || e); }
  }
  function scanDeterministicLines() {
    if (stale()) return;
    try {
      if (!state.rateLine || !TURN_STATS) {   // 开关关闭：撤下自己插的行（模型历史行不动）
        document.querySelectorAll("[data-zusage-deterministic]").forEach(function (el) { el.remove(); });
        return;
      }
      /* 两种选择器可能同时命中同一个 turn（外层 [data-v4-turn-unit] 包着内层
       * section，二者带同一个 data-turn-id）：按 tid 去重，section 更具体，优先用它
       * 当容器，避免同一轮被当成两个独立容器各插一条，出现重复行（真机实测过）。 */
      var boxes = [], seen = {};
      document.querySelectorAll("section[data-turn-id]").forEach(function (el) {
        var t = el.getAttribute("data-turn-id");
        if (t && !seen[t]) { seen[t] = 1; boxes.push(el); }
      });
      document.querySelectorAll("[data-v4-turn-unit][data-turn-id]").forEach(function (el) {
        var t = el.getAttribute("data-turn-id");
        if (t && !seen[t]) { seen[t] = 1; boxes.push(el); }
      });
      /* v86 诊断（≥10s 一次写 __zusageDiag.det，主进程泵取回写 diag-<n>.json）：每轮容器的行类型
       * （rich/ph/na/keep/model/none）与 tracker 视图、各 pane 的桥接快照窗口——排"历史轮不可用"类问题用 */
      var wantDiag = Date.now() - (scanDeterministicLines.diagAt || 0) > 10000, diagTurns = wantDiag ? [] : null;
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        var tid = box.getAttribute && box.getAttribute("data-turn-id");
        if (!tid) continue;
        var rec = diagTurns ? { tid: tid.slice(-8) } : null;
        if (rec) diagTurns.push(rec);
        var mine = null;
        try { mine = box.querySelector("[data-zusage-deterministic]"); } catch (e) { }
        if (mine) {
          /* 已插过：重挂/数据演进后从 tracker 重建文本；观测过但记录已清（换代）、
           * 或完成但确实零输出（无意义数字，如"耗时 939.0s"配"输出 0 token"）则明示不可用 */
          var again = null;
          for (var n = 0; n < instances.length; n++) { again = instances[n].statsFor(tid); if (again) break; }
          var againOk = !!again && again.complete && zuHasMeaningfulOutput(again);
          if (!againOk && !(again && again.observedLive)) {
            /* v86：tracker 无记录（快照窗口滑出/store 换代/热更新换 tracker）或重绑后一步到位捞到的
             * 历史存量轮缺 outputTokens（缺字段 ≠ 零输出）——都不据此改判"不可用"：已完成轮的数字不会
             * 过时，保留已有占位/富文本；此前误插的"不可用"行直接撤下。仅亲历过的真实零输出轮仍明示 */
            var keptLine = mine.querySelector("p") || mine;
            if (richTextCache[tid]) {
              if ((keptLine.textContent || "") !== richTextCache[tid]) keptLine.textContent = richTextCache[tid];
              if (!keptLine.style.fontSize) keptLine.style.fontSize = ZU_DET_FONT_SIZE;
              zuDetPlace(box, mine);
            } else if (zuIsUnavailableText(keptLine.textContent)) mine.remove();
            else zuDetPlace(box, mine);
            if (rec) { rec.line = richTextCache[tid] ? "rich" : "keep"; rec.st = zuDiagStats(again); }
            continue;
          }
          var againText = againOk ? zuFinalText(again) : zuUnavailableText();
          if (againOk) zuRequestTurnText(tid, again);   // 仍缺富文本就补发（限流见函数内）
          var text = richTextCache[tid] || againText;
          var line = mine.querySelector("p") || mine;
          if ((line.textContent || "") !== text) line.textContent = text;
          if (!line.style.fontSize) line.style.fontSize = ZU_DET_FONT_SIZE;   // 旧代节点补样式（热更间隙）
          zuDetPlace(box, mine);   // React 重排后兜住用户指定位置（工具条之前）
          if (rec) { rec.line = richTextCache[tid] ? "rich" : (againOk ? "ph" : "na"); rec.st = zuDiagStats(again); }
          continue;
        }
        var hasModel = false;
        try {
          box.querySelectorAll("blockquote p, blockquote, p").forEach(function (el) {
            if (!hasModel && isRateLine(el)) hasModel = true;
          });
        } catch (e) { }
        if (hasModel) { if (rec) rec.line = "model"; continue; }   // 模型历史统计行在位：不叠双行
        var stats = null;
        for (var k = 0; k < instances.length; k++) { stats = instances[k].statsFor(tid); if (stats) break; }
        if (rec) { rec.line = "none"; rec.st = zuDiagStats(stats); }
        if (!stats || !stats.complete) continue;   // 未完成 / 旧消息（tracker 无记录）不插
        var statsOk = zuHasMeaningfulOutput(stats);
        if (!statsOk && !stats.observedLive && !richTextCache[tid]) continue;   // v86：历史零值或缺字段不判失败；已缓存的完整统计仍可重建
        var quote = document.createElement("blockquote");
        quote.dataset.zusageDeterministic = "1";
        var p = document.createElement("p");
        p.dataset.zusageDeterministic = "1";
        /* 样式基本交还宿主默认（模型时代贴的 Markdown 引用块就是这套渲染：彩色 ⚡、
         * 正文亮度、引用线）；唯一例外字号（v78）：用户反馈宿主正文号太大，内联缩到
         * 0.8125rem（13px）。必须内联——本节点长在宿主消息流 prose 容器内，bar 内部
         * 样式表够不着，挂 head 的外来样式又会被 React 清掉（历史根因）。 */
        p.style.fontSize = ZU_DET_FONT_SIZE;
        if (statsOk) zuRequestTurnText(tid, stats);   // 先占位，向主进程要这轮的数据库富文本
        p.textContent = richTextCache[tid] || (statsOk ? zuFinalText(stats) : zuUnavailableText());
        if (rec) rec.line = richTextCache[tid] ? "rich" : (statsOk ? "ph" : "na");
        quote.appendChild(p);
        zuDetPlace(box, quote);
      }
      if (wantDiag) {
        scanDeterministicLines.diagAt = Date.now();
        FATAL.det = {
          time: new Date().toISOString(), boxes: boxes.length, rich: Object.keys(richTextCache).length,
          bridge: instances.map(function (inst) { return inst.bridgeInfo ? inst.bridgeInfo() : null; }),
          turns: diagTurns.slice(0, 40),
        };
      }
    } catch (e) { FATAL.detErr = String((e && e.stack) || e); }
  }
  function zuDiagStats(s) {
    return s ? { c: s.complete ? 1 : 0, live: s.observedLive ? 1 : 0, out: s.outputTokens, st: s.state,
      sa: s.startedAt, ea: s.endedAt, mm: s.modelMs, dm: s.durationMs } : null;
  }
  function cleanupDeterministic() {
    clearInterval(detTimer);
    zuResetRichText();
    try {
      document.querySelectorAll("[data-zusage-deterministic],[data-zusage-loading-status]").forEach(function (el) { el.remove(); });
    } catch (e) { }
  }
  /* ---------- 工具动词表（v76 引入，v78 起仅悬浮条合并 chip 使用）：zuBarSpeedView
   * 在工具执行期显示"正在读取 · 1.2s"同款状态词，数据源为桥接 tracker 的 runningTool
   * （本轮最后一个活动行=进行中的工具调用，宿主从 tool_input_start 起算"进行中"）。
   * v76 的消息流 loading 插槽插入（[data-zusage-loading-status]）已删，见 zuToolVerb 下方注。 */
  var ZU_TOOL_VERBS = {
    Read: ["正在读取", "Reading"],
    Write: ["正在写入", "Writing"], Edit: ["正在编辑", "Editing"], ApplyPatch: ["正在编辑", "Editing"],
    Bash: ["正在执行", "Running command"],
    Grep: ["正在搜索", "Searching"], Glob: ["正在搜索", "Searching"],
    WebSearch: ["正在搜索", "Searching"], web_search: ["正在搜索", "Searching"],
    WebFetch: ["正在获取网页", "Fetching page"],
    TodoWrite: ["正在更新待办", "Updating todos"], TodoRead: ["正在读取待办", "Reading todos"],
    Skill: ["正在运行技能", "Running skill"],
    ReadSessionContext: ["正在读取上下文", "Reading context"],
    Agent: ["子代理运行中", "Running agent"], Task: ["子代理运行中", "Running agent"],
    SendMessage: ["正在发送消息", "Sending message"],
    TaskOutput: ["正在获取任务输出", "Fetching task output"],
    TaskStop: ["正在停止任务", "Stopping task"],
    CreateWorkflow: ["正在编写工作流", "Writing workflow"],
  };
  function zuToolVerb(name) {
    if (name && ZU_TOOL_VERBS[name]) { var pair = ZU_TOOL_VERBS[name]; return L(pair[0], pair[1]); }
    if (name && name.indexOf("mcp__computer-use__") === 0) return L("正在操作电脑", "Operating computer");
    if (name && name.indexOf("mcp__") === 0)
      return L("正在调用 " + name.slice(5).replace(/__/g, " · "), "Calling " + name.slice(5).replace(/__/g, " · "));
    if (name && name.indexOf("js") === 0) return L("正在执行代码", "Executing code");
    return name ? L("正在执行 " + name, "Running " + name) : L("执行中", "Working");
  }
  /* v78：消息流 loading 状态词（v76 的 [data-zusage-loading-status] 插槽插入）已删——
   * 悬浮条合并 chip 在工具执行期仍显示同款动词+耗时（zuBarSpeedView），消息流内不再插节点。
   * 清理选择器保留（根清理 + dispose）：热更/重载后把旧版本可能残留的 span 清干净。 */
  function sharedTick() {
    if (stale()) return;
    scanDeterministicLines();
  }
  detTimer = setInterval(sharedTick, 500);   // v88：2s→0.5s，与速率行扫描/心跳同节奏
  sharedTick();

  function disposeOverlay() {
    if (disposed) return;
    disposed = true;
    clearTimeout(bootTimer);
    clearInterval(coordinatorTimer);
    instances.forEach(function (inst) { inst.dispose(); });
    instances = [];
    quotaSelectionsSig = "";
    pluginRequest("quota-providers", { panes: {} });
    cleanupRateTip();
    cleanupGitTip();
    cleanupDeterministic();
    window.__zusageWantSids = [];
    window.__zusageWantSid = "";
    window.__zusageGitPaths = [];   // v96：主进程下轮 tick 读到空集即停查
    if (window.__zusageDispose === disposeOverlay) {
      delete window.__zusageDispose;
      delete window.__zusageUpdate;
      delete window.__zusagePluginUpdate;
      delete window.__zusageGitState;
      window.__zusageOverlay = false;
    }
  }
  window.__zusageDispose = disposeOverlay;
  bootTimer = setTimeout(function () {
    if (stale()) return;
    try { coordinator(); } catch (e) {
      FATAL.fatal = String((e && e.stack) || e);
      var b = document.getElementById("zusage-bar");
      if (b) b.style.cssText = "position:fixed;right:16px;bottom:16px;font:12px monospace;color:#ff7a59;" +
        "background:#1a0f0d;border:1px solid #ff7a59;border-radius:6px;padding:4px 10px;z-index:2147483647";
    }
  }, 0);

  /* 设置页（MCP 配置等）内的编辑框不是聊天输入框：设置是同窗口覆盖层，激活时
   * 聊天视图保持挂载、仅 opacity-0+inert 视觉遮蔽——v61 幽灵判定管的是聊天壳，
   * 设置层是其兄弟节点、够不着。设置框架内（settings-page 根 testid 或
   * content/panel 双 frame 标记，三层标记并集排除、跨宿主版本覆盖面最大）的
   * JSON/环境变量文本框（MCP 表单展开「环境变量（可选）」后的 rows=4 文本框）
   * 落在视口下半部，会被协调器当聊天输入框派发，条冒在设置页底部（实测 bug）。
   * 带设置框架标记的候选一律不派发；聊天流（composer/权限面板/批准框）不在
   * 设置框架内，行为不受影响。 */
  function inSettingsView(el) {
    try { return !!(el.closest && el.closest('[data-testid="settings-page"],[data-settings-content-frame],[data-settings-panel-frame]')); } catch (e) { return false; }
  }
  function coordinator() {
    /* 协调器（v61.1）：扫描主文档里全部下半屏可见输入框，按 pane 键（data-pane-id，
     * 无属性回退 "auto"）分组派发给实例；一个 pane 一条，pane 消失对应条自藏。 */
    function paneKeyOf(el) {
      for (var p = el; p && p !== document.body; p = p.parentElement) {
        if (p.hasAttribute && p.hasAttribute("data-pane-id")) return p.getAttribute("data-pane-id") || "auto";
      }
      return "auto";
    }
    function sessIdOf(el) {
      for (var p = el; p && p !== document.body; p = p.parentElement) {
        if (p.hasAttribute && p.hasAttribute("data-session-id")) return p.getAttribute("data-session-id") || "";
      }
      return "";
    }
    var SEL = 'textarea, [contenteditable="true"], [role="textbox"], .ProseMirror, .ql-editor';
    function tick() {
      if (stale()) return;
      try {
        var best = {};
        document.querySelectorAll(SEL).forEach(function (el) {
          if (el.closest && el.closest('[role="dialog"]')) return;   // v62：弹窗内的编辑框不是聊天输入框，不派实例（issue #9）
          if (inSettingsView(el)) return;   // 设置页（MCP 配置等）的编辑框不是聊天输入框，不派实例
          var r = el.getBoundingClientRect();
          if (!(r.width > 40 && r.height > 8 && r.bottom > 0 && r.top < innerHeight)) return;
          if (r.top < innerHeight * 0.45) return;   // 聊天输入框特征：视口下半部（排除设置页等处元素）
          var k = paneKeyOf(el);
          if (!best[k] || r.top > best[k].top) best[k] = { el: el, top: r.top };
        });
        var keys = Object.keys(best);
        if (!keys.length) { best["auto"] = { el: null, top: 0 }; keys = ["auto"]; }   // shadow/iframe 兜底
        instances = instances.filter(function (inst) {
          if (keys.indexOf(inst.pid) >= 0) return true;
          inst.dispose();
          return false;
        });
        keys.forEach(function (k) {
          var inst = null;
          for (var i = 0; i < instances.length; i++) if (instances[i].pid === k) { inst = instances[i]; break; }
          if (!inst && instances.length < 4) inst = spawnInstance(k, nextSlot++);
          if (inst) inst.attach(best[k].el, sessIdOf(best[k].el));
        });
        refreshWants();
        reportQuotaSelections();
        FATAL.insts = instances.map(function (a) { return a.pid + "=" + (a.getSid() ? a.getSid().slice(-8) : "-"); }).join(" | ");
      } catch (e) { FATAL.coordErr = String((e && e.stack) || e); }
    }
    tick();
    coordinatorTimer = setInterval(tick, 600);
  }

  /* ---------- 实例工厂（v61.1）：一个 pane 一套 条/面板/气泡/tooltip/定位循环。
   * slot 0 保留 #zusage-bar/#zusage-tip 兼容 id（泵热更新按它清理），其余实例仅类名。 */
  function spawnInstance(pid, slot) {
    var VERSION = "v110";   // v99.1（主线并流）apiKey 模式 BigModel/Z.ai（bigmodel-api[-N]/zai-api[-N]）额度 chip 标题家族判定（issue #68；数据链在 quota-client） → v82 统计行锚点深度查找（新会话结构嵌套在 group/assistant-turn 内容列内）→ v83 万/亿单位开关（默认开、仅中文）+ K/M/B 的 B 档 → v84 主标签页远端路由（工作台分组唯一主绑定上报 + 迟到载荷守卫，issue #30）→ v85 回答末尾统计行跟随万/亿开关 + tok→token → v86 历史轮 tracker 无记录（窗口滑出/换代/热更）或缺输出字段不再翻成"本轮统计不可用"，加 det 诊断 → v87 主叶归属增 last-session 回退（组零证据时唯一远端记录放行，issue #30 复测：单会话主标签页不建组）→ v88 运行态心跳与两处扫描 tick 2s→0.5s（富文本重试 6→24 次等价放大）→ v89 ⚙ 面板更新进度：downloading 阶段文案 + 下载（字节）/安装（校验→安装→同步）双进度条，缺 progress 的旧主进程自动隐藏 → v90 主标签页/分栏归属改按本窗会话节点身份（renderer 桥按版本/资产/锚点写 SessionPane 属性，移除 workbench-groups/last-session 共享回退）+ 心跳 0.5s→0.1s（扫描维持 0.5s）→ v91 设置页/权限面板冒条修复（PR #44：inSettingsView 三处派发排除 + anchorCardOf 面板锚点改判）收编收尾：排除标记并集（settings-page testid + content/panel 双 frame）、track 显隐第四处防御 → v92 ⚙ 更新区固定显示可复制的重装口令（源码安装无法自动更新时引导用户发给 agent）→ v93 原生上下文按钮（chat-context-usage-trigger）增强：环填充/四档色/右侧百分比镜像状态条上下文格（ctxBandOf 同源），cw 缺失还原原生形态 → v94 状态条删除「上下文容量」格（UI+tooltip，该口径由原生按钮增强承载），⚙ 面板同步去掉「上下文」开关，子代理格改始终展示（零值也显示）→ v95 ⚙ 更新区去掉 v92 重装口令提示块（源码清单的仓库来源改由宿主插件管理器直接更新，不再报渠道不一致），更新来源文案增「仓库源码」分支→ v96 套餐额度 chip（默认关）：挂原生上下文按钮左侧（wrapper 内前插，与按钮增强同款双 reapply/还原），数据来自主进程 quota 字段（解密宿主 OAuth 凭据直查 monitor 端点，账号级套餐池口径），会话首个 main_turn 完成前不显示；自绘 tooltip 走 rateTip 独立浮层模式；chip 改多窗分段：每窗一段（中文 5小时/7天，英文 5h/7d）各自按 80/95/100 档位色，分隔符 |；余额类型单段渲染就绪（余额 ¥100.00，阶段 3 数据源接入即用）；去掉环形，容器不着色 → v97 子代理速率（T1+T2）：zusage sub 汇总加 rate_avg/每子代理 tps_avg（已完成段加权平均，口径同 _turn_rate），子代理格 tooltip/明细面板展示；Agent 运行期主 chip 附加「子代理运行中 · 估 X t/s」——turn-stats 透传 subagent 行 childSessionId，overlay 据此用同款 zuTryBindStore 绑子代理会话 store 做字符增量估算（运行中请求未入库，DB 无实时数据；150s 采样实锤零 running 行），思考文本不进 rows 时退回纯状态词；工具动词「正在运行子智能体」压成「子代理运行中」（web 同步文案）；同日多槽位化：turn-stats 暴露 runningSubagents 全集（并行时 rowId 前 8 个），每子代理独立绑定/2s 节流，主 chip 显示合计速率（并行 ≥2 时动词后缀 ×N），chip tooltip 与子代理明细面板逐个实时展示运行中估算（tooltip 随原地改字同步 __tip 重画；面板 800ms tick 原地刷新 .subrate，汇总页运行块含 DB 尚无记录的新子代理） → v98 额度实时选源恢复（v4-model-config 观察 + quota-providers 全窗快照上报 + byProvider 定向刷新、空选择 fail-closed）与 sub2api 额度 UI（今日/本月窗口、窗口行内金额明细、Key 总额度、订阅截止、账户余额标题） → v99 思考中计时随语言本地化（中文「1 时 2 分 3 秒」/英文「1 h 2 m 3 s」，空格分隔、零段照旧省略）；回答末尾行采样时刻改完整中文日期时间（⏱ 2026 年 10 月 23 日 11 点 20 分 28 秒，token_rate.py format_turn_line 同步改版） → v99b（主线并流）tooltip 伪边界 leave 过滤：Chrome 悬停链收缩/重算会补发 DOM 内部的 documentElement/tip mouseleave，tipLeaveAt 贴边判定后取触发时刻最深 :hover 元素甄别，仍悬停在本档具体元素上即伪 leave 一律忽略交回 mousemove 流（主线 v100 滚动豁免=本链 v106 同义，不另列） → v100 设置面板分区导航（ZCode 设置侧栏同款：左栏三组分区导航 + 内容区单分区显隐，激活项 aria-current="page"，选择持久化 zusage3.sec；面板窄于 620px 时导航收成 icon rail） → v101 设置面板高度在打开瞬间按内容自然高锁定（切分区不再抖动，resize 只收紧不放大） → v102 额度源预设模板（CC Switch/magpie 同款选模板只填 Key：官方域变体 chip 一键写入 secrets baseUrl，minimax 可信域机制推广到 siliconflow 币种随域；deepseek/openrouter/kimi/anthropic/mimo/volcano 附控制台取 Key 链接，走 openExternal 桥） → v103 额度源列表卡片化布局（每源圆角卡片+间距，凭据框限宽 420px，长说明段落补水平边距；纯 CSS，结构行为不变） → v104 源状态文案补 disabled=已关闭映射 + 主进程对显式关闭源统一报 disabled（修「开关已关却显示待查询」矛盾）；刷新/获取 Key 按钮补 title 提示，关闭源的刷新按钮禁用 → v105 「上下文容量」弹层（hover-card-content）内压缩上下文按钮：命中率行下方全宽胶囊按钮（原生 secondary 配色全走客户端语义变量），弹层关即卸载（Radix 无 forceMount）故 body MutationObserver + heavy 对账双触发、DOM 存在性幂等（多实例安全），插入锚=「剩余额度」border-t 段前（缺则容器尾）+位置兜回；点击弹原生 AlertDialog 视格确认框（遮罩/Esc/外点关闭、Enter 确认），确认后优先走 fiber 上原生残留的 onSendCompressionCommand("/compact")（SessionPane 压缩入口，不动输入框草稿），缺失回落官方 E2E 输入桥 __zcodeLexicalInputE2E.setText + 发送键（Lexical 直写 DOM 不生效，禁用该路径；草稿非空拒绝） → v106 额度 tooltip 滚动豁免：hideTipsOnScroll 不再收 quotaTip（chip 固定 composer 工具行与 gitTip 同理），修思考中流式输出自动滚动致悬停弹出即灭；chip 随宿主重建 detach（无 mouseleave）由 scanRateLines 加 isConnected 健康检查兜底收起 → v107 压缩确认框补行为提示：压缩进行中发送新消息/停止会打断压缩（实测 16:27 新 turn 启动同秒 compact turn TURN_CANCELLED，cancelled_by_user=1；引擎对该次摘要流挂起 134s 无首 token 也不重试 retryable=0），确认框加 hint 行中性告知 → v108 压缩主通道按用户指定改为字面 "/compact" 输入提交（E2E 桥 setText+发送键；流式中 v4-stop 可见/草稿非空/发送键 disabled 三重拒绝），fiber 命令信封降兜底；hint 升级为「通常需 2-4 分钟且无进度反馈」（DB 实证：全库 compact 请求无首 token 但正常完成，72s-9.6min，14:44 同会话同模型 165s 成功先例；16:25/16:43 两次「卡住」实为 2m20s 被新消息 TURN_CANCELLED，非故障） → v109 压缩主通道按用户指定改回直接调会话发送接口（fiber onSendCompressionCommand 命令信封：不碰输入框/发送键、流式中交引擎排队，修字面输入通道在生成中被发送键禁用卡住的问题），字面 "/compact" 输入提交降兜底（三重门控仅作用于兜底） → v110 压缩提交函数改在弹框打开瞬间（弹层必存活、锚点几何可信）解析并缓存，修复确认时弹层已被 Radix 卸载、几何重解析退化为「离视口左上角最近」致多分栏把 /compact 发进错误会话（P1）；兜底字面输入通道的流式/发送键/草稿三重门控全部前置到 setText 之前（拒绝不再残留草稿）；Enter 确认限定焦点在弹框内（无焦点陷阱下防焦点外 Enter 误触发确认）   // 悬停 ⚙ 面板可见；版本号随代际递增
    var instanceDisposed = false, heavyTimer = 0, frame = 0, themeObserver = null;
    var globalListeners = [];
    function listenGlobal(target, type, fn, capture) {
      target.addEventListener(type, fn, capture);
      globalListeners.push([target, type, fn, capture]);
    }
    function inactive() { return instanceDisposed || stale(); }
    /* ---------- 状态（实例级） ---------- */
    var excOn = false,    // 本 pane 会话处于"上下文超限被拒"状态（render 时按 picked 会话计算）
      excGone = false,    // 用户点 ✕ 关闭了本次气泡；超限解除后自动复位
      nativeCtxVal = 0,   // 本 pane 输入框卡片上读到的原生上下文总量
      lastSub = null,     // 子代理明细面板数据源
      instSid = "",       // 本 pane 当前会话（composer 祖先链 data-session-id）
      pendingSid = "", wantedEl = null, scopeStamp = "",   // 协调器派发的最新 composer/会话
      shrink = 0,         // 分级收缩（v66）：1 = 内容超卡片宽，「本轮/会话累计」缓存命中率已让位
      fadeOn = false,     // 收缩后仍超宽：右缘渐隐（.zu-clip）
      bridge = { handle: null, turnId: "", timer: 0 },   // v71 本 pane 的 renderer store 订阅
      lastBand = null,    // v92：本 pane 上下文分档（ctxBandOf 结果，原生按钮增强的数据源）
      ctxBtnCache = null,   // v92：本实例上次增强的原生按钮（还原/对账引用，不依赖 cardCache 存活）
      lastQuota = null, lastQuotaAll = null, quotaProvider = "", quotaModel = "", quotaFallback = "", quotaChipCache = null,
      quotaSourceId = "", quotaSelection = null, quotaPaneRoot = null, quotaSelectionObserver = null, quotaMarkerSeen = false,   // 当前 pane 模型选择与额度来源
      cuaBtnCache = null, gitChipCache = null,   // v96：Git chip 的锚点按钮（电脑操作）与本实例的 chip 节点
      liveTextCur = "", liveStatsCur = null, liveKindCur = "fallback", liveEl = null,   // v72：合并「生成速度」用
      livePhaseCur = "", liveIconCur = "bolt";   // v77：当前 chip 阶段与图标（think=思考动效/bolt=闪电）——相位切换需整条重渲染

    /* ---------- DOM ---------- */
    /* 样式表挂在 bar 内部而非 head：React 可能清理 head 里的外来 style，
     * CSS 一旦失效条就退化成 static 占位元素（"输入框下方空白"的历史根因）。 */
    var style = document.createElement("style");
    style.textContent =
      /* 胶囊条：半透明底 + 微边框（v80 起仅 below-card 兜底形态用；in-card 形态由
       * .zusage-root.zu-in 全部抹平）。配色全量跟随客户端主题（v58）：颜色一律
       * var(--color-*, 旧值兜底) 引用客户端语义变量（<html> 的 .dark 类翻转整套值，
       * zai-light/zai-dark 特殊主题同样自动适配）；color-mix 处加同值前置声明，
       * 不支持 color-mix 的旧引擎落到实色行不至于透明。 */
      ".zusage-root{position:fixed;box-sizing:border-box;" +
      "font-family:var(--font-mono,Consolas,'Cascadia Mono',Menlo,'Microsoft YaHei UI','Microsoft YaHei',monospace);" +
      "font-size:var(--ui-font-size,14px);line-height:1.3;" +
      "font-variant-numeric:tabular-nums;color:var(--color-foreground-subtle,#8791a3);" +
      "background:rgba(15,18,25,.86);background:color-mix(in srgb,var(--color-background,#0f1219) 86%,transparent);" +
      "backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);" +
      "border:1px solid var(--color-border,rgba(255,255,255,.07));border-radius:9px;padding:2px 6px;user-select:none;" +
      "box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 4px 14px rgba(0,0,0,.38),0 1px 3px rgba(0,0,0,.28);" +
      "display:flex;align-items:center;gap:2px;white-space:nowrap;" +
      /* 条不用 overflow:hidden：超宽截断由 #zu-main 自己负责（渐隐 .zu-clip）。 */
      "z-index:50}" +
      /* in-card 形态（v80）：条挂在输入卡片内部 group/toolbar 工具行之后自占一行，
       * 与对话框融为一体——背景/边框/阴影/毛玻璃全抹掉（用户指定），宽度交由卡片
       * flex-col 的 stretch 撑满内宽（min/max-width 不再写死）。 */
      ".zusage-root.zu-in{position:static;background:none;border:0;border-radius:0;padding:1px 0 0;" +
      "box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;min-width:0;max-width:none;z-index:auto}" +
      ".zu-main{overflow:hidden;min-width:0;flex:1 1 auto;display:flex;align-items:center;gap:1px;justify-content:space-between}" +
      /* 收缩兜底（v66）：分级收缩后仍装不下时右缘 26px 渐隐，替代生硬的截断 */
      ".zu-main.zu-clip{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 26px),transparent);" +
      "mask-image:linear-gradient(90deg,#000 calc(100% - 26px),transparent)}" +
      /* zu-main 不得带 .it class：querySelectorAll('.it') 收集 tooltip 时会把它算进第 0 位，
       * tips 全部错位一位且末项为 null —— v31"悬停只有空胶囊/内容错位"的根因 */
      ".it{display:flex;align-items:center;gap:4px;padding:2px 6px;border-radius:6px;" +
      "transition:background-color .12s ease-out}" +
      ".it:hover{background:var(--color-hover,rgba(255,255,255,.06))}" +
      ".sep{width:1px;height:15px;background:var(--color-border,rgba(255,255,255,.09));flex:0 0 auto;margin:0 1px}" +
      ".k{color:#7e8899}.v{color:var(--color-foreground,#e9edf4);font-weight:600}" +
      ".zu-live{color:var(--color-foreground,#e9edf4);font-weight:600}" +
      ".pct{font-weight:700}.dim{color:var(--color-foreground-subtle,#667082)}" +
      /* 三档状态色刻意不走客户端变量（v58.1）：terminal-bright-* 是语法高亮色板，
       * 绿档在条面小字号/细进度条上发白（用户实测）；改用高对比自调档，
       * 浅色加深版在 .zu-light 组。 */
      ".ok{color:#3ecf8e}.warm{color:#f5b944}.hot{color:#ff6b57}" +
      /* 超限=亮红呼吸闪烁（v38 定性"亮红闪烁优先于一切档位"，v54 落成动画） */
      "@keyframes zuexc{0%,100%{opacity:1}50%{opacity:.4}}" +
      ".exc{color:var(--color-destructive,#ff2d55);text-shadow:0 0 8px rgba(255,45,85,.5);animation:zuexc 1.1s ease-in-out infinite}" +
      ".btn{cursor:pointer;padding:2px 6px;border-radius:6px;color:var(--color-foreground-subtle,#7e8899);" +
      "transition:background-color .12s ease-out,color .12s ease-out}" +
      ".btn:hover{color:var(--color-foreground,#e9edf4);background:var(--color-hover,rgba(255,255,255,.07))}" +
      ".btn:active{transform:scale(.96)}" +
      /* v81：⚙ 原为 +3px（17px），比宿主 group/toolbar 行的任何文字（统一
       * text-ui-base = var(--ui-font-size)）都大一号，改为同基准以对齐工具行观感 */
      ".zu-gear{flex:0 0 auto;font-size:var(--ui-font-size,14px);border-radius:6px}" +
      /* 行内 SVG 线性图标（v54）：currentColor 跟随文字色，一处定义全局换色 */
      ".ico{width:12px;height:12px;flex:0 0 auto;color:var(--color-foreground-subtle,#7e8899);opacity:.85}" +
      /* 思考态动效图标（v77）：自带配色（脑灰+紫信号），略大于常规线性图标——
       * 12px 下 4 个脉冲节点会缩没；不撑高条面（行高由文字主导）。 */
      ".zu-think{width:14px;height:14px;opacity:1}" +
      /* 工具错误数徽标 */
      ".eb{background:rgba(255,107,87,.14);background:color-mix(in srgb,var(--color-destructive,#ff6b57) 14%,transparent);" +
      "color:var(--color-destructive,#ff8a73);border-radius:999px;padding:0 6px;line-height:16px;font-weight:600;display:inline-flex;align-items:center;gap:2px}" +
      ".eb .ico{color:inherit}" +
      /* v92 原生上下文按钮增强（原状态条「上下文容量」格 v93 删除，档位口径由本处承载）：四档色由 data-zusage-band 驱动 —— React
       * 不清理非 props 的手动属性；!important 压原生 text-success/text-warning/
       * text-foreground-subtle 变调；静态几何（r/描边/圆帽/透明度）用 CSS 覆盖
       * presentation attribute（永远生效），动态 pathLength/dasharray 由
       * enhanceCtxButton 写入。exc 复用 zuexc 呼吸闪烁。数值挂按钮内（环右侧）：
       * 悬停自动享受原生 hover:bg-hover 与「上下文容量」面板，width 由固定方形放开。 */
      "[data-testid=chat-context-usage-trigger][data-zusage-armed]{color:#3ecf8e!important;" +
      "width:auto!important;min-width:1.75rem;padding:0 3px;gap:4px}" +
      "[data-testid=chat-context-usage-trigger][data-zusage-armed][data-zusage-band=warm]{color:#f5b944!important}" +
      "[data-testid=chat-context-usage-trigger][data-zusage-armed][data-zusage-band=hot]{color:#ff6b57!important}" +
      "[data-testid=chat-context-usage-trigger][data-zusage-armed][data-zusage-band=exc]{color:var(--color-destructive,#ff2d55)!important;" +
      "text-shadow:0 0 8px rgba(255,45,85,.5);animation:zuexc 1.1s ease-in-out infinite}" +
      "[data-testid=chat-context-usage-trigger][data-zusage-armed]>svg:not(.animate-spin) circle{opacity:1;stroke-width:3;r:9px}" +
      "[data-testid=chat-context-usage-trigger][data-zusage-armed]>svg:not(.animate-spin) circle:first-of-type{stroke:var(--color-hover,rgba(255,255,255,.1))}" +
      "[data-testid=chat-context-usage-trigger][data-zusage-armed]>svg:not(.animate-spin) circle:last-of-type{stroke:currentColor;stroke-linecap:round}" +
      ".zu-ctxpct{font-family:var(--font-mono,Consolas,'Cascadia Mono',Menlo,'Microsoft YaHei UI','Microsoft YaHei',monospace);" +
      "font-size:var(--ui-font-size,14px);font-weight:700;font-variant-numeric:tabular-nums;line-height:1;" +
      "display:inline-flex;align-items:center;flex:0 0 auto}" +
      /* 浅色档（与 .zu-light 组同源深化值）：标记由 enhanceCtxButton 随 bar 主题同步到
       * button（pct span 与环都在按钮内，同为 data-zusage-light 后代）。 */
      "[data-zusage-light][data-zusage-band=ok]{color:#0f9d6c!important}" +
      "[data-zusage-light][data-zusage-band=warm]{color:#b6791a!important}" +
      "[data-zusage-light][data-zusage-band=hot]{color:#d8482f!important}" +
      "[data-zusage-light][data-zusage-band=exc]{text-shadow:none}" +
      "[data-zusage-light] .zu-ctxpct.ok{color:#0f9d6c}" +
      "[data-zusage-light] .zu-ctxpct.warm{color:#b6791a}" +
      "[data-zusage-light] .zu-ctxpct.hot{color:#d8482f}" +
      "[data-zusage-light] .zu-ctxpct.exc{text-shadow:none}" +
      /* v96 Git 状态 chip（工具行「电脑操作」按钮右侧）：外形对齐原生 ghost 按钮（h-7/rounded-lg/
       * px-1.5/gap-1）；配色移植 cc-pretty-statusline 的 git 段——图标+分支名暗灰，+插入绿 /
       * -删除红 / ?未跟踪黄，括号与 ↑↓ 随暗灰；浅色档（Catppuccin Latte 同源值）由 syncCtxLite
       * 写在 chip 自身的 data-zusage-light 切换。 */
      ".zu-git{display:inline-flex;align-items:center;gap:4px;height:1.75rem;padding:0 .375rem;border-radius:.5rem;" +
      "flex:0 0 auto;box-sizing:border-box;cursor:pointer;user-select:none;white-space:nowrap;outline:none;" +
      "font-family:var(--font-mono,Consolas,'Cascadia Mono',Menlo,'Microsoft YaHei UI','Microsoft YaHei',monospace);" +
      "font-size:var(--ui-font-size,14px);line-height:1;font-variant-numeric:tabular-nums;color:#afafb2;transition:background-color .15s}" +
      ".zu-git:hover,.zu-git:focus-visible{background:var(--color-hover,rgba(255,255,255,.08))}" +
      ".zu-git>svg{width:16px;height:16px;flex:0 0 auto}" +
      ".zu-git .zu-git-ins{color:#aae6aa}" +
      ".zu-git .zu-git-del{color:#f09696}" +
      ".zu-git .zu-git-unt{color:#f0e6a0}" +
      ".zu-git-conflict{color:#f09696}" +
      ".zu-git-warn{color:#f0e6a0}" +
      ".zu-git-op{color:#afafb2}" +
      ".zu-git-sep{opacity:.6}" +
      ".zu-git.zu-compact .zu-git-name,.zu-git.zu-compact .zu-git-ab{display:none}" +
      ".zu-git.zu-compact.zu-git-multi .zu-git-d{display:none}" +   // v96 multi 紧凑：聚合计数段一并收起（单仓紧凑保留行数段）
      "@keyframes zugitspin{to{transform:rotate(360deg)}}" +
      ".zu-git.zu-gbusy>svg{animation:zugitspin .8s linear infinite}" +
      ".zu-git[data-zusage-light]{color:#6c6f85}" +
      ".zu-git[data-zusage-light] .zu-git-ins{color:#2da587}" +
      ".zu-git[data-zusage-light] .zu-git-del{color:#d20f39}" +
      ".zu-git[data-zusage-light] .zu-git-unt{color:#df8e1d}" +
      ".zu-git[data-zusage-light] .zu-git-conflict{color:#d20f39}" +
      ".zu-git[data-zusage-light] .zu-git-warn{color:#946200}" +
      ".zu-git[data-zusage-light] .zu-git-op{color:#626579}" +
      /* v96 multi：脏仓段黄（有冲突时 .zu-conflict 整段红）+ 聚合改动计数 M 黄；浅色档同源深化/加浓值 */
      ".zu-git .zu-git-dirty{color:#f0e6a0}" +
      ".zu-git.zu-conflict .zu-git-dirty{color:#f09696}" +
      ".zu-git .zu-git-m{color:#f0e6a0}" +
      ".zu-git[data-zusage-light] .zu-git-dirty{color:#df8e1d}" +
      ".zu-git[data-zusage-light].zu-conflict .zu-git-dirty{color:#d20f39}" +
      ".zu-git[data-zusage-light] .zu-git-m{color:#df8e1d}" +
      /* v96 套餐额度 chip（原生上下文按钮左侧，wrapper 内前插）：多窗分段样式——每个窗口
       * 一段（中文 5小时/7天，英文 5h/7d）各自按 80/95/100 上档位色；余额类型单段
       * （阶段 3 数据源接入即显示）；容器不再着色，颜色只落在分段上。 */
      ".zu-quota{display:inline-flex;align-items:center;gap:5px;height:1.75rem;padding:0 6px;border-radius:.5rem;cursor:pointer;user-select:none;flex:0 0 auto;" +
      "font-family:var(--font-mono,Consolas,'Cascadia Mono',Menlo,'Microsoft YaHei UI','Microsoft YaHei',monospace);font-size:calc(var(--ui-font-size,14px) - 1px);font-weight:700;font-variant-numeric:tabular-nums;line-height:1}" +
      ".zu-quota:hover,.zu-quota:focus-visible{background:var(--color-hover,rgba(255,255,255,.08));outline:none}" +
      ".zu-qseg{color:#3ecf8e;white-space:nowrap}" +
      ".zu-qseg.warm{color:#f5b944}.zu-qseg.hot{color:#ff6b57}" +
      ".zu-qseg.exc{color:var(--color-destructive,#ff2d55);text-shadow:0 0 8px rgba(255,45,85,.5);animation:zuexc 1.1s ease-in-out infinite}" +
      ".zu-qsep{color:var(--color-foreground-subtle,rgba(255,255,255,.28));font-weight:400}" +
      ".zu-quota.zu-qstale{opacity:.6}" +
      ".zu-quota.zu-qbusy{animation:zupulse 1s ease-in-out infinite}" +
      ".zu-quota .zu-qwarn{font-size:.85em;line-height:1}" +
      ".zu-quota[data-zusage-light] .zu-qseg{color:#0f9d6c}" +
      ".zu-quota[data-zusage-light] .zu-qseg.warm{color:#b6791a}" +
      ".zu-quota[data-zusage-light] .zu-qseg.hot{color:#d8482f}" +
      ".zu-quota[data-zusage-light] .zu-qseg.exc{text-shadow:none}" +
      /* 阶段 3 ⚙ 源列表（v103 布局）：每源一张圆角小卡片（dsh QuotaCard 同款），卡片间距与
       * 内边距呼吸开；凭据框限宽不拉满；说明段落（card 直子 pnote）补水平边距 */
      ".zu-src-list{display:flex;flex-direction:column;gap:8px;padding:4px 12px 12px}" +
      ".zu-src-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:10px 12px 11px;" +
      "border:1px solid var(--color-border,rgba(255,255,255,.08));border-radius:10px}" +
      ".zu-src-name{display:flex;align-items:center;gap:8px;flex:0 0 auto;font-weight:600}" +
      ".zu-src-status{flex:1 1 auto;min-width:0;color:var(--color-tooltip-tag-foreground,#a6a6a6);font-size:calc(var(--ui-font-size,14px) - 2px)}" +
      ".zu-src-refresh{background:none;border:none;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:2px 4px}" +
      ".zu-src-refresh:disabled{opacity:.4;cursor:default}" +
      ".zu-src-refresh:hover{color:var(--color-foreground,#fafafa)}" +
      ".zu-src-fields{flex-basis:100%;display:flex;gap:8px;flex-wrap:wrap}" +
      ".zu-src-field{flex:1 1 220px;max-width:420px;min-width:0;background:rgba(0,0,0,.25);border:1px solid var(--color-border,rgba(255,255,255,.12));border-radius:6px;color:inherit;padding:4px 9px;font-family:var(--font-mono,monospace);font-size:calc(var(--ui-font-size,14px) - 2px)}" +
      /* v102 预设模板：官方域变体一键填充 chip + 控制台取 Key 链接 */
      ".zu-src-presets{flex-basis:100%;display:flex;gap:6px;flex-wrap:wrap;align-items:center}" +
      ".zu-src-preset{background:none;border:1px solid var(--color-border,rgba(255,255,255,.14));border-radius:999px;" +
      "color:var(--color-foreground-subtle,#8791a3);font:inherit;font-size:calc(var(--ui-font-size,14px) - 2px);line-height:1.4;padding:1px 9px;cursor:pointer}" +
      ".zu-src-preset:hover{color:var(--color-foreground,#e9edf4);border-color:var(--color-border-hover,rgba(255,255,255,.22))}" +
      ".zu-src-preset.on{color:var(--color-brand,#57c7ff);border-color:var(--color-brand,#57c7ff)}" +
      ".zu-src-keyurl{background:none;border:0;color:var(--color-brand,#57c7ff);font:inherit;font-size:calc(var(--ui-font-size,14px) - 2px);line-height:1.4;padding:2px 4px;cursor:pointer;white-space:nowrap}" +
      ".zu-src-keyurl:hover{text-decoration:underline}" +
      /* 子代理运行中呼吸灯 */
      "@keyframes zupulse{0%,100%{opacity:1}50%{opacity:.2}}" +
      ".dot{animation:zupulse 1.6s ease-in-out infinite;font-size:var(--ui-font-size,14px);line-height:1}" +
      /* 面板（v80 起 fixed 挂 body）：原 absolute 挂 bar、bottom:calc(100%+10px) 向上展开，
       * 但 in-card 形态下条长在输入卡片（overflow-hidden）内部，面板会被卡片裁掉——
       * 照 .tip/.zusage-exc 的 body+fixed 模式迁移，left/top 由 position*Panel 每帧按条矩形写。 */
      ".panel{position:fixed;background:rgba(19,22,30,.97);" +
      "background:color-mix(in srgb,var(--color-card,#13161e) 96%,transparent);" +
      "backdrop-filter:blur(18px) saturate(1.3);-webkit-backdrop-filter:blur(18px) saturate(1.3);" +
      "border:1px solid var(--color-border,rgba(255,255,255,.09));border-radius:12px;padding:12px 14px;display:none;" +
      "flex-direction:column;gap:4px;" +
      "font-family:var(--font-mono,Consolas,Menlo,'Microsoft YaHei UI',monospace);" +
      "font-size:calc(var(--ui-font-size,14px) - 1px);line-height:1.6;color:var(--color-foreground,#c6cdd9);" +
      "box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 12px 32px rgba(0,0,0,.5),0 2px 8px rgba(0,0,0,.35);" +
      "min-width:280px;max-width:480px;max-height:72vh;overflow:auto;white-space:normal;z-index:2147483647;" +
      "scrollbar-width:thin;scrollbar-color:var(--color-border,rgba(255,255,255,.14)) transparent}" +
      ".panel.open{display:flex}" +
      ".panel::-webkit-scrollbar{width:8px}" +
      ".panel::-webkit-scrollbar-thumb{background:var(--color-border,rgba(255,255,255,.14));border-radius:999px}" +
      ".panel label{display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:5px 8px;margin:0 -8px;" +
      "border-radius:8px;transition:background-color .12s ease-out}" +
      ".panel input[type=text]{width:110px;background:var(--color-input,rgba(0,0,0,.3));border:1px solid var(--color-border,rgba(255,255,255,.14));" +
      "color:var(--color-foreground,#e9edf4);border-radius:6px;padding:2px 7px;font:inherit;outline:none}" +
      ".panel input[type=text]:focus{border-color:var(--color-brand,#57c7ff);box-shadow:0 0 0 2px rgba(87,199,255,.15)}" +
      ".panel .hr{border-top:1px solid var(--color-border,rgba(255,255,255,.08));margin:5px 0}" +
      ".panel .cap{color:var(--color-foreground-subtlest,#6b7484);margin:4px 0 2px;font-size:calc(var(--ui-font-size,14px) - 2px);letter-spacing:.08em}" +
      ".panel .phead{font-weight:700;color:var(--color-foreground,#eef2f8);font-size:calc(var(--ui-font-size,14px) + 2px);margin-bottom:5px;display:flex;align-items:center;gap:8px}" +
      ".panel .pver{color:var(--color-brand,#57c7ff);font-weight:400;font-size:calc(var(--ui-font-size,14px) - 2px);background:rgba(87,199,255,.12);background:color-mix(in srgb,var(--color-brand,#57c7ff) 12%,transparent);border-radius:999px;padding:1px 8px}" +
      ".panel label em{font-style:normal;color:var(--color-foreground-subtle,#6f7989);display:block}" +
      ".panel input[type=checkbox]{accent-color:var(--color-brand,#57c7ff);margin-top:3px}" +
      ".panel .pnote{line-height:1.6;color:var(--color-foreground-subtle,#6f7989);margin-top:3px}" +
      ".panel .zu-update-actions{display:flex;gap:8px;margin:5px 0}" +
      ".panel .zu-update-actions button{font:inherit;color:var(--color-foreground,#e9edf4);background:var(--color-hover,rgba(255,255,255,.07));border:1px solid var(--color-border,rgba(255,255,255,.14));border-radius:6px;padding:3px 10px;cursor:pointer}" +
      ".panel .zu-update-actions button:disabled{opacity:.5;cursor:default}" +
      ".panel .zu-update-status{overflow-wrap:anywhere;white-space:pre-line}" +
      /* 更新进度（v89）：下载条按字节，安装条按校验/安装/同步三段推进；宿主安装器没有
       * 字节进度，用扫光动画表示仍在活动。主进程未推送 progress（旧版 updater）时整块隐藏。 */
      ".panel .zu-update-progress{display:flex;flex-direction:column;gap:6px;margin:6px 0 2px}" +
      ".panel .zu-update-progress[hidden]{display:none}" +
      ".panel .zu-progress-row{display:flex;align-items:center;gap:8px;font-size:calc(var(--ui-font-size,14px) - 1px);color:var(--color-foreground-subtle,#6f7989)}" +
      ".panel .zu-progress-label{flex:0 0 2.5em}" +
      ".panel .zu-progress-track{flex:1;height:6px;border-radius:999px;background:var(--color-hover,rgba(255,255,255,.08));overflow:hidden}" +
      ".panel .zu-progress-fill{height:100%;width:0;border-radius:999px;background:var(--color-brand,#57c7ff);transition:width .2s ease}" +
      ".panel .zu-progress-fill.active{background-image:linear-gradient(90deg,transparent 0,rgba(255,255,255,.4) 50%,transparent 100%);background-size:48px 100%;background-repeat:no-repeat;animation:zuProgressSweep 1.1s linear infinite}" +
      ".panel .zu-progress-value{flex:0 0 auto;min-width:3em;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      "@keyframes zuProgressSweep{from{background-position:-48px 0}to{background-position:calc(100% + 48px) 0}}" +
      ".panel.zu-settings{box-sizing:border-box;min-width:0;max-width:none;" +
      "max-height:min(72vh,var(--zu-settings-height,72vh));padding:0;gap:0;overflow:hidden;line-height:1.5}" +
      ".zu-settings .zu-settings-head{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;" +
      "padding:14px 16px;border-bottom:1px solid var(--color-border,rgba(255,255,255,.09))}" +
      ".zu-settings .phead{margin:0;font-size:var(--ui-font-size,14px);font-weight:600}" +
      ".zu-settings .zu-settings-close{background:none;border:0;font:inherit;color:var(--color-foreground-subtle,#8791a3);" +
      "padding:2px 6px;border-radius:6px;cursor:pointer}" +
      ".zu-settings .zu-settings-close:hover{background:var(--color-hover,rgba(255,255,255,.07))}" +
      /* 分区布局（v100）：左栏分组导航 + 右侧内容区（一次只显示一个分区），ZCode 设置页同款双栏 */
      ".zu-settings .zu-settings-layout{flex:1;min-height:0;display:flex}" +
      ".zu-settings .zu-settings-nav{flex:0 0 auto;width:164px;overflow-y:auto;padding:2px 8px 12px;scrollbar-width:thin;" +
      "scrollbar-color:var(--color-foreground-subtlest,#6b7484) transparent;border-right:1px solid var(--color-border,rgba(255,255,255,.09))}" +
      ".zu-settings .zu-settings-nav::-webkit-scrollbar{width:8px}" +
      ".zu-settings .zu-settings-nav::-webkit-scrollbar-thumb{background:var(--color-foreground-subtlest,#6b7484);border:2px solid transparent;background-clip:padding-box;border-radius:999px}" +
      ".zu-settings .zu-settings-navgroup+.zu-settings-navgroup{margin-top:16px}" +
      ".zu-settings .zu-navcap{padding:0 10px 5px;font-size:calc(var(--ui-font-size,14px) - 2px);font-weight:500;letter-spacing:0;" +
      "color:var(--color-remote-foreground-muted,#8d95a5)}" +
      /* 导航项：ZCode 侧栏同款 32px 行 + 12px 圆角 + surface-hover 激活底；图标恒为前景色 */
      ".zu-settings .zu-navitem{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 10px;border:0;border-radius:12px;" +
      "background:none;font:inherit;font-size:var(--ui-font-size,14px);line-height:1.4;text-align:left;cursor:pointer;" +
      "color:var(--color-remote-foreground-muted,#8d95a5);transition:background-color .12s ease-out,color .12s ease-out}" +
      ".zu-settings .zu-navitem:hover,.zu-settings .zu-navitem[aria-current]{background:var(--color-surface-hover,rgba(255,255,255,.08));color:var(--color-foreground,#e9edf4)}" +
      ".zu-settings .zu-nav-ic{flex:0 0 16px;display:inline-flex;align-items:center;justify-content:center;color:var(--color-foreground,#e9edf4)}" +
      ".zu-settings .zu-nav-ic svg{width:16px;height:16px;display:block}" +
      ".zu-settings .zu-nav-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      /* 窄条收成 icon rail（ZCode max-lg icon-only 同语义；阈值由 syncSettingsScroll 按面板实测宽切换） */
      ".zu-settings.zu-nav-icons .zu-settings-nav{width:52px;padding:2px 6px 12px}" +
      ".zu-settings.zu-nav-icons .zu-navitem{justify-content:center;padding:0}" +
      ".zu-settings.zu-nav-icons .zu-nav-label,.zu-settings.zu-nav-icons .zu-navcap{" +
      "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}" +
      ".zu-settings .zu-settings-body{flex:1;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;" +
      "padding:12px 12px 16px;scrollbar-width:thin;scrollbar-color:var(--color-foreground-subtlest,#6b7484) transparent}" +
      ".zu-settings-body::-webkit-scrollbar{width:8px}" +
      ".zu-settings-body::-webkit-scrollbar-thumb{background:var(--color-foreground-subtlest,#6b7484);border:2px solid var(--color-card,#13161e);border-radius:999px}" +
      ".zu-settings.zu-settings-more .zu-settings-body{mask-image:linear-gradient(#000 calc(100% - 16px),transparent)}" +
      /* 分区标题（v100）：单分区视图下 cap 即该页标题，提级为前景色 + 略大字号 */
      ".zu-settings .cap{margin:0 0 8px;letter-spacing:0;color:var(--color-foreground,#e9edf4);font-weight:600;" +
      "font-size:calc(var(--ui-font-size,14px) + 1px)}" +
      ".zu-settings .zu-settings-card{border:1px solid var(--color-border,rgba(255,255,255,.09));border-radius:12px;" +
      "background:var(--color-surface,rgba(255,255,255,.04));overflow:hidden}" +
      ".zu-settings label{align-items:center;gap:12px;margin:0;padding:10px 12px;border-radius:0}" +
      ".zu-settings .zu-settings-card>label+label{border-top:1px solid var(--color-border,rgba(255,255,255,.09))}" +
      ".zu-settings label>span{flex:1;min-width:0;font-weight:500}" +
      ".zu-settings label em{font-weight:400;margin-top:2px;font-size:calc(var(--ui-font-size,14px) - 2px);line-height:1.5}" +
      ".zu-settings input[type=checkbox]{appearance:none;-webkit-appearance:none;order:2;position:relative;flex:0 0 28px;" +
      "width:28px;height:16px;margin:0;border:1px solid var(--color-border,rgba(255,255,255,.18));border-radius:999px;" +
      "background:var(--color-input,rgba(255,255,255,.12));cursor:pointer}" +
      ".zu-settings input[type=checkbox]::before{content:'';position:absolute;left:2px;top:2px;width:10px;height:10px;" +
      "border-radius:50%;background:var(--color-foreground-subtle,#8791a3)}" +
      ".zu-settings input[type=checkbox]:checked{background:var(--color-brand,#57c7ff);border-color:var(--color-brand,#57c7ff)}" +
      ".zu-settings input[type=checkbox]:checked::before{left:14px;background:var(--color-background,#13161e)}" +
      ".zu-settings input:focus-visible,.zu-settings button:focus-visible{outline:2px solid var(--color-brand,#57c7ff);outline-offset:2px}" +
      ".zu-settings input:disabled{opacity:.4;cursor:default}" +
      ".zu-settings .zu-ctxov{order:2;box-sizing:border-box;width:120px;min-width:0;padding:5px 7px}" +
      ".zu-settings .zu-settings-langs{display:flex;gap:8px;padding:10px 12px}" +
      ".zu-settings .zu-settings-langs label{flex:1;padding:5px 8px;border:1px solid var(--color-border,rgba(255,255,255,.14));border-radius:6px}" +
      ".zu-settings input[type=radio]{accent-color:var(--color-brand,#57c7ff);margin:0}" +
      ".zu-settings .zu-settings-detail{padding:0 12px 10px}" +
      ".zu-settings .zu-settings-card>.pnote{padding:2px 12px 4px}" +
      ".zu-settings .zu-settings-detail .pnote{font-size:calc(var(--ui-font-size,14px) - 2px)}" +
      ".zu-settings .zu-settings-foot{flex:0 0 auto;display:flex;align-items:center;gap:10px;border-top:1px solid var(--color-border,rgba(255,255,255,.09));padding:9px 12px}" +
      ".zu-settings .zu-settings-scroll{display:block;flex:1;min-width:0;width:auto;border:0;background:none;font:inherit;" +
      "font-size:calc(var(--ui-font-size,14px) - 2px);color:var(--color-brand,#57c7ff);padding:2px;cursor:pointer}" +
      ".zu-settings .zu-settings-scroll:disabled{color:var(--color-foreground-subtle,#8791a3);cursor:default}" +
      /* 反馈按钮（v70）：常驻底栏右缘，点击经 window.open 交由系统默认浏览器打开 issues */
      ".zu-settings .zu-settings-feedback{flex:0 0 auto;font:inherit;font-size:calc(var(--ui-font-size,14px) - 2px);" +
      "color:var(--color-foreground,#e9edf4);background:var(--color-hover,rgba(255,255,255,.07));" +
      "border:1px solid var(--color-border,rgba(255,255,255,.14));border-radius:6px;padding:3px 10px;cursor:pointer}" +
      /* 子代理明细面板（v49）：点击条目弹出的固定面板（与设置面板同机制，互斥打开）；
       * 面板不随鼠标消失，绕开悬停+tab 的全部几何问题。 */
      ".zu-sub{cursor:pointer}" +
      ".zu-sub:hover .v{color:var(--color-foreground,#fff)}" +
      ".panel.subp{width:420px;max-width:60vw;gap:8px}" +
      ".subrow{padding:8px 10px;background:var(--color-surface,rgba(255,255,255,.03));border:1px solid var(--color-border,rgba(255,255,255,.06));border-radius:8px}" +
      ".subname{font-weight:600;color:var(--color-foreground,#e9edf4);font-size:var(--ui-font-size,14px);overflow-wrap:anywhere}" +
      ".substat{color:var(--color-foreground-subtle,#8791a3);margin-top:2px}" +
      ".sublive{color:#3ecf8e;font-size:calc(var(--ui-font-size,14px) - 2px);font-weight:400;background:rgba(62,207,142,.12);border-radius:999px;padding:0 7px;margin-left:7px}" +
      /* 自绘 tooltip（v31）：向上弹出（原生 title 方向不可控且会被窗口下缘遮挡），
       * 支持多 tab；white-space:pre-line 保留数据里的 \n 换行。
       * v32：fixed 挂 body —— 原 absolute 挂 bar，被页面消息流的层叠上下文盖住
       * （diag 实证 disp=block 但不可见），挂 body 用视口坐标独立定位。
       * v81：底色/边框/文字改宿主 Radix Tooltip 同款（bg-tooltip + border-border +
       * text-tooltip-foreground，反色底：暗色主题白底黑字、浅色主题黑底白字），
       * 内部次级文字用宿主 tooltip-tag 系变量；毛玻璃在实色底下无意义，删。 */
      ".tip{position:fixed;background:var(--color-tooltip,#171717);" +
      "border:1px solid var(--color-border,transparent);border-radius:10px;padding:8px 12px;" +
      "font-family:var(--font-mono,Consolas,'Microsoft YaHei UI',monospace);" +
      "font-size:calc(var(--ui-font-size,14px) - 1px);line-height:1.6;color:var(--color-tooltip-foreground,#fafafa);" +
      "box-shadow:0 10px 28px rgba(0,0,0,.5),0 2px 6px rgba(0,0,0,.3);" +
      "white-space:pre-line;z-index:2147483646;max-width:560px;display:none;scrollbar-width:thin}" +
      /* 结构化 tooltip 行排版（v67.1，与统计行悬停解释同款；仅状态条 .tip 作用域）
       * v81：前景色系改 tooltip 语境（反色底上 --color-foreground 会与底同色不可读） */
      ".tip .rt-h{font-weight:600;color:var(--color-tooltip-foreground,#fafafa);margin:0 0 6px}" +
      ".tip .rt-row{display:flex;gap:10px;margin:3px 0}" +
      ".tip .rt-row b{flex:0 0 auto;min-width:86px;color:var(--color-tooltip-foreground,#fafafa);font-weight:600}" +
      ".tip .rt-row span{color:var(--color-tooltip-tag-foreground,#a6a6a6)}" +
      ".tip .rt-note{margin-top:7px;padding-top:6px;border-top:1px solid var(--color-border,transparent);color:var(--color-tooltip-tag-foreground,#a6a6a6)}" +
      ".ttabs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:7px}" +
      ".ttab{cursor:pointer;padding:2px 10px;border-radius:999px;background:var(--color-tooltip-tag,#262626);" +
      "color:var(--color-tooltip-tag-foreground,#a6a6a6);white-space:nowrap;font-size:calc(var(--ui-font-size,14px) - 1px);" +
      "transition:background-color .12s ease-out,color .12s ease-out}" +
      ".ttab:hover{color:var(--color-tooltip-foreground,#fafafa);background:color-mix(in srgb,var(--color-tooltip-foreground,#fafafa) 12%,transparent)}" +
      ".ttab.on{background:color-mix(in srgb,var(--color-brand,#5ac8ff) 16%,transparent);color:var(--color-brand,#5ac8ff)}" +
      ".tbody{max-height:60vh;overflow:auto;scrollbar-width:thin}" +
      ".tbody::-webkit-scrollbar{width:8px}" +
      ".tbody::-webkit-scrollbar-thumb{background:var(--color-border,rgba(255,255,255,.14));border-radius:999px}" +
      /* 超限告警气泡（v39）：挂 body 的独立浮层（与 .tip 同套路，免受条面重建影响），
       * 红边警示 + 建议步骤 + 可点击复制的会话 ID；user-select:text 允许手动选中兜底。
       * 底色 = 客户端 destructive 掺背景色：深色下深红黑、浅色下淡粉，自动适配。 */
      ".zusage-exc{position:fixed;max-width:470px;" +
      "background:linear-gradient(180deg,rgba(41,18,22,.98),rgba(27,14,16,.98));" +
      "background:linear-gradient(180deg,color-mix(in srgb,var(--color-destructive,#ff2d55) 10%,var(--color-background,#1b0e10)),color-mix(in srgb,var(--color-destructive,#ff2d55) 5%,var(--color-background,#1b0e10)));" +
      "border:1px solid rgba(255,45,85,.4);border-color:color-mix(in srgb,var(--color-destructive,#ff2d55) 40%,transparent);" +
      "border-radius:12px;padding:12px 15px;" +
      "font-family:var(--font-mono,Consolas,'Microsoft YaHei UI',monospace);" +
      "font-size:calc(var(--ui-font-size,14px) - 1px);line-height:1.7;color:var(--color-foreground,#e9edf4);" +
      "box-shadow:0 12px 32px rgba(0,0,0,.5),0 4px 18px rgba(255,45,85,.12);white-space:normal;z-index:2147483647;" +
      "user-select:text;display:none}" +
      ".zusage-exc .xb-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}" +
      ".zusage-exc .xb-title{font-weight:700;color:var(--color-destructive,#ff5c77)}" +
      ".zusage-exc .xb-step{color:var(--color-foreground-subtle,#c6cdd9)}" +
      ".zusage-exc .xb-close{cursor:pointer;color:var(--color-foreground-subtlest,#8791a5);padding:2px 5px;border-radius:6px;font-size:calc(var(--ui-font-size,14px) + 2px);line-height:1}" +
      ".zusage-exc .xb-close:hover{color:var(--color-foreground,#fff);background:var(--color-hover,rgba(255,255,255,.08))}" +
      ".zusage-exc .xb-sid{color:var(--color-brand,#57c7ff);cursor:pointer;text-decoration:underline dotted}" +
      ".zusage-exc .xb-sid:hover{text-decoration-style:solid}" +
      ".zusage-exc .xb-copied{color:#3ecf8e;margin-left:6px;display:none}" +
      /* 白色主题程度性覆盖（v58.1）：颜色已全量走客户端变量随 .dark 自动翻转，
       * 这里只兜两类 —— 程度差（浅色下阴影/内高光减重、红字光晕收掉）与
       * 三档状态色加深版（高对比自调档，见 .ok 注释）。 */
      /* :not(.zu-in) 保特异性：in-card 形态（v80）自身声明 box-shadow:none 且定义在前，
       * 同特异性的浅色阴影会反超——透明无框条上浮出一圈浅影（review 抓获） */
      ".zusage-root.zu-light:not(.zu-in){box-shadow:inset 0 1px 0 rgba(255,255,255,.85),0 4px 14px rgba(15,23,42,.12),0 1px 3px rgba(15,23,42,.08)}" +
      ".panel.zu-light{box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 12px 32px rgba(15,23,42,.14),0 2px 8px rgba(15,23,42,.08)}" +
      /* v81：反色底后 tip 的 inset 白高光在浅色主题（黑底 tip）上违和，浅色只调淡外阴影 */
      ".tip.zu-light{box-shadow:0 10px 28px rgba(15,23,42,.16),0 2px 6px rgba(15,23,42,.08)}" +
      ".zusage-exc.zu-light{box-shadow:0 12px 32px rgba(15,23,42,.14),0 4px 18px rgba(220,38,38,.1)}" +
      ".zu-light .exc{text-shadow:none}" +
      ".zu-light .ok{color:#0f9d6c}.zu-light .warm{color:#b6791a}.zu-light .hot{color:#d8482f}" +
      ".zu-light .sublive{color:#0c8a63;background:rgba(15,140,102,.12)}" +
      ".zu-light .xb-copied{color:#0c8a63}" +
      /* 减少动态偏好：关闭呼吸/闪烁与悬浮过渡 */
      "@media (prefers-reduced-motion:reduce){.exc,.dot,.zu-compact-dlg,.zu-compact-card{animation:none}" +
      ".it,.btn,.ttab,.panel label{transition:none}}" +
      /* v105 压缩上下文：弹层内胶囊按钮 + 确认弹框。配色全量引用客户端语义变量
       * （secondary/primary/popover/border/hover，明暗与 zai 主题自动跟随）；color-mix
       * 处加同值前置声明（不支持时落实色）。按钮复刻原生 hover:bg-secondary/80。 */
      ".zu-compact-btn{display:block;box-sizing:border-box;width:100%;height:36px;padding:0;border:0;border-radius:9999px;" +
      "background:var(--color-secondary,#e5e5e5);color:var(--color-foreground,#0a0a0a);" +
      "font-family:inherit;font-size:14px;font-weight:500;line-height:1;cursor:pointer;" +
      "transition:background .15s}" +
      ".zu-compact-btn:hover{background:var(--color-secondary,#e5e5e5);background:color-mix(in srgb,var(--color-secondary,#e5e5e5) 80%,transparent)}" +
      ".zu-compact-btn:active{background:var(--color-secondary,#e5e5e5);background:color-mix(in srgb,var(--color-secondary,#e5e5e5) 68%,transparent)}" +
      ".zu-compact-dlg{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(0,0,0,.6);animation:zuCptFade .1s ease-out}" +
      ".zu-compact-card{box-sizing:border-box;width:min(92vw,384px);padding:20px;border-radius:16px;" +
      "background:var(--color-popover,#fff);color:var(--color-foreground,#0a0a0a);" +
      "border:1px solid var(--color-border,rgba(0,0,0,.1));box-shadow:0 25px 50px -12px rgba(0,0,0,.45);" +
      "font-family:inherit;font-size:14px;line-height:1.5;animation:zuCptZoom .1s ease-out}" +
      ".zu-compact-title{font-size:16px;font-weight:600}" +
      ".zu-compact-desc{padding-top:8px;color:var(--color-foreground-subtle,#8791a3)}" +
      ".zu-compact-desc b{color:var(--color-foreground,#0a0a0a);font-weight:500;font-variant-numeric:tabular-nums}" +
      ".zu-compact-hint{margin-top:8px;font-size:12.5px;line-height:1.45;color:var(--color-foreground-subtle,#8791a3);opacity:.85}" +
      ".zu-compact-err{display:none;margin-top:10px;padding:8px 10px;border-radius:8px;background:rgba(220,38,38,.1);color:#dc2626;font-size:13px}" +
      ".zu-compact-err.on{display:block}" +
      ".zu-compact-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}" +
      ".zu-compact-foot button{height:36px;padding:0 16px;border-radius:8px;font-family:inherit;font-size:14px;cursor:pointer;" +
      "transition:background .15s,opacity .15s}" +
      ".zu-compact-cancel{background:transparent;border:1px solid var(--color-border,rgba(0,0,0,.1));color:var(--color-foreground,#0a0a0a)}" +
      ".zu-compact-cancel:hover{background:var(--color-hover,#e5e5e5)}" +
      ".zu-compact-ok{border:0;background:var(--color-primary,#0a0a0a);color:var(--color-primary-foreground,#fff)}" +
      ".zu-compact-ok:hover{opacity:.8}" +
      ".zu-compact-ok:disabled{opacity:.5;cursor:default}" +
      "@keyframes zuCptFade{from{opacity:0}to{opacity:1}}" +
      "@keyframes zuCptZoom{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}";

    /* 结构：条撑满卡片宽后 .zu-main 占满剩余宽、条目+分隔线 space-between 均匀分布，
     * ⚙ 落在最右缘（内容超宽时分级收缩、极限右缘渐隐 .zu-clip）；面板 fixed 挂 body，
     * 由 position*Panel 按条矩形定位在条上方（v80 迁移，见挂载处注） */
    var bar = document.createElement("div");
    bar.className = "zusage-root";
    if (slot === 0) bar.id = "zusage-bar";
    bar.style.display = "none";   // 定位成功前不显示（避免占位）
    bar.innerHTML = '<span class="zu-main">…</span>' +
      '<span class="btn zu-gear">⚙</span>';
    var panel = document.createElement("div");
    panel.className = "panel zu-settings";
    /* issue #55：这三个 var 必须先于下方 buildPanel() 的调用完成赋值——var 只提升声明不提升
     * 赋值，而 buildPanel → syncUpdate 首轮执行就会读它们（赋值语句曾排在调用点之后，
     * v1.5.2 首轮读到 undefined 抛 TypeError 拖垮实例创建）。配套函数是声明有提升，留在原位。 */
    var srcListSig = "";
    var SRC_FIELD_LABELS = {
      apiKey: L("API Key", "API Key"), cookie: L("控制台 Cookie", "Console Cookie"), token: L("Token", "Token"),
      accessKeyId: L("AccessKeyId", "AccessKeyId"), secretAccessKey: L("SecretAccessKey", "SecretAccessKey"),
      planCredits: L("套餐 Credits 总量", "Plan credits"), planStart: L("计费锚日 YYYY-MM-DD", "Billing anchor day"),
    };
    var PROGRESS_STAGES = ["download", "verify", "install", "sync"];
    function settingRow(input, title, note) {
      return '<label>' + input + '<span>' + title + '<em>' + note + '</em></span></label>';
    }
    /* ---------- 分区导航（v100，ZCode 设置侧栏同款交互）：左栏三组、内容区单分区显隐 ---------- */
    var ZU_NAV_GROUPS = [
      { id: "basics", zh: "基础", en: "Basics" },
      { id: "data", zh: "数据与统计", en: "Data & stats" },
      { id: "maint", zh: "维护", en: "Maintenance" },
    ];
    var ZU_SECTIONS = [
      { id: "display", group: "basics", zh: "状态条显示", en: "Display items",
        icon: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>' },
      { id: "general", group: "basics", zh: "通用", en: "General",
        icon: '<path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>' },
      { id: "stats", group: "data", zh: "回答统计", en: "Reply statistics",
        icon: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>' },
      { id: "quota", group: "data", zh: "套餐额度", en: "Plan quota",
        icon: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>' },
      { id: "update", group: "maint", zh: "插件更新", en: "Plugin updates",
        icon: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 21H3v-5"/>' },
      { id: "about", group: "maint", zh: "关于数据", en: "About the data",
        icon: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>' },
    ];
    function activeSettingsSec() {
      for (var i = 0; i < ZU_SECTIONS.length; i++) if (ZU_SECTIONS[i].id === state.settingsSec) return state.settingsSec;
      return ZU_SECTIONS[0].id;
    }
    function secOpen(id) { return activeSettingsSec() === id ? "" : " hidden"; }
    function navHtml() {
      var active = activeSettingsSec();
      var html = '<nav class="zu-settings-nav" aria-label="' + L("设置分区", "Settings sections") + '">';
      for (var g = 0; g < ZU_NAV_GROUPS.length; g++) {
        var grp = ZU_NAV_GROUPS[g], gid = "zu-navgroup-" + grp.id;
        html += '<div class="zu-settings-navgroup" role="group" aria-labelledby="' + gid + '">' +
          '<div class="zu-navcap" id="' + gid + '">' + L(grp.zh, grp.en) + '</div>';
        for (var s = 0; s < ZU_SECTIONS.length; s++) {
          var it = ZU_SECTIONS[s];
          if (it.group !== grp.id) continue;
          html += '<button type="button" class="zu-navitem" data-sec="' + it.id + '"' + (it.id === active ? ' aria-current="page"' : '') +
            '><span class="zu-nav-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + it.icon + '</svg></span>' +
            '<span class="zu-nav-label">' + L(it.zh, it.en) + '</span></button>';
        }
        html += '</div>';
      }
      return html + '</nav>';
    }
    /* 面板文案可随语言重建（事件走 panel 级委托，重建不丢监听） */
    function buildPanel() {
      var oldBody = panel.querySelector(".zu-settings-body");
      var scrollTop = oldBody ? oldBody.scrollTop : 0;
      panel.innerHTML =
      '<div class="zu-settings-head"><div class="phead">' + L("状态条设置", "Status bar settings") + '<span class="pver zu-settings-version"></span></div>' +
      '<button type="button" class="zu-settings-close" aria-label="' + L("关闭设置", "Close settings") + '">✕</button></div>' +
      '<div class="zu-settings-layout">' + navHtml() +
      '<div class="zu-settings-body" tabindex="0" role="region" aria-label="' + L("状态条设置选项", "Status bar settings options") + '">' +
      '<section class="zu-settings-section" data-sec="display"' + secOpen("display") + '><div class="cap">' + L("状态条显示", "Display items") + '</div><div class="zu-settings-card">' +
      settingRow('<input type="checkbox" data-k="turn">', L("本轮", "Current turn"), L("tokens、请求次数、耗时与首字延迟", "Tokens, requests, duration and first-token latency")) +
      settingRow('<input type="checkbox" data-k="win">', L("会话累计", "Session total"), L("当前会话的 tokens、轮数与请求次数", "Tokens, turns and requests in this session")) +
      settingRow('<input type="checkbox" data-k="tools">', L("工具调用", "Tool calls"), L("悬停查看各工具明细与错误", "Hover for per-tool details and errors")) +
      settingRow('<input type="checkbox" data-k="today">', L("今日合计", "Today's total"), L("今天所有会话的消耗", "Usage across all sessions today")) +
      settingRow('<input type="checkbox" data-k="sub">', L("子代理", "Sub-agents"), L("点击状态条上的子代理查看明细", "Click the bar item for sub-agent details")) +
      settingRow('<input type="checkbox" data-k="git">', L("Git 状态", "Git status"), L("「电脑操作」按钮右侧显示当前分支、↑领先 ↓落后与未提交改动（+插入行 -删除行 ?未跟踪）；仅本地仓库", "Branch, ↑ahead ↓behind and uncommitted changes (+ins -del ?untracked) beside the Computer Use button; local repositories only")) +
      '</div></section>' +
      '<section class="zu-settings-section" data-sec="general"' + secOpen("general") + '><div class="cap">' + L("通用", "General") + '</div><div class="zu-settings-card">' +
      settingRow('<input type="text" class="zu-ctxov" inputmode="numeric" aria-label="' + L("上下文窗口", "Context window") + '" placeholder="' + L("自动（按模型）", "Auto (model)") + '">', L("上下文窗口", "Context window"), L("留空自动识别，优先使用客户端数值", "Leave empty to detect automatically; prefer the client value")) +
      /* 万/亿开关只在中文界面出现（英文始终 K/M/B，见 fmt），因此文案不走 L() */
      (state.lang === "en" ? "" : settingRow('<input type="checkbox" class="zu-cn-num">', "中文单位（万/亿）", "token 数量以万/亿显示，默认开启")) +
      '<div class="zu-settings-langs"><label><input type="radio" name="zu-lang" value="zh"><span>中文</span></label>' +
      '<label><input type="radio" name="zu-lang" value="en"><span>English</span></label></div></div></section>' +
      '<section class="zu-settings-section" data-sec="stats"' + secOpen("stats") + '><div class="cap">' + L("回答统计", "Reply statistics") + '</div><div class="zu-settings-card">' +
      settingRow('<input type="checkbox" class="zu-rate-line">', L("回答末尾追加统计行", "Append stats to each reply"), L("默认开启，下一次提问生效。包含速率（含思考）、首字延迟、输出量、生成耗时、段数峰值与会话累计。", "On by default; effective on the next prompt. Includes speed (with thinking), first-token latency, output, duration, segments/peak and session total.")) +
      '</div></section>' +
      '<section class="zu-settings-section" data-sec="quota"' + secOpen("quota") + '><div class="cap">' + L("套餐额度", "Plan quota") + '</div><div class="zu-settings-card">' +
      settingRow('<input type="checkbox" class="zu-quota-enable">', L("显示套餐额度", "Show plan quota"), L("在输入框上下文按钮左侧显示当前登录账号编码套餐的已用比例与重置时间（账号级套餐池，不是单个模型独享）。默认关闭。点击 chip 立即刷新。", "Shows the signed-in account's coding-plan usage and reset time left of the context button (account-level pool, not per model). Off by default. Click the chip to refresh.")) +
      '<div class="pnote">' + L("开启后主进程读取本机 ZCode 登录凭据（~/.zcode/v2/credentials.json）查询官方套餐接口：凭据仅在内存使用、不落盘、不进日志与诊断：内置套餐发往 bigmodel.cn / api.z.ai 官方域；自定义供应商余额用其自己的 key，只发其官方域（api.deepseek.com、openrouter.ai、api.siliconflow.cn、api.minimaxi.com、api.kimi.com、api.commandcode.ai、api.cline.bot、api.anthropic.com、platform.xiaomimimo.com、open.volcengineapi.com、opencode.ai 等）或你配置的中转站本域。套餐支持 BigModel / Z.ai 个人档与多家 Token Plan/余额（见下方数据源列表）；团队套餐暂不支持，识别不了余额形状的中转不显示。启用 Anthropic 源时会读取本机 Claude Code 的登录凭据（~/.claude/.credentials.json）查询其官方用量接口，同样仅在内存使用。",
        "When on, credentials are read in memory to query plan/balance endpoints and never reach disk, logs or diagnostics: built-in plans go to bigmodel.cn / api.z.ai; custom-provider lookups use that provider's own key and go only to its official domain (api.deepseek.com, openrouter.ai, api.siliconflow.cn, api.minimaxi.com, api.kimi.com, api.commandcode.ai, api.cline.bot, api.anthropic.com, platform.xiaomimimo.com, open.volcengineapi.com, opencode.ai, ...) or the relay base URL you configured — never anywhere else. Multiple Token Plan / balance vendors are supported (see the source list below); team plans are not. Enabling the Anthropic source additionally reads the local Claude Code credential (~/.claude/.credentials.json) for its official usage endpoint, in memory only.") + '</div>' +
      '<div class="zu-src-list"></div>' +
      '<div class="pnote">' + L("每个数据源独立启用、独立刷新；凭据只保存在本机 quota-secrets.json（0600），不进日志与诊断。标 * 的厂商为源码转写适配，未经真实账号实测。", "Each source has its own toggle and refresh; credentials stay in the local quota-secrets.json (0600), never in logs or diagnostics. Vendors marked * are ported from reference projects without live verification.") + '</div></div></section>' +
      '<section class="zu-settings-section" data-sec="update"' + secOpen("update") + '><div class="cap">' + L("插件更新", "Plugin updates") + '</div><div class="zu-settings-card">' +
      settingRow('<input type="checkbox" class="zu-auto-update">', L("自动更新", "Automatic updates"), L("每 24 小时检查并安装新版，默认开启", "Check and install every 24 hours; on by default")) +
      '<div class="zu-settings-detail"><div class="zu-update-actions"><button type="button" data-update="check">' + L("检查更新", "Check for updates") + '</button><button type="button" data-update="update">' + L("立即更新", "Update now") + '</button></div>' +
      '<div class="pnote zu-update-status" role="status" aria-live="polite"></div>' +
      '<div class="zu-update-progress" hidden>' +
      '<div class="zu-progress-row" data-progress="download"><span class="zu-progress-label">' + L("下载", "Download") + '</span><div class="zu-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="zu-progress-fill"></div></div><span class="zu-progress-value"></span></div>' +
      '<div class="zu-progress-row" data-progress="install"><span class="zu-progress-label">' + L("安装", "Install") + '</span><div class="zu-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="zu-progress-fill"></div></div><span class="zu-progress-value"></span></div>' +
      '</div>' +
      '<div class="pnote">' + L("仅更新此插件。GitHub/GitCode 来源会联网，本地目录来源只检查本地文件，不上传用量数据。", "Only this plugin is updated. GitHub/GitCode sources use the network; directory sources check local files. Usage data is never uploaded.") + '</div></div></div></section>' +
      '<section class="zu-settings-section" data-sec="about"' + secOpen("about") + '><div class="cap">' + L("关于数据", "About the data") + '</div><div class="pnote">' +
      L("悬停状态条查看明细。数据源 ~/.zcode/cli/db/db.sqlite（只读），请求完成后才落库。", "Hover bar items for details. Data source ~/.zcode/cli/db/db.sqlite (read-only); data is written after requests complete.") + '</div></section></div></div>' +
      '<div class="zu-settings-foot"><button type="button" class="zu-settings-scroll"></button>' +
      '<button type="button" class="zu-settings-feedback">' + L("反馈问题", "Report an issue") + '</button></div>';
      panel.querySelectorAll('input[name=zu-lang]').forEach(function (r) {
        r.checked = state.lang === r.value;
      });
      /* 重建后回填全部控件状态（语言切换路径不走 syncPanel）：checkbox 按 state.show、
         上下文窗口输入框按 state.ctxOv——否则切语言后勾选态清空、首次点击语义反转 */
      panel.querySelectorAll("input[type=checkbox][data-k]").forEach(function (cb) {
        cb.checked = !!state.show[cb.dataset.k];
      });
      var ovInput = panel.querySelector(".zu-ctxov");
      if (ovInput) ovInput.value = state.ctxOv;
      var cnBox = panel.querySelector(".zu-cn-num");
      if (cnBox) cnBox.checked = !!state.cnNum;
      syncUpdate();
      panel.querySelector(".zu-settings-body").scrollTop = scrollTop;
      syncSettingsScroll();
    }
    function syncSettingsScroll() {
      var body = panel.querySelector(".zu-settings-body");
      var button = panel.querySelector(".zu-settings-scroll");
      if (!body || !button) return;
      /* 窄面板（<620px）导航收成 icon rail：ZCode max-lg icon-only 同语义，按面板实测宽切换 */
      panel.classList.toggle("zu-nav-icons", !!panel.offsetWidth && panel.offsetWidth < 620);
      var overflow = body.scrollHeight > body.clientHeight + 2;
      var more = overflow && body.scrollHeight - body.clientHeight - body.scrollTop > 2;
      panel.classList.toggle("zu-settings-more", more);
      button.disabled = !more;
      var text = more ? L("↓ 下方还有设置 · 滚动或点击查看更多", "↓ More settings below · scroll or click to see more") :
        overflow ? L("✓ 已到底部 · 所有设置已展示", "✓ End of settings") : L("所有设置已展示", "All settings are visible");
      if (button.textContent !== text) button.textContent = text;
    }
    function positionSettingsPanel() {
      if (!panel.classList.contains("open")) return;
      var br = bar.getBoundingClientRect();
      var height = Math.max(0, Math.floor(br.top - 18));
      /* v101：高度在打开瞬间按内容自然高锁定（scrollHeight 返回未被 max-height 截断的
       * 完整内容高），此后切分区/内容增减都不改面板高，只随可用上限收紧不放大——
       * 左侧导航切分区时面板高度与底边不再抖动；72vh 上限仍由 CSS max-height 兜底。 */
      if (!panel.style.height) {
        var natural = panel.scrollHeight || panel.offsetHeight || 0;
        panel.style.height = Math.max(0, Math.min(natural, height)) + "px";
      } else if ((parseInt(panel.style.height, 10) || 0) > height) {
        panel.style.height = height + "px";
      }
      var value = height + "px";
      if (panel.style.getPropertyValue("--zu-settings-height") !== value) panel.style.setProperty("--zu-settings-height", value);
      value = br.width + "px";
      if (panel.style.width !== value) panel.style.width = value;
      /* v80：面板 fixed 挂 body——视口坐标贴条上沿（原 absolute 语义 bottom:100%+10px），
       * 左缘随条、可视区内夹紧；top 用开启后的实测面板高，避免底部悬空/重叠。 */
      var left = Math.max(8, Math.min(Math.round(br.left), innerWidth - Math.round(br.width) - 8));
      if (panel.style.left !== left + "px") panel.style.left = left + "px";
      var top = Math.max(8, Math.round(br.top - panel.offsetHeight - 10));
      if (panel.style.top !== top + "px") panel.style.top = top + "px";
      syncSettingsScroll();
    }
    panel.addEventListener("scroll", syncSettingsScroll, true);
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") panel.classList.remove("open");
    });
    buildPanel();
    /* v80：面板挂 body（fixed 视口坐标），不再挂 bar——条长进输入卡片（overflow-hidden）
     * 内部后，absolute 面板会被卡片裁掉。同 .tip 挂 body 的先例；.zusage-panel 类供
     * 全局清理与 isOwnOverlay 命中。 */
    panel.className = "panel zu-settings zusage-panel";
    document.body.appendChild(panel);
    /* 子代理明细面板（v49）：与设置面板同款 .panel 机制，点击条目开关，互斥打开 */
    var subPanel = document.createElement("div");
    subPanel.className = "panel subp zusage-panel";
    document.body.appendChild(subPanel);
    /* 自绘 tooltip：向上弹出（v45 起配空中走廊，移入点击不再被移开即隐掐断）；取代原生 title（方向不可控，在窗口底边会朝下被遮挡） */
    /* 自绘 tooltip 挂 body（fixed 视口坐标）：挂 bar 内会被消息流的层叠上下文盖住（v31 实证） */
    var tip = document.createElement("div");
    tip.className = "tip zusage-tip-root";
    if (slot === 0) tip.id = "zusage-tip";
    tip.style.display = "none";
    document.body.appendChild(tip);
    bar.appendChild(style);           // 样式随条走，不进 head（防清理）
    /* 内联兜底：即使样式表意外失效，定位行为也不退化。
     * z-index 50：压得过聊天列表/输入框外层容器（Tailwind z-20），又不盖权限菜单等弹层（实测值）。 */
    bar.style.position = "fixed";
    bar.style.zIndex = "50";
    document.body.appendChild(bar);

    /* ---------- 超限告警气泡（v39）：当前会话"上下文超限被拒"时自动弹出，随条定位 ---------- */
    var excBubble = document.createElement("div");
    excBubble.className = "zusage-exc";
    /* 文案只进 textContent/静态 innerHTML；会话 ID 是动态数据，一律走 textContent 防注入。
     * 面板语言切换时 rebuildExcBubble() 重建气泡文案。 */
    var excSid, excCopied;
    function rebuildExcBubble() {
      if (excCopied) clearTimeout(excCopied.timer);
      excBubble.innerHTML =
      '<div class="xb-head"><span class="xb-title">' + L("⚠ 上下文超限", "⚠ Context over limit") + '</span>' +
      '<span class="xb-close" aria-label="' + L("关闭，本次不再提醒", "Close; do not remind again this session") + '">✕</span></div>' +
      '<div class="xb-step">' + L("最近一次请求因超出上下文窗口容量被拒绝，本轮对话暂时无法继续。建议依次尝试：",
        "The latest request was rejected for exceeding the context window; this turn cannot continue for now. Try these in order:") + '</div>' +
      '<div class="xb-step">' + L("① 回滚上一轮对话，去掉超限的那次请求后继续；",
        "① Roll back the previous turn, drop the over-limit request and continue;") + '</div>' +
      '<div class="xb-step">' + L("② 换用上下文窗口更大的模型继续，或压缩 / 精简本会话；",
        "② Continue with a larger-window model, or compress / trim this session;") + '</div>' +
      '<div class="xb-step">' + L("③ 仍无法解决时，新开一个对话，把下面的会话 ID（必要时连同工作区路径）发给它，让新会话读取本会话的记录文件接手修复。",
        "③ If that still fails, start a new conversation and send it the session ID below (workspace path if needed) — the new session can pick up this session's rollout files to take over.") + '</div>' +
      '<div>' + L("会话 ID：", "Session ID: ") + '<span class="xb-sid"></span><span class="xb-copied">' + L("已复制", "Copied") + '</span></div>';
      excSid = excBubble.querySelector(".xb-sid");
      excCopied = excBubble.querySelector(".xb-copied");
      excSid.addEventListener("click", onExcSidCopy);
      excBubble.querySelector(".xb-close").addEventListener("click", onExcClose);
    }
    function onExcSidCopy() {
      if (inactive() || !excSid.textContent) return;
      try {
        var ta = document.createElement("textarea");
        ta.value = excSid.textContent;
        ta.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (e) { }
      excCopied.style.display = "inline";
      clearTimeout(excCopied.timer);
      excCopied.timer = setTimeout(function () { excCopied.style.display = "none"; }, 1500);
    }
    function onExcClose() {
      if (inactive()) return;
      excGone = true;
      syncExcBubble();
    }
    rebuildExcBubble();
    document.body.appendChild(excBubble);

    /* ---------- 主题跟随（v58）：深浅由客户端根元素 .dark 类驱动 ----------
     * 客户端主题切换时往 <html> 挂/摘 .dark（zai-dark 时挂；theme-zai-* 同步），整套
     * CSS 变量（--color-background/foreground/border/hover/card/destructive/brand/
     * terminal-* …）随级联翻转，上面的配色自动换装 —— 本块只负责观察 .dark 摘挂，
     * 同步 .zu-light（仅剩阴影/光晕程度性覆盖）。观察类属性而非 matchMedia：
     * 信号源与变量翻转同源，客户端强制浅色+系统深色等错位态不会劈叉。 */
    var rootEl = document.documentElement;
    function themeIsDark() {
      try { return rootEl.classList.contains("dark"); } catch (e) { return true; }
    }
    var themeDark = themeIsDark();
    function applyTheme() {
      bar.classList.toggle("zu-light", !themeDark);
      tip.classList.toggle("zu-light", !themeDark);
      excBubble.classList.toggle("zu-light", !themeDark);
      /* v80：面板挂 body 后不在 bar 的 zu-light 作用域内，自带类（.panel.zu-light） */
      panel.classList.toggle("zu-light", !themeDark);
      subPanel.classList.toggle("zu-light", !themeDark);
    }
    try {
      themeObserver = new MutationObserver(function () {
        var d = themeIsDark();
        if (d !== themeDark) { themeDark = d; applyTheme(); }
      });
      themeObserver.observe(rootEl, { attributes: true, attributeFilter: ["class"] });
    } catch (e) { }
    applyTheme();

    var $ = function (id) { return bar.querySelector(id); };
    var main = bar.querySelector(".zu-main"), gear = bar.querySelector(".zu-gear");

    /* ---------- 渲染 ---------- */
    function fmt(n) {
      n = n || 0;
      if (cnUnits()) {
        if (n >= 1e8) return cnUnit(n / 1e8) + "亿";
        if (n >= 1e4) return cnUnit(n / 1e4) + "万";
        return String(n);
      }
      if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
      if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
      return String(n);
    }
    function cnUnit(x) { return x.toFixed(2).replace(/\.?0+$/, ""); }   // 至多两位小数并去尾零：58.25万、142万、1亿（数字与单位不留空格：等宽字体下空格占满一格）
    function sec(ms) { return ms ? (ms / 1000).toFixed(1) + "s" : "–"; }

    /* 超限判定：最近一次"上下文超限被拒"晚于最近成功请求 = 仍处于超限状态（该请求
     * status=error，不进任何 completed 统计，只能这样单独检测）。html() 与气泡共用。 */
    function excActive(s) {
      return !!(s && s.ctx_exc > 0 && s.ctx_exc >= (s.last_at || 0));
    }

    function cachePct(cache, input) {
      // 无原生 title：原生提示向下弹且与自绘 tooltip 双显闪烁（v33 移除），定义见各项 tooltip 明细
      return input > 0 ? '<span class="dim">' + Math.round(cache / input * 100) + "%</span>" : "";
    }

    /* 上下文分档口径（v93 起唯一消费方是原生按钮增强；原状态条上下文格已删）。
     * cw 优先级：手动覆盖 > 原生按钮 aria-label 读到的总量（nativeCtxVal）> 会话 context_window。 */
    function ctxBandOf(sess) {
      var cw = parseInt(state.ctxOv, 10) || nativeCtxVal || (sess && sess.context_window) || 0;
      var pct = cw ? (sess && sess.ctx || 0) / cw * 100 : 0;
      var exc = excActive(sess);
      /* 占比档位分两套：窗口 ≥100 万时同一百分比的绝对 token 量大，40/60 提前预警；其余维持 70/85。 */
      var big = cw >= 1000000;
      var cls = exc ? "exc" : pct >= (big ? 60 : 85) ? "hot" : pct >= (big ? 40 : 70) ? "warm" : "ok";
      return { cw: cw, pct: pct, cls: cls, exc: exc, big: big };
    }

    /* 显示顺序：本轮 → 会话 → 工具 → 今日 → 子代理；token 后带缓存命中率。
     * v31：条面只放主数值；悬停改自绘 tooltip（向上弹），随渲染以 tips[]
     * 按 .it 顺序挂到元素 __tip，全部为字符串单页（{tabs:[...]} 多 tab 机制 v49 起
     * 无条目使用已删除：子代理改点击面板，tooltip 不再承载 tab 切换）。
     * 缓存写入/思考/重试/错误均 >0 才显示，0 时不产生噪音。 */
    function fmtTime(ms) {
      var d = ms ? new Date(ms) : null;
      return d ? (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" +
        (d.getMinutes() < 10 ? "0" : "") + d.getMinutes() + ":" +
        (d.getSeconds() < 10 ? "0" : "") + d.getSeconds() : "?";
    }
    function fmtStart(ms) {   // 会话时间范围用：完整日期 YYYY-MM-DD HH:MM（跨数日的会话，秒无意义）
      if (!ms) return "?";
      var d = new Date(ms);
      function two(v) { return (v < 10 ? "0" : "") + v; }
      return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) +
        " " + two(d.getHours()) + ":" + two(d.getMinutes());
    }
    function ioc(inp, out, cache, rea, cw) {   // 悬停明细行：输入/输出/缓存命中/缓存写入/思考
      return L("输入 ", "Input ") + fmt(inp) + L(" / 输出 ", " / Output ") + fmt(out) + L(" / 缓存命中 ", " / Cache read ") + fmt(cache) +
        (cw > 0 ? L(" / 缓存写入 ", " / Cache write ") + fmt(cw) : "") +
        (rea > 0 ? L(" / 思考 ", " / Thinking ") + fmt(rea) : "");
    }
    /* 结构化 tooltip（v67.1）：\x01 前缀标记 HTML 内容（drawTip 分流），行/脚注排版与
     * 回复末尾统计行 tooltip 同款；动态值一律过 ttEsc（innerHTML 安全，如工具名/错误文案） */
    function ttEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function ttH(t) { return '<div class="rt-h">' + ttEsc(t) + "</div>"; }
    function ttRow(k, v) { return '<div class="rt-row"><b>' + ttEsc(k) + '</b><span>' + ttEsc(v) + "</span></div>"; }
    function ttNote(v) { return '<div class="rt-note">' + ttEsc(v) + "</div>"; }
    /* v97：live chip（生成速度）的 tooltip 内容——子代理速率是渲染端实时状态（不在泵
     * 快照里），html() 整条渲染与 updateLive 原地改字两条路径都要能生成，抽出共用。
     * 运行中的每个子代理一行（…sid4 · 估 X t/s），并行 ≥2 个时先给合计行。 */
    function buildLiveTip(speedView) {
      var rows =
        ttH(L("生成速度", "Generation speed")) +
        ttRow(L("生成中", "While running"), L("按文本增量算出的字符/s，除以「每 token 字符数」估算 tok/s；该比例取自本会话最近一次完成的真实轮次，随每轮刷新（首轮无样本时用粗略默认值）", "estimated from the text-delta chars/s divided by a chars-per-token ratio; the ratio is calibrated from this session's most recently completed turn and refines each turn (a rough default is used before the first sample)")) +
        ttRow(L("子代理运行中", "Agent running"), L("子智能体运行期间按各自会话文本增量同款估算，主 chip 显示合计；运行中的请求未入本地库，思考文本不外显时无速率、只显示状态词", "while sub-agents run, each is estimated the same way from its own session text deltas and the bar chip shows their sum; in-flight requests are not in the local DB yet, and when thinking text is not exposed there is no rate, only the status word"));
      if (speedView && speedView.phase === "tool") {
        var sids = [], now = Date.now();
        for (var sid in subRate.slots) sids.push(sid);
        sids.sort();
        var fresh = 0;
        for (var i = 0; i < sids.length; i++) {
          var sl = subRate.slots[sids[i]];
          if (sl.rate != null && now - sl.at <= 3000) fresh++;
        }
        if (sids.length) {
          if (fresh > 1) rows += ttRow(L("合计", "Sum"),
            L("估 ", "est ") + subRate.sum.rate.toFixed(1) + L(" t/s（", " t/s (") + fresh + L(" 个）", " running)"));
          for (var j = 0; j < sids.length; j++) {
            var s2 = subRate.slots[sids[j]];
            var tail = String(sids[j]).slice(-4);
            rows += ttRow(L("子代理 …" + tail, "agent …" + tail),
              s2.rate != null && now - s2.at <= 3000
                ? L("估 ", "est ") + s2.rate.toFixed(1) + L(" t/s", " t/s")
                : L("估算中…", "estimating…"));
          }
        }
      }
      rows +=
        ttRow(L("完成后", "When done"), L("切换为本轮真实 tok/s：输出 tokens（含思考）÷ 模型生成时长；本轮缺口径时回退数据库最近一段值", "switches to this turn's real tok/s: output tokens (thinking incl.) ÷ model generation time; falls back to the latest DB segment when this turn's basis is missing")) +
        ttRow(L("档位", "Bands"), L("≥70 绿 · 40–70 黄 · <40 红（仅完成态）", "≥70 green · 40–70 yellow · <40 red (completed only)")) +
        ttNote(L("数据来自 renderer 会话状态（只读桥），实时更新，不经过本地数据库轮询；生成中的数值为字符增量估算", "Data comes from the renderer session state via the read-only bridge, updating live, independent of local database polling; running values are estimated from text deltas"));
      return "\x01" + rows;
    }
    /* 行内 SVG 线性图标（v54）：stroke 走 currentColor，颜色由 .ico 控制统一换色 */
    function ico(paths) {
      return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
    }
    function html(d) {
      var sess = d.session || {}, lt = d.last_turn || {}, today = d.today || {}, last = d.last || {};
      var tls = d.tools || { total: 0, errors: 0, list: [] };
      var items = [], tips = [];
      function it(inner, tip, cls) { items.push('<span class="it' + (cls ? " " + cls : "") + '">' + inner + "</span>"); tips.push(tip || null); }
      if (d.remote) {   // v9：SSH 远程会话（数据取自远端机），置顶徽标标明数据源
        it(ico('<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>') +
          '<span class="dim">' + L("远端", "remote") + "</span>",
          L("数据源：SSH 远程服务器 ", "Data source: remote server over SSH ") + (d.remote_host || "?") + "\n" +
          L("会话数据实时取自远端机的 ZCode 数据库，「今日合计」亦为远端值", "Session data is fetched live from the remote machine's ZCode database; today's total is the remote value") +
          (d.remote_error ? "\n⚠ " + L("最近一次远端查询失败：", "Last remote query failed: ") + d.remote_error : "") +
          (d.remote_stale ? "\n" + L("当前显示最后成功快照，正在重试", "Showing last successful snapshot; retrying") : "") +
          (d.remote_empty ? "\n⚠ " + L("远端库里这个会话还没有已完成的请求（各项为 0）——确认远端 zusage.py 读到的库与远端 ZCode 实际写入的库是同一个",
                                        "The remote database has no completed requests for this session (all items are 0) — check that the remote zusage.py reads the same database the remote ZCode actually writes") : ""));
      }
      if (d.not_local) {   // v62（issue #14）：本地库没有这个会话 —— 全 0 不是插件坏了，是数据不在这儿
        it(ico('<circle cx="12" cy="12" r="9"/><path d="M12 16h.01"/><path d="M12 8h.01"/>') +
          '<span class="dim">' + L("不在本地库", "not in local db") + "</span>",
          L("这个会话不在本地数据库里（~/.zcode/cli/db/db.sqlite 查不到它），所以各项显示 0 —— 不是插件坏了。",
            "This session is not in the local database (~/.zcode/cli/db/db.sqlite), which is why every item reads 0 — the plugin is not broken.") + "\n" +
          (d.remote_enabled
            ? L("已配置 remote 段，但远端查询没有返回它：", "A remote section is configured, but the remote query did not return it: ")
              + (d.remote_error ? L("查询失败 ", "query failed: ") + d.remote_error
                 : L("远端库里也没有这个会话（核对远端 zusage.py 读的库/用户与远端 ZCode 实际写入的是否一致）",
                     "the remote database does not have it either (verify the database/user the remote zusage.py reads matches what the remote ZCode writes)"))
            : L("若这是 SSH/WSL 远程会话：客户端连过的远端工作区会自动被发现并查询（零配置）；没查到时核对远端已部署 zusage.py（WSL 需发行版内有 python3），或在 config.json 配置 remote 段（README「远程会话」；ssh 也可写成 argv 数组，docker exec / wsl --exec / kubectl exec 等通道都能借道）",
                "If this is a remote SSH/WSL session: remote workspaces the client connected to are discovered and queried automatically (zero config); if it's still missing, make sure zusage.py is deployed on the remote machine (WSL needs python3 inside the distro), or add the remote section to config.json (see README; ssh may also be an argv array, so docker exec / wsl --exec / kubectl exec all work)")));
      }
      /* v73：生成速度——桥命中（本 pane 会话有 renderer 投影）时用它的估算/真实 tok/s，
       * 否则退回原 DB 最近一段值（与 state.rateLine 开关无关：桥不可用或开关关闭时
       * liveStatsCur 恒为空，自动走 db 分支，不影响这个本就独立于逐问速率行的指标）。
       * zuBarSpeedView 对"刚绑定/重绑时捞到的历史存量已完成轮次"返回 null——这种情况
       * 和"桥完全没命中"一视同仁，同样回退 DB/不渲染，不冒充"这个会话速度不可用"。
       * 二者互斥：绝不同时渲染两枚「速度」chip。 */
      var dbTps = last.tps || 0;
      var speedView = liveStatsCur ? zuBarSpeedView(liveStatsCur, bridge.handle && bridge.handle.charsPerToken, subRate.sum) : null;
      if (speedView) {
        liveKindCur = "live";
        livePhaseCur = speedView.phase || "";
        liveIconCur = speedView.phase ? "think" : "bolt";   // v77.1：运行期一律动效脑（思考/正文/工具），完成态才回闪电
        it((speedView.phase ? zuIcoThinking() : ico('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>')) +
          '<span class="zu-live ' + speedView.cls + '">' + speedView.text + "</span>",
          buildLiveTip(speedView));
      } else if (dbTps) {
        liveKindCur = "fallback";
        livePhaseCur = "";
        liveIconCur = "bolt";
        var tpsCls = dbTps >= 70 ? "ok" : dbTps >= 40 ? "warm" : "hot";
        it(ico('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>') +
          '<span class="zu-live ' + tpsCls + '">' + dbTps + '</span><span class="dim">t/s</span>',
          "\x01" +
          ttH(L("生成速度 · 最近一段", "Generation speed · latest segment")) +
          ttRow(L("口径", "Basis"), L("输出 tokens（含思考）÷ 生成耗时", "output tokens (thinking incl.) ÷ generation time")) +
          ttRow(L("档位", "Bands"), L("≥70 绿 · 40–70 黄 · <40 红", "≥70 green · 40–70 yellow · <40 red")) +
          ((last.startedAt || last.endedAt)
            ? ttRow(L("时间范围", "Time span"),
                (last.startedAt ? fmtStart(last.startedAt) : "—") + " - " +
                (last.endedAt ? fmtStart(last.endedAt) : "—"))
            : "") +
          ttNote(L("回答期间每段完成即刷新。回复末尾的统计行是整问加权均值，两者数值不同属正常",
            "Refreshes as each segment completes. The reply-end rate line is the whole-turn weighted average, so the two legitimately differ")));
      } else {
        liveKindCur = "none";
        livePhaseCur = "";
        liveIconCur = "";
      }
      if (state.show.turn) {
        it(ico('<path d="M23 4v6h-6"/><path d="M20.49 15A9 9 0 1 1 18.36 5.64L23 10"/>') +
          '<span class="v">' + fmt(lt.total) + "</span>" +
          (shrink ? "" : cachePct(lt.cache_read, lt.input)) +   // v66 超宽时命中率让位，明细仍在悬停 tooltip
          '<span class="dim">' + (lt.requests || 0) + L("次", " req") + "</span>" +
          ico('<path d="M6 3h12M6 21h12M8 3v3.5L12 11l4-4.5V3M8 21v-3.5L12 13l4 4.5V21"/>') +
          '<span class="dim">' + sec(last.duration_ms) + "</span>" +
          ico('<path d="M5 20v-5M12 20v-9M19 20V5"/>') +
          '<span class="dim">' + sec(last.ttft_ms) + "</span>",
          "\x01" +
          ttH(state.lang === "en"
            ? "Latest turn · " + (lt.requests || 0) + " requests"
            : "本轮 · " + (lt.requests || 0) + " 次请求") +
          ttRow(L("输入", "Input"), fmt(lt.input) +
            (lt.input > 0 && lt.cache_read > 0 ? L("（命中 " + Math.round(lt.cache_read / lt.input * 100) + "%）", " (" + Math.round(lt.cache_read / lt.input * 100) + "% cached)") : "")) +
          ttRow(L("输出", "Output"), fmt(lt.output) +
            (lt.reasoning > 0 ? L("（含思考 " + fmt(lt.reasoning) + "）", " (incl. " + fmt(lt.reasoning) + " thinking)") : "")) +
          ((typeof lt.tps === "number" && isFinite(lt.tps) && lt.tps > 0)
            ? ttRow(L("输出速度", "Output rate"), lt.tps.toFixed(1) + " tok/s" +
                L("（Σ有效段输出 ÷ Σ有效段生成时长，段间工具等待不计）", " (Σrated output ÷ Σrated generation time, tool waits excluded)") +
                (lt.unrated_output > 0 ? L("；另有 " + fmt(lt.unrated_output) + " token 未参与测速", "; " + fmt(lt.unrated_output) + " tokens excluded from rate") : ""))
            : "") +
          (lt.cache_write > 0 ? ttRow(L("缓存写入", "Cache write"), fmt(lt.cache_write)) : "") +
          ttRow(L("耗时", "Time"), L("单次 ", "request ") + sec(last.duration_ms) + L(" · 首字 ", " · TTFT ") + sec(last.ttft_ms) + L(" · 轮总 ", " · turn ") + sec(lt.duration_ms)) +
          ((lt.started || lt.ended)
            ? ttRow(L("时间范围", "Time span"),
                (lt.started ? fmtStart(lt.started) : "—") + " - " +
                (lt.ended ? fmtStart(lt.ended) : "—"))
            : "") +
          ((lt.tool_calls || lt.retries || lt.tool_errors)
            ? ttRow(L("工具", "Tools"), (lt.tool_calls ? lt.tool_calls + L(" 次调用", " calls") : "") +
                (lt.retries ? L(" · 重试 ", " · retries ") + lt.retries : "") +
                (lt.tool_errors ? L(" · 错误 ", " · errors ") + lt.tool_errors : "")) : ""));
      }
      if (state.show.win) {
        it(ico('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>') +
          '<span class="v">' + fmt(sess.total) + "</span>" +
          (shrink ? "" : cachePct(sess.cache_read, sess.input)) +   // v66 同上
          '<span class="dim">' + (sess.turns || 0) + L("轮 ", " turns · ") + (sess.requests || 0) + L("次", " req") + "</span>",
          "\x01" +
          ttH(L("会话累计 · 全部请求", "Session total · all requests")) +
          ttRow(L("输入", "Input"), fmt(sess.input) +
            (sess.input > 0 && sess.cache_read > 0 ? L("（命中 " + Math.round(sess.cache_read / sess.input * 100) + "%）", " (" + Math.round(sess.cache_read / sess.input * 100) + "% cached)") : "")) +
          ttRow(L("输出", "Output"), fmt(sess.output) +
            (sess.reasoning > 0 ? L("（含思考 " + fmt(sess.reasoning) + "）", " (incl. " + fmt(sess.reasoning) + " thinking)") : "")) +
          (sess.cache_write > 0 ? ttRow(L("缓存写入", "Cache write"), fmt(sess.cache_write)) : "") +
          ttRow(L("规模", "Scale"), (sess.turns || 0) + L(" 轮 · ", " turns · ") + (sess.requests || 0) + L(" 次请求", " requests") +
            (sess.tool_calls ? L(" · 工具 ", " · tools ") + sess.tool_calls : "") +
            (sess.retries ? L(" · 重试 ", " · retries ") + sess.retries : "")) +
          ttRow(L("时间范围", "Time span"),
            (sess.started ? fmtStart(sess.started) : "—") + " - " +
            (sess.last_at ? fmtStart(sess.last_at) : "—")) +
          (d.code && (d.code.add || d.code.del)
            ? ttRow(L("代码变更", "Code changes"), "+" + (d.code.add || 0) + " / -" + (d.code.del || 0) +
                (d.code.files ? L("（" + d.code.files + " 文件）", " (" + d.code.files + " files)") : "")) : ""));
      }
      if (state.show.tools) {
        var toolRows = (tls.list || []).map(function (t1) {
          return ttRow(t1.name, t1.count + L(" 次 · ", " calls · ") + sec(t1.duration_ms) +
            (t1.errors ? L(" · 错误 ", " · errors ") + t1.errors : ""));
        }).join("");
        it(ico('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>') +
          '<span class="v">' + (tls.total || 0) + "</span>" +
          (tls.errors ? '<span class="eb">' +
            ico('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>') +
            tls.errors + "</span>" : ""),
          "\x01" +
          ttH(state.lang === "en"
            ? "Tool calls · " + (tls.total || 0) + " total" + (tls.errors ? ", " + tls.errors + " errors" : "")
            : "工具调用 · 共 " + (tls.total || 0) + " 次" + (tls.errors ? " · 错误 " + tls.errors : "")) +
          (toolRows || ttNote(L("无工具调用记录", "No tool calls recorded"))));
      }
      if (state.show.today) {
        it(ico('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>') +
          '<span class="v">' + fmt(today.total) + "</span>",
          "\x01" +
          ttH(L("今日合计 · 今天所有会话", "Today · all sessions")) +
          ttRow(L("输入", "Input"), fmt(today.input) +
            (today.input > 0 && today.cache_read > 0 ? L("（命中 " + Math.round(today.cache_read / today.input * 100) + "%）", " (" + Math.round(today.cache_read / today.input * 100) + "% cached)") : "")) +
          ttRow(L("输出", "Output"), fmt(today.output) +
            (today.reasoning > 0 ? L("（含思考 " + fmt(today.reasoning) + "）", " (incl. " + fmt(today.reasoning) + " thinking)") : "")) +
          ttRow(L("请求", "Requests"), (today.requests || 0) +
            (today.retries ? L(" 次请求 · 重试 ", " requests · retries ") + today.retries : L(" 次", " requests"))) +
          ((today.started || today.last_at)
            ? ttRow(L("时间范围", "Time span"),
                (today.started ? fmtStart(today.started) : "—") + " - " +
                (today.last_at ? fmtStart(today.last_at) : "—"))
            : ""));
      }
      if (state.show.sub) {
        /* v93：随「上下文容量」格移除改为始终展示（零值也显示，口径与其他格统一）；
         * 无子代理时就是 0。v50：悬停 tooltip 只放汇总 + 打开面板的提示；各子代理明细
         * 在点击弹出的固定面板里用页签切换（面板固定不随鼠标，页签点击没有几何问题）。 */
        var sb = d.sub || { requests: 0, total: 0, input: 0, output: 0, cache_read: 0, reasoning: 0, cache_write: 0, active: false, rate_avg: 0 };
        it(ico('<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>') +
          '<span class="v">' + fmt(sb.total) + "</span>" +
          (sb.active ? '<span class="ok dot">●</span>' : ""),
          L("子代理：当前会话的后台子代理消耗（独立统计，不计入会话累计）", "Sub-agents: background sub-agent usage of the current session (tracked separately, not counted in the session total)") + "\n" +
          ioc(sb.input, sb.output, sb.cache_read, sb.reasoning, sb.cache_write) +
          L("，共 ", ", ") + (sb.requests || 0) + L(" 次", " requests in total") +
          (sb.rate_avg > 0 ? L(" · 均 ", " · avg ") + sb.rate_avg + L(" t/s（已完成段加权平均）", " t/s (weighted avg of completed segments)") : "") +
          (sb.active ? L(" · 运行中", " · running") : "") +
          "\n" + L("点击条目打开面板，查看每个子代理的具体消耗", "Click the item to open the panel with per-sub-agent details"), "zu-sub");
      }
      return { s: items.join('<span class="sep"></span>') || '<span class="dim">' + L("全部显示项已关闭", "All display items are off") + '</span>', tips: tips };
    }

    /* 当前会话识别（v34 起 mine 优先，此处为兜底启发式）：ZCode 在 localStorage 的
     * "zcode-v4-last-session:v1:<工作区路径>" 键里保存每个工作区当前打开的会话 id。
     * 键随会话切换由应用更新（新开空会话时应用还会删键）；但 localStorage 全窗口共享、
     * 键对"自动新建的会话"更新滞后，多窗口下根本分不清哪个键属于本窗口 ——
     * 所以 v34 起正常路径是泵按窗口注入的 mine（渲染端经 IPC 上报的焦点会话），
     * 只有泵无该窗口信息时（辅助窗口/旧泵）才落到这里：取所有键值与 payload.recent
     * 的 sid 求交集；多候选取最近活跃（数值 last_at 比较，勿用 HH:MM:SS 字符串，跨午夜会排错）。
     * v32：键值即使不在 recent 池里也作为 want 返回（挂 window.__zusageWantSid），
     * 泵把它传给 zusage.py 强制纳入快照——刚开的新会话/超出 6+6 池的会话也能显示自己的数据。
     * 注意：会话标题不在可扫描的 DOM 文本节点里（顶栏标题扫描方案实测永远失败，勿回退）。 */
    var pickedSid = "", wsPrev = null, lastHtml = "";
    function watchQuotaSelection(pane) {
      if (pane === quotaPaneRoot) return;
      if (quotaSelectionObserver) quotaSelectionObserver.disconnect();
      quotaSelectionObserver = null;
      quotaPaneRoot = pane;
      if (!pane) return;
      quotaSelectionObserver = new MutationObserver(function () {
        if (inactive()) return;
        if (readQuotaSelection() && state.data) render(state.data);
      });
      quotaSelectionObserver.observe(pane, { subtree: true, childList: true, attributes: true,
        attributeFilter: ["data-provider", "data-model", "data-session-id"] });
    }
    function readQuotaSelection() {
      var el = wantedEl || composer, pane = null, selection = null;
      var sid = instSid || pickedSid || "";
      if (el && el.isConnected) {
        for (var parent = el; parent && parent !== document.body; parent = parent.parentElement) {
          var tid = parent.getAttribute && parent.getAttribute("data-testid");
          if (tid && tid.indexOf("v4-session-pane-") === 0) { pane = parent; break; }
        }
      }
      watchQuotaSelection(pane);
      if (pane) {
        selection = { sid: sid, providerId: "", modelId: "" };
        var paneSid = pane.getAttribute("data-session-id");
        var paneId = pane.getAttribute("data-testid").slice("v4-session-pane-".length);
        if (paneSid === sid && (pid === "auto" || paneId === pid)) {
          var nodes = pane.querySelectorAll('[data-testid="v4-model-config"]');
          var own = [];
          for (var i = 0; i < nodes.length; i++) {
            var owner = nodes[i].parentElement;
            while (owner && owner !== pane) {
              var ot = owner.getAttribute && owner.getAttribute("data-testid");
              if (ot && ot.indexOf("v4-session-pane-") === 0) break;
              owner = owner.parentElement;
            }
            if (owner === pane) own.push(nodes[i]);
          }
          if (own.length) quotaMarkerSeen = true;
          if (!own.length && !quotaMarkerSeen) selection = null;
          if (own.length === 1) {
            var provider = own[0].getAttribute("data-provider");
            var model = own[0].getAttribute("data-model");
            if (typeof provider === "string" && provider.length <= 160 &&
                typeof model === "string" && model.length <= 160 && !/[\x00-\x1f\x7f]/.test(provider + model)) {
              selection.providerId = provider.trim();
              selection.modelId = model.trim();
            }
          }
        }
      } else if (quotaSelection) {
        selection = { sid: sid, providerId: "", modelId: "" };
      }
      if (JSON.stringify(selection) === JSON.stringify(quotaSelection)) return false;
      quotaSelection = selection;
      if (instances.length) reportQuotaSelections();
      return true;
    }
    function effectiveQuotaProvider() {
      return quotaSelection ? quotaSelection.providerId : (quotaProvider || quotaFallback);
    }
    function pickCurrent(d) {
      var recent = d.recent || [];
      if (!recent.length) return null;
      var bySid = {}, kv = {};
      for (var i = 0; i < recent.length; i++) bySid[recent[i].sid] = recent[i];
      try {
        Object.keys(localStorage).forEach(function (k) {
          if (/^zcode-v4-last-session:/.test(k)) {
            var v = localStorage.getItem(k);
            if (v && /^[A-Za-z0-9_-]+$/.test(v)) kv[k] = v;
          }
        });
      } catch (e) { return null; }
      if (!Object.keys(kv).length) return null;
      var hit = {}, firstKeyVal = "";
      for (var k in kv) {
        if (bySid[kv[k]]) hit[k] = kv[k];
        if (!firstKeyVal) firstKeyVal = kv[k];
      }
      var switched = null;
      if (wsPrev) {
        for (var k2 in kv) {
          if (wsPrev[k2] && wsPrev[k2] !== kv[k2]) switched = kv[k2];   // 该工作区刚切换了会话
        }
      }
      wsPrev = kv;
      /* want = 当前真正打开的会话（切换优先，否则任一键值），交由泵强制补拉 */
      var want = switched || firstKeyVal;
      if (switched && bySid[switched]) return { sess: bySid[switched], want: want };
      var cands = [];
      for (var k3 in hit) cands.push(bySid[hit[k3]]);
      if (cands.length === 1) return { sess: cands[0], want: want };
      if (!cands.length) return { sess: null, want: want };
      var best = cands[0];   // 多候选：取最近活跃的
      for (var n = 1; n < cands.length; n++) {
        if ((cands[n].last_at || 0) > (best.last_at || 0)) best = cands[n];
      }
      return { sess: best, want: want };
    }

    /* 子代理查看视图识别：子代理会话的任务提示词会作为聊天气泡文本出现在消息流里，
     * 用 recent 中 is_sub 候选的标题前缀（前 30 字）在 DOM 文本里匹配。
     * （主会话的标题不在 DOM 文本里，但子代理视图的气泡是普通文本，可匹配。） */
    /* 零值会话 stub：当前会话在共享池里还没有数据行（新会话没发过消息/还没拉到）时，
     * 显示"当前会话的 0 值"。绝不回退到池里别的会话 —— 显示错会话的数字正是 v34 修的 bug。 */
    function stubFor(sid) {
      return { sid: String(sid || ""), title: "", active: false, turns: 0, requests: 0,
        input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, total: 0,
        tool_calls: 0, retries: 0, ctx: 0, updated: "", last_at: 0, ctx_exc: 0, started: 0,
        last_turn: {requests: 0, retries: 0, tool_calls: 0, tool_errors: 0, input: 0, output: 0,
          reasoning: 0, cache_read: 0, cache_write: 0, total: 0, duration_ms: 0, ttft_ms: 0, started: 0, ended: 0},
        last: {duration_ms: 0, ttft_ms: 0, model: "", tps: 0, startedAt: 0, endedAt: 0},
        code: {add: null, del: null, files: null},
        tools: {total: 0, errors: 0, list: []},
        sub: {requests: 0, total: 0, input: 0, output: 0, cache_read: 0, reasoning: 0,
          cache_write: 0, active: false, list: []},
        context_window: 0, context_auto: false };
    }

    /* ---------- renderer store 桥客户端（v71，实例级）：一个 pane 一个订阅 ----------
     * 低频（2s）能力检测：API 在 + diagnostics 里有本 pane 会话的 topic → 绑定 store；
     * 绑定后 tracker.ingest 由订阅推送驱动（实时），store 关闭/换代（getState null /
     * 快照 sessionId 变）→ off 释放，下轮 tick 重绑。全链路失败 = 降级 DB 路径。 */
    function bridgeDetach(handle) {
      if (!handle || handle.dead) return;
      handle.dead = true;
      try { if (handle.off) handle.off(); } catch (e) { }   // 停订阅 + dispose tracker
      try { handle.store.off(); } catch (e) { }
      if (bridge.handle === handle) { bridge.handle = null; bridge.turnId = ""; }
      subRateDetach();   // 主桥释放（换代/切换/世代失效）时子代理速率桥一并释放
    }

    /* ---------- 子代理运行期速率桥（v97）：主会话 rows 的 subagent 行自带
     * childSessionId（turn-stats 的 runningSubagents 集合），据此用同一套 zuTryBindStore
     * 为**每个**运行中的子代理绑定会话 store，字符增量 ÷ c2t 估算各自输出 tok/s；
     * 主 chip 显示合计（Σ 有效槽位，并行 ≥2 个时动词后缀 ×N），tooltip/明细面板按
     * 槽位逐个展示。运行中请求未入库（DB 完成才写行，150s 实测零 running 行），这是
     * 唯一的实时来源；子代理思考文本若不进 rows（与主会话同款限制），characterRate
     * 为 null，该槽位速率缺席。生命周期跟随主桥：主桥释放/换代即全解绑；行结束
     * （runningSubagents 收敛）下一次 updateLive 自然解绑。
     * 上限保护：宿主 schema 允许 64 个并行 subagent，全绑会让订阅失控——只绑
     * rowId 最大（最新派发）的前 8 个，其余不估算（turn-stats 已按 rowId 升序给出）。 */
    var MAX_SUB_SLOTS = 8;
    var subRate = { slots: {}, sum: { rate: null, at: 0, count: 0 } };
    /* 释放槽位的绑定资源但保留槽位（want/retryAt）：绑定失败/首调 detach 时等待
     * 2s 后重试；对未绑定槽位（handle 为 null）调用也安全。 */
    function subSlotReset(sl) {
      if (sl.handle) sl.handle.dead = true;
      try { if (sl.off) sl.off(); } catch (e) { }
      try { if (sl.store) sl.store.off(); } catch (e) { }
      if (sl.tracker) { try { sl.tracker.dispose(); } catch (e) { } }
      sl.handle = null; sl.store = null; sl.tracker = null; sl.off = null;
      sl.rate = null; sl.calib = null;
      sl.retryAt = Date.now() + 2000;
    }
    function subSlotDetach(sid) {   // 彻底移除槽位（行结束/主桥释放）
      var sl = subRate.slots[sid];
      if (!sl) return;
      subSlotReset(sl);
      delete subRate.slots[sid];
    }
    function subRateDetach() {   // 全解绑（主桥释放/换代/世代失效）
      for (var sid in subRate.slots) subSlotDetach(sid);
      subRate.sum = { rate: null, at: 0, count: 0 };
    }
    /* 合计视图：Σ 3 秒内有效的槽位速率；全部无效/过期时为 {rate:null}（chip 回退状态词）。 */
    function subRateRecompute() {
      var now = Date.now(), sum = 0, at = 0, count = 0;
      for (var sid in subRate.slots) {
        var sl = subRate.slots[sid];
        if (sl.rate != null && now - sl.at <= 3000) { sum += sl.rate; count++; if (sl.at > at) at = sl.at; }
      }
      subRate.sum = count ? { rate: sum, at: at, count: count } : { rate: null, at: 0, count: 0 };
    }
    /* 单槽位展示文案（tooltip/明细面板共用）：有效速率 →「估 X t/s」；已绑但无速率
     * （思考期）→「估算中…」；未绑槽位 → 空串。 */
    function subRateSlotText(sid) {
      var sl = subRate.slots[sid];
      if (!sl) return "";
      var now = Date.now();
      return sl.rate != null && now - sl.at <= 3000
        ? L("估 ", "est ") + sl.rate.toFixed(1) + L(" t/s", " t/s")
        : L("估算中…", "estimating…");
    }
    /* 每次主桥数据到达时 reconcile：不在 runningSubagents 里的槽位解绑，新出现的
     * 尝试绑定（槽位级 2s 节流——updateLive 挂在 0.1s 心跳上，不节流会让 diag 全表
     * 枚举跟着心跳空转）。 */
    function subRateTick(runningSubagents) {
      var list = [];
      if (runningSubagents) {
        for (var i = 0; i < runningSubagents.length && list.length < MAX_SUB_SLOTS; i++) {
          var cs = runningSubagents[i] && runningSubagents[i].childSessionId;
          if (cs && list.indexOf(cs) < 0) list.push(cs);
        }
      }
      for (var sid in subRate.slots) if (list.indexOf(sid) < 0) subSlotDetach(sid);
      for (var j = 0; j < list.length; j++) {
        if (!subRate.slots[list[j]]) {
          subRate.slots[list[j]] = { handle: null, store: null, tracker: null, off: null,
                                     rate: null, at: 0, calib: null, retryAt: 0, want: list[j] };
        }
        subTryBindSlot(subRate.slots[list[j]]);
      }
      subRateRecompute();
    }
    function subTryBindSlot(sl) {
      if (sl.handle || Date.now() < sl.retryAt) return;
      var store = zuTryBindStore(sl.want);
      if (!store) { sl.retryAt = Date.now() + 2000; return; }   // 注册表里还没有该 topic：2s 后再试
      var h = { dead: false, sid: sl.want };
      var tracker = TURN_STATS.createTracker();
      sl.handle = h; sl.store = store; sl.tracker = tracker;
      var offFn = TURN_STATS.subscribeStore(store, tracker, function () {
        if (inactive() || h.dead) { subSlotReset(sl); subRateRecompute(); return; }
        var st = null;
        try { st = store.getState(); } catch (e) { st = null; }
        var snap = st && st.snapshot;
        if (!snap || snap.sessionId !== sl.want) { subSlotReset(sl); subRateRecompute(); return; }   // 关闭/换代：重置待重试
        var tid = zuActiveTurnId(snap);
        var stats = tid ? tracker.get(tid) : null;
        if (stats && !stats.complete) {
          if (stats.characterRate != null) {
            sl.rate = stats.characterRate /
              (sl.calib || (bridge.handle && bridge.handle.charsPerToken) || DEFAULT_CHARS_PER_TOKEN);
            sl.at = Date.now();
          } else {
            sl.rate = null;   // 思考期无可测字符流：该槽位缺席合计
          }
        } else if (stats && stats.complete && stats.outputTokens > 0 && stats.totalCharacters > 0) {
          sl.calib = stats.totalCharacters / stats.outputTokens;   // c2t 自校准：该子代理完成轮的真实比例
        }
        subRateRecompute();
        updateLive();
      });
      sl.off = offFn;
      /* subscribeStore 会同步首调一次回调：首调即 reset（换代/sessionId 不匹配）时
       * h.dead 已置位，offFn 是悬挂订阅的解绑函数——直接判 offFn 会把它当成功绑定
       * 写回（10Hz 重绑抖动 + 订阅泄漏，review P1）。按 h.dead 判定：显式释放 offFn
       * （幂等，兼带 dispose tracker），subSlotReset 自带 2s 节流防心跳空转。 */
      if (!offFn || h.dead) {
        if (offFn) { try { offFn(); } catch (e) { } }
        subSlotReset(sl);
      }
    }
    function bridgeTick() {
      if (inactive()) return;
      if (!state.rateLine || !TURN_STATS) { bridgeDetach(bridge.handle); updateLive(); return; }
      var sid = instSid || pickedSid || "";
      if (!sid) { bridgeDetach(bridge.handle); updateLive(); return; }
      if (bridge.handle) {
        if (bridge.handle.sid === sid) {
          var cur = null;
          try { cur = bridge.handle.store.getState(); } catch (e) { }
          var snap = cur && cur.snapshot;
          /* 绑定健康：store 可能在工具执行期间（查阅/编辑等）很久不推新快照——
           * 仍按本轮 2s 心跳刷新一次，让「已观察 Xs」能继续走字，而不是整段
           * 工具执行时间里界面像冻住；updateLive 内部按文本/类名是否真变化
           * 做了去重写入，这里多调用一次不会造成多余的 DOM 抖动。 */
          if (snap && snap.sessionId === bridge.handle.sid) { updateLive(); return; }
        }
        bridgeDetach(bridge.handle);   // pane 切会话 / store 关闭或换代：释放后重绑
      }
      var store = zuTryBindStore(sid);
      if (!store) { updateLive(); return; }   // 无桥 / 无匹配 session：降级（DB 路径不变），下轮再探
      var tracker = TURN_STATS.createTracker();
      var handle = { dead: false, sid: sid, store: store, tracker: tracker, alias: {}, off: null, charsPerToken: null, bornAt: Date.now() };
      var off = TURN_STATS.subscribeStore(store, tracker, function () {
        if (inactive() || handle.dead) return;
        var st = null;
        try { st = store.getState(); } catch (e) { st = null; }
        var snap = st && st.snapshot;
        if (!snap || snap.sessionId !== sid) { bridgeDetach(handle); updateLive(); return; }   // 换代/关闭：下轮 tick 重绑
        var rows = snap.rows && snap.rows.window;
        if (Array.isArray(rows)) {
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (r && typeof r.turnId === "string") handle.alias[r.turnId] = r.productTurnId || r.turnId;
          }
        }
        bridge.turnId = zuActiveTurnId(snap);
        updateLive();
      });
      if (!off) {   // store 接口不合约定：退回降级
        try { store.off(); } catch (e) { }
        tracker.dispose();
        updateLive();
        return;
      }
      handle.off = off;
      bridge.handle = handle;
      bridge.rebinds = (bridge.rebinds || 0) + 1;   // 诊断：本 pane 实例绑定/重绑次数
      updateLive();   // subscribeStore 首次同步回调已 ingest 初始快照，这里补挂实时段
    }
    function updateLive() {
      /* v73：合并「生成速度」chip 后，桥数据持续存在（生成中→完成，同一套
       * ico+'<span class="zu-live CLS">'+TEXT 结构）时只原地改 textContent/className，
       * 不重建条面（v33 原则）；桥「有/无」切换才会改变 chip 结构（图标出现/消失、
       * 退回 DB 的两段式拼接），需要整条重渲染。 */
      var h = bridge.handle;
      var stats = (state.rateLine && h && !h.dead && bridge.turnId) ? h.tracker.get(bridge.turnId) : null;
      /* v87：绑定成功但 turnHeader 还没到（新会话/TurnStarted 前的空窗口，源码证实
       * draft 期 rows.window 为空）——桥活着就别让 chip 空着：按绑定时长合成"思考中"，
       * turnHeader 到位后自然切换为真实统计。 */
      if (!stats && h && !h.dead && bridge.handle && h.store) {
        try {
          var st0 = h.store.getState();
          var snap0 = st0 && st0.snapshot;
          if (snap0 && snap0.sessionId === h.sid) {
            var rows0 = snap0.rows && snap0.rows.window;
            if ((rows0 && rows0.length) || (snap0.control && snap0.control.phase === "running")) {
              stats = { complete: false, characterRate: null, runningTool: null,
                        phase: "thinking", observedMs: Math.max(0, Date.now() - (h.bornAt || Date.now())),
                        observedLive: true, totalCharacters: 0 };
              bridge.turnId = bridge.turnId || "";
            }
          }
        } catch (e) { }
      }
      if (h && stats && stats.complete && stats.outputTokens > 0 && stats.totalCharacters > 0) {
        h.charsPerToken = stats.totalCharacters / stats.outputTokens;   // c2t 自校准：本轮真实比例供下一轮估算用
      }
      subRateTick(stats && !stats.complete ? stats.runningSubagents : null);   // 运行中子代理逐个绑/解速率桥
      var wasLive = liveKindCur === "live";
      var view = stats ? zuBarSpeedView(stats, h && h.charsPerToken, subRate.sum) : null;
      liveStatsCur = stats;
      // 用 view（而非 stats）判定快速路径：stats 非空但 view 为 null（历史存量，见
      // zuBarSpeedView）时结构要切回降级拼法，必须走下面的整条重渲染，不能原地改字。
      // 阶段（思考↔工具↔正文）切换会更换 chip 的图标（动效脑/闪电），同样只能整条
      // 重渲染——原地改字换不了图标。
      var phase = view && view.phase ? view.phase : "";
      if (view && wasLive && phase === livePhaseCur) {
        liveTextCur = view.text;
        if (!liveEl) { render(state.data || { session: {}, last_turn: {}, today: {}, context_window: 0 }); return; }
        if (liveEl.textContent !== view.text) liveEl.textContent = view.text;
        var cls = "zu-live " + view.cls;
        if (liveEl.className !== cls) liveEl.className = cls;
        /* v97：子代理速率是渲染端实时状态（不在泵快照里），tooltip 里的逐子代理
         * 行随原地改字一起刷新——内容签名没变时 drawTip 幂等只调位置，不闪烁。 */
        var tip1 = buildLiveTip(view);
        if (liveEl.__tip !== tip1) {
          liveEl.__tip = tip1;
          if (tipFor === liveEl) drawTip(liveEl, true);
        }
        return;
      }
      liveTextCur = view ? view.text : "";
      render(state.data || { session: {}, last_turn: {}, today: {}, context_window: 0 });
    }
    /* v90：心跳 0.5s→0.1s——0.5s 秒数走字仍有可感卡顿；render 有 lastHtml 幂等守卫，
     * 内容未变时仅字符串构建+比较、不写 DOM，10Hz 空转无性能顾虑。扫描 tick 保持 0.5s。 */
    bridge.timer = setInterval(bridgeTick, 100);
    bridgeTick();

    function render(d) {
      state.data = d;
      var pc = null, p = null;
      if (instSid) {
        /* v61.1 分屏多实例：本条显示哪个会话由 composer 祖先链的 data-session-id 决定
         * （客户端每个 pane 自带该标记，比窗口级 mine 更准，绝不串 pane）；
         * 会话不在池里（还没拉取）就显示本会话 0 值 —— 绝不回退到别的会话（v34 原则）。 */
        pickedSid = instSid;
        p = sessionFor(d, instSid, pid);
        if (!p) p = stubFor(instSid);
      } else {
        var mine = d.mine;   // 泵按窗口注入：string=本窗口焦点会话（空串=该窗口当前无会话），undefined=泵无该窗口信息
        if (typeof mine === "string") {
          pickedSid = mine;
          window.__zusageWantSid = mine;
          if (mine) {
            p = sessionFor(d, mine, pid);
            if (!p) p = stubFor(mine);
          } else {
            p = stubFor("");
          }
        } else {
          pc = pickCurrent(d);
          p = pc ? pc.sess : null;
          pickedSid = p ? p.sid : "";
          window.__zusageWantSid = (pc && pc.want) || "";   // 泵读取后让 zusage.py 强制纳入该会话
          if (!p) p = stubFor((pc && pc.want) || "");
        }
      }
      excOn = excActive(p);   // 气泡的显示依据（track 每帧消费）
      lastBand = ctxBandOf(p);   // v92：原生上下文按钮增强的数据源（与状态条上下文格同口径）
      /* 实时 pane 模型优先；没有宿主标记的旧版本才使用最近已完成请求。 */
      readQuotaSelection();
      quotaProvider = quotaSelection ? quotaSelection.providerId : ((p.last && p.last.provider_id) || "");
      quotaModel = quotaSelection ? quotaSelection.modelId : ((p.last && p.last.model) || "");
      quotaFallback = typeof d.provider_fallback === "string" ? d.provider_fallback : "";
      reportQuotaSelections();
      quotaSourceId = "";
      lastQuotaAll = d.quota && typeof d.quota === "object" ? d.quota : null;
      if (lastQuotaAll && lastQuotaAll.sources) {
        var qprov = effectiveQuotaProvider();
        var qsid = "";
        if (qprov.indexOf("account:") === 0) {
          qsid = qprov.indexOf("bigmodel") >= 0 ? "bigmodel" : (qprov.indexOf("zai") >= 0 ? "zai" : "");
          /* 未知 account 档不退 active（可能显示他窗自定义源）；team 变体由上方静态提示分支承接 */
        } else if (lastQuotaAll.byProvider && lastQuotaAll.byProvider[qprov]) {
          qsid = lastQuotaAll.byProvider[qprov];   // 自定义 provider：只认主进程显式映射
        }
        quotaSourceId = qsid;
        lastQuota = qsid ? (lastQuotaAll.sources[qsid] || null) : null;
      } else if (lastQuotaAll) {
        /* 旧主进程平铺协议：数据归属未知。内置 account 档按 family 接受（v96 语义即主进程
         * 只查内置套餐）；自定义 provider 无法证明归属 → fail-closed 不显示。 */
        var fp = effectiveQuotaProvider();
        lastQuota = (fp.indexOf("account:") === 0 && fp.indexOf("team") < 0) ? lastQuotaAll : null;
      } else lastQuota = null;
      /* v12 多服务器：remote_today/remote_errors 按目标键分组，取本会话所属主机的分片；
       * 旧格式（单目标，顶层对象即 today）兜底兼容。 */
      var myTarget = p.remote_target || "";
      var remoteToday = null;
      if (p.remote && d.remote_today && typeof d.remote_today === "object") {
        remoteToday = typeof d.remote_today.requests === "number" ? d.remote_today
          : (myTarget && (d.remote_today[myTarget] || remoteTodayCache[myTarget])) || null;
      }
      var view = {
        session: p, last_turn: p.last_turn || {}, last: p.last || {},
        /* v9：远端会话的「今日合计」用远端机数据，本地 today 只在显示本地会话时使用 */
        today: p.remote ? (remoteToday || {}) : d.today,
        native_ctx: nativeCtxVal,
        context_window: p.context_window, context_auto: p.context_auto,
        code: p.code, ctx_exc: p.ctx_exc, tools: p.tools,
        remote: !!p.remote, remote_host: p.remote_host || "", remote_error: p.remote_error || (d.remote_errors && myTarget && d.remote_errors[myTarget]) || (!d.remote_errors && d.remote_error) || "",
        /* v62（issue #14 / #10）：该会话不在本地库且没命中远端 → 条面给一次配置指引，
         * 把"各项全 0 = 插件坏了"的误判转成可执行的下一步；远端命中的会话由 ☁ 徽标那套说明。 */
        not_local: (d.not_local || []).indexOf(p.sid) >= 0 && !p.remote,
        remote_enabled: !!d.remote_enabled,
        remote_stale: !!p.remote_stale,
        remote_empty: !!(p.remote && !p.requests && !p.remote_missing),
        sub: p.sub || {requests: 0, total: 0, input: 0, output: 0, cache_read: 0, active: false, list: []},
      };
      lastSub = view.sub;   // 子代理明细面板的数据源（开关面板/数据推送刷新用）
      refreshWants();
      var h = html(view);
      /* 内容没变就不重建 DOM：泵每 1.5s 推送一次，无条件 innerHTML 会重建条面+重启呼吸灯
       * 动画+触发 tooltip 重画 = 悬停时周期性闪烁（v33 修复）。变化时才重建。 */
      if (h.s !== lastHtml) {
        lastHtml = h.s;
        main.innerHTML = h.s;
      }
      var els = main.querySelectorAll(".it");
      for (var i = 0; i < els.length; i++) els[i].__tip = h.tips[i] || null;
      liveEl = main.querySelector(".zu-live");   // v71：条面重建后实时段节点重挂（原地更新用）
      /* 数据刷新时正在悬停：接管同位置的新元素继续显示。只调位置不重画内容——
       * 数字每 1.5s 都在变，重画就是闪烁；旧文本保持到鼠标下次移动为止。 */
      if (tipFor) {
        var nu = null;
        if (tipFor === main) nu = main;
        else if (tipFor.__n === els.length) nu = els[tipFor.__idx];
        if (nu && nu.__tip) { tipFor = nu; positionTip(nu, true); } else hideTip(false, "render-orphan");
        /* 接管失败（条目结构变化）也受总闸保护：鼠标仍在条上时保持旧 tooltip，
         * 下一次 mousemove 会重新判定该显示哪一项 */
      }
      if (subPanel.classList.contains("open")) buildSubPanel(view.sub);   // 面板开着：随推送实时刷新
      enhanceCtxButton();   // v92：数据点 reapply（React 数据更新重写 dasharray 后兜回）
      enhanceQuotaChip();   // v96：额度 chip 数据点 reapply
      enhanceGitChip();     // v96：同点对账 Git chip（开关/会话切换/scope 变化在此收敛）
    }


    /* ---------- 自绘 tooltip：向上弹出（原生 title 方向不可控） ---------- */
    var tipFor = null, lastMoveAt = 0, tipSig = "";
    var mouseInBar = false;   // 鼠标是否悬停在条面/tooltip/面板上（最近一次 mousemove 判定）
    var tipGraceTimer = 0;    // 越顶宽限定时器（v46）
    var tipStats = { mv: 0, shows: 0, hides: 0, last: "", lastHide: "", corridor: 0, grace: 0 };   // 诊断：随 mount diag 回写
    /* 隐藏总闸（v33.3）：鼠标还在条面上时，任何路径（数据刷新接管失败/输入框重建/
     * 瞬时不可见判定）都不得隐藏 tooltip——只有鼠标真正离开条面（left-bar，force）
     * 或条面整体隐藏（force）才允许。 */
    function hideTip(force, cause) {
      if (!force && mouseInBar) { tipStats.lastHide = "blocked:" + (cause || "?"); return; }
      if (tipGraceTimer) { clearTimeout(tipGraceTimer); tipGraceTimer = 0; }
      if (tip.style.display !== "none") tip.style.display = "none";
      tipFor = null;
      tipSig = "";
      tipStats.hides++;
      tipStats.lastHide = cause || "?";
    }
    function positionTip(el, keepTop) {
      var tr = tip.getBoundingClientRect(), ar = el.getBoundingClientRect();
      var left = ar.left + ar.width / 2 - tr.width / 2;
      left = Math.max(8, Math.min(left, Math.max(8, innerWidth - tr.width - 8)));
      /* keepTop=数据刷新等重定位时保持顶边——悬停中只调位置不重建，顶边不动鼠标就
       * 不会因盒形变化被甩出去（外面是 iframe 静默区，甩出去就回不来了）。
       * 只有首次弹出才按条目重新锚定（悬空 8px）。 */
      var top = (keepTop && tip.style.top) ? parseFloat(tip.style.top) : 0;
      if (!isFinite(top) || top < 8) top = Math.max(8, ar.top - tr.height - 8);
      tip.style.left = Math.round(left) + "px";
      tip.style.top = Math.round(top) + "px";
    }
    function drawTip(el, keepTop) {
      var t = el && el.__tip;
      if (!t) { tip.style.display = "none"; tipFor = null; return; }
      /* 幂等：内容没变就只调位置，不重建 innerHTML（重建=悬停中每 1.5s 闪烁） */
      if (t === tipSig && tip.style.display === "block") {
        positionTip(el, true);
        return;
      }
      tipSig = t;
      tip.innerHTML = '<div class="tbody"></div>';
      if (t.charCodeAt(0) === 1) tip.firstChild.innerHTML = t.slice(1);   // \x01 前缀 = 结构化 HTML（v67.1）
      else tip.firstChild.textContent = t;
      tip.style.display = "block";
      positionTip(el, keepTop);
    }
    function showTipFor(el) {
      tipFor = el;
      var its = main.querySelectorAll(".it");
      el.__idx = el === main ? -1 : Array.prototype.indexOf.call(its, el);
      el.__n = its.length;   // render 接管时校验条目数未变，数量变了 __idx 就不可信
      tipStats.shows++;
      tipStats.last = el === main ? "main" : String(el.textContent || "").slice(0, 12);
      drawTip(el, false);
    }
    /* 事件挂 document 捕获阶段（v32）：React/应用层可能在冒泡路上 stopPropagation，
     * 挂 main 的 mousemove 收不到（v31 实证：原生 title 有 hover、自绘 tip 无事件）。
     * stale() 守卫：热更新后旧实例监听器必须罢工，否则新旧两个 tip 同时工作。 */
    listenGlobal(document, "mousemove", function (e) {
      if (inactive()) return;
      tipStats.mv++;
      if (Date.now() - lastMoveAt < 150) return;
      lastMoveAt = Date.now();
      var t = e.target;
      if (!t || !t.closest) return;
      if (tip.contains(t)) { mouseInBar = true; cancelTipGrace(); return; }   // 鼠标移入 tooltip：保持
      if (t.closest(".panel")) {
        /* 面板上不保留条面 tooltip（v42）：开设置的路上触发过条目 tooltip 的话，
         * 这分支若不清掉它，鼠标在面板里它就永不消失。 */
        mouseInBar = true;
        if (tipFor) hideTip(true, "panel-hover");
        return;
      }
      if (!bar.contains(t)) {
        /* 空中走廊（v45）：悬空缝是"条外且 tip 外"的真空带，采样事件落在这里会被误判
         * 成"移开"立即熄灭——鼠标在 tooltip 横向范围、底边下方 ~12px 内时视同仍在条上，
         * 穿行去 tooltip 点 tab 的路上不熄灭。 */
        if (tipFor && inTipCorridor(e.clientX, e.clientY)) {
          tipStats.corridor++;
          mouseInBar = true;
          cancelTipGrace();
          return;
        }
        /* 越顶宽限（v46）：mousemove 有 150ms 节流采样，快速上移时两个采样点之间能跨过
         * 整个 tooltip，采样点落在 tip 上方的死区——此前立即隐藏就把"正要进 tip"错杀成
         * "离开"。改挂 300ms 宽限：下一个采样落回 tip/走廊就取消（tip 仍可点 tab），
         * 确实继续远离才真正收起。横向/向下移出不享受宽限，依旧立即消失。 */
        if (tipFor && inTipColumn(e.clientX, e.clientY)) {
          tipStats.grace++;
          mouseInBar = true;   // 视同在途：总闸拦住 render-orphan 等路径趁机熄灯
          if (!tipGraceTimer) tipGraceTimer = setTimeout(function () {
            tipGraceTimer = 0;
            hideTip(true, "grace-expire");
          }, 300);
          return;
        }
        mouseInBar = false;
        if (tipFor) hideTip(true, "left-bar");   // v43：移开条面立即消失，不再留 300ms 缓冲
        return;
      }
      mouseInBar = true;
      cancelTipGrace();
      if (panel.classList.contains("open")) return;   // 面板开着：条面不弹 tooltip（弹出也会被面板盖住，只露边角）
      var el = t.closest(".it");
      if (el) {
        if (el !== tipFor) showTipFor(el);
      } else if (tipFor) {
        /* 条面内非条目区（项间隔/分隔符/⚙）：保持当前 tooltip 不动（此处刻意无操作）。
         * 慢速移动时命中目标在条目↔空隙间反复跳，若此处切换内容/隐藏
         * 就是"出现一下立刻消失"的闪烁（v33.2，概览 tooltip 因此废除） */
      }
    }, true);
    /* 鼠标甩出窗口外/窗口失焦：tooltip 立即收起（v43）。
     * v47 根因修正：ZCode 条面上方的聊天区是独立浏览上下文（iframe/webview，findComposer
     * 穿透同源 iframe 即佐证），光标从条面跨入其上时宿主文档会发 documentElement
     * mouseleave、且后续 mousemove 全部进子文档——diag 实证（mv 上万但 corridor/grace
     * 计数全 0、lastHide=win-leave）这就是"一向上移 tooltip 就消失"的根因：v43 把这种
     * 内部 leave 当成了甩出窗口。故 mouseleave 按退出点分流：
     *   · 退出点贴窗口边缘 = 真离开窗口 → 立即收；
     *   · 内部 leave 且退出点在 tip 横向列内（±30px）= 去 tooltip/回条面的穿行 → 400ms
     *     宽限（子上下文区域事件停摆，靠定时器兜底收回；tip/条面/走廊事件会取消它）；
     *   · 内部 leave 列外 = 横向走掉 → 立即收。 */
    function tipBoundaryHide() {
      if (inactive()) return;
      mouseInBar = false;
      if (tipFor) hideTip(true, "win-leave");
    }
    listenGlobal(window, "blur", tipBoundaryHide, true);
    function tipLeaveAt(x, y) {
      if (inactive() || !tipFor) return;
      if (x <= 1 || x >= innerWidth - 2 || y <= 1 || y >= innerHeight - 2) {
        tipBoundaryHide();
        return;
      }
      /* 伪边界过滤（v99）：Chrome 在悬停链收缩/重算时会补发 DOM 内部的 mouseleave
       * （Playwright 实测：滑过格内 .v↔.dim 的 flex 空隙时 documentElement 级必发、
       * tooltip 子元素之间连 tip 本体级都发，坐标在视口内、relatedTarget 是文档内存活
       * 元素）——指针并没有离开本文档。此前每次伪 leave 都按 v47 分流挂 400ms 宽限，
       * 鼠标随即停在格间空白/tooltip 上（无后续事件取消）→ tooltip「弹出后立即关闭」
       * （用户实测悬停「2.85万 1轮 1次」格内 万↔1 空隙必现；tooltip 本体停留同款熄灭）。
       * 事件坐标与 relatedTarget 都不可信（真进 iframe 时 relatedTarget=宿主 body、坐标
       * 也可能落在门外），改问活体：取触发时刻最深 :hover 元素——仍是本档具体元素即伪
       * leave，忽略交给 mousemove 流接管；截断到 body（空档区/已进子文档，v47 宽限语义）、
       * iframe/webview 或空链（甩出窗口）一律按真边界走原分流。 */
      try {
        var hs = document.querySelectorAll(":hover");
        var hovered = hs.length ? hs[hs.length - 1] : null;
        if (hovered && hovered !== document.body && hovered !== document.documentElement &&
            hovered.tagName !== "IFRAME" && hovered.tagName !== "WEBVIEW") return;
      } catch (e) { }
      var r = tip.getBoundingClientRect();
      if (x >= r.left - 30 && x <= r.right + 30) {
        tipStats.grace++;
        mouseInBar = true;   // 在途：总闸拦住 render-orphan 等路径趁机熄灯
        cancelTipGrace();
        tipGraceTimer = setTimeout(function () {
          tipGraceTimer = 0;
          hideTip(true, "grace-expire");
        }, 400);
      } else {
        mouseInBar = false;
        hideTip(true, "left-bar");
      }
    }
    listenGlobal(document.documentElement, "mouseleave", function (e) {
      tipLeaveAt(e.clientX, e.clientY);
    }, true);
    /* 光标离开 tooltip 本体：上行越顶/下行回条面 → 列内宽限；横向 → 立即收（分流同上） */
    tip.addEventListener("mouseleave", function (e) {
      tipLeaveAt(e.clientX, e.clientY);
    }, true);
    tip.addEventListener("mouseenter", function () {
      if (inactive()) return;
      cancelTipGrace();
    }, true);
    /* 空中走廊判定（v45）：tooltip 矩形横向 ±4px、纵向 tip 顶边到底边下方 12px
     * （覆盖条面顶边到 tooltip 底边的 8px 悬空缝）。只在 tipFor 存在时被调用。 */
    function inTipCorridor(x, y) {
      var r = tip.getBoundingClientRect();
      return x >= r.left - 4 && x <= r.right + 4 && y >= r.top && y <= r.bottom + 12;
    }
    /* 越顶宽限判定（v46）：tip 正上方 ±30px、高 80px 的柱形区——快速上移的采样点
     * 落进这里说明鼠标刚越过 tip 顶边，大概率下一拍就停在 tip 里。 */
    function inTipColumn(x, y) {
      var r = tip.getBoundingClientRect();
      return x >= r.left - 30 && x <= r.right + 30 && y >= r.top - 80 && y < r.top;
    }
    function cancelTipGrace() {
      if (tipGraceTimer) { clearTimeout(tipGraceTimer); tipGraceTimer = 0; }
    }

    /* ---------- 设置面板 ---------- */
    function syncUpdate() {
      var u = state.pluginUpdate;
      var active = !!(u && u.supported);
      var version = panel.querySelector(".zu-settings-version");
      version.textContent = active && u.currentVersion ? u.currentVersion : "";
      version.hidden = !version.textContent;
      var cb = panel.querySelector(".zu-auto-update");
      cb.checked = !!(u && u.auto);
      cb.disabled = !active;
      panel.querySelector('[data-update=check]').disabled = !active || !!u.busy;
      panel.querySelector('[data-update=update]').disabled = !active || !!u.busy || u.phase !== "available";
      var messages = {
        idle: L("尚未检测", "Not checked yet"),
        checking: L("正在检查更新…", "Checking for updates…"),
        available: L("发现新版本", "Update available"),
        current: L("当前已是最新版本", "Up to date"),
        downloading: L("正在下载更新…", "Downloading update…"),
        updating: L("正在安装更新…", "Installing update…"),
        updated: L("插件已更新；请重开会话以加载新版插件组件", "Plugin updated; start a new session to load the new components"),
        error: L("更新失败：", "Update failed: ") + (u && u.error || ""),
      };
      var text = !active ? L("仅支持已安装的 zusage-marketplace 用户插件；更新通道未就绪时需先升级插件并重启 ZCode。", "Requires the installed user plugin from zusage-marketplace. Upgrade the plugin and restart ZCode if the update channel is not ready.") : messages[u.phase] || messages.idle;
      if (!active && u && u.error) text += "\n" + messages.error;
      if (active && u.currentVersion) text += "\n" + L("当前版本：", "Current version: ") + u.currentVersion;
      if (active && u.latestVersion) text += (u.channel === "release" ? L(" · Release 版本：", " · Release version: ") : L(" · 市场版本：", " · Marketplace version: ")) + u.latestVersion;
      if (active && u.channel) text += "\n" + L("更新来源：", "Update source: ") + (u.channel === "release" ? (u.channelHost === "gitcode" ? L("GitCode 正式 Release（校验 ZIP 与 SHA256）", "stable GitCode Release (validated ZIP and SHA256)") : L("GitHub 正式 Release（校验 ZIP 与 SHA256）", "stable GitHub Release (validated ZIP and SHA256)"))
        : u.channel === "market" ? (u.channelHost === "gitcode" ? L("GitCode 仓库源码（由插件管理器直接更新）", "GitCode repository source (updated directly by the plugin manager)") : L("GitHub 仓库源码（由插件管理器直接更新）", "GitHub repository source (updated directly by the plugin manager)"))
        : L("本地目录市场", "local directory marketplace"));
      if (active && u.releaseUrl) text += "\n" + u.releaseUrl;
      if (active && u.checkedAt) text += "\n" + L("上次检测：", "Last checked: ") + new Date(u.checkedAt).toLocaleString();
      if (u && (u.phase === "updating" || u.phase === "downloading")) text += "\n" + L("关闭自动更新仅阻止后续安装；已开始的安装会继续完成", "Turning automatic updates off stops future installs; an install already started will finish");
      if (u && u.restartRequired) text += "\n" + L("主进程或关闭热更新的文件已更新，需重启 ZCode", "Restart ZCode to load main-process updates or files with hot reload disabled");
      if (u && u.skipped && u.skipped.length) text += "\n" + L("保留本地热修（未覆盖）：", "Local edits preserved (not overwritten): ") + u.skipped.join(", ");
      panel.querySelector(".zu-update-status").textContent = text;
      syncProgress(active ? u : null);
      /* 逐问速率行开关勾选态：state.rateLine 由主进程推送（或 change 时代乐观更新） */
      var rl = panel.querySelector(".zu-rate-line");
      if (rl) rl.checked = state.rateLine;
      var qe = panel.querySelector(".zu-quota-enable");   // v95：勾选态由主进程推送的 quotaEnabled 决定
      if (qe) qe.checked = state.quotaEnabled;
      try { syncQuotaSources(); } catch (eSrc) { try { window.__zusageDiag.quotaSrcErr = String((eSrc && eSrc.stack) || eSrc); } catch (_) { } }   // 防御：多源列表渲染失败不得拖垮实例创建（实测 SRC_FIELD_LABELS 时序可致整条状态条消失）
    }
    function srcStatusText(sv) {
      var m = { ok: "✓", idle: L("待查询", "pending"), not_configured: L("未配置凭据", "credential missing"),
        disabled: L("已关闭", "off"),
        auth_failed: L("认证失效", "auth failed"), no_plan: L("无订阅", "no subscription"),
        rate_limited: L("限流中", "rate limited"), network_error: L("查询失败", "failed"),
        parse_error: L("响应异常", "bad response"), unsupported: L("不支持", "unsupported") };
      return m[sv.status] || sv.status || "";
    }
    /* 源列表按推送状态增量重建（JSON 签名没变不重绘，避免打断正在输入的凭据框） */
    function syncQuotaSources() {
      var box = panel.querySelector(".zu-src-list");
      if (!box) return;
      var list = state.quotaSources || [];
      var sig = JSON.stringify(list);
      if (sig === srcListSig && box.children && box.children.length) return;
      /* 正在输入凭据的源行不重建：状态推送（如别家查询完成）会翻转签名，重建会丢焦点丢内容 */
      try {
        var act = document.activeElement;
        if (act && act.classList && act.classList.contains("zu-src-field") && box.contains && box.contains(act)) return;
      } catch (e) { }
      srcListSig = sig;
      var html = "";
      for (var i2 = 0; i2 < list.length; i2++) {
        var sv = list[i2];
        var credFields = "";
        for (var f = 0; f < (sv.credentialFields || []).length; f++) {
          var field = sv.credentialFields[f];
          var isCred = field === "apiKey" || field === "cookie" || field === "token" || field === "secretAccessKey";
          credFields += '<input type="' + (isCred ? "password" : "text") + '" class="zu-src-field" data-src="' + sv.id +
            '" data-field="' + field + '" placeholder="' + ((SRC_FIELD_LABELS || {})[field] || field) +
            (isCred && sv.keyConfigured ? L("（已配置，输入以更换）", " (configured)") : "") + '" autocomplete="off">';
        }
        var pr = sv.presets || [], chips = "", curBase = String(sv.baseUrl || "").replace(/\/+$/, "");
        for (var p2 = 0; p2 < pr.length; p2++) {
          chips += '<button type="button" class="zu-src-preset' + (curBase && curBase === String(pr[p2].value || "").replace(/\/+$/, "") ? " on" : "") +
            '" data-src="' + sv.id + '" data-base="' + pr[p2].value + '" title="' + pr[p2].value + '">' + L(pr[p2].label, pr[p2].labelEn || pr[p2].label) + '</button>';
        }
        html += '<div class="zu-src-row" data-src="' + sv.id + '">' +
          '<label class="zu-src-name"><input type="checkbox" class="zu-src-enable" data-src="' + sv.id + '"' + (sv.enabled ? " checked" : "") + '>' +
          '<span>' + sv.label + (sv.unverified ? "*" : "") + '</span></label>' +
          '<span class="zu-src-status">' + srcStatusText(sv) + '</span>' +
          (sv.keyUrl ? '<button type="button" class="zu-src-keyurl" data-url="' + sv.keyUrl + '" aria-label="' + L("打开控制台获取 API Key", "Open the console to get an API key") + '" title="' + L("打开控制台获取 API Key", "Open the console to get an API key") + '">' + L("获取 Key ↗", "Get key ↗") + '</button>' : "") +
          '<button type="button" class="zu-src-refresh" data-src="' + sv.id + '" aria-label="' + L("立即刷新", "Refresh now") + '" title="' + L("跳过缓存，立即重新查询该源", "Re-query this source now, skipping the cache") + '"' + (sv.enabled ? "" : " disabled") + '>↻</button>' +
          (chips ? '<span class="zu-src-presets">' + chips + '</span>' : "") +
          '<span class="zu-src-fields">' + credFields + '</span></div>';
      }
      box.innerHTML = html;
    }
    /* 更新进度条（v89）。主进程 updater 在 downloading/updating 阶段推送
     * progress = { stage: download|verify|install|sync, loaded?, total? }：
     * 下载条在 download 阶段按字节比例，之后一律 100%；安装条没有字节口径（宿主插件管理器
     * 不报进度），按校验→安装→同步三段推进并用扫光表示仍在活动。旧版主进程不带 progress
     * 字段（热更新的渲染端先于主进程重启生效），此时整块隐藏，只保留原有状态文案。 */
    function formatBytes(n) {
      n = Math.max(0, +n || 0);
      if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
      if (n >= 1024) return Math.round(n / 1024) + " KB";
      return n + " B";
    }
    function setProgressBar(box, key, ratio, active, label) {
      var row = box.querySelector('[data-progress="' + key + '"]');
      if (!row) return;
      var pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
      var fill = row.querySelector(".zu-progress-fill");
      fill.style.width = pct + "%";
      fill.classList.toggle("active", !!active);
      row.querySelector(".zu-progress-track").setAttribute("aria-valuenow", String(pct));
      row.querySelector(".zu-progress-value").textContent = label;
    }
    function syncProgress(u) {
      var box = panel.querySelector(".zu-update-progress");
      if (!box) return;
      var p = u && u.progress;
      var show = !!(p && typeof p.stage === "string" && (u.phase === "downloading" || u.phase === "updating"));
      box.hidden = !show;
      if (!show) return;
      var idx = PROGRESS_STAGES.indexOf(p.stage);
      var total = +p.total > 0 ? +p.total : 0, loaded = Math.max(0, +p.loaded || 0);
      var dlRatio = idx > 0 ? 1 : (total ? loaded / total : 0);
      var dlLabel = idx > 0 ? "100%"
        : total ? Math.round(Math.min(1, loaded / total) * 100) + "% · " + formatBytes(loaded) + " / " + formatBytes(total)
        : formatBytes(loaded);
      setProgressBar(box, "download", dlRatio, idx <= 0, dlLabel);
      var install = {
        verify: [.15, L("校验中", "Verifying")],
        install: [.55, L("安装中", "Installing")],
        sync: [.9, L("同步中", "Syncing")],
      }[p.stage] || [0, L("等待下载完成", "Waiting for download")];
      setProgressBar(box, "install", install[0], idx > 0, install[1]);
    }
    function syncPanel() {
      panel.querySelectorAll("input[type=checkbox][data-k]").forEach(function (cb) {
        cb.checked = !!state.show[cb.dataset.k];
      });
      panel.querySelector(".zu-ctxov").value = state.ctxOv;
      var cnBox = panel.querySelector(".zu-cn-num");
      if (cnBox) cnBox.checked = !!state.cnNum;
      syncUpdate();
    }
    panel.addEventListener("click", function (e) {
      var navItem = e.target.closest && e.target.closest(".zu-navitem");
      if (navItem && !navItem.hasAttribute("aria-current")) {
        state.settingsSec = navItem.dataset.sec || "display";
        persist();
        var cur = activeSettingsSec();
        panel.querySelectorAll(".zu-settings-section[data-sec]").forEach(function (s) {
          s.hidden = s.getAttribute("data-sec") !== cur;
        });
        panel.querySelectorAll(".zu-navitem").forEach(function (b) {
          if (b.getAttribute("data-sec") === cur) b.setAttribute("aria-current", "page");
          else b.removeAttribute("aria-current");
        });
        var navBody = panel.querySelector(".zu-settings-body");
        if (navBody) navBody.scrollTop = 0;
        syncSettingsScroll();
        return;
      }
      if (e.target.closest && e.target.closest(".zu-settings-close")) {
        panel.classList.remove("open");
        return;
      }
      if (e.target.closest && e.target.closest(".zu-settings-scroll")) {
        var body = panel.querySelector(".zu-settings-body");
        body.scrollTop += Math.max(1, Math.round(body.clientHeight * .8));
        syncSettingsScroll();
        return;
      }
      if (e.target.closest && e.target.closest(".zu-settings-feedback")) {
        /* 优先走客户端 zcode 桥（IPC → 主进程 shell.openExternal，系统默认浏览器）；
           window.open 会被客户端内置浏览器接管，仅作无桥环境兜底 */
        var zc = window.zcode, issuesUrl = "https://github.com/ByteRax/zcode-token-usage-statusbar/issues";
        if (zc && typeof zc.openExternal === "function") zc.openExternal(issuesUrl);
        else window.open(issuesUrl, "_blank", "noopener");
        return;
      }
      var keyBtn = e.target.closest && e.target.closest(".zu-src-keyurl");
      if (keyBtn) {
        /* 获取 Key：走客户端 openExternal 桥（系统默认浏览器），无桥环境 window.open 兜底 */
        var ku = keyBtn.getAttribute("data-url") || "";
        if (ku) {
          var zk = window.zcode;
          if (zk && typeof zk.openExternal === "function") zk.openExternal(ku);
          else window.open(ku, "_blank", "noopener");
        }
        return;
      }
      var presetBtn = e.target.closest && e.target.closest(".zu-src-preset");
      if (presetBtn) {
        /* 预设模板（v102）：一键填充官方域变体（走 baseUrl 白名单写通道）；写成功后
         * writeQuotaSecrets 会自动解冻重查并回推 sourcesConfig，选中态随重绘高亮 */
        if (presetBtn.dataset.src && presetBtn.dataset.base) pluginRequest("quota-src-key", { id: presetBtn.dataset.src, field: "baseUrl", value: presetBtn.dataset.base });
        return;
      }
      var srcBtn = e.target.closest && e.target.closest(".zu-src-refresh");
      if (srcBtn) { pluginRequest("quota-src-refresh", { id: srcBtn.dataset.src }); return; }
      var button = e.target.closest && e.target.closest("[data-update]");
      if (button && !button.disabled) pluginRequest(button.dataset.update);
    });
    gear.addEventListener("click", function (e) {
      e.stopPropagation();
      syncPanel();
      var opening = !panel.classList.contains("open");
      panel.classList.toggle("open");
      if (opening) {
        panel.style.height = "";   // v101：重开时按当前分区内容重测高度（开着的期间高度锁死）
        positionSettingsPanel();
        subPanel.classList.remove("open");   // 两面板同位重叠，互斥打开（v49）
        hideTip(true, "gear-open");   // 移向齿轮的路上可能触发过条目 tooltip，开面板时一并收掉
      }
    });
    panel.addEventListener("change", function (e) {
      var t2 = e.target;
      if (t2.classList.contains("zu-auto-update")) {
        pluginRequest("auto", t2.checked);
        return;
      }
      if (t2.classList.contains("zu-src-enable")) {
        pluginRequest("quota-src", { id: t2.dataset.src, enabled: t2.checked });
        return;
      }
      if (t2.classList.contains("zu-src-field")) {
        if (t2.dataset.src && t2.dataset.field) pluginRequest("quota-src-key", { id: t2.dataset.src, field: t2.dataset.field, value: t2.value });
        return;
      }
      if (t2.classList.contains("zu-quota-enable")) {
        /* v95：乐观更新，真值以主进程写 config.json 的 quota_enabled 后回推为准；关闭时
           chip 在下一次 heavy 对账点摘除，主进程停止解密与联网 */
        state.quotaEnabled = t2.checked;
        pluginRequest("quota", t2.checked);
        renderAll(false);
        return;
      }
      if (t2.classList.contains("zu-rate-line")) {
        /* 乐观更新勾选态，真值以主进程写 config.json 后回推的 rateLine 为准 */
        state.rateLine = t2.checked;
        scanRateLines();
        scanDeterministicLines();   // v71：关=撤下确定性历史行，开=立即重扫补行
        pluginRequest("rate-line", t2.checked);
        return;
      }
      if (t2.classList.contains("zu-cn-num")) {
        state.cnNum = t2.checked ? 1 : 0;
        persist();
        renderAll(false);
        return;
      }
      if (t2.name === "zu-lang") {
        state.lang = t2.value;
        persist();
        buildPanel();   // 面板自身文案随语言重建（含 radio 勾选态）
        rebuildExcBubble();
        renderAll(true);   // 条面单位与 tooltip 文案随语言刷新（含各实例面板文案重建）
        return;
      }
      if (t2.type === "checkbox") {
        state.show[t2.dataset.k] = t2.checked ? 1 : 0;
        persist();
        if (t2.dataset.k === "git") refreshWants();   // v96：开/关即时更新上报路径集（开启时顺带触发首查）
      } else if (t2.classList.contains("zu-ctxov")) {
        state.ctxOv = t2.value.trim();
        persist();
      }
      renderAll(false);
    });
    listenGlobal(document, "mousedown", function (e) {
      /* v80：面板挂 body 后 bar.contains 不再覆盖面板自身，点面板内部不能关 */
      if (panel.classList.contains("open") && !bar.contains(e.target) && !panel.contains(e.target)) panel.classList.remove("open");
      if (subPanel.classList.contains("open") && !bar.contains(e.target) && !subPanel.contains(e.target)) subPanel.classList.remove("open");
    });

    /* ---------- 子代理明细面板（v49）：点击条目弹出的固定面板，替代悬停 tooltip ---------- */
    var subPanelTab = 0;   // 面板当前页签（0=汇总，i=第 i 个子代理）；数据刷新时保持
    function buildSubPanel(sub) {
      var list = (sub && sub.list) || [];
      if (subPanelTab > list.length) subPanelTab = 0;   // 列表变短则回汇总
      subPanel.innerHTML = "";
      var head = document.createElement("div");
      head.className = "phead";
      head.textContent = L("子代理明细", "Sub-agent details");
      var ver = document.createElement("span");
      ver.className = "pver";
      ver.textContent = L("独立统计 · 不计入会话累计", "Tracked separately · not counted in session total");
      head.appendChild(ver);
      subPanel.appendChild(head);
      var runningSids = [];
      for (var rsid in subRate.slots) runningSids.push(rsid);   // v97：运行中槽位（DB 可能还没有记录）
      runningSids.sort();
      if (!sub || (!sub.total && !sub.active && !runningSids.length)) {
        var empty = document.createElement("div");
        empty.className = "pnote";
        empty.textContent = L("当前会话没有子代理记录", "No sub-agent records in the current session");
        subPanel.appendChild(empty);
        return;
      }
      /* 页签行：汇总 + 每个子代理（复用 .ttabs/.ttab 样式）；动态名走 textContent 防注入 */
      var tabsRow = document.createElement("div");
      tabsRow.className = "ttabs";
      var labels = [L("汇总", "Summary")];
      list.forEach(function (s1) {
        /* task=派发时的 description（右侧"子智能体目录"同源）；无则退回 title/线路名 */
        var nm = String(s1.task || "").trim() || String(s1.title || "").trim() ||
          String(s1.agent || "sub").replace(/^zcode-/, "") + "…" + String(s1.sid).slice(-4);
        labels.push(nm.length > 12 ? nm.slice(0, 11) + "…" : nm);
      });
      labels.forEach(function (lb, i) {
        var tb = document.createElement("span");
        tb.className = "ttab" + (i === subPanelTab ? " on" : "");
        tb.setAttribute("data-i", String(i));
        tb.textContent = lb;
        tabsRow.appendChild(tb);
      });
      subPanel.appendChild(tabsRow);
      var body = document.createElement("div");
      body.className = "tbody";   // 复用 tooltip 内容容器的限高滚动
      subPanel.appendChild(body);
      function fillRow(row, s1) {
        var nm = String(s1.task || "").trim() || String(s1.title || "").trim() ||
          String(s1.agent || "sub").replace(/^zcode-/, "") + "…" + String(s1.sid).slice(-4);
        var n = document.createElement("div");
        n.className = "subname";
        n.textContent = nm + L("（", " (") + String(s1.agent || "subagent").replace(/^zcode-/, "") +
          " …" + String(s1.sid).slice(-4) + L("）", ")");
        if (s1.active) {   // 运行中徽章：动态名仍走 textContent，徽章是独立 span
          var live = document.createElement("span");
          live.className = "sublive";
          live.textContent = L("运行中", "running");
          n.appendChild(live);
          var est = document.createElement("span");   // v97：运行期估算速率（渲染端状态，面板 tick 原地更新）
          est.className = "subrate dim";
          est.setAttribute("data-sid", String(s1.sid || ""));
          est.textContent = subRateSlotText(s1.sid);
          n.appendChild(est);
        }
        var st = document.createElement("div");
        st.className = "substat";
        st.textContent = L("总消耗 ", "Total ") + fmt(s1.total) + L(" · ", " · ") + (s1.requests || 0) +
          L(" 次请求", " requests") +
          (s1.tps_avg > 0 ? L(" · 均 ", " · avg ") + s1.tps_avg + L(" t/s", " t/s") : "") +
          (s1.last ? L(" · 最后活动 ", " · last activity ") + fmtTime(s1.last) : "");
        var br = document.createElement("div");
        br.className = "substat dim";
        br.textContent = ioc(s1.input, s1.output, s1.cache_read, s1.reasoning, s1.cache_write);
        row.appendChild(n);
        row.appendChild(st);
        row.appendChild(br);
      }
      if (subPanelTab === 0) {
        var p1 = document.createElement("div");
        p1.className = "pnote";
        p1.textContent = ioc(sub.input, sub.output, sub.cache_read, sub.reasoning, sub.cache_write) +
          L("，共 ", ", ") + (sub.requests || 0) + L(" 次", " requests in total") +
          (sub.rate_avg > 0 ? L(" · 均 ", " · avg ") + sub.rate_avg + L(" t/s", " t/s") : "") +
          (sub.active ? L(" · 有子代理运行中", " · sub-agent running") : "");
        body.appendChild(p1);
        /* v97：运行中子代理逐个实时估算——含 DB 还没有完成记录的新子代理（sub.list
         * 只收录有已完成请求的会话）；数值 span 由面板 tick 原地刷新。 */
        if (runningSids.length) {
          var rh = document.createElement("div");
          rh.className = "pnote";
          rh.textContent = L("运行中估算（字符增量；主 chip 显示合计）", "Running estimates (text-delta; the bar chip shows the sum)");
          body.appendChild(rh);
          for (var ri = 0; ri < runningSids.length; ri++) {
            var rl = document.createElement("div");
            rl.className = "substat";
            rl.textContent = L("子代理 …", "agent …") + String(runningSids[ri]).slice(-4) +
              L(" · 运行中 · ", " · running · ");
            var rest = document.createElement("span");
            rest.className = "subrate";
            rest.setAttribute("data-sid", runningSids[ri]);
            rest.textContent = subRateSlotText(runningSids[ri]);
            rl.appendChild(rest);
            body.appendChild(rl);
          }
        }
        if (!list.length && !runningSids.length) {
          var p2 = document.createElement("div");
          p2.className = "pnote";
          p2.textContent = L("当前会话还没有子代理记录", "No sub-agent records in the current session yet");
          body.appendChild(p2);
        }
      } else {
        var row = document.createElement("div");
        row.className = "subrow";
        fillRow(row, list[subPanelTab - 1]);
        body.appendChild(row);
      }
    }
    function positionSubPanel() {
      if (!subPanel.classList.contains("open")) return;
      var item = bar.querySelector(".zu-sub");
      if (!item) return;
      var ir = item.getBoundingClientRect();
      var width = subPanel.offsetWidth;
      var left = ir.left + ir.width / 2 - width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      subPanel.style.left = Math.round(left) + "px";
      /* v80：fixed 挂 body，top 同设置面板——条上沿留 10px 缝 */
      subPanel.style.top = Math.max(8, Math.round(bar.getBoundingClientRect().top - subPanel.offsetHeight - 10)) + "px";
    }
    /* v97：面板打开期间 800ms 原地刷新 .subrate span（估算速率是渲染端状态，泵推送
     * 静默期面板不会自动重建）；面板关闭/实例失效即自停，dispose 兜底清理。 */
    var subRateTimer = 0;
    function subRateTickPanel() {
      if (inactive() || !subPanel.classList.contains("open")) {
        if (subRateTimer) { clearInterval(subRateTimer); subRateTimer = 0; }
        return;
      }
      var spans = subPanel.querySelectorAll(".subrate");
      for (var i = 0; i < spans.length; i++) {
        var txt = subRateSlotText(spans[i].getAttribute("data-sid") || "");
        if (spans[i].textContent !== txt) spans[i].textContent = txt;
      }
    }
    function toggleSubPanel() {
      var opening = !subPanel.classList.contains("open");
      subPanel.classList.toggle("open", opening);
      if (opening) {
        panel.classList.remove("open");   // 与设置面板互斥
        buildSubPanel(lastSub);
        positionSubPanel();
        hideTip(true, "sub-open");
        if (!subRateTimer) subRateTimer = setInterval(subRateTickPanel, 800);
      }
    }
    bar.addEventListener("click", function (e) {
      if (inactive()) return;
      if (e.target && e.target.closest && e.target.closest(".zu-sub")) {
        e.stopPropagation();
        toggleSubPanel();
      }
    });
    subPanel.addEventListener("click", function (e) {
      if (inactive()) return;
      var b = e.target && e.target.closest ? e.target.closest(".ttab") : null;
      if (!b) return;
      subPanelTab = +b.getAttribute("data-i") || 0;
      buildSubPanel(lastSub);   // 面板固定，切页签只换内容
    });

    /* ---------- 输入框查找（穿透 open shadow / 同源 iframe） ---------- */
    var COMPOSER_SEL = 'textarea, [contenteditable="true"], [role="textbox"], .ProseMirror, .ql-editor';
    var deepCache = { el: null, at: 0 };
    function visible(el) {
      var r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 8 && r.bottom > 0 && r.top < innerHeight;
    }
    function deepFind() {
      if (deepCache.el && deepCache.el.isConnected && reallyVisible(deepCache.el)) return deepCache.el;
      if (Date.now() - deepCache.at < 1000) return null;
      deepCache.at = Date.now();
      var found = null;
      function scan(doc, depth) {
        if (found || !doc || depth > 8) return;
        try {
          doc.querySelectorAll(COMPOSER_SEL).forEach(function (el) {
            if (el.closest && el.closest('[role="dialog"]')) return;   // v62：弹窗内的编辑框不是聊天输入框（issue #9）
            if (inSettingsView(el)) return;   // 设置页（MCP 配置等）的编辑框不是聊天输入框
            if (!found && visible(el) && el.getBoundingClientRect().top > innerHeight * 0.45) found = el;
            else if (found && el.getBoundingClientRect().top > found.getBoundingClientRect().top && visible(el)) found = el;
          });
        } catch (e) { }
        if (found) return;
        try {
          doc.querySelectorAll("*").forEach(function (el) {
            if (!found && el.shadowRoot) scan(el.shadowRoot, depth + 1);
          });
        } catch (e) { }
        try {
          doc.querySelectorAll("iframe").forEach(function (fr) {
            if (!found) { try { if (fr.contentDocument) scan(fr.contentDocument, depth + 1); } catch (e) { } }
          });
        } catch (e) { }
      }
      scan(document, 0);
      if (found) deepCache.el = found;
      return found;
    }
    /* 输入框是否真的露在屏幕上：幽灵子树检测（设置页等 opacity-0/inert 壳，v61）+
     * 中心点命中测试（真渲染出来的覆盖层，如全屏对话框背景、悬浮菜单）。 */
    /* 自己的浮层（设置面板/超限气泡/悬停 tooltip）展开在条上方、必然覆盖输入区中心：
     * 若算进遮挡判定，会进 隐藏→复显→再隐藏 的循环（v40 离线复现的"打开设置闪烁"根因；
     * v41 补 tooltip——会话/工具的长 tooltip 同样盖住输入框中心，悬停 0.4s 后闪一下且 tooltip 消失）。
     * 只豁免 track 的可见性路径；findComposer 找输入框时不用（ownOK 缺省 false）。 */
    function isOwnOverlay(el) {
      try { return !!(el && el.closest && el.closest(".zusage-tip-root,.panel,.zusage-exc")); } catch (e) { return false; }
    }
    /* 幽灵子树检测（v61，取代 v58/v59 的 coverLock + 穿透特判）：
     * 客户端 3.11.x 的设置页 = 设置 tab 激活时给工作区主视图套 opacity-0 + inert +
     * pointer-events-none 的壳（DOM 与几何原样保留，纯视觉隐藏）。输入框落在这类
     * "保持挂载但视觉已隐藏"的祖先链里就判不可见 —— 直接读计算样式，与
     * elementFromPoint 无关，天然免疫滚动锁定期的穿透假象。 */
    function inGhostSubtree(el) {
      try {
        for (var p = el; p && p !== document.body; p = p.parentElement) {
          if (p.inert) return true;
          var cs = getComputedStyle(p);
          if (cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.1) return true;
        }
      } catch (e) { }
      return false;
    }
    /* 模态弹窗打开判定（v62，issue #9）：Radix Dialog 往 body 挂一层「固定全屏 + 带底色 +
     * z-index 抬升」的遮罩（下拉菜单/选择器只设 body pointer-events:none、不挂遮罩——v61
     * 实测），且文档里同时存在 [role="dialog"]。此时聊天区整体不可交互，条必须整体收起：
     * 模型配置弹窗里的「推理参数映射」编辑框正好落在视口下半部，会被 findComposer 的
     * 启发式当聊天输入框，条就冒在弹窗里（用户 issue #9 截图）。
     * 自己的浮层（.zu-bar/.zu-back/.zu-sheet——移动端抽屉遮罩是同款全屏底色）不算。 */
    function modalOpen() {
      try {
        if (!document.querySelector('[role="dialog"]')) return false;
        var kids = document.body.children;
        for (var i = 0; i < kids.length; i++) {
          var el = kids[i];
          var cls = String(el.getAttribute && el.getAttribute("class") || "");
          if (el.id === "zusage-bar" || /(^|\s)zu-(bar|back|sheet)(\s|$)/.test(cls)) continue;
          var cs = getComputedStyle(el);
          if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
          if (parseFloat(cs.opacity || "1") < 0.05) continue;
          if (!(parseInt(cs.zIndex, 10) >= 10)) continue;   // 遮罩必抬层（z-40/50）；普通全屏容器不抬
          var r = el.getBoundingClientRect();
          if (r.width < innerWidth * 0.9 || r.height < innerHeight * 0.9) continue;
          var bg = cs.backgroundColor;
          if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") continue;
          return true;
        }
      } catch (e) { }
      return false;
    }
    function reallyVisible(el, ownOK) {
      if (!visible(el)) return false;
      if (inGhostSubtree(el)) return false;   // 设置页等幽灵壳：视觉已隐藏（v61）
      var r = el.getBoundingClientRect();
      var hit;
      try { hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); } catch (e) { return true; }
      if (!hit) return false;
      /* 命中根元素 = 穿透（v61 翻转判定）：Radix 模态层（下拉/对话框/modal 弹层）打开时给
       * body 设 pointer-events:none，应用树全被跳过、elementFromPoint 一路穿到 <html>。
       * v58/v59 曾把它当"被盖"（修设置页冒条），但正常聊天里开任何下拉也会中招——
       * 条被误藏（用户实测）。现改判"可见"：设置页场景由 inGhostSubtree 兜住
       * （3.11.x 设置壳必带 opacity-0+inert，不依赖命中测试），其余穿透场景
       * 都是真·未被盖（弹层在别处，输入框露着）。 */
      if (hit === document.body || hit === document.documentElement) return true;
      if (hit === el || hit.contains(el) || el.contains(hit)) return true;   // 命中自身/祖先/内部装饰层
      /* 悬浮气泡豁免（v65）：非模态浮层（「剩余额度」hover 卡、下拉/选择器弹层——body
       * 直挂、无遮罩）会压住输入框中心点，按旧判定悬停一超 400ms 迟滞整条就消失
       * （用户实测）。但条挂在输入框正下方，上方浮层与条并无几何冲突：命中元素只是
       * 部分遮挡（未把输入框矩形整体罩住）时仍判可见。整体罩住才维持"被盖"——模态
       * 全屏遮罩等真接管行为不变，模态弹窗/设置页另有 modalOpen/inGhostSubtree 收口。 */
      var hr = hit.getBoundingClientRect();
      if (hr.left > r.left || hr.top > r.top || hr.right < r.right || hr.bottom < r.bottom) return true;
      if (ownOK && isOwnOverlay(hit)) return true;
      return false;
    }
    function findComposer() {
      var best = null;
      document.querySelectorAll("textarea").forEach(function (ta) {
        if (ta.closest && ta.closest('[role="dialog"]')) return;   // v62：弹窗内的编辑框不是聊天输入框（模型配置弹窗的「推理参数映射」落在下半屏，issue #9）
        if (inSettingsView(ta)) return;   // 设置页（MCP 配置等）的编辑框不是聊天输入框
        if (!reallyVisible(ta)) return;
        var r = ta.getBoundingClientRect();
        if (r.top < innerHeight * 0.45) return;   // 聊天输入框特征：在视口下半部（排除设置页等处元素）
        if (!best || r.top > best.getBoundingClientRect().top) best = ta;
      });
      return best || deepFind();
    }
    function collectDiag(extra) {
      if (everMounted) return;  /* 已成功挂载的窗口才允许写诊断，防后台空窗口覆盖 */
      if (Date.now() - (collectDiag.at || 0) < 5000) { if (extra) Object.assign(window.__zusageDiag, extra); return; }
      collectDiag.at = Date.now();
      /* 只在 window.__zusageDiag 本体上原地更新，绝不整体替换对象：
       * v14 曾用 Object.assign(d, ...) 换新对象，FATAL 仍指旧对象，
       * 之后写入的 mount/trackErr 全进孤儿对象，diag 文件永远看不到（实测翻车）。 */
      var d = window.__zusageDiag;
      d.time = new Date().toISOString();
      d.version = VERSION;
      d.href = String(location.href).slice(0, 90);
      var shallow = {};
      COMPOSER_SEL.split(",").forEach(function (sel) {
        try { shallow[sel.trim()] = document.querySelectorAll(sel).length; } catch (e) { }
      });
      d.shallow = shallow;
      d.iframes = document.querySelectorAll("iframe").length;
      var sr = 0;
      (function walk(doc) {
        if (!doc || !doc.querySelectorAll) return;
        var all;
        try { all = doc.querySelectorAll("*"); } catch (e) { return; }
        for (var i = 0; i < all.length; i++) {
          if (all[i].shadowRoot) { sr++; walk(all[i].shadowRoot); }
        }
      })(document);
      d.shadowRoots = sr;
      if (extra) Object.assign(d, extra);
    }

    /* 每实例只归还自己占用的卡片，不能清掉其它 pane 的让位边距。 */
    var paddedCard = null, originalMargin = "";
    function releasePads() {
      if (!paddedCard) return;
      paddedCard.style.marginBottom = originalMargin;
      delete paddedCard.dataset.zuCardPad;
      paddedCard = null;
    }
    var CARD_MARGIN = "24px";
    function ensureCardPad() {
      if (!cardCache) return;
      if (paddedCard !== cardCache) {
        releasePads();
        paddedCard = cardCache;
        originalMargin = cardCache.style.marginBottom || "";
        cardCache.dataset.zuCardPad = originalMargin;
      }
      if (cardCache.style.marginBottom !== CARD_MARGIN) cardCache.style.marginBottom = CARD_MARGIN;
    }

    /* 从 textarea 向上找视觉卡片容器（有可见边框或背景的最近祖先）——条的锚点 + 读原生总量按钮 */
    function isVisualBox(el) {
      try {
        var cs = getComputedStyle(el);
        return cs.borderTopWidth !== "0px" || cs.backgroundColor !== "rgba(0, 0, 0, 0)";
      } catch (e) { return false; }
    }
    function cardOf(el) {
      var cr = el.getBoundingClientRect();
      var p = el.parentElement, last = el, i = 0;
      for (; p && p !== document.body && i < 8; p = p.parentElement, i++) {
        var r = p.getBoundingClientRect();
        if (r.height > cr.height * 8 + 80) break;          // 会话级大容器（高度异常）
        if (isVisualBox(p)) return p;                       // 第一个有边框/背景的层 = 视觉卡片
        last = p;
      }
      return last;
    }
    /* 权限确认面板内的锚点改判：composer 被面板顶掉（display:none）后，面板里的
     * 反馈输入框是该 pane 唯一候选——它比面板卡矮得多，cardOf 的高度熔断会在到达面板卡
     * 之前 break，落到面板内部的选项/反馈包裹层，条就冒进面板里（最初的 bug：确认时条
     * 跑进对话框）。输入框带 data-permission-* 标记（或卡片自带的数据标记）时改判面板
     * 视觉卡：第一个「有边框且有背景」的祖先（选项按钮只有背景无边框会跳过，rounded-2xl
     * 面板卡二者俱全）。
     * 普通输入框不走这条（closest 不命中），行为与 v62 完全一致。 */
    function isCardLike(el) {
      try {
        var cs = getComputedStyle(el);
        return cs.borderTopWidth !== "0px" && cs.backgroundColor !== "rgba(0, 0, 0, 0)";
      } catch (e) { return false; }
    }
    function panelCardOf(el) {
      try {
        /* 权限面板与批准框（elicitation）同组件，卡片自带该标记（rounded-2xl 视觉卡），
         * 直接锚卡片——选项行聚焦/填写时带底色也会被 cardOf 误判成视觉盒，锚了它条会落进卡片里 */
        var card = el.closest("[data-elicitation-dialog-card]");
        if (card) return card;
        if (!el.closest('[data-permission-option-kind],[data-permission-feedback-option],[data-permission-rule-scopes]')) return null;
      } catch (e) { return null; }
      for (var p = el; p && p !== document.body; p = p.parentElement) {
        if (isCardLike(p)) return p;
      }
      return null;
    }
    function anchorCardOf(el) {
      return panelCardOf(el) || cardOf(el);
    }
    /* 读原生 UI 的上下文总量（输入框工具行按钮的文本/aria-label，如"…总量 1,000,000"）。
     * 服务端下发、自动跟随模型，优先级高于 catalog 查表和 config fallback。 */
    var nativeCtx = { val: 0, at: 0 };
    function readNativeCtx(card) {
      if (Date.now() - nativeCtx.at < 5000) return nativeCtx.val;
      nativeCtx.at = Date.now();
      var els = card.querySelectorAll("button, [aria-label], [title]");
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var t = el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "";
        var m = t.match(/总量\s*([\d,，]+)/);
        if (m) {
          nativeCtx.val = parseInt(m[1].replace(/[,,]/g, ""), 10);
          return nativeCtx.val;
        }
      }
      return nativeCtx.val;
    }

    /* ---------- v92 原生上下文按钮增强（v93 起档位口径唯一承载处）：环填充与右侧百分比 ----------
     * 按钮（chat-context-usage-trigger）与本条同 pane 同会话：数据取本实例 lastBand。
     * 稳定性依据：React 不清理非 props 的手动 data-* 属性，也不动 wrapper 末尾追加的
     * 节点（其 React children 只有 button）；dasharray/dashoffset 属 React 管理，宿主
     * 数据更新瞬间会重写，由 render + heavy 双 reapply 兜回（≤600ms）。
     * cw 缺失时还原原生形态（按钮仍承载 Coding Plan/Start Plan 面板，不动其存在性）。 */
    var ZU_CTX_TRIGGER = '[data-testid="chat-context-usage-trigger"]';
    var ZU_CTX_CIRC = 62.83185307179586;   // 原生环 r=10 的周长（还原原生 dashoffset 用）
    function enhanceCtxButton() {
      if (inactive()) return;
      var btn = null;
      try { btn = cardCache ? cardCache.querySelector(ZU_CTX_TRIGGER) : null; } catch (e) { }
      if (!btn || !btn.parentElement || !lastBand || !lastBand.cw) {
        if (ctxBtnCache) { restoreCtxButton(ctxBtnCache); ctxBtnCache = null; }
        return;
      }
      ctxBtnCache = btn;
      if (btn.getAttribute("data-zusage-armed") !== "1") btn.setAttribute("data-zusage-armed", "1");
      if (btn.getAttribute("data-zusage-band") !== lastBand.cls) btn.setAttribute("data-zusage-band", lastBand.cls);
      var lite = bar.classList.contains("zu-light");
      syncCtxLite(btn, lite);
      var svg = null;   // 排除 .animate-spin：额度重置中 spinner 保留原生转圈，期间环回原生样式
      for (var i = 0; i < btn.children.length; i++) {
        var k = btn.children[i];
        if (String(k.tagName || "").toLowerCase() === "svg" && !(k.classList && k.classList.contains("animate-spin"))) { svg = k; break; }
      }
      if (svg) {
        var cs = svg.querySelectorAll("circle");
        var v = cs.length >= 2 ? cs[1] : null;
        if (v) {
          var da = Math.max(0, Math.min(100, lastBand.pct)).toFixed(1) + " 100";
          if (v.getAttribute("pathLength") !== "100") v.setAttribute("pathLength", "100");
          if (v.getAttribute("stroke-dasharray") !== da) v.setAttribute("stroke-dasharray", da);
          if (v.getAttribute("stroke-dashoffset") !== "0") v.setAttribute("stroke-dashoffset", "0");
          if (v.getAttribute("stroke-linecap") !== "round") v.setAttribute("stroke-linecap", "round");
        }
      }
      var pctEl = null;
      for (var j = 0; j < btn.children.length; j++) {
        if (btn.children[j].classList && btn.children[j].classList.contains("zu-ctxpct")) { pctEl = btn.children[j]; break; }
      }
      if (!pctEl) {
        pctEl = document.createElement("span");
        pctEl.className = "zu-ctxpct";
        btn.appendChild(pctEl);   // 挂在 trigger 按钮内：悬停数值=悬停按钮，原生 hover 效果与「上下文容量」面板自动生效
      } else if (pctEl !== btn.children[btn.children.length - 1]) {
        btn.appendChild(pctEl);   // React 提交（如额度重置 loading 切换的 appendChild）可能把手动节点挤离末尾，挪回环右侧
      }
      var txt = lastBand.pct.toFixed(1) + "%";
      var pcls = "zu-ctxpct pct " + lastBand.cls;
      if (pctEl.textContent !== txt) pctEl.textContent = txt;
      if (pctEl.className !== pcls) pctEl.className = pcls;
    }
    function syncCtxLite(el, lite) {
      var has = el.getAttribute && el.getAttribute("data-zusage-light");
      if (lite && !has) el.setAttribute("data-zusage-light", "1");
      else if (!lite && has) el.removeAttribute("data-zusage-light");
    }
    function restoreCtxButton(btn) {
      if (!btn || !btn.isConnected) return;
      btn.removeAttribute("data-zusage-armed");
      btn.removeAttribute("data-zusage-band");
      btn.removeAttribute("data-zusage-light");
      for (var i = 0; i < btn.children.length; i++) {
        if (btn.children[i].classList && btn.children[i].classList.contains("zu-ctxpct")) { btn.children[i].remove(); break; }
      }
      var cs = btn.querySelectorAll("circle");
      var v = cs.length >= 2 ? cs[1] : null;
      if (v) {
        v.removeAttribute("pathLength");
        v.removeAttribute("stroke-linecap");
        /* 还原原生 dash 语义：aria-label「上下文已用 X / 总量 Y」推回 offset；拿不到就退
         * 空环（offset=周长），React 数据更新时会写回准确值。 */
        var ratio = 0, m = String(btn.getAttribute("aria-label") || "").match(/已用\s*([\d,，]+)\s*\/\s*总量\s*([\d,，]+)/);
        if (m) {
          var used = parseFloat(m[1].replace(/[,,]/g, "")), total = parseFloat(m[2].replace(/[,,]/g, ""));
          if (used > 0 && total > 0) ratio = Math.min(Math.max(used / total, 0), 1);
        }
        v.setAttribute("stroke-dasharray", ZU_CTX_CIRC + " " + ZU_CTX_CIRC);
        v.setAttribute("stroke-dashoffset", String(ZU_CTX_CIRC * (1 - ratio)));
      }
    }

    /* ---------- v96 套餐额度 chip：原生上下文按钮左侧 ----------
     * 挂载面与按钮增强同源：wrapper（tooltip-trigger span）的 React children 只有 button，
     * 前插的手动节点不受 reconcile 清理；双 reapply（render 数据点 + heavy 对账点）兜回位置
     * 与内容；dispose / 关闭开关 / 无数据一律摘除。显示门控：开关开 + 本 pane 会话已有完成的
     * main_turn（provider_id 已知）+ provider 为内置套餐档；自定义 provider 隐藏，团队档给
     * 不支持提示。数据账号级（快照 quota 字段），同套餐换模型只换 tooltip 高亮不重查。 */
    var ZU_QUOTA_WARM = 80, ZU_QUOTA_HOT = 95;   // 已用 % 档位（独立于上下文的 70/85）
    function quotaBandOf(pct) { return pct >= 100 ? "exc" : pct >= ZU_QUOTA_HOT ? "hot" : pct >= ZU_QUOTA_WARM ? "warm" : "ok"; }
    /* chip 分段：每个窗口一段（5小时/7天），各自按已用 % 上档位色；余额类型一段（阶段 3 数据源接入即用） */
    function quotaSegs(q) {
      var w = q && q.windows, out = [];
      if (!w) return out;
      var defs = [["daily", "今日", "1d"], ["fiveHour", "5小时", "5h"], ["weekly", "7天", "7d"], ["monthly", "本月", "1mo"]];
      for (var i = 0; i < defs.length; i++) {
        var e = w[defs[i][0]];
        if (e && typeof e.percent === "number") out.push({ label: L(defs[i][1], defs[i][2]), pct: e.percent });
      }
      return out;
    }
    function quotaChipMode() {
      if (!state.quotaEnabled) return null;
      /* 会话有请求历史 → 跟随本会话最近完成的请求；无历史（新会话/刚切模型）→ 跟随快照
       * 顶层 provider_fallback（账号最近套餐档），消除切模型到首请求完成的 chip 空窗。 */
      var prov = effectiveQuotaProvider();
      if (!prov) return null;
      if (prov.indexOf("account:") === 0 && prov.indexOf("team") >= 0) {
        return { kind: "team", html: '<span class="zu-qwarn">⊘</span>', aria: L("团队套餐额度暂不支持", "Team plan quota not supported yet") };   // 静态提示不依赖数据
      }
      if (!lastQuota) return null;
      /* 按 provider 选源：内置 account:* → family 源；自定义 → byProvider 映射（主进程
       * noteProvider 时记录），未映射的自定义退 custom 源。多窗异 provider 各取各的源。 */
      var q = lastQuota, st = q.status;
      if (st === "not_configured" || st === "unsupported" || st === "disabled") return null;
      var warn = (st !== "ok" && st !== "idle") ? '<span class="zu-qwarn">⚠</span>' : "";
      var bal = q.balance;
      if (bal && typeof bal.amount === "number" && isFinite(bal.amount)) {
        var amt = quotaBalanceText(bal);
        return { kind: "balance", stale: !!q.stale,
          html: '<span class="zu-qseg ok">' + (state.lang === "en" ? "" : "余额 ") + amt + "</span>" + warn,
          aria: L("余额 ", "Balance ") + amt };
      }
      var segs = quotaSegs(q);
      if (segs.length) {
        var html = segs.map(function (s) {
          return '<span class="zu-qseg ' + quotaBandOf(s.pct) + '">' + s.label + " " + Math.round(s.pct) + "%</span>";
        }).join('<span class="zu-qsep">|</span>');
        return { kind: "value", stale: !!q.stale,
          html: html + warn,
          aria: L("套餐已用 ", "Plan used ") + segs.map(function (s) { return s.label + " " + Math.round(s.pct) + "%"; }).join(L("，", ", ")) };
      }
      var summary = q.quotaSummary;
      if (summary && typeof summary.remaining === "number" && isFinite(summary.remaining)) {
        var left = quotaBalanceText({ amount: summary.remaining, currency: summary.currency });
        return { kind: "quota", stale: !!q.stale, html: '<span class="zu-qseg ok">' + L("额度 ", "Quota ") + left + "</span>" + warn,
          aria: L("Key 剩余额度 ", "Key quota remaining ") + left };
      }
      if (st === "ok" || st === "idle") return null;   // 还没有可显示的窗口（首查在途/接口回空）
      return { kind: "error", html: '<span class="zu-qwarn">⚠</span>', aria: quotaStatusText(st) || st };
    }
    function onQuotaClick(e) {
      e.preventDefault();
      e.stopPropagation();
      pluginRequest("quota-refresh", quotaSourceId ? { sourceId: quotaSourceId } : undefined);   // 绕过 TTL 与软冻结
      var el = this;
      el.classList.add("zu-qbusy");
      setTimeout(function () { el.classList.remove("zu-qbusy"); }, 1500);
    }
    function enhanceQuotaChip() {
      if (inactive()) { restoreQuotaChip(); return; }
      var mode = quotaChipMode();
      if (!mode) { restoreQuotaChip(); return; }
      var btn = null;
      try { btn = (ctxBtnCache && ctxBtnCache.isConnected) ? ctxBtnCache : (cardCache ? cardCache.querySelector(ZU_CTX_TRIGGER) : null); } catch (e) { }
      if (!btn || !btn.parentElement) { restoreQuotaChip(); return; }
      var wrap = btn.parentElement;
      var chip = quotaChipCache;
      if (!chip || !chip.isConnected || chip.parentElement !== wrap) {
        if (chip && chip.isConnected) chip.remove();
        chip = null;
        for (var i = 0; i < wrap.children.length; i++) {   // 复用热更/重建遗留的同类节点，避免双 chip
          if (wrap.children[i].classList && wrap.children[i].classList.contains("zu-quota")) { chip = wrap.children[i]; break; }
        }
        if (!chip) {
          chip = document.createElement("span");
          chip.className = "zu-quota";
          chip.setAttribute("role", "status");
          chip.tabIndex = 0;
          chip.addEventListener("mouseenter", onQuotaEnter);
          chip.addEventListener("mouseleave", hideQuotaTip);
          chip.addEventListener("focus", onQuotaEnter);
          chip.addEventListener("blur", hideQuotaTip);
          chip.addEventListener("click", onQuotaClick);
        }
        quotaChipCache = chip;
      }
      if (chip.nextElementSibling !== btn) wrap.insertBefore(chip, btn);   // 位置兜回：始终紧贴按钮左侧
      syncCtxLite(chip, bar.classList.contains("zu-light"));
      var srcLabels = {};
      for (var si = 0; si < (state.quotaSources || []).length; si++) srcLabels[state.quotaSources[si].id] = state.quotaSources[si].label;
      var all = lastQuotaAll && lastQuotaAll.sources ? Object.assign({}, lastQuotaAll, { active: quotaSourceId }) : lastQuotaAll;
      chip.__zuQ = { q: lastQuota, all: all, srcLabels: srcLabels, provider: quotaProvider, model: quotaModel, mode: mode };
      var sig = mode.kind + "|" + (mode.stale ? 1 : 0) + "|" + mode.html;
      if (chip.__zuSig !== sig) {   // 幂等：内容没变不重建，悬停/焦点态不被打断
        chip.__zuSig = sig;
        chip.className = "zu-quota" + (mode.stale ? " zu-qstale" : "");
        chip.setAttribute("aria-label", mode.aria);
        chip.innerHTML = mode.html;
      }
      if (quotaTipFor === chip) showQuotaTip(chip);   // 悬停中数据刷新：内容跟随
    }
    function restoreQuotaChip() {
      if (!quotaChipCache) return;
      if (quotaTipFor === quotaChipCache) hideQuotaTip();
      try { quotaChipCache.remove(); } catch (e) { }
      quotaChipCache = null;
    }

    /* ---------- v96 Git 状态 chip：挂「电脑操作」按钮（v4-composer-cua-entry）右侧 ----------
     * 样式移植 cc-pretty-statusline 的 git 段：⎇ 分支 ↑N ↓N (+插入行 -删除行 ?未跟踪文件)。
     * 数据：模块级 gitViewFor(scope.workspacePath)（主进程旁路查询推送）；本 pane 的 scope 为远端
     * （identity 非空）/ 未知 / 非仓库 / 无 git 时不挂载。稳定性同 v92：自有节点插在 React children
     * 之间（React 既不复用也不清理外来节点），位置由 render/heavy 双 reapply 兜回；内容签名幂等。 */
    var ZU_CUA_BTN = '[data-testid="v4-composer-cua-entry"]';
    var ZU_GIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<line x1="6" x2="6" y1="3" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>';
    /* v96 multi：多仓库聚合态图标 = lucide folder-git 官方 path 数据（描边宽对齐 ZU_GIT_ICON 的 1.5） */
    var ZU_GIT_MULTI_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="12" cy="13" r="2"></circle>' +
      '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>' +
      '<path d="M14 13h3"></path><path d="M7 13h3"></path></svg>';
    function gitChipView() {   // null = 本 pane 当前不该显示 chip
      if (!state.show.git) return null;
      var scope = readPaneScope(wantedEl, pickedSid, pid);
      if (!scope || scope.identity || !scope.workspacePath) return null;
      var v = gitViewFor(scope.workspacePath);
      return v ? { path: scope.workspacePath, st: v.st, stale: v.stale } : null;
    }
    function gitChipHtml(view) {   // view={path, st, stale}：stale 是工作区级过期标志（勿与闭包 stale() 函数混淆）
      var st = view.st, stale = view.stale;
      if (st.kind === "multi") {   // v96 multi：仓库数 + ·分隔语义段（已知/上次前缀、!冲突、失败、过期）；文件条目汇总在 tooltip 不上 chip
        var agg = gitMultiAgg(st), parts = ['<span class="zu-git-name">' + agg.total + L("仓", " repos") + "</span>"];
        var prefix = agg.failed > 0 ? L("已知", "") : (agg.staleAny || stale) ? L("上次", "last ") : "";
        if (agg.changed > 0) parts.push('<span class="zu-git-dirty">' + prefix + agg.changed + L("改", " changed") + "</span>");   // 有改动仓库数；任一确认冲突时整段红（.zu-conflict）
        if (agg.conflict > 0) parts.push('<span class="zu-git-conflict">!' + agg.conflict + L("冲突", " conflicted") + "</span>");   // 确认冲突的仓库数
        if (agg.failed > 0) parts.push('<span class="zu-git-warn">' + agg.failed + L("失败", " failed") + "</span>");
        if (stale) parts.push('<span class="zu-git-warn">' + L("过期", "stale") + "</span>");   // 过期用文字提示，不降透明度
        return ZU_GIT_MULTI_ICON + parts.join('<span class="zu-git-sep"> · </span>');
      }
      var name = st.detached ? "HEAD" : st.noCommits ? L("初始", "init") : String(st.branch || "HEAD");
      var shown = name.length > 18 ? name.slice(0, 16) + "…" : name;   // 全名进 tooltip
      var h = ZU_GIT_ICON + '<span class="zu-git-name">' + gitEsc(shown) + "</span>";
      var ab = (st.ahead > 0 ? "↑" + st.ahead : "") + (st.behind > 0 ? (st.ahead > 0 ? " " : "") + "↓" + st.behind : "");
      if (ab) h += '<span class="zu-git-ab">' + ab + "</span>";
      var nums = [];
      if (st.ins > 0) nums.push('<span class="zu-git-ins">+' + st.ins + "</span>");
      if (st.del > 0) nums.push('<span class="zu-git-del">-' + st.del + "</span>");
      var d = nums.join(" ") + (nums.length && st.untracked > 0 ? '<span class="zu-git-sep"> · </span>' : "") + (st.untracked > 0 ? '<span class="zu-git-unt">?' + st.untracked + "</span>" : "");
      if (d) h += '<span class="zu-git-d">(' + d + ")</span>";   // 无任何改动时整段不出现
      if ((st.conflicts | 0) > 0) h += ' <span class="zu-git-conflict">!' + st.conflicts + L("冲突", " conflicted") + "</span>";
      if (st.op) h += ' <span class="zu-git-op">' + gitEsc(gitOpLabel(st.op)) + "</span>";
      if (stale) h += ' <span class="zu-git-warn">' + L("过期", "stale") + "</span>";
      return h;
    }
    function gitChipAria(st, stale) {
      if (st.kind === "multi") {
        var a = gitMultiAgg(st);
        var ms = L("Git " + a.total + " 个仓库", "Git " + a.total + " repos");
        if (a.changed > 0 || a.failed > 0) ms += L("，" + (a.failed > 0 ? "已知 " : "") + a.changed + " 个有改动", ", " + a.changed + " with changes");
        if (a.conflict > 0) ms += L("，" + a.conflict + " 个仓库冲突", ", " + a.conflict + " repos conflicted");
        if (a.op > 0) ms += L("，" + a.op + " 个操作中", ", " + a.op + " mid-operation");
        if (a.failed > 0) ms += L("，" + a.failed + " 个查询失败", ", " + a.failed + " failed");
        if (stale) ms += L("，数据已过期", ", data stale");
        return ms;
      }
      var s = L("Git 分支 ", "Git branch ") + (st.detached ? "HEAD" : st.noCommits ? L("初始（尚无首次提交）", "init (no initial commit yet)") : st.branch);
      if (st.ahead > 0) s += L("，领先 ", ", ahead ") + st.ahead;
      if (st.behind > 0) s += L("，落后 ", ", behind ") + st.behind;
      if (st.ins > 0 || st.del > 0) s += L("，改动 +", ", changes +") + (st.ins | 0) + " -" + (st.del | 0);
      if (st.untracked > 0) s += L("，未跟踪 ", ", untracked ") + st.untracked;
      if ((st.conflicts | 0) > 0) s += L("，! " + st.conflicts + " 个冲突文件", ", ! " + st.conflicts + " conflicted files");
      if (st.op) s += L("，进行中操作：", ", git operation: ") + gitOpLabel(st.op);
      if (stale) s += L("，数据已过期", ", data stale");
      return s;
    }
    function onGitEnter() { showGitTip(this); }
    function onGitClick(e) {
      e.preventDefault();
      e.stopPropagation();
      askGitRefresh(true);   // 主进程立即重查全部已关注路径（绕过快照节流）
      var el = this;
      el.classList.add("zu-gbusy");
      setTimeout(function () { el.classList.remove("zu-gbusy"); }, 1500);
    }
    function enhanceGitChip() {
      if (inactive()) { restoreGitChip(); return; }
      var view = gitChipView();
      if (!view) { restoreGitChip(); return; }
      var btn = null;
      try { btn = (cuaBtnCache && cuaBtnCache.isConnected) ? cuaBtnCache : (cardCache ? cardCache.querySelector(ZU_CUA_BTN) : null); } catch (e) { }
      if (!btn || !btn.parentElement) { restoreGitChip(); return; }
      cuaBtnCache = btn;
      var wrap = btn.parentElement;
      var chip = gitChipCache;
      if (!chip || !chip.isConnected || chip.parentElement !== wrap) {
        if (chip && chip.isConnected) chip.remove();
        chip = null;
        for (var i = 0; i < wrap.children.length; i++) {   // 复用热更/重建遗留的同类节点，避免双 chip
          if (wrap.children[i].classList && wrap.children[i].classList.contains("zu-git")) { chip = wrap.children[i]; break; }
        }
        if (!chip) {
          chip = document.createElement("span");
          chip.className = "zu-git";
          chip.setAttribute("role", "status");
          chip.tabIndex = 0;
          chip.addEventListener("mouseenter", onGitEnter);
          chip.addEventListener("mouseleave", hideGitTipSoon);
          chip.addEventListener("focus", onGitEnter);
          chip.addEventListener("blur", hideGitTip);
          chip.addEventListener("click", onGitClick);
        }
        gitChipCache = chip;
      }
      if (btn.nextSibling !== chip) wrap.insertBefore(chip, btn.nextSibling);   // 位置兜回：始终紧贴按钮右侧（nextSibling 为 null 即追加末尾）
      syncCtxLite(chip, bar.classList.contains("zu-light"));
      var compact = btn.getAttribute("data-composer-compact") === "true";   // 宿主窄屏折叠：原生标签隐藏，chip 同步只留图标+计数
      chip.__zuGit = view;
      var html = gitChipHtml(view);
      var mAgg = view.st.kind === "multi" ? gitMultiAgg(view.st) : null;
      var cls = "zu-git" + (compact ? " zu-compact" : "") + (view.st.kind === "multi" ? " zu-git-multi" : "") + (mAgg && mAgg.conflict > 0 ? " zu-conflict" : "");   // v96：形态类（紧凑态收起份数与聚合计数段）+ 确认冲突 → 冲突段转红（类进签名保持幂等）；过期走文字徽章不降透明度
      var sig = cls + "|" + html + "|" + state.lang;
      if (chip.__zuSig !== sig) {   // 幂等：内容没变不重建，悬停/焦点态不被每 1.5s 的推送打断
        chip.__zuSig = sig;
        var busy = chip.classList.contains("zu-gbusy");
        chip.className = cls + (busy ? " zu-gbusy" : "");
        chip.setAttribute("aria-label", gitChipAria(view.st, view.stale));
        chip.innerHTML = html;
      }
      if (gitTipFor === chip) showGitTip(chip);   // 悬停中数据刷新：内容跟随
    }
    function restoreGitChip() {
      if (!gitChipCache) return;
      if (gitTipFor === gitChipCache) hideGitTip();
      try { gitChipCache.remove(); } catch (e) { }
      gitChipCache = null;
    }

    /* ---------- v105 压缩上下文：「上下文容量」弹层内、命中率行下方的胶囊按钮 ----------
     * 弹层（hover-card-content）关即卸载（Radix 无 forceMount），每次打开全新挂载——注入
     * 节点随之销毁，靠 body MutationObserver（即时）+ heavy 对账点（600ms 兜底）双触发重注
     * 入；以 DOM 存在性幂等，多实例并发安全。打开期间 React 只原地 patch，不会删除外来
     * 兄弟节点，最多相对移位（新 border-t 段出现时），同步时位置兜回（同 quota chip 3765 套路）。
     * 面板判别双指纹：!w-80（contextPanelWidthClass，全仓库唯一 important 宽）+ 内含 ui
     * Progress；插入锚=ContextContentBody（div.space-y-3）内「剩余额度」border-t 段之前
     * （命中率行在 <78% 时条件隐藏，锚定 border-t 段不受影响），缺则容器尾（仍是命中率行下）。
     * 确认后发送 /compact：优先 fiber 上原生残留的 onSendCompressionCommand（SessionPane
     * 压缩入口，最终 dispatchCommand("compact")，与手敲 /compact 同链、不动草稿、自带 toast）；
     * 缺失回落官方 E2E 输入桥（生产客户端无条件挂载）__zcodeLexicalInputE2E.setText +
     * 发送键。Lexical 的 contenteditable 直写不进 EditorState，该路径禁用；兜底通道会清写
     * 输入框，草稿非空一律拒绝。pane 归属：按几何就近的可见触发按钮（分栏各拿各的 fiber）。 */
    var ZU_HC_SEL = '[data-slot="hover-card-content"]';
    var compactDlg = null, compactDlgKey = null, compactAnchor = null, compactFn = null;
    function nearestByRect(anchor, sel) {   // 可见元素中矩形中心离 anchor 最近者；隐藏 pane 不参与
      var list = [], r0 = null;
      try {
        list = document.querySelectorAll(sel);
        r0 = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      } catch (e) { return null; }
      var best = null, bd = Infinity;
      var cx = r0 ? r0.left + r0.width / 2 : 0, cy = r0 ? r0.top + r0.height / 2 : 0;
      for (var i = 0; i < list.length; i++) {
        var r = null;
        try { r = list[i].getBoundingClientRect(); } catch (e) { }
        if (!r || r.width <= 0 || r.height <= 0) continue;
        var dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
        var d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = list[i]; }
      }
      return best;
    }
    function fiberPropFrom(el, prop) {   // 沿 __reactFiber$ 向上找 memoizedProps（限深 60 层）
      try {
        var ks = Object.keys(el), fk = "";
        for (var i = 0; i < ks.length; i++) {
          if (ks[i].indexOf("__reactFiber$") === 0) { fk = ks[i]; break; }
        }
        if (!fk) return null;
        var f = el[fk], n = 0;
        while (f && n++ < 60) {
          if (f.memoizedProps && typeof f.memoizedProps[prop] === "function") return f.memoizedProps[prop];
          f = f.return;
        }
      } catch (e) { }
      return null;
    }
    function syncCompactBtn() {
      if (inactive()) return;
      var hcs = [];
      try { hcs = document.querySelectorAll(ZU_HC_SEL); } catch (e) { return; }
      for (var i = 0; i < hcs.length; i++) {
        var body = null, anchor = null;
        try {
          if (!hcs[i].classList.contains("!w-80")) continue;
          if (!hcs[i].querySelector('[data-slot="progress"]')) continue;
          body = hcs[i].querySelector("div.space-y-3");
        } catch (e) { continue; }
        if (!body) continue;
        try {
          for (var j = 0; j < body.children.length; j++) {
            /* 「剩余额度」段=border-t+pt-2（CodingPlanContextUsage/StartPlanContextBalance 的
             * separated 分支）；命中率行在 breakdown 存在时也带 border-t 但是 pt-3，须双类名
             * 判别，否则按钮会插到命中率行上方。 */
            var cls2 = body.children[j].classList;
            if (cls2 && cls2.contains("border-t") && cls2.contains("pt-2")) { anchor = body.children[j]; break; }
          }
        } catch (e) { }
        var exist = null;
        for (var k = 0; k < body.children.length; k++) {
          if (body.children[k].classList && body.children[k].classList.contains("zu-compact-btn")) { exist = body.children[k]; break; }
        }
        if (exist) {   // 幂等 + 位置兜回：紧贴「剩余额度」段上方（无则容器尾）
          var misplaced = anchor ? exist.nextElementSibling !== anchor : body.lastElementChild !== exist;
          if (misplaced) body.insertBefore(exist, anchor);
          continue;
        }
        var b = document.createElement("button");
        b.type = "button";
        b.className = "zu-compact-btn";
        b.textContent = L("压缩上下文", "Compact context");
        b.addEventListener("click", onCompactClick);
        body.insertBefore(b, anchor);
      }
    }
    function closeCompactDlg() {
      if (compactDlgKey) {
        try { document.removeEventListener("keydown", compactDlgKey, true); } catch (e) { }
        compactDlgKey = null;
      }
      if (compactDlg) { try { compactDlg.remove(); } catch (e) { } compactDlg = null; }
      compactAnchor = null; compactFn = null;
    }
    function openCompactDlg(anchorBtn) {
      closeCompactDlg();
      compactAnchor = anchorBtn || null;
      /* fiber 提交函数只在打开瞬间解析（此刻弹层必存活、锚点几何可信）；确认时弹层可能
       * 已被 Radix 卸载（指针移入弹框），届时重解析会退化为「离视口左上角最近」，
       * 多分栏窗口会把 /compact 发进错误 pane 的会话（v110 修复）。 */
      var trig = null, label = "", fn = null;
      try {
        trig = nearestByRect(compactAnchor, ZU_CTX_TRIGGER);
        label = trig ? String(trig.getAttribute("aria-label") || "") : "";
        fn = trig ? fiberPropFrom(trig, "onSendCompressionCommand") : null;
      } catch (e) { }
      compactFn = fn || null;
      var m = label.match(/([\d,，]+)\s*\/\s*总量\s*([\d,，]+)/) || label.match(/([\d,]+)\s+of\s+([\d,]+)/i);
      var dlg = document.createElement("div");
      dlg.className = "zu-compact-dlg";
      var card = document.createElement("div");
      card.className = "zu-compact-card";
      var title = document.createElement("div");
      title.className = "zu-compact-title";
      title.textContent = L("压缩上下文", "Compact context");
      var desc = document.createElement("div");
      desc.className = "zu-compact-desc";
      if (m) {
        var b1 = document.createElement("b");
        b1.textContent = L("当前已用 " + m[1] + " / 总量 " + m[2], "Used " + m[1] + " of " + m[2]);
        desc.appendChild(b1);
        desc.appendChild(document.createTextNode(L("。将把会话历史总结压缩以释放上下文窗口，压缩后上下文占比会回落。", ". The conversation history will be summarized to free context window space; usage drops afterwards.")));
      } else {
        desc.textContent = L("将把会话历史总结压缩以释放上下文窗口，压缩后上下文占比会回落。", "The conversation history will be summarized to free context window space; usage drops afterwards.");
      }
      var hint = document.createElement("div");
      hint.className = "zu-compact-hint";
      hint.textContent = L("压缩通常需要 2-4 分钟且没有进度反馈，期间请勿发送新消息或点停止——那会取消压缩。", "Compaction usually takes 2–4 minutes with no progress indicator. Don't send new messages or stop during it — that cancels it.");
      var err = document.createElement("div");
      err.className = "zu-compact-err";
      var foot = document.createElement("div");
      foot.className = "zu-compact-foot";
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "zu-compact-cancel";
      cancel.textContent = L("取消", "Cancel");
      var ok = document.createElement("button");
      ok.type = "button";
      ok.className = "zu-compact-ok";
      ok.textContent = L("压缩", "Compact");
      cancel.addEventListener("click", closeCompactDlg);
      dlg.addEventListener("mousedown", function (e) {
        if (e.target === dlg) closeCompactDlg();   // 点遮罩关闭（卡片内点击不关）
      });
      ok.addEventListener("click", function () {
        if (ok.disabled) return;
        ok.disabled = true;
        var fail = compactSend(compactAnchor || ok);
        if (fail) {   // 失败：弹框保留并显示中性错误文案，不静默不关闭
          ok.disabled = false;
          err.textContent = fail;
          err.classList.add("on");
          return;
        }
        closeCompactDlg();
      });
      compactDlgKey = function (e) {
        if (!compactDlg) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeCompactDlg();
        } else if (e.key === "Enter" && !ok.disabled) {
          var f = null;
          try { f = document.activeElement; } catch (e2) { }
          if (f && dlg.contains && !dlg.contains(f)) return;   // 焦点已逸出弹框（无焦点陷阱）：不劫持宿主 Enter
          e.preventDefault();
          e.stopPropagation();
          ok.click();
        }
      };
      document.addEventListener("keydown", compactDlgKey, true);   // 捕获先行，拦下宿主对 Esc/Enter 的处理
      foot.appendChild(cancel);
      foot.appendChild(ok);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(hint);
      card.appendChild(err);
      card.appendChild(foot);
      dlg.appendChild(card);
      document.body.appendChild(dlg);
      compactDlg = dlg;
      try { ok.focus(); } catch (e) { }
    }
    function compactSend(anchorEl) {   // 返回 "" = 已提交；否则错误文案
      /* 主通道（v109 用户指定「直接调发送会话的接口」；v110 改在打开瞬间解析缓存）：
       * fiber 上原生残留的 onSendCompressionCommand——SessionPane 自己的程序化压缩入口，
       * 直接 dispatchCommand("compact") 命令信封，不碰输入框/发送键，流式中也交给引擎
       * 排队。摘要请求非流式（DB 历史 72s-9.6min、典型 2-4 分钟），hint 据此措辞。
       * 兜底：字面 "/compact" 输入提交（E2E 桥 setText+发送键）——流式/发送键/草稿
       * 三重门控全部前置到 setText 之前（拒绝不留残迹），仅当 fiber 通道缺失时使用。 */
      if (compactFn) {
        try { compactFn("/compact"); return ""; } catch (e) { FATAL.cptErr = String((e && e.stack) || e); }
      }
      var input = nearestByRect(anchorEl, '[data-testid="v4-composer-input"]');
      var api = null;
      try { api = input ? input.__zcodeLexicalInputE2E : null; } catch (e) { }
      if (input && api && input.getAttribute("data-e2e-lexical-bridge") === "ready") {
        try {
          if (nearestByRect(anchorEl, '[data-testid="v4-stop"]')) return L("正在生成回复，请等待完成后再压缩", "A reply is being generated; wait for it to finish before compacting");
          var send = nearestByRect(anchorEl, '[data-testid="v4-composer-send"]');
          if (!send || send.disabled) return L("发送键当前不可用（可能正在生成回复）", "Send button is unavailable right now (a reply may be running)");
          var draft = "";
          try { draft = String(api.getText() || ""); } catch (e) { }
          if (draft.replace(/\s+/g, "")) return L("输入框有未发送草稿，请先发送或清空后再压缩", "The composer has an unsent draft; send or clear it before compacting");
          api.setText("/compact");
          send.click();
          return "";
        } catch (e) { FATAL.cptErr = String((e && e.stack) || e); return L("发送失败，请重试", "Send failed; please try again"); }
      }
      return L("未找到可用的提交通道（需 ZCode 桌面端）", "No available submit channel (ZCode desktop required)");
    }
    function onCompactClick(e) {
      if (inactive()) return;   // 停用实例的残留按钮（新代际清扫前的窗口期）无声失效
      e.preventDefault();
      e.stopPropagation();   // 弹层内点击不外泄（Radix/宿主不响应这次 click）
      openCompactDlg(e.currentTarget);
    }

    /* ---------- v80 in-card 挂载：条挂输入卡片内部、group/toolbar 工具行之后自占一行 ----------
     * 宿主 ChatPromptEditor 的工具行是卡片（flex-col gap-3）的最后一个子块；条作为其兄弟
     * 节点插在后面，卡片纯自适应高度自然长高（12px 间距 + 条高），与对话框融为一体。
     * 工具行 Tailwind 类名含 : / [ ] 特殊字符，querySelector 转义易碎 → 按直接子节点
     * className 子串匹配（同 zuDetAnchor 套路）。找不到工具行 = below-card 兜底形态。 */
    function toolbarRowOf(card) {
      try {
        var kids = card.children;
        for (var i = kids.length - 1; i >= 0; i--) {
          if (String(kids[i].className || "").indexOf("group/toolbar") >= 0) return kids[i];
        }
      } catch (e) { }
      return null;
    }
    function mountInCard() {
      var row = cardCache ? toolbarRowOf(cardCache) : null;
      if (!row) return false;
      try {
        if (bar.parentElement !== cardCache) {
          var ref = row.nextSibling;
          if (ref && ref.parentElement === cardCache) cardCache.insertBefore(bar, ref);
          else cardCache.appendChild(bar);
        }
        if (!bar.classList.contains("zu-in")) {
          bar.classList.add("zu-in");
          /* .zu-in 管不住内联声明：摘掉兜底形态写入的悬浮样式与锁宽 */
          bar.style.position = ""; bar.style.zIndex = "";
          bar.style.left = ""; bar.style.top = ""; bar.style.minWidth = ""; bar.style.maxWidth = "";
          lastPos = [-1, -1];
        }
        return true;
      } catch (e) { return false; }
    }
    function mountBelowCard() {   // 兜底还原：无工具行（宿主改版/异形布局）时回到旧悬浮形态
      if (!bar.classList.contains("zu-in")) return;
      bar.classList.remove("zu-in");
      bar.style.position = "fixed"; bar.style.zIndex = "50";
      document.body.appendChild(bar);
      lastPos = [-1, -1];
    }

    /* ---------- 定位：重活低频（找输入框/找卡片），逐帧只做矩形跟随 ---------- */
    var composer = null, cardCache = null, everMounted = false, lastMountDiagAt = 0;
    var curDisplay = "none", lastPos = [-1, -1], hideSince = 0;
    /* v80：true=条挂在输入卡片内部（group/toolbar 工具行之后）；false=旧 below-card 悬浮兜底 */
    var cardMode = false;

    function setComposer(el) {
      releasePads();   // 旧卡片的让位边距先还原（in-card 形态不需要让位带；兜底形态由 heavy 补回）
      composer = el;
      cardCache = null;
      cardMode = false;
      if (composer) {
        var c = anchorCardOf(composer);
        if (c && c !== document.body) cardCache = c;
      }
      if (bar.classList.contains("zu-in")) mountBelowCard();   // 换卡先回落兜底形态，heavy 同 tick 重判挂载
    }
    function heavy() {
      if (inactive()) return;
      if (pid === "auto") {
        /* 兜底模式（主文档找不到带 pane 标记的输入框，shadow/iframe 场景）：沿用原
         * 单条查找链路（findComposer 含 deepFind 穿透），会话判定走 mine/pickCurrent */
        var el = findComposer();
        if (el && el !== composer) setComposer(el);
        else if (!el && composer && !composer.isConnected) setComposer(null);
      } else {
        /* v61.1 多实例：composer 由协调器按 pane 派发（wantedEl），本层只对账——
         * 元素被 React 重建/pane 关闭时清绑，等下一轮协调器重新派发 */
        if (wantedEl && wantedEl.isConnected) {
          if (wantedEl !== composer) setComposer(wantedEl);
        } else if (composer) {
          setComposer(null);
        }
        var nextScope = readPaneScope(wantedEl, pendingSid, pid);
        var nextScopeStamp = JSON.stringify(nextScope);
        if (pendingSid !== instSid || nextScopeStamp !== scopeStamp) {
          instSid = pendingSid;
          scopeStamp = nextScopeStamp;
          if (state.data) render(state.data);
          refreshWants();
        }
      }
      if (!composer && slot === 0) collectDiag();   // 一直找不到输入框的窗口：周期性写环境诊断（everMounted 门防覆盖）
      if (composer) {
        if (!cardCache || !cardCache.isConnected) {
          var c = anchorCardOf(composer);
          cardCache = c && c !== document.body ? c : null;
        }
        if (cardCache) {
          /* v80：优先挂输入卡片内部（工具行下）；无工具行回落 below-card 兜底 + 让位带 */
          cardMode = mountInCard();
          if (cardMode) releasePads();
          else { mountBelowCard(); ensureCardPad(); }   // React 重渲染可能重建卡片/重置内联边距，对比后再补
          nativeCtxVal = readNativeCtx(cardCache);
        } else if (cardMode) {
          mountBelowCard();
        }
      }
      enhanceCtxButton();   // v92：DOM 对账点（React 重渲染/按钮重建后兜回，幂等）
      enhanceQuotaChip();   // v96：额度 chip DOM 对账点（按钮重建/前插节点被挤走后兜回）
      enhanceGitChip();     // v96：同点对账（React 重建工具行后重挂/位置兜回/紧凑态切换）
      syncCompactBtn();     // v105：弹层压缩按钮对账点（Observer 漏触发/节点移位后兜回）
      if (state.data && pid === "auto") {
        var msid = typeof state.data.mine === "string" ? state.data.mine : null;
        var pSid;
        if (msid !== null) pSid = msid;   // mine 模式：泵会在会话切换时推新 payload，这里只需同步 pickedSid
        else {
          var pc = pickCurrent(state.data);
          pSid = pc ? (pc.sess ? pc.sess.sid : pc.want) : "";
        }
        if (pSid !== pickedSid) render(state.data);   // 切换了会话：立即按缓存 payload 重渲染
      }
    }
    function hideBar() {
      if (curDisplay !== "none") { bar.style.display = "none"; curDisplay = "none"; }
      /* v80：面板挂 body 不再随条隐藏，条隐时必须主动收起（否则面板悬空在已消失的条上方） */
      panel.classList.remove("open");
      subPanel.classList.remove("open");
      hideTip(true, "bar-hidden");   // 条面整体隐藏时 tooltip 必须跟着走（force 绕过总闸）
    }
    /* 超限气泡同步（track 每帧调）：位置贴条上沿、左缘对齐；条隐藏/超限解除/已关闭则藏。
     * exc 解除时复位 excGone，下次再超限会重新弹。display 切换与测量在同一同步块内
     * 完成后才绘制，无首帧闪位。 */
    function syncExcBubble() {
      var show = excOn && !excGone && curDisplay === "flex";
      if (!show) {
        if (!excOn) excGone = false;
        if (excBubble.style.display !== "none") excBubble.style.display = "none";
        return;
      }
      var sidStr = pickedSid || L("（未知）", "(unknown)");
      if (excSid.textContent !== sidStr) excSid.textContent = sidStr;
      if (excBubble.style.display !== "block") excBubble.style.display = "block";
      var br = bar.getBoundingClientRect();
      var r = excBubble.getBoundingClientRect();
      var left = Math.max(8, Math.round(Math.min(br.left, innerWidth - r.width - 8)));
      var top = Math.max(8, Math.round(br.top - r.height - 8));
      if (excBubble.style.left !== left + "px") excBubble.style.left = left + "px";
      if (excBubble.style.top !== top + "px") excBubble.style.top = top + "px";
    }
    /* 可见性判定（带卡片豁免）：输入框视觉卡片内部的装饰层（占位符/镜像/焦点层等）
     * 瞬时盖到输入框中心不算"被盖住"——逐帧严格判定会造成显示/隐藏来回横跳（闪烁）；
     * 设置页等真正的覆盖层不在卡片内，仍判为盖住。
     * 条外挂在输入框上方，不参与对输入框中心的遮挡（v12-v14 内嵌形态的自遮挡闪烁根因）。 */
    function coverOK(el) {
      var r = el.getBoundingClientRect();
      var hit;
      try { hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); } catch (e) { return true; }
      if (!hit) return false;
      if (hit === el || hit.contains(el) || el.contains(hit)) return true;
      if (cardCache && cardCache.contains(el) && cardCache.contains(hit)) return true;
      if (isOwnOverlay(hit)) return true;   // 自己的面板/气泡盖住输入框中心不算被盖（v40）
      return false;
    }
    /* 隐藏态诊断（v61）：条被判定不可见时周期性转储现场 —— body 直接子层的矩形/
     * pointer-events/透明度、elementFromPoint 命中链、幽灵子树判定与 body 的 pe 状态。
     * 定位"正常聊天窗口被误藏"类问题用；节流 4s，只写 __zusageDiag.hidden
     * （泵取回写 diag-<n>.json）。 */
    var lastHiddenDiagAt = 0;
    function elDesc(el) {
      if (!el) return String(el);
      var cls = el instanceof Element ? (el.getAttribute("class") || "") : "";
      return el.tagName + (el.id ? "#" + el.id : "") + (cls ? "." + String(cls).slice(0, 60) : "");
    }
    function diagHidden(r) {
      var now = Date.now();
      if (now - lastHiddenDiagAt < 4000) return;
      lastHiddenDiagAt = now;
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var hit = null, chain = [], bodyPE = "";
      try {
        hit = document.elementFromPoint(cx, cy);
        chain = (document.elementsFromPoint(cx, cy) || []).slice(0, 8).map(elDesc);
        bodyPE = getComputedStyle(document.body).pointerEvents;
      } catch (e) { }
      var kids = [];
      try {
        var cs = document.body.children;
        for (var i = 0; i < cs.length; i++) {
          var el = cs[i], kr = el.getBoundingClientRect(), st = getComputedStyle(el);
          kids.push({
            el: elDesc(el),
            rect: [Math.round(kr.left), Math.round(kr.top), Math.round(kr.width), Math.round(kr.height)],
            pe: st.pointerEvents, op: st.opacity, vis: st.visibility, disp: st.display,
            covers: (kr.width >= 4 && kr.height >= 4 && cx >= kr.left && cx <= kr.right && cy >= kr.top && cy <= kr.bottom) ? 1 : 0,
          });
        }
      } catch (e) { }
      FATAL.hidden = {
        time: new Date().toISOString(),
        ghost: inGhostSubtree(composer),
        modal: modalOpen(),   // v62：模态弹窗判定（弹窗打开时条本就该收起，用于区分"误藏"与"应藏"）
        bodyPE: bodyPE,
        hit: elDesc(hit),
        chain: chain,
        composerCenter: [Math.round(cx), Math.round(cy)],
        composerRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        bodyKids: kids,
      };
    }
    /* 分屏现场诊断（v61）：转储全部可见 textarea 的祖先链（含 data-* 属性）、全页
     * iframe 的矩形与 src、pane/layout 相关 localStorage 键——用于确认"pane → 工作区/
     * 会话"能否从 DOM 映射（多实例状态条的数据源设计依据）。随 mount 诊断每 5s 刷新。 */
    function diagPanes() {
      try {
        var composers = [];
        document.querySelectorAll(COMPOSER_SEL + ",textarea").forEach(function (ta) {
          if (!visible(ta)) return;
          var r = ta.getBoundingClientRect();
          if (r.top < innerHeight * 0.4) return;
          var sess = null, pane = null, tag = elDesc(ta);
          for (var p = ta; p && p !== document.body; p = p.parentElement) {
            if (sess === null && p.hasAttribute && p.hasAttribute("data-session-id")) sess = p.getAttribute("data-session-id");
            if (pane === null && p.hasAttribute && p.hasAttribute("data-pane-id")) pane = p.getAttribute("data-pane-id");
          }
          composers.push({ tag: tag, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], pane: pane, sess: sess });
        });
        var webviews = [];
        document.querySelectorAll("webview,iframe").forEach(function (fr) {
          var r = fr.getBoundingClientRect();
          webviews.push({ tag: fr.tagName, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], src: String(fr.src || "").slice(0, 130) });
        });
        var attrHits = [];
        document.querySelectorAll("[data-session],[data-session-id],[data-workspace],[data-workspace-path],[data-pane],[data-pane-id],[data-task-id]").forEach(function (el) {
          var parts = [el.tagName];
          for (var i = 0; i < el.attributes.length; i++) {
            var a = el.attributes[i];
            if (/^data-(session|workspace|pane|task)/i.test(a.name)) parts.push(a.name + "=" + String(a.value).slice(0, 60));
          }
          attrHits.push(parts.join(" "));
        });
        var lsPane = [];
        try {
          Object.keys(localStorage).forEach(function (k) {
            if (/pane|split|layout|last-session/i.test(k)) lsPane.push(k + " = " + String(localStorage.getItem(k)).slice(0, 160));
          });
        } catch (e) { }
        FATAL.panes = { time: new Date().toISOString(), composers: composers, webviews: webviews.slice(0, 10), attrHits: attrHits.slice(0, 30), lsPane: lsPane.slice(0, 20) };
      } catch (e) { FATAL.panes = { err: String((e && e.stack) || e) }; }
    }

    function track() {
      if (inactive()) return;   // 旧实例罢工，把舞台让给新实例
      try {
        syncExcBubble();   // 超限气泡：显示/隐藏/贴条定位（内部自判状态，隐藏分支零开销）
        if (!composer || !composer.isConnected) { hideSince = 0; hideBar(); return; }
        if (cardMode) {
          /* v80 in-card 对账：React 整子树重挂（切会话 key 变化）会连外来节点一起丢，
           * 帧率级检查补挂；卡片本身被重建时 cardCache 断连，heavy 低频重找后再挂 */
          if (!bar.isConnected || bar.parentElement !== cardCache) {
            cardMode = mountInCard();
            if (!cardMode) mountBelowCard();
          }
        } else if (cardCache && cardCache.style.marginBottom !== CARD_MARGIN) {
          ensureCardPad();   // 流式期间 React 重置内联边距时立刻补回（仅 below-card 兜底形态）
        }
        var r = composer.getBoundingClientRect();
        var on = r.width > 60 && r.height > 14 && r.bottom > 0 && r.top < innerHeight &&
          !inGhostSubtree(composer) &&   // 设置页等幽灵壳（opacity-0/inert）：视觉已隐藏（v61）
          !inSettingsView(composer) &&   // v91：设置页排除的第四处收口——已绑到设置页编辑框时不显示（防其它绑定路径漏排除）
          !modalOpen() &&                // v62：模态弹窗（模型配置等）打开时整体收起，弹窗内容不归条管（issue #9）
          (reallyVisible(composer, true) || coverOK(composer));
        if (!on) {
          if (slot === 0) diagHidden(r);   // 隐藏现场周期转储（v61，节流 4s；仅 0 号实例写，槽位共享）
          // 迟滞：连续 400ms 判定不可见才隐藏，瞬时失败（流式装饰层等）不闪
          if (!hideSince) hideSince = Date.now();
          if (Date.now() - hideSince > 400) { hideBar(); }
          return;
        }
        hideSince = 0;
        if (curDisplay !== "flex") { bar.style.display = "flex"; curDisplay = "flex"; }
        /* 悬浮在输入框视觉卡片正下方（v58 定位回归）：v55-v57 改贴窗口底，新对话 hero 页
         * 输入框垂直居中时条与输入框彻底脱钩（用户点名回退）。让位带 24px 比条高+顶缝
         * 短 ~7px，条底落进原生底部留白、距窗口底 ~7px —— v54 的"条下 15px 空白"不复发。
         * 水平仍与卡片左缘对齐 */
        var anchor = cardCache || composer;
        var ar = anchor.getBoundingClientRect();
        if (!cardMode) {
          /* 悬浮在输入框视觉卡片正下方（v58 定位回归）：v55-v57 改贴窗口底，新对话 hero 页
           * 输入框垂直居中时条与输入框彻底脱钩（用户点名回退）。让位带 24px 比条高+顶缝
           * 短 ~7px，条底落进原生底部留白、距窗口底 ~7px —— v54 的"条下 15px 空白"不复发。
           * 水平仍与卡片左缘对齐。v80 起仅 below-card 兜底形态走这里。 */
          var left = Math.round(ar.left);
          var top = Math.max(8, Math.min(Math.round(ar.bottom + 4), innerHeight - bar.offsetHeight - 2));
          if (left !== lastPos[0] || top !== lastPos[1]) {
            bar.style.left = left + "px"; bar.style.top = top + "px";
            lastPos = [left, top];
          }
          /* 宽度锁死卡片（v63 对齐，v66 收缩）：min=max-width = 卡片实测宽（border-box，
           * 外缘含边框正好压在卡片两缘上），任何内容量下条都与会话框两缘对齐。 */
          var minW = Math.max(60, Math.round(ar.width));
          if (bar.style.minWidth !== minW + "px") bar.style.minWidth = minW + "px";
          if (bar.style.maxWidth !== minW + "px") bar.style.maxWidth = minW + "px";
        }
        /* in-card 形态（v80）：无坐标跟随、无锁宽——宽度由卡片 flex-col 的 stretch 撑满内宽。
         * 两种形态共用的收缩判定：内容超宽不撑破卡片，分级收缩：先隐藏「本轮/会话累计」
         * 的缓存命中率（核心项 tps/上下文/会话累计不动，明细仍在悬停 tooltip），
         * 迟滞 +12px/-120px 防数值刷新在阈值附近来回闪；仍装不下由 .zu-main 右缘渐隐
         * 兜底（.zu-clip）。测量基准都是 bar 自身内容宽，形态无关。 */
        var ov = main.scrollWidth - main.clientWidth;
        var ns = shrink;
        if (!shrink && ov > 12) ns = 1;
        else if (shrink && ov < -120) ns = 0;
        if (ns !== shrink) { shrink = ns; render(state.data || { session: {}, last_turn: {}, today: {}, context_window: 0 }); }
        var clip = main.scrollWidth > main.clientWidth + 1;
        if (clip !== fadeOn) { fadeOn = clip; main.classList.toggle("zu-clip", clip); }
        positionSettingsPanel();
        positionSubPanel();
        everMounted = true;
        if (slot === 0 && Date.now() - lastMountDiagAt > 5000) {
          lastMountDiagAt = Date.now();
          var br = bar.getBoundingClientRect(), bh = null;
          try { bh = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2); } catch (e) { }
          FATAL.mount = {
            version: VERSION, mode: cardMode ? "in-card" : "below-card", bodyPE: (function () { try { return getComputedStyle(document.body).pointerEvents; } catch (e) { return ""; } })(),
            panes: diagPanes(),
            theme: themeDark ? "dark" : "light",
            /* 字体跟随（v64）实测：条面计算字体 + 客户端两个字体变量的原值（验证 var 命中） */
            font: (function () {
              try {
                var rs = getComputedStyle(document.documentElement), cs = getComputedStyle(bar);
                return { fam: String(cs.fontFamily).slice(0, 90), size: cs.fontSize,
                  mono: String(rs.getPropertyValue("--font-mono")).slice(0, 80).trim(),
                  ui: String(rs.getPropertyValue("--ui-font-size")).trim() };
              } catch (e) { return "ERR:" + e; }
            })(),
            tip: (function () { return { stats: tipStats, disp: tip.style.display, barRect: (function () { var b = bar.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })() }; })(),
            composerRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
            anchorRect: [Math.round(ar.left), Math.round(ar.top), Math.round(ar.width), Math.round(ar.height)],
            barRect: [Math.round(br.left), Math.round(br.top), Math.round(br.width), Math.round(br.height)],
            /* 条中心命中元素：若被应用层盖住（z 序问题）此处直接暴露 */
            barHit: bh ? bh.tagName + "." + String(bh.className).slice(0, 40) : String(bh),
            bottomGap: Math.round(innerHeight - ar.bottom),
            nativeCtx: nativeCtxVal,
            quota: { providerId: effectiveQuotaProvider(), modelId: quotaModel, sourceId: quotaSourceId,
              selected: !!quotaSelection, status: lastQuota ? lastQuota.status : "unavailable", chip: !!quotaChipCache },
            picked: pickedSid,
            exc: excOn ? (excGone ? "on-gone" : "on") : 0,
            href: String(location.href).slice(0, 120),
            lsVals: (function () {
              try {
                var out = [];
                Object.keys(localStorage).forEach(function (k) {
                  out.push(k + " = " + String(localStorage.getItem(k)).slice(0, 90));
                });
                var wk = [];
                Object.keys(window).forEach(function (k) {
                  if (/zcode|session|store|state|tab/i.test(k)) wk.push(k);
                });
                out.push("WINDOW_KEYS=" + wk.join("|").slice(0, 300));
                return out.join("\n").slice(0, 7000) || "(none)";
              } catch (e) { return "ERR:" + e; }
            })(),
            lastSessionVals: (function () {
              try {
                var out = [];
                Object.keys(localStorage).forEach(function (k) {
                  if (/last-session/i.test(k)) out.push(k.slice(22) + "=" + String(localStorage.getItem(k)).slice(0, 50));
                });
                return out.join(" | ").slice(0, 1000) || "(none)";
              } catch (e) { return "ERR:" + e; }
            })(),
          };
        }
      } catch (e) {
        if (Date.now() - (track.errAt || 0) > 5000) {
          track.errAt = Date.now();
          FATAL.trackErr = String((e && e.stack) || e);
        }
      } finally {
        if (!inactive()) frame = requestAnimationFrame(track);   // 自调度循环：异常绝不能杀死循环（setInterval 无此问题，rAF 有）
      }
    }

    heavyTimer = setInterval(heavy, 600);
    heavy();
    frame = requestAnimationFrame(track);
    /* v105：弹层压缩按钮的即时重注入观察器。弹层每次打开/关闭都是 body 子树变异，rAF 去抖
     * 合并同帧爆发；自身注入也会触发下一轮回查（存在性幂等，无环）。异常只降级为 heavy 兜底。 */
    var hcObserver = null, hcObsQueued = false;
    try {
      hcObserver = new MutationObserver(function () {
        if (hcObsQueued) return;
        hcObsQueued = true;
        requestAnimationFrame(function () {
          hcObsQueued = false;
          syncCompactBtn();
        });
      });
      hcObserver.observe(document.body, { childList: true, subtree: true });
    } catch (e) { FATAL.cptErr = String(e); }

    syncPanel();
    if (state.data) render(state.data);   // 已有共享数据（后 spawn 的实例）直接渲染，不用零值覆盖
    else render({ session: {}, last_turn: {}, today: {}, context_window: 0 });

    function dispose() {
      if (instanceDisposed) return;
      instanceDisposed = true;
      clearInterval(heavyTimer);
      clearInterval(bridge.timer);   // v71：pane 销毁即停能力检测并释放 store 订阅
      clearInterval(subRateTimer);   // v97：子代理面板速率刷新定时器
      subRateTimer = 0;
      bridgeDetach(bridge.handle);
      cancelAnimationFrame(frame);
      cancelTipGrace();
      if (excCopied) clearTimeout(excCopied.timer);
      if (themeObserver) themeObserver.disconnect();
      if (quotaSelectionObserver) quotaSelectionObserver.disconnect();
      quotaSelectionObserver = null; quotaPaneRoot = null; quotaSelection = null;
      if (hcObserver) hcObserver.disconnect();   // v105：停弹层压缩按钮观察器
      closeCompactDlg();   // v105：本实例打开的确认弹框与 Esc/Enter 监听一并摘除
      globalListeners.forEach(function (binding) {
        binding[0].removeEventListener(binding[1], binding[2], binding[3]);
      });
      globalListeners = [];
      releasePads();
      if (ctxBtnCache) { restoreCtxButton(ctxBtnCache); ctxBtnCache = null; }   // v92：还原原生按钮形态
      restoreQuotaChip();   // v95：摘除额度 chip（不留孤儿节点）
      restoreGitChip();   // v96：摘掉本 pane 的 Git chip（含在显 tooltip）
      cuaBtnCache = null;
      wantedEl = composer = cardCache = null;
      bar.remove();
      panel.remove();   // v80：面板挂 body，dispose 需单独摘除
      subPanel.remove();
      tip.remove();
      excBubble.remove();
    }
    var api = {
      pid: pid, slot: slot, dispose: dispose,
      attach: function (el, sid) {   // 协调器派发：pane 最靠下的可见输入框 + 其 data-session-id
        if (inactive()) return;
        wantedEl = el;
        pendingSid = sid || "";
        heavy();   // 立即对账（composer 重建/pane 关闭的最快收敛路径）
      },
      render: render,
      syncUpdate: syncUpdate,
      rebuild: function () { buildPanel(); rebuildExcBubble(); syncPanel(); },
      getSid: function () { return pickedSid || ""; },
      getQuotaSelection: function () {
        if (inactive()) return null;
        if (quotaSelection) return quotaSelection;
        var sid = instSid || pickedSid || "";
        return sid ? { sid: sid, providerId: effectiveQuotaProvider(), modelId: quotaModel } : null;
      },
      getScope: function () { return inactive() ? null : readPaneScope(wantedEl, pickedSid, pid); },
      gitTouch: function () { if (!inactive()) enhanceGitChip(); },   // v96：主进程推送 git 状态后即时对账（不等 heavy）
      /* v71 确定性历史行数据源：DOM turn id（turnId 或 productTurnId 形态）→ tracker 统计 */
      statsFor: function (tid) {
        var h = bridge.handle;
        if (!h || h.dead || typeof tid !== "string") return null;
        var s = h.tracker.get(tid);
        if (!s) {
          var key = h.alias[tid];
          if (key && key !== tid) s = h.tracker.get(key);
        }
        return s;
      },
      /* v86 诊断：桥接绑定状态与当前快照窗口（行数/序号/代际）——重启后历史轮可见性取决于它 */
      bridgeInfo: function () {
        var h = bridge.handle, info = { bound: !!(h && !h.dead), sid: h ? String(h.sid).slice(-8) : "", rebinds: bridge.rebinds || 0 };
        if (!info.bound) return info;
        var snap = null;
        try { var st = h.store.getState(); snap = st && st.snapshot; } catch (e) { info.err = String(e); }
        if (snap) {
          info.win = snap.rows && Array.isArray(snap.rows.window) ? snap.rows.window.length : null;
          info.seq = snap.seq;
          info.epoch = String(snap.logEpoch).slice(0, 12);
          info.heads = 0;
          try { snap.rows.window.forEach(function (r) { if (r && r.kind === "turnHeader") info.heads++; }); } catch (e) { }
        }
        return info;
      },
      liveEl: function () { return liveEl; },   // 测试缝：实时段节点引用
      liveIconKind: function () { return liveIconCur; },   // 测试缝：当前 chip 图标（think/bolt/空）
    };
    instances.push(api);
    refreshWants();
    return api;
  }
})();
