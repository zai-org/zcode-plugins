/* session-stats pills v4 — 贴 chips 行（电脑操作之后）、悬浮弹层含模型分布、支持热更新 */
;(function () {
  "use strict";
  if (window.__SSPILLS__) { try { window.__SSPILLS_TEARDOWN__(); } catch (e) {} }
  window.__SSPILLS__ = true;

  var ENDPOINT = "http://127.0.0.1:31710";
  var POLL_MS = 5000;
  var data = null, lastOk = 0, fails = 0, popupOpen = false;
  var rowEl = null, popEl = null, css = null, lastHtml = "";

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
    ".__sspills-row{position:absolute;left:50%;transform:translateX(-50%);bottom:10px;" +
    "display:inline-flex;align-items:center;gap:6px;z-index:30;}" +
    ".__sspills-pill{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;" +
    "border-radius:8px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.09);" +
    "color:rgba(232,235,241,.88);font:500 13px/1 'Segoe UI','Microsoft YaHei',system-ui,sans-serif;" +
    "cursor:pointer;white-space:nowrap;transition:border-color .15s,background .15s;}" +
    ".__sspills-pill:hover{border-color:rgba(122,162,247,.55);background:rgba(122,162,247,.08);}" +
    ".__sspills-pill .ico{opacity:.6;}" +
    ".__sspills-pill b{font-weight:600;}" +
    ".__sspills-pill .sep{opacity:.35;}" +
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
      ["缓存命中率", d.cache_hit_pct != null ? d.cache_hit_pct + "%" : "—"],
    ];
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

  function renderPopup() {
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
    if (!popEl) return;
    popEl.style.display = open ? "block" : "none";
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
        if (rowEl) rowEl.style.display = "";
        render();
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

  function pillEl(ico, body) {
    return '<span class="__sspills-pill" data-act="detail">' +
      '<span class="ico">' + ico + "</span>" + body + "</span>";
  }
  function pillHtml() {
    if (!data) return pillEl("⏱", "加载中…");
    if (data.draft) return pillEl("⏱", "新会话 · 暂无统计");
    if (data.error) return pillEl("⏱", "统计不可用");
    var t = data.tokens || {};
    var lt = liveTps(data);
    var shown = lt ? Math.round(lt.v * 10) / 10 : data.tps;
    var shownHtml = shown != null
      ? shown + ' tok/s' + (lt && lt.inflight ? '<span class="live">●</span>' : "")
      : "—";
    return pillEl("⏱",
      "<b>" + (data.turns != null ? data.turns : "—") + " 轮 " + (data.steps != null ? data.steps : 0) + " 步</b>" +
      '<span class="sep">·</span>' + shownHtml +
      '<span class="dv"></span>' +
      "<b>" + fmtTok(t.total) + " tok</b>" +
      '<span class="sep">·</span>缓存命中 ' + (data.cache_hit_pct != null ? data.cache_hit_pct : "—") + "%");
  }
  function render() {
    if (!rowEl) return;
    var stale = Date.now() - lastOk > 9e5;
    rowEl.classList.toggle("stale", stale);
    var html = pillHtml();
    if (html !== lastHtml) { rowEl.innerHTML = html; lastHtml = html; }
  }

  function makeRow() {
    var el = document.createElement("div");
    el.className = "__sspills-row";
    el.addEventListener("click", function (ev) {
      var act = ev.target && ev.target.closest && ev.target.closest("[data-act='detail']");
      if (act) setPopup(!popupOpen);
      ev.stopPropagation();
    });
    return el;
  }

  /* 锚点：相对输入框水平居中——pill 绝对定位在输入条容器（dock-content）中心；
     垂直方向动态对齐模型选择器的中心线（量 rect 差，不写死像素）。 */
  function alignVertical(dock) {
    if (!rowEl) return;
    var trig = dock.querySelector('[data-testid="chat-model-select-trigger"]');
    if (!trig) return;
    var tr = trig.getBoundingClientRect();
    var dr = dock.getBoundingClientRect();
    if (!tr.height || !dr.height) return;
    var pillH = rowEl.offsetHeight || 30;
    var bottomOffset = (dr.bottom - (tr.top + tr.height / 2)) - pillH / 2;
    rowEl.style.bottom = Math.max(0, Math.round(bottomOffset)) + "px";
  }

  function mount() {
    var dock = document.querySelector("[data-v4-composer-dock-content]");
    if (!dock) {
      if (rowEl) { rowEl.remove(); }
      return;
    }
    if (rowEl && rowEl.parentElement === dock && rowEl.isConnected) {
      alignVertical(dock); // 每次 tick 校正垂直位置
      return; // 已在输入条容器内
    }
    if (!rowEl) rowEl = makeRow();
    dock.appendChild(rowEl);
    alignVertical(dock);
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      mount();
      var sid = currentSessionId();
      if (sid !== lastSid) poll();
    });
  }

  document.addEventListener("click", function (ev) {
    if (popupOpen && rowEl && !rowEl.contains(ev.target) && popEl && !popEl.contains(ev.target)) {
      setPopup(false);
    }
  }, true);
  window.addEventListener("resize", function () { if (popupOpen) renderPopup(); });
  document.addEventListener("scroll", function () { if (popupOpen) renderPopup(); }, true);

  var mo = new MutationObserver(schedule);
  mo.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["data-session-id"],
  });
  mount();
  popEl = document.createElement("div");
  popEl.className = "__sspills-pop";
  document.body.appendChild(popEl);
  poll();
  var pollTimer = setInterval(poll, POLL_MS);

  window.__SSPILLS_TEARDOWN__ = function () {
    try { mo.disconnect(); } catch (e) {}
    try { clearInterval(pollTimer); } catch (e) {}
    try { css.remove(); } catch (e) {}
    try { rowEl && rowEl.remove(); } catch (e) {}
    try { popEl && popEl.remove(); } catch (e) {}
    rowEl = null; popEl = null; data = null;
  };
})();
