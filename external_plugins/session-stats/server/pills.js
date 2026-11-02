/* session-stats pills v4 — 贴 chips 行（电脑操作之后）、悬浮弹层含模型分布、支持热更新 */
;(function () {
  "use strict";
  if (window.__SSPILLS__) { try { window.__SSPILLS_TEARDOWN__(); } catch (e) {} }
  window.__SSPILLS__ = true;

  var ENDPOINT = "http://127.0.0.1:31710";
  var POLL_MS = 5000;
  var data = null, lastOk = 0, fails = 0, popupOpen = false, pillMode = "full", openedAt = 0, lastToggleAt = 0;
  var rowEl = null, popEl = null, css = null;

  function fmtDur(ms) {
    if (ms == null) return "—";
    if (ms < 1000) return Math.round(ms) + " 毫秒";
    var s = ms / 1000;
    if (s < 60) return (s < 10 ? s.toFixed(1) : Math.round(s)) + " 秒";
    var m = Math.floor(s / 60), rs = Math.round(s % 60);
    if (m < 60) return m + " 分 " + rs + " 秒";
    return Math.floor(m / 60) + " 时 " + (m % 60) + " 分 " + rs + " 秒";
  }
  function fmtTok(n) {
    if (n == null) return "—";
    if (n < 1e3) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(1) + "K";
    if (n < 1e9) return (n / 1e6).toFixed(1) + "M";
    return (n / 1e9).toFixed(2) + "B";
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function shortId(id) {
    if (!id) return "—";
    return id.length > 26 ? id.slice(0, 23) + "…" : id;
  }
  function stripWs(s) {
    return String(s).replace(/\s+/g, "");
  }


  css = document.createElement("style");
  css.textContent =
    ".__sspills-row{position:absolute;bottom:10px;transform:translateX(-50%);" +
    "display:inline-flex;align-items:center;gap:6px;z-index:30;transition:left .12s ease;}" +
    ".__sspills-pill{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;" +
    "border-radius:8px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.09);" +
    "color:rgba(232,235,241,.88);font:500 13px/1 'Segoe UI','Microsoft YaHei',system-ui,sans-serif;" +
    "cursor:pointer;white-space:nowrap;transition:border-color .15s,background .15s;}" +
    ".__sspills-pill:hover{border-color:rgba(122,162,247,.55);background:rgba(122,162,247,.08);}" +
    ".__sspills-pill .ico{display:inline-flex;align-items:center;}" +
    ".__sspills-pill .ico svg{width:14px;height:14px;display:block;}" +
    ".__sspills-pill b{font-weight:600;}" +
    ".__sspills-pill .sep{opacity:.5;margin:0 6px;}" +
    ".__sspills-pill .dv{opacity:.3;margin:0 4px;border-left:1px solid currentColor;height:12px;}" +
    ".__sspills-pill .live{color:#9ece6a;font-size:8px;margin-left:4px;}" +
    ".__sspills-row.stale .__sspills-pill{opacity:.4;}" +
    ".__sspills-pop{position:fixed;display:none;width:400px;max-width:calc(100vw - 16px);z-index:2147483000;" +
    "background:#1f2128;border:1px solid rgba(255,255,255,.12);border-radius:12px;" +
    "box-shadow:0 10px 36px rgba(0,0,0,.5);padding:12px 14px;" +
    "font:12px/1.5 'Segoe UI','Microsoft YaHei',system-ui,sans-serif;color:rgba(232,235,241,.9);}" +
    ".__sspills-pop .h{font-weight:600;font-size:12.5px;margin-bottom:6px;}" +
    ".__sspills-pop table{width:100%;border-collapse:collapse;table-layout:fixed;}" +
    ".__sspills-pop td{padding:2.5px 0;vertical-align:top;}" +
    ".__sspills-pop td.k{color:rgba(232,235,241,.52);padding-right:12px;white-space:nowrap;" +
    "overflow:hidden;text-overflow:ellipsis;}" +
    ".__sspills-pop td.v{font-family:Consolas,'Cascadia Mono',monospace;text-align:right;white-space:nowrap;}" +
    ".__sspills-pop table.models td.k{width:118px;}" +
    ".__sspills-pop table.models td.v{overflow:hidden;text-overflow:ellipsis;}" +
    ".__sspills-pop .div{height:1px;background:rgba(255,255,255,.09);margin:7px 0;}" +
    ".__sspills-pop .foot{color:rgba(232,235,241,.4);font-size:11px;margin-top:2px;}" +
    "@media (prefers-color-scheme: light){" +
    ".__sspills-pill{background:rgba(0,0,0,.045);border-color:rgba(0,0,0,.12);color:rgba(28,30,36,.88);}" +
    ".__sspills-pill:hover{border-color:rgba(59,91,219,.5);background:rgba(59,91,219,.06);}" +
    ".__sspills-pop{background:#fff;border-color:rgba(0,0,0,.14);color:rgba(28,30,36,.9);" +
    "box-shadow:0 10px 36px rgba(0,0,0,.18);}" +
    ".__sspills-pop td.k{color:rgba(28,30,36,.52);}" +
    ".__sspills-pop .div{background:rgba(0,0,0,.09);}}";
  document.documentElement.appendChild(css);

  function popupHtml() {
    var d = data, t = (d && d.tokens) || {};
    if (!d) return '<div class="h">会话统计</div><div class="foot">加载中…</div>';
    if (d.draft) return '<div class="h">会话统计</div><div class="foot">新会话 · 发起第一条消息后开始统计</div>';
    if (d.error) return '<div class="h">会话统计</div><div class="foot">' + esc(d.error) + "</div>";
    function mk(rows) {
      return rows.map(function (r) {
        return '<tr><td class="k" title="' + esc(r[0]) + '">' + esc(r[0]) +
          '</td><td class="v">' + r[1] + "</td></tr>";
      }).join("");
    }
    var lt = liveTps(d);
    var r1 = [
      ["模型用时", fmtDur(d.model_ms)],
      ["工具调用用时", fmtDur(d.tool_ms)],
      ["首 token 平均（TTFT）", fmtDur(d.ttft_ms_avg)],
    ];
    if (lt) {
      r1.push(["实时 TPS", Math.round(lt.v * 10) / 10 + " tok/s" + (lt.inflight ? "（进行中）" : "（最近请求）")]);
    }
    r1.push(["平均 TPS（会话累计）", d.tps != null ? d.tps + " tok/s" : "—"]);
    var r2 = [
      ["输入（含缓存）", fmtTok(t.input) + "（读 " + fmtTok(t.cache_read) + " / 写 " + fmtTok(t.cache_write) + "）"],
      ["输出", fmtTok(t.output) + "（含推理 " + fmtTok(t.reasoning) + "）"],
      ["总 token", fmtTok(t.total)],
      ["未命中缓存 token", fmtTok(Math.max(0, (t.input || 0) - (t.cache_read || 0)))],
      ["缓存命中率", d.cache_hit_pct != null ? d.cache_hit_pct + "%" : "—"],
    ];
    // 最近一次完成的请求：输入/输出/缓存命中
    var lr = null;
    for (var ri = 0; ri < (d.recent || []).length; ri++) {
      if (d.recent[ri].done_at != null) { lr = d.recent[ri]; break; }
    }
    if (lr && lr["in"] > 0) {
      r2.push(["最近请求 输入", fmtTok(lr["in"])]);
      r2.push(["最近请求 输出", fmtTok(lr.out)]);
      r2.push(["最近请求 未命中缓存", fmtTok(Math.max(0, lr["in"] - (lr.cread || 0)))]);
      r2.push(["最近请求 缓存命中", Math.round((lr.cread || 0) * 1000 / lr["in"]) / 10 + "%"]);
    }
    var r3 = (d.models || []).slice(0, 5).map(function (m) {
      return [
        m.model_id || "—",
        (m.steps != null ? m.steps : "—") + "步 · " +
        fmtTok((m.t_in || 0) + (m.t_out || 0)) + " tok · " +
        (m.tps != null ? m.tps : "—") + " tok/s",
      ];
    });
    var foot = "会话 " + esc(shortId(d.session_id)) +
      (d.subagent_count ? " · 子代理 " + d.subagent_count + " 个" : "") +
      " · 5 秒自动刷新";
    return '<div class="h">会话统计</div>' +
      "<table>" + mk(r1) + "</table>" +
      '<div class="div"></div>' +
      "<table>" + mk(r2) + "</table>" +
      (r3.length ? '<div class="div"></div><div class="h" style="font-size:11.5px">模型分布</div><table class="models">' + mk(r3) + "</table>" : "") +
      '<div class="foot">' + foot + "</div>";
  }

  /* 自愈：僵尸实例可能把 popEl 从 body 里删掉，用前先确保挂载 */
  function ensurePopEl() {
    if (!popEl) {
      popEl = document.createElement("div");
      popEl.className = "__sspills-pop";
    }
    if (!popEl.isConnected) document.body.appendChild(popEl);
  }

  function renderPopup() {
    ensurePopEl();
    if (!popEl) return;
    popEl.innerHTML = popupHtml();
    if (popupOpen && rowEl) {
      var pill = rowEl.querySelector(".__sspills-pill");
      if (pill) {
        var r = pill.getBoundingClientRect();
        /* 弹窗水平中心对准 pill 中心（自适应居中），越界钳制防出窗 */
        var pw = popEl.offsetWidth;
        var left = r.left + r.width / 2 - pw / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
        popEl.style.left = left + "px";
        popEl.style.top = "auto";
        popEl.style.bottom = (window.innerHeight - r.top + 8) + "px";
        /* 上方放不下 → 翻到 pill 下方；再放不下 → 钳回视口内 */
        var ph = popEl.offsetHeight;
        if (r.top - ph - 8 < 8) {
          var topBelow = r.bottom + 8;
          if (topBelow + ph > window.innerHeight - 8) {
            popEl.style.top = Math.max(8, window.innerHeight - ph - 8) + "px";
            popEl.style.bottom = "auto";
          } else {
            popEl.style.top = topBelow + "px";
            popEl.style.bottom = "auto";
          }
        }
      }
    }
  }

  function setPopup(open) {
    popupOpen = open;
    ensurePopEl();
    if (!popEl) return;
    popEl.style.display = open ? "block" : "none";
    openedAt = open ? Date.now() : 0;
    if (open) renderPopup();
  }

  /* 当前标签页的会话状态：
     返回正式会话 id（sess_/session_ 前缀）、"draft"（新会话未发消息）或 null。
     只信可见视图；可见视图里只有占位值时明确返回 draft，绝不回落到隐藏的旧会话。 */
  function currentSessionId() {
    var els = document.querySelectorAll("[data-session-id]");
    var visible = [], all = [], i, v;
    function isReal(s) {
      return s.indexOf("sess_") === 0 || s.indexOf("session_") === 0;
    }
    function pick(list) {
      for (var a = 0; a < list.length; a++) {
        if (isReal(list[a])) return list[a];
      }
      for (var b = 0; b < list.length; b++) {
        if (list[b] && list[b] !== "draft") return list[b];
      }
      return list.indexOf("draft") >= 0 ? "draft" : null;
    }
    for (i = 0; i < els.length; i++) {
      v = els[i].getAttribute("data-session-id") || "";
      all.push(v);
      if (els[i].offsetParent !== null) visible.push(v);
    }
    var fromVisible = pick(visible);
    if (fromVisible) return fromVisible;
    if (visible.length) return "draft"; // 有可见会话视图但 id 是占位 → 新会话
    return pick(all); // 视图尚未挂载完成的兜底
  }

  var lastSid = null;
  function poll() {
    var sid = currentSessionId();
    lastSid = sid;
    requestLayout(); // 每次轮询统一走调度器（宽度比对交给 ResizeObserver）
    if (sid === "draft") {
      // 新会话（尚未产生请求）：显示空态，不去借别的会话的数据
      data = { draft: true, session_source: "draft" };
      lastOk = Date.now(); fails = 0;
      if (rowEl) rowEl.style.display = "";
      render();
      if (popupOpen) renderPopup();
      return;
    }
    var url = ENDPOINT + "/stats?scope=current" + (sid ? "&session_id=" + encodeURIComponent(sid) : "");
    fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) {
        data = j; lastOk = Date.now(); fails = 0;
        render();
        requestLayout();
        if (popupOpen) renderPopup();
      })
      .catch(function () {
        fails++;
        if (fails >= 3 && rowEl) rowEl.style.display = "none";
      });
  }

  /* 实时 TPS：优先取进行中的请求（token/(now-首token)），否则取最近一次完成的请求 */
  function liveTps(d) {
    if (!d || !d.recent || !d.recent.length) return null;
    var now = d.generated_at;
    var i, r;
    for (i = 0; i < d.recent.length; i++) {
      r = d.recent[i];
      if (r.done_at == null && r.fta != null && r.out > 0 && now > r.fta) {
        return { v: r.out * 1000 / (now - r.fta), inflight: true };
      }
    }
    for (i = 0; i < d.recent.length; i++) {
      r = d.recent[i];
      if (r.done_at != null && r.fta != null && r.out > 0 && r.done_at > r.fta) {
        return { v: r.out * 1000 / (r.done_at - r.fta), inflight: false };
      }
    }
    return null;
  }

  /* 最近一次完整（已完成）请求：底部横条展示它的输入+输出 token 与缓存命中率 */
  function latestReq(d) {
    if (!d || !d.recent) return null;
    for (var i = 0; i < d.recent.length; i++) {
      var r = d.recent[i];
      if (r.done_at != null && r["in"] > 0) return r;
    }
    return null;
  }
  function reqHitPct(r) {
    if (!r || !(r["in"] > 0)) return null;
    return Math.round((r.cread || 0) * 1000 / r["in"]) / 10;
  }

  function pillBody(mode) {
    // 三档内容的内层 HTML（外层 pill 壳由 makeRow 常驻创建，切换只改 display，零重建）
    if (!data) return "加载中…";
    if (data.draft) return "新会话 · 暂无统计";
    if (data.error) return "统计不可用";
    var lt = liveTps(data);
    var shown = lt ? Math.round(lt.v * 10) / 10 : data.tps;
    var shownHtml = shown != null
      ? shown + ' tok/s' + (lt && lt.inflight ? '<span class="live">●</span>' : "")
      : "—";
    var lr = latestReq(data);
    var hit = reqHitPct(lr);
    // 最近请求 token 段：入 X / 出 Y（无数据时退回会话累计）
    var reqTokHtml = lr
      ? "入 " + fmtTok(lr["in"]) + " · 出 " + fmtTok(lr.out)
      : "累计 " + fmtTok((data.tokens || {}).total) + " tok";
    if (mode === "micro") {
      // 最窄档：只剩实时速度（参照同款统计条的 compact 形态），保证窄输入框也放得下
      return shownHtml;
    }
    if (mode === "mini") {
      return shownHtml + " " + reqTokHtml;
    }
    if (mode === "mid") {
      return "<b>" + (data.steps != null ? data.steps : 0) + " 步</b>" +
        '<span class="sep">·</span>' + shownHtml +
        " " + reqTokHtml +
        '<span class="sep">·</span>' +
        "缓存命中 " + (hit != null ? hit : "—") + "%";
    }
    return "<b>" + (data.turns != null ? data.turns : "—") + " 轮 " + (data.steps != null ? data.steps : 0) + " 步</b>" +
      '<span class="sep">·</span>' + shownHtml +
      '<span class="dv"></span>' +
      reqTokHtml +
      '<span class="sep">·</span>' +
      "缓存命中 " + (hit != null ? hit : "—") + "%";
  }

  /* 三档内容常驻为三个子 span，档位切换只改 display（无 innerHTML 重建 → 无闪现土壤） */
  var modeSpans = null; // { full, mid, mini }
  var lastBody = {};    // 每档上次渲染的内容缓存
  function ensureModeSpans() {
    if (modeSpans && modeSpans.full && modeSpans.full.isConnected) return;
    var pill = rowEl.querySelector(".__sspills-pill");
    if (!pill) return;
    modeSpans = {};
    var modes = ["full", "mid", "mini", "micro"];
    for (var i = 0; i < modes.length; i++) {
      var s = pill.querySelector(".__sspills-mode[data-mode='" + modes[i] + "']");
      if (!s) { // 不存在才创建，防热更新边界下重复追加
        s = document.createElement("span");
        s.className = "__sspills-mode";
        s.setAttribute("data-mode", modes[i]);
        s.style.display = "none";
        pill.appendChild(s);
      }
      modeSpans[modes[i]] = s;
    }
  }
  function render() {
    if (!rowEl) return;
    var stale = Date.now() - lastOk > 9e5;
    rowEl.classList.toggle("stale", stale);
    ensureModeSpans();
    if (!modeSpans) return;
    var modes = ["full", "mid", "mini", "micro"];
    for (var i = 0; i < modes.length; i++) {
      var m = modes[i];
      var body = pillBody(m);
      if (body !== lastBody[m]) { modeSpans[m].innerHTML = body; lastBody[m] = body; }
    }
    if (rowEl.style.display !== "none") setModeSpans(pillMode);
  }
  function setModeSpans(mode) {
    if (!modeSpans) return;
    var modes = ["full", "mid", "mini", "micro"];
    for (var i = 0; i < modes.length; i++) {
      modeSpans[modes[i]].style.display = modes[i] === mode ? "" : "none";
    }
  }

  function makeRow() {
    var el = document.createElement("div");
    el.className = "__sspills-row";
    el.style.cursor = "pointer";
    el.addEventListener("click", function (ev) {
      // 点击 pill 任意位置都开合弹窗；250ms 去抖防宿主合成重复点击（关了又开的闪烁）
      if (Date.now() - lastToggleAt < 250) { ev.stopPropagation(); return; }
      lastToggleAt = Date.now();
      setPopup(!popupOpen);
      ev.stopPropagation();
    });
    // pill 外壳（含图标）：三档内容 span 由 ensureModeSpans 挂进来
    var pill = document.createElement("span");
    pill.className = "__sspills-pill";
    pill.setAttribute("data-act", "detail");
    var ico = document.createElement("span");
    ico.className = "ico";
    // 仪表盘图标（gauge-outline，16 viewBox / 1px 描边），与应用内统计图标同源
    ico.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="1">' +
      '<path d="M3.4041 13.096C2.49514 12.187 1.87614 11.0288 1.62537 9.76798C1.37459 8.50716 1.50331 7.20028 1.99525 6.01261C2.48719 4.82494 3.32025 3.80981 4.3891 3.09557C5.45795 2.38134 6.71458 2.00008 8.0001 2C9.28563 2.00008 10.5423 2.38134 11.6111 3.09557C12.68 3.80981 13.513 4.82494 14.005 6.01261C14.4969 7.20028 14.6256 8.50716 14.3748 9.76798C14.1241 11.0288 13.5051 12.187 12.5961 13.096" stroke="currentColor"></path>' +
      '<path d="M8 8.49994L11.6114 4.88855" stroke="currentColor"></path>' +
      '<path d="M8 9.75C8.69036 9.75 9.25 9.19036 9.25 8.5C9.25 7.80964 8.69036 7.25 8 7.25C7.30964 7.25 6.75 7.80964 6.75 8.5C6.75 9.19036 7.30964 9.75 8 9.75Z" fill="currentColor"></path>' +
      "</svg>";
    pill.appendChild(ico);
    el.appendChild(pill);
    return el;
  }

  function stripWs(s) {
    return String(s).replace(/\s+/g, "");
  }
  function findChipByText(root, txt) {
    var btns = root.querySelectorAll("button,[role='button']");
    for (var i = 0; i < btns.length; i++) {
      if (stripWs(btns[i].textContent) === txt) return btns[i];
    }
    return null;
  }

  /* 只取「可见」的输入条容器——多标签页时隐藏标签页的 dock 也在 DOM 里。
     不能用 offsetParent 判断（fixed 定位/特殊容器下恒为 null，可见也会误判为隐藏），
     改用实测宽度 > 0。 */
  function visibleDock() {
    var docks = document.querySelectorAll("[data-v4-composer-dock-content]");
    for (var i = 0; i < docks.length; i++) {
      var r = docks[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return docks[i];
    }
    return docks[0] || null;
  }

  /* 布局调度器：所有触发点只置脏标记，界面稳定后才执行一次完整布局。
     - 尾随防抖 180ms：滚轮滑动/侧栏动画等过渡帧全部跳过，只在静止后布局一次
     - 档位判定用「稳定宽度」（宽度持续 300ms 才认），过渡帧不换档
     - 档位带真滞回（±24px），临界宽度不反复跳
     - 空隙不足先降档；连续 4 次放不下才隐藏，条件恢复立即回来 */
  var dead = false;      // teardown 后置 true：一切异步回调早退，死实例不碰 DOM
  var lastLeft = -9999, lastBottom = -9999;
  var layoutTimer = 0;
  var shrinkStreak = 0;
  var basisW = 0;      // 稳定宽度（档位判定基准）
  var pendingW = 0;    // 待确认的新宽度
  var pendingSince = 0;
  var lastScrollAt = 0; // 滚动豁免：滚动后 700ms 内不布局（滚动中会话顶栏/输入条有过渡动画）

  function requestLayout() {
    if (dead) return;
    if (layoutTimer) clearTimeout(layoutTimer);
    layoutTimer = setTimeout(function () {
      layoutTimer = 0;
      if (dead) return;
      var quiet = Date.now() - lastScrollAt;
      if (quiet < 700) {
        // 滚动豁免期内：推迟到豁免期结束再布局
        layoutTimer = setTimeout(function () {
          layoutTimer = 0;
          if (dead) return;
          layout();
        }, 700 - quiet + 20);
        return;
      }
      layout();
    }, 180);
  }

  function stableWidth(w) {
    if (!basisW || Math.abs(w - basisW) <= 2) {
      if (!basisW) basisW = w;
      pendingW = 0;
      return basisW;
    }
    if (Math.abs(w - pendingW) > 2) { pendingW = w; pendingSince = Date.now(); }
    else if (Date.now() - pendingSince > 300) { basisW = pendingW; pendingW = 0; }
    return basisW;
  }

  /* 清扫幽灵实例：React 重建 dock 会泄漏旧 rowEl（代码只追新不删旧），
     泄漏元素停留旧档位与新 pill 叠加闪现。每次布局前清掉一切非当前实例。 */
  function purgeForeign() {
    var rows = document.querySelectorAll(".__sspills-row");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] !== rowEl && rows[i].parentNode) rows[i].parentNode.removeChild(rows[i]);
    }
    var pops = document.querySelectorAll(".__sspills-pop");
    for (var j = 0; j < pops.length; j++) {
      if (pops[j] !== popEl && pops[j].parentNode) pops[j].parentNode.removeChild(pops[j]);
    }
  }

  function layout() {
    if (dead) return;
    purgeForeign();
    var dock = visibleDock();
    if (!dock) {
      if (rowEl) { rowEl.remove(); }
      return;
    }
    if (!rowEl || rowEl.parentElement !== dock || !rowEl.isConnected) {
      if (!rowEl) rowEl = makeRow();
      dock.appendChild(rowEl);
    }
    var dockRect = dock.getBoundingClientRect();
    var trig = dock.querySelector('[data-testid="chat-model-select-trigger"]');
    if (!trig) { rowEl.style.display = "none"; return; }
    var leftChip = findChipByText(dock, "电脑操作") || findChipByText(dock, "完全访问");
    var leftEdge;
    if (leftChip) {
      leftEdge = leftChip.getBoundingClientRect().right;
    } else {
      leftEdge = dockRect.left + 60;
    }
    /* 右边界 = 左 chip 右侧、与 chip 同一水平带的按钮（模型选择器、上下文图标等）中
       最近者的左边缘。垂直带过滤（±22px）排除悬浮在输入条上方的「回到底部」按钮、
       提示条等——它们不该影响 pill 的空隙计算。 */
    var trigRect = trig.getBoundingClientRect();
    var leftChipRect = leftChip ? leftChip.getBoundingClientRect() : null;
    var bandCy = leftChipRect
      ? (leftChipRect.top + leftChipRect.bottom) / 2
      : (trigRect.top + trigRect.bottom) / 2;
    var rightEdge = trigRect.left;
    var btns = dock.querySelectorAll("button,[role='button']");
    for (var bi = 0; bi < btns.length; bi++) {
      var br = btns[bi].getBoundingClientRect();
      if (br.width > 0 && br.left > leftEdge + 4 && br.left < rightEdge &&
          Math.abs((br.top + br.bottom) / 2 - bandCy) < 22) {
        rightEdge = br.left;
      }
    }
    var gap = rightEdge - leftEdge;
    var dockW = stableWidth(dockRect.width); // 档位判定用稳定宽度，过渡帧不换档

    /* 档位判定：按稳定宽度 + 真滞回（升降门槛错开 48px），临界宽度稳定不跳 */
    var HY = 24;
    var want;
    if (pillMode === "full") want = dockW >= 700 - HY ? "full" : (dockW >= 460 - HY ? "mid" : "mini");
    else if (pillMode === "mid") want = dockW >= 700 + HY ? "full" : (dockW >= 460 - HY ? "mid" : "mini");
    else want = dockW >= 700 + HY ? "full" : (dockW >= 460 + HY ? "mid" : "mini");

    var order = [want];
    var all = ["full", "mid", "mini", "micro"];
    for (var ai = 0; ai < all.length; ai++) {
      if (all[ai] !== want) order.push(all[ai]);
    }
    var chosen = null;
    ensureModeSpans();
    for (var mi = 0; mi < order.length; mi++) {
      var mode = order[mi];
      setModeSpans(mode); // 纯 display 切换，零重建
      rowEl.style.display = "";
      if (gap >= rowEl.offsetWidth + 24) { chosen = mode; break; }
    }
    if (!chosen) {
      /* 放不下就立即隐藏——宁可暂时不显示，也绝不停在旧位置压住模型选择器/发送按钮 */
      shrinkStreak = 0;
      rowEl.style.display = "none";
      return;
    }
    shrinkStreak = 0;
    pillMode = chosen;
    setModeSpans(chosen);
    var centerX = (leftEdge + rightEdge) / 2;
    var newLeft = Math.round(centerX - dockRect.left);
    var pillH = rowEl.offsetHeight || 30;
    var newBottom = Math.max(0, Math.round((dockRect.bottom - (trigRect.top + trigRect.height / 2)) - pillH / 2));
    /* 位置亚像素防抖：变化 ≤1px 不应用（悬浮态量出的亚像素抖动直接吞掉） */
    if (Math.abs(newLeft - lastLeft) > 1) { rowEl.style.left = newLeft + "px"; lastLeft = newLeft; }
    if (Math.abs(newBottom - lastBottom) > 1) { rowEl.style.bottom = newBottom + "px"; lastBottom = newBottom; }
    rowEl.style.display = "";
    /* 落位自校正：绝对定位的包含块可能被宿主 transform 改写（侧栏动画等），
       量出实际中心与目标中心的偏差回写一次；校正后仍越界就隐藏，绝不压住原生控件。
       校正期间关掉 left 过渡，否则量到的是动画中间值，会把自己越修越偏。 */
    rowEl.style.transition = "none";
    for (var pass = 0; pass < 2; pass++) {
      var rr = rowEl.getBoundingClientRect();
      if (!rr.width) break;
      var delta = centerX - (rr.left + rr.width / 2);
      if (Math.abs(delta) < 1.5) break;
      var curLeft = parseFloat(rowEl.style.left || "0") || 0;
      var fixedLeft = Math.round(curLeft + delta);
      rowEl.style.left = fixedLeft + "px";
      lastLeft = fixedLeft;
    }
    var fr = rowEl.getBoundingClientRect();
    rowEl.style.transition = "";
    if (fr.width > 0 && (fr.left < leftEdge - 2 || fr.right > rightEdge + 2)) {
      rowEl.style.display = "none"; // 实测仍压到原生控件：本帧不显示
      return;
    }
    /* 宽度已变但尚未稳定：再排一次布局，让稳定宽度有机会生效 */
    if (pendingW) setTimeout(requestLayout, 340);
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      requestLayout();
      var sid = currentSessionId();
      if (sid !== lastSid) poll();
    });
  }

  document.addEventListener("click", function (ev) {
    if (!popupOpen) return;
    if (Date.now() - openedAt < 400) return; // 刚开启：忽略宿主合成的迟到点击，防秒关
    if (rowEl && !rowEl.contains(ev.target) && popEl && !popEl.contains(ev.target)) {
      setPopup(false);
      // 关闭后短暂锁定 pill 布局，避免点击穿透触发的宿主重排让 pill 闪一下
      lastScrollAt = Date.now();
    }
  }, true);
  window.addEventListener("resize", function () { requestLayout(); if (popupOpen) renderPopup(); });
  document.addEventListener("scroll", function () {
    lastScrollAt = Date.now();
    if (popupOpen) renderPopup();
    requestLayout(); // 记录豁免；滚动停稳后会补执行一次
  }, true);

  var mo = new MutationObserver(schedule);
  mo.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["data-session-id"],
  });
  /* 立即钳制：输入框尺寸突变（侧栏开合）时先保证 pill 不压原生控件，
     防抖布局随后再正式归位。避免防抖窗口期内 pill 悬在旧位置形成「留痕」。 */
  function clampNow() {
    if (dead || !rowEl || rowEl.style.display === "none") return;
    var dock = visibleDock();
    if (!dock) return;
    var trig = dock.querySelector('[data-testid="chat-model-select-trigger"]');
    if (!trig) return;
    var trigRect = trig.getBoundingClientRect();
    var dockRect = dock.getBoundingClientRect();
    var leftChip = findChipByText(dock, "电脑操作") || findChipByText(dock, "完全访问");
    var leftEdge = leftChip ? leftChip.getBoundingClientRect().right : dockRect.left + 60;
    var bandCy = leftChip
      ? (leftChip.getBoundingClientRect().top + leftChip.getBoundingClientRect().bottom) / 2
      : (trigRect.top + trigRect.bottom) / 2;
    var rightEdge = trigRect.left;
    var btns = dock.querySelectorAll("button,[role='button']");
    for (var bi = 0; bi < btns.length; bi++) {
      var br = btns[bi].getBoundingClientRect();
      if (br.width > 0 && br.left > leftEdge + 4 && br.left < rightEdge &&
          Math.abs((br.top + br.bottom) / 2 - bandCy) < 22) rightEdge = br.left;
    }
    var pw = rowEl.offsetWidth || 0;
    if (!pw) return;
    if (rightEdge - leftEdge < pw + 24) {
      rowEl.style.display = "none"; // 空隙已不够：先隐，等防抖布局选到合适档位再显
      return;
    }
    var centerX = (leftEdge + rightEdge) / 2;
    var newLeft = Math.round(centerX - dockRect.left);
    var curLeft = parseFloat(rowEl.style.left || "0") || 0;
    if (Math.abs(newLeft - curLeft) > 1) {
      rowEl.style.left = newLeft + "px";
      lastLeft = newLeft;
    }
  }

  /* 输入框容器尺寸变化（侧栏开合/拖分隔条不触发 window resize）：
     立即钳制防留痕 + 防抖触发完整布局 */
  var ro = null;
  var roTimer = 0;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(function () { clampNow(); requestLayout(); });
    roTimer = setInterval(function () {
      if (dead) { clearInterval(roTimer); roTimer = 0; return; }
      var d = visibleDock();
      if (d) { ro.observe(d); clearInterval(roTimer); roTimer = 0; }
    }, 2000);
  }
  requestLayout();
  popEl = document.createElement("div");
  popEl.className = "__sspills-pop";
  document.body.appendChild(popEl);
  poll();
  var pollTimer = setInterval(poll, POLL_MS);

  window.__SSPILLS_TEARDOWN__ = function () {
    dead = true; // 先置死：所有异步回调（延迟布局/rAF/定时器）从此早退，死实例不再碰 DOM
    try { mo.disconnect(); } catch (e) {}
    try { clearInterval(pollTimer); } catch (e) {}
    try { clearInterval(roTimer); } catch (e) {}
    try { clearTimeout(layoutTimer); } catch (e) {}
    try { ro && ro.disconnect(); } catch (e) {}
    try { css.remove(); } catch (e) {}
    try { rowEl && rowEl.remove(); } catch (e) {}
    try { popEl && popEl.remove(); } catch (e) {}
    rowEl = null; popEl = null; data = null;
  };
})();
