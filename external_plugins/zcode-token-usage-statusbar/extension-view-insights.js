<!--
  扩展视图页面（上下文洞察）。宿主按纯文本读取本文件作为沙箱页面内容（view entry）。
  文件放在插件顶层、用 .js 后缀，是因为在野旧版解包器只放行顶层 .py/.cjs/.js 与
  hooks/*.py、commands/*.md、skills/…，新建子目录或 .html 会让旧版用户无法自动更新。
  本文件不是 JavaScript：不要对它做语法检查，也不要当作脚本加载。
-->
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Context Insights</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--color-background, #ffffff);
      --card: var(--color-card, #f7f8fa);
      --card2: rgba(128, 128, 128, 0.06);
      --fg: var(--color-foreground, #171717);
      --muted: var(--color-foreground-subtle, #737373);
      --border: var(--color-border, rgba(128, 128, 128, 0.22));
      --accent: var(--color-primary, #3b82f6);
      --ok: #10b981;
    }
    html[data-theme="dark"] {
      --bg: var(--color-background, #141417);
      --card: var(--color-card, #1d1e23);
      --card2: rgba(255, 255, 255, 0.04);
      --fg: var(--color-foreground, #f5f5f5);
      --muted: var(--color-foreground-subtle, #9ca3af);
      --border: var(--color-border, rgba(255, 255, 255, 0.14));
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 12px 14px 26px; background: var(--bg); color: var(--fg);
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .hdr { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .title { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .pills { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
    .pill {
      padding: 4px 10px; border-radius: 7px; border: 1px solid var(--border);
      background: transparent; color: var(--muted); font-size: 11.5px; cursor: pointer;
    }
    .pill.on { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 500; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 11px; margin-bottom: 10px; min-width: 0; }
    .card-h { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: 600; font-size: 12.5px; margin-bottom: 8px; min-width: 0; }
    .card-h > span:first-child { white-space: nowrap; }
    .top-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; margin-bottom: 10px; }
    .kpi-6 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
    @media (max-width: 420px) { .kpi-6 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .kpi { background: var(--card2); border: 1px solid var(--border); border-radius: 8px; padding: 7px 9px; min-width: 0; }
    .kpi-k { font-size: 10.5px; color: var(--muted); }
    .kpi-v { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kpi-s { font-size: 10.5px; color: var(--muted); font-variant-numeric: tabular-nums; margin-top: 1px; }
    .daily-bars { display: flex; align-items: flex-end; gap: 6px; height: 96px; padding-top: 10px; border-bottom: 1px solid var(--border); }
    .dcol { flex: 1 1 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; min-width: 0; }
    .dpair { display: flex; align-items: flex-end; gap: 2px; width: 100%; justify-content: center; height: 74px; }
    .dbar { width: 10px; max-width: 45%; background: var(--accent); border-radius: 3px 3px 0 0; min-height: 2px; }
    .dbar-cost { width: 10px; max-width: 45%; background: var(--ok); border-radius: 3px 3px 0 0; min-height: 2px; }
    .dlbl { font-size: 9.5px; color: var(--muted); margin-top: 4px; white-space: nowrap; }
    .daily-legend { display: flex; justify-content: flex-end; align-items: center; gap: 14px; margin-top: 6px; font-size: 10.5px; color: var(--muted); }
    .daily-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }
    .mtable { width: 100%; border-collapse: collapse; font-size: 11px; }
    .mtable th { text-align: right; color: var(--muted); font-weight: 500; font-size: 10px; padding: 3px 6px; border-bottom: 1px solid var(--border); white-space: nowrap; }
    .mtable th:first-child, .mtable td:first-child { text-align: left; }
    .mtable td { text-align: right; padding: 4px 6px; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .mtable tr:last-child td { border-bottom: none; }
    .mtable td.m-name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
    .mtable td.m-empty { color: var(--muted); }
    .est-box { margin-top: 8px; border-top: 1px dashed var(--border); padding-top: 6px; }
    .est-box > summary { font-size: 11px; color: var(--muted); }
    .qrow { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px; padding: 2px 0; }
    .qrow .num { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .qfoot { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); font-size: 11px; color: var(--muted); }
    .warn { color: var(--warn, #f59e0b); }
    .err-strip { display: flex; align-items: flex-end; gap: 2px; height: 20px; margin-top: 6px; }
    .err-strip i { flex: 1 1 0; background: var(--err, #ef4444); opacity: .7; border-radius: 1px; }
    .dbar-err { width: 100%; max-width: 22px; background: var(--err, #ef4444); border-radius: 2px; margin-top: 2px; opacity: .85; }
    .donut-wrap { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .donut-box { position: relative; width: 76px; height: 76px; flex: 0 0 76px; }
    .donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; pointer-events: none; }
    .donut-v { font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .donut-k { font-size: 9.5px; color: var(--muted); }
    .leg-grid { flex: 1 1 180px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 10px; font-size: 11px; }
    .leg-item { display: flex; justify-content: space-between; align-items: center; gap: 4px; min-width: 0; }
    .leg-l { display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; }
    .leg-l span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 7px; }
    .num { font-variant-numeric: tabular-nums; color: var(--muted); white-space: nowrap; }
    .mid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-bottom: 10px; }
    .heat-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; }
    .hcell { aspect-ratio: 1; border-radius: 3px; background: rgba(128,128,128,.14); cursor: pointer; }
    .hcell.l1 { background: rgba(59, 130, 246, 0.30); }
    .hcell.l2 { background: rgba(59, 130, 246, 0.55); }
    .hcell.l3 { background: rgba(59, 130, 246, 0.80); }
    .hcell.l4 { background: rgba(59, 130, 246, 1.00); }
    .hcell.sel { outline: 2px solid var(--fg); }
    .rank-row { padding: 4px 0; border-bottom: 1px solid var(--border); font-size: 11.5px; }
    .rank-row:last-child { border-bottom: none; }
    .rank-top { display: flex; justify-content: space-between; gap: 6px; }
    .rank-bar { height: 2px; border-radius: 2px; margin-top: 3px; background: var(--accent); opacity: 0.75; }
    .toolbar { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; align-items: center; }
    .input {
      flex: 1 1 160px; height: 28px; padding: 0 8px; border-radius: 7px;
      border: 1px solid var(--border); background: var(--bg); color: var(--fg); font: inherit; font-size: 11.5px;
    }
    .sess-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 8px; }
    .sess-card {
      background: var(--card2); border: 1px solid var(--border); border-radius: 8px;
      padding: 9px 10px; cursor: pointer; min-width: 0;
    }
    .sess-card:hover { border-color: var(--accent); }
    .sess-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-weight: 600; font-size: 12px; }
    .sess-top span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sess-proj { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border); color: var(--muted); margin: 4px 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sess-body { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
    .sess-stats { flex: 1 1 0; font-size: 11px; min-width: 0; }
    .sess-line { display: flex; justify-content: space-between; gap: 6px; }
    .tps-badge { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; background: rgba(16,185,129,.14); color: #10b981; font-weight: 600; white-space: nowrap; }
    .loading { opacity: 0.65; pointer-events: none; }
    .empty { color: var(--muted); text-align: center; padding: 16px; }
  </style>
</head>
<body>
  <div class="hdr">
    <div class="title" id="tTitle">上下文洞察</div>
    <div class="pills">
      <button class="pill" data-days="1">今天</button>
      <button class="pill on" data-days="7">近 7 天</button>
      <button class="pill" data-days="30">近 30 天</button>
      <button class="pill" data-days="0">全部</button>
    </div>
    <div class="pills" id="splitPills">
      <button class="pill on" data-split="all">全部请求</button>
      <button class="pill" data-split="main">主会话</button>
      <button class="pill" data-split="sub">子代理</button>
    </div>
  </div>
  <div id="content"><div class="card"><div class="empty">正在聚合跨会话统计…</div></div></div>

  <script>
    (function () {
      var STATE_URI = "ui://zcode-token-usage-statusbar/insights/state";
      var days = 7;
      var snap = null;
      var search = "";
      var dayFilter = "";
      var splitMode = "all"; // all | main | sub（主会话 / 子代理拆分）
      var heatMode = "tokens"; // tokens | sessions | tps
      var sortBy = "updated"; // updated | tokens | context
      var toast = "";
      var reqSeq = 0;

      var TOK_COLORS = {
        systemPrompt: "#6366f1", toolSchemas: "#f59e0b", userMessages: "#10b981",
        injectedContext: "#8b5cf6", skillInjections: "#ec4899", toolCalls: "#3b82f6",
        reasoning: "#a855f7", answers: "#14b8a6"
      };
      var TOK_LABELS = {
        zh: {
          systemPrompt: "系统提示词", toolSchemas: "工具定义", userMessages: "用户消息",
          injectedContext: "注入内容", skillInjections: "技能注入", toolCalls: "工具调用",
          reasoning: "模型思考", answers: "模型回复"
        },
        en: {
          systemPrompt: "System Prompt", toolSchemas: "Tool Schemas", userMessages: "User Messages",
          injectedContext: "Injected", skillInjections: "Skills", toolCalls: "Tool Calls",
          reasoning: "Reasoning", answers: "Answers"
        }
      };

      function isZh(locale) { return !locale || String(locale).toLowerCase().indexOf("zh") === 0; }
      function applyTheme(ctx) {
        if (ctx && ctx.theme) document.documentElement.dataset.theme = ctx.theme === "dark" ? "dark" : "light";
      }
      function esc(s) {
        return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      }
      function fmtCompact(n, zh) {
        if (typeof n !== "number" || !isFinite(n)) return "-";
        if (zh) {
          if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
          if (n >= 1e4) return (n / 1e4).toFixed(2) + "万";
          return String(Math.round(n));
        }
        if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
        return String(Math.round(n));
      }
      function fmtCost(usd, fx) {
        if (typeof usd !== "number" || !isFinite(usd)) return "-";
        if (typeof fx === "number" && fx > 0) return "¥" + (usd * fx).toFixed(2);
        return "$" + usd.toFixed(2);
      }
      function fmtDur(ms) {
        if (typeof ms !== "number" || ms <= 0) return "0s";
        var s = Math.round(ms / 1000);
        if (s < 60) return s + "s";
        var m = Math.floor(s / 60), rs = s % 60;
        if (m < 60) return m + "m" + rs + "s";
        var h = Math.floor(m / 60), rm = m % 60;
        return h + "h" + rm + "m";
      }
      function fmtAgo(ts, zh) {
        if (!ts) return "";
        var diff = Math.max(0, Date.now() - ts);
        var m = Math.floor(diff / 60000);
        if (m < 1) return zh ? "刚刚" : "just now";
        if (m < 60) return m + (zh ? "分钟前" : "m ago");
        var h = Math.floor(m / 60);
        if (h < 24) return h + (zh ? "小时前" : "h ago");
        return Math.floor(h / 24) + (zh ? "天前" : "d ago");
      }

      function fmtSpan(a, b) {
        if (!a) return "—";
        var p = function (n) { return (n < 10 ? "0" : "") + n; };
        function core(d) { return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()); }
        var da = new Date(a);
        var txt = da.getFullYear() + "-" + core(da);
        if (!b) return txt;
        var db = new Date(b);
        return txt + (da.toDateString() === db.toDateString() ? " ~ " + p(db.getHours()) + ":" + p(db.getMinutes()) : " ~ " + core(db));
      }

      function svgDonut(segs, centerVal, centerLbl) {
        var tot = segs.reduce(function (s, x) { return s + (x.v || 0); }, 0) || 1;
        var r = 30, circ = 2 * Math.PI * r, off = 0;
        var circles = segs.filter(function (s) { return s.v > 0; }).map(function (s) {
          var len = (s.v / tot) * circ;
          var c = '<circle cx="38" cy="38" r="' + r + '" fill="none" stroke="' + s.c + '" stroke-width="8" stroke-dasharray="' + len.toFixed(2) + ' ' + (circ - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 38 38)" />';
          off += len;
          return c;
        }).join("");
        return '<div class="donut-box"><svg width="76" height="76" viewBox="0 0 76 76"><circle cx="38" cy="38" r="' + r + '" fill="none" stroke="rgba(128,128,128,.16)" stroke-width="8" />' + circles + '</svg>' +
          '<div class="donut-center"><div class="donut-v">' + esc(centerVal) + '</div><div class="donut-k">' + esc(centerLbl) + '</div></div></div>';
      }

      var SPLIT_COLORS = { cacheRead: "#3b82f6", cacheWrite: "#06b6d4", bareInput: "#8b5cf6", reasoning: "#a855f7", answers: "#10b981" };
      var SPLIT_LABELS = {
        zh: { cacheRead: "缓存读取", cacheWrite: "缓存写入", bareInput: "未命中输入", reasoning: "模型思考", answers: "模型回复" },
        en: { cacheRead: "Cache read", cacheWrite: "Cache write", bareInput: "Bare input", reasoning: "Reasoning", answers: "Answers" }
      };
      function fmtMs(ms) {
        if (typeof ms !== "number" || ms <= 0) return "0ms";
        if (ms < 1000) return Math.round(ms) + "ms";
        return fmtDur(ms);
      }
      function pctOf(a, b) { return b > 0 ? (a / b * 100).toFixed(1) + "%" : "—"; }
      function splitDonutHtml(split, total, zh) {
        var arr = split || [];
        var drawn = arr.filter(function (x) { return x.tokens > 0; });
        var labels = zh ? SPLIT_LABELS.zh : SPLIT_LABELS.en;
        return '<div class="donut-wrap">' + svgDonut(drawn.map(function (x) { return { v: x.tokens, c: SPLIT_COLORS[x.id] || "#64748b" }; }), fmtCompact(total, zh), zh ? "总用量" : "Total") +
          '<div class="leg-grid">' + arr.map(function (x) {
            return '<div class="leg-item"><span class="leg-l"><span class="dot" style="background:' + (SPLIT_COLORS[x.id] || "#64748b") + '"></span><span>' + esc(labels[x.id] || x.id) + '</span></span>' +
              '<span class="num">' + fmtCompact(x.tokens, zh) + ' · ' + pctOf(x.tokens, total) + '</span></div>';
          }).join("") + '</div></div>';
      }
      function estimateDetailsHtml(tb, basis, zh) {
        var arr = tb || [];
        if (!arr.length) return "";
        var tot = arr.reduce(function (s, x) { return s + (x.tokens || 0); }, 0) || 1;
        var labels = zh ? TOK_LABELS.zh : TOK_LABELS.en;
        var note = basis === "capture"
          ? (zh ? "system 与工具 schema 按抓包内容估算；其余类别按字符数或固定比例估算" : "System & tool schemas estimated from captured requests; other categories by chars or ratio")
          : (zh ? "用量库不存各类别的 token，以下均为估算值" : "The usage DB has no per-category tokens; everything below is an estimate");
        return '<details class="est-box"><summary>' + (zh ? "8 分类构成（估算）" : "8-category breakdown (estimated)") + '</summary>' +
          '<div style="font-size:10.5px;color:var(--muted);margin:4px 0">' + esc(note) + '</div>' +
          '<div class="leg-grid">' + arr.map(function (x) {
            return '<div class="leg-item"><span class="leg-l"><span class="dot" style="background:' + (TOK_COLORS[x.id] || "#64748b") + '"></span><span>' + esc(labels[x.id] || x.id) + '</span></span>' +
              '<span class="num">≈' + fmtCompact(x.tokens, zh) + ' · ' + ((x.tokens / tot) * 100).toFixed(1) + '%</span></div>';
          }).join("") + '</div></details>';
      }
      function errLabel(t, zh) {
        var m = zh
          ? { rate_limited: "限流", cancelled: "已取消", stream_idle_timeout: "流中断", network_error: "网络错误", server_error: "服务端错误", unknown: "未知", invalid_request: "请求无效", auth_failed: "认证失败" }
          : { rate_limited: "Rate limited", cancelled: "Cancelled", stream_idle_timeout: "Stream idle", network_error: "Network", server_error: "Server error", unknown: "Unknown", invalid_request: "Bad request", auth_failed: "Auth failed" };
        return m[t] || t;
      }
      function errFootHtml(e, zh) {
        e = e || {};
        return '<div class="qfoot">' + (zh ? "最终失败 " : "Failed ") + '<b>' + (e.failed || 0) + '</b>' + (zh ? " · 取消 " : " · Cancelled ") + '<b>' + (e.cancelled || 0) + '</b>' + (zh ? " · 重试 " : " · Retries ") + '<b>' + (e.retries || 0) + '</b></div>';
      }
      function compactionRowHtml(c, zh) {
        return '<div class="qrow"><span>' + esc(fmtSpan(c.time)) + '</span>' +
          '<span class="num">' + fmtCompact(c.preTokens, zh) + ' → <b style="color:var(--fg)">' + fmtCompact(c.postTokens, zh) + '</b>' +
          (c.preTokens > 0 && c.postTokens < c.preTokens ? ' <span class="warn">-' + pctOf(c.preTokens - c.postTokens, c.preTokens) + '</span>' : '') +
          (c.willRetrigger ? ' <span class="warn">' + (zh ? "下轮再压缩" : "retrigger") + '</span>' : '') + '</span></div>' +
          '<div style="font-size:10.5px;color:var(--muted)">' + (c.auto ? (zh ? "自动" : "auto") : (zh ? "手动" : "manual")) + (c.trigger ? ' · ' + esc(c.trigger) : '') +
          (c.summarized ? ' · ' + (zh ? "摘要 " : "summarized ") + c.summarized + (zh ? " 条" : "") : '') + '</div>';
      }
      function errorCardHtml(err, daily, zh) {
        var e = err || { byType: {} };
        var types = Object.keys(e.byType || {}).map(function (t) { return { t: t, n: e.byType[t] }; }).sort(function (a, b) { return b.n - a.n; });
        var mx = types.length ? types[0].n : 1;
        var days = daily || [];
        var mxE = Math.max.apply(null, days.map(function (d) { return d.errors || 0; })) || 1;
        var hasErr = days.some(function (d) { return (d.errors || 0) > 0; });
        return '<div class="card" style="margin-bottom:0"><div class="card-h"><span>' + (zh ? "错误与重试" : "Errors & Retries") + '</span><span class="num">' + (e.failedAttempts || 0) + ' / ' + (e.requests || 0) + '</span></div>' +
          (types.length ? types.map(function (x) {
            return '<div class="rank-row"><div class="rank-top"><span>' + esc(errLabel(x.t, zh)) + '</span><span class="num">' + x.n + ' · ' + pctOf(x.n, e.requests) + '</span></div>' +
              '<div class="rank-bar" style="width:' + Math.max(4, Math.round(x.n / mx * 100)) + '%;background:var(--err,#ef4444);opacity:.8"></div></div>';
          }).join("") : '<div class="empty">' + (zh ? "无失败尝试" : "No failed attempts") + '</div>') +
          (hasErr ? '<div class="err-strip">' + days.map(function (d) {
            return '<i style="height:' + Math.max(2, Math.round((d.errors || 0) / mxE * 18)) + 'px" title="' + esc(d.date) + ': ' + (d.errors || 0) + '"></i>';
          }).join("") + '</div><div style="font-size:10px;color:var(--muted)">' + (zh ? "每日失败尝试（最近在右）" : "Failed attempts per day (latest right)") + '</div>' : '') +
          errFootHtml(e, zh) + '</div>';
      }
      function compactionCardHtml(h, list, zh) {
        h = h || {};
        var arr = (list || []).slice(0, 5);
        return '<div class="card" style="margin-bottom:0"><div class="card-h"><span>' + (zh ? "压缩健康度" : "Compactions") + '</span><span class="num">' + (h.count || 0) + (zh ? " 次" : "") + '</span></div>' +
          (h.latest
            ? '<div class="kpi"><div class="kpi-k">' + (zh ? "平均缩减" : "Avg reduction") + '</div><div class="kpi-v">' + (h.avgReductionPct || 0) + '%</div>' +
              '<div class="kpi-s">' + (h.willRetrigger ? '<span class="warn">' + (zh ? "下轮再压缩 " : "retrigger ") + h.willRetrigger + (zh ? " 次" : "") + '</span>' : (zh ? "无连续压缩" : "no retrigger")) + '</div></div>'
            : '<div class="empty">' + (zh ? "窗口内无压缩" : "No compactions") + '</div>') +
          (arr.length ? '<div style="margin-top:4px">' + arr.map(function (c) { return compactionRowHtml(c, zh); }).join("") + '</div>' : '') + '</div>';
      }
      function toolQualityHtml(tq, zh) {
        var q = tq || {};
        function row(l, v) { return '<div class="qrow"><span>' + l + '</span><span class="num">' + v + '</span></div>'; }
        return '<div class="card" style="margin-bottom:0"><div class="card-h"><span>' + (zh ? "工具质量" : "Tool Quality") + '</span><span class="num">' + (q.total || 0) + (zh ? " 次调用" : " calls") + '</span></div>' +
          row(zh ? "错误状态" : "Error status", (q.errorStatus || 0) + ' · ' + pctOf(q.errorStatus, q.total)) +
          row(zh ? "非零退出" : "Non-zero exit", (q.nonZeroExit || 0) + ' · ' + pctOf(q.nonZeroExit, q.total)) +
          (q.truncated ? row(zh ? "输出被截断" : "Truncated", q.truncated) : '') +
          row(zh ? "只读占比" : "Read-only", pctOf(q.readOnly, q.total)) +
          (q.destructive ? row(zh ? "破坏性操作" : "Destructive", q.destructive) : '') +
          row(zh ? "耗时 P50 / P95" : "P50 / P95", fmtMs(q.p50Ms) + ' / ' + fmtMs(q.p95Ms)) + '</div>';
      }

      function render() {
        var el = document.getElementById("content");
        var zh = isZh(snap && snap.locale);
        document.getElementById("tTitle").textContent = zh ? "上下文洞察" : "Context Insights";
        document.querySelectorAll("[data-days]").forEach(function (b) {
          var d = Number(b.getAttribute("data-days"));
          b.classList.toggle("on", d === days);
          if (zh) b.textContent = d === 1 ? "今天" : d === 0 ? "全部" : "近 " + d + " 天";
          else b.textContent = d === 1 ? "Today" : d === 0 ? "All" : d + "d";
        });

        if (!snap || !snap.ok) {
          el.innerHTML = '<div class="card"><div class="empty">' + (zh ? "暂无数据" : "No data") + '</div></div>';
          return;
        }
        var k = snap.kpi;
        var split = snap.split || {};
        // 主/子代理切换：cur=对应来源桶（null=全部请求，走 kpi 合计）
        // 所选来源在窗口内没有请求时给一页显式的 0，而不是戴着该来源的名字显示全局数字
        var EMPTY_BUCKET = { requests: 0, tokens: 0, inp: 0, out: 0, reas: 0, cr: 0, cw: 0, ttftMs: 0, genMs: 0, durMs: 0, toolCalls: 0, costUsd: 0, cacheHitRate: 0, tps: 0, sessions: 0 };
        var cur = splitMode === "all" ? null : (split[splitMode] || EMPTY_BUCKET);
        var tpsNow = cur ? (cur.tps || 0) : (k.tps || 0);
        document.querySelectorAll("[data-split]").forEach(function (b) {
          b.classList.toggle("on", (b.getAttribute("data-split") || "all") === splitMode);
        });
        var html = '<div class="top-grid">';

        // Left: 6 KPIs（分桶内没有工具耗时，切到主/子时只给调用次数）
        html += '<div class="card" style="margin-bottom:0"><div class="kpi-6">' +
          '<div class="kpi"><div class="kpi-k">' + (zh ? "会话" : "Sessions") + '</div><div class="kpi-v">' + (cur ? (cur.sessions || 0) : k.sessions) + '</div><div class="kpi-s">' + (cur ? (zh ? "该来源的会话数" : "sessions in scope") : (zh ? "已归档 " : "Arch ") + (k.archivedSessions || 0)) + '</div></div>' +
          '<div class="kpi"><div class="kpi-k">' + (zh ? "Token 消耗" : "Tokens") + '</div><div class="kpi-v">' + fmtCompact(cur ? cur.tokens : k.billedTokens, zh) + '</div><div class="kpi-s">' + (cur ? ((cur.requests || 0) + (zh ? " 次请求" : " reqs")) : (zh ? "轮次 " : "Turns ") + k.turns) + '</div></div>' +
          '<div class="kpi"><div class="kpi-k">' + (zh ? "预估费用" : "Est. Cost") + '</div><div class="kpi-v">' + fmtCost(cur ? cur.costUsd : k.costUsd, k.fx) + '</div><div class="kpi-s">' + (cur ? (pctOf(cur.tokens, (split.all || {}).tokens || 0) + (zh ? " 的 token" : " of tokens")) : k.requests + (zh ? " 次请求" : " reqs")) + '</div></div>' +
          '<div class="kpi"><div class="kpi-k">' + (zh ? "缓存命中" : "Cache Hit") + '</div><div class="kpi-v">' + (cur ? cur.cacheHitRate : k.cacheHitRate) + '%</div><div class="kpi-s">' + fmtCompact(cur ? cur.cr : k.cacheReadTokens, zh) + '</div></div>' +
          '<div class="kpi"><div class="kpi-k">' + (zh ? "工具调用" : "Tool Calls") + '</div><div class="kpi-v">' + (cur ? (cur.toolCalls || 0) : k.toolCalls) + '</div><div class="kpi-s">' + (cur ? (zh ? "耗时未按来源分" : "duration not split") : (zh ? "耗时 " : "") + fmtDur(k.toolDurationMs)) + '</div></div>' +
          '<div class="kpi"><div class="kpi-k">' + (zh ? "活跃时长" : "Active Time") + '</div><div class="kpi-v">' + fmtDur(cur ? cur.durMs : k.activeDurationMs) + '</div><div class="kpi-s">' + (cur ? (tpsNow ? tpsNow + ' tok/s' : '—') : (tpsNow ? tpsNow + ' tok/s' : (k.modelCalls + ' calls'))) + '</div></div>' +
          '</div></div>';

        // Right: Daily paired bars
        var daily = snap.daily || [];
        function dayTok(d) { return splitMode === "main" ? (d.mainTokens || 0) : splitMode === "sub" ? (d.subTokens || 0) : (d.tokens || 0); }
        function dayCost(d) { return splitMode === "main" ? (d.mainCostUsd || 0) : splitMode === "sub" ? (d.subCostUsd || 0) : (d.costUsd || 0); }
        var maxTok = Math.max.apply(null, daily.map(dayTok)) || 1;
        var maxCost = Math.max.apply(null, daily.map(dayCost)) || 0.0001;
        var hasErr = daily.some(function (d) { return (d.errors || 0) > 0; });
        var maxErr = Math.max.apply(null, daily.map(function (d) { return d.errors || 0; })) || 1;
        html += '<div class="card" style="margin-bottom:0"><div class="card-h"><span>' + (zh ? "近 " + daily.length + " 天用量（Token · 费用）" : daily.length + "d Usage (Token · Cost)") + '</span><span class="tps-badge">' + tpsNow + ' tok/s</span></div>' +
          '<div class="daily-bars">' + daily.map(function (d) {
            var tk = dayTok(d), cs = dayCost(d), en = d.errors || 0;
            var ht = Math.max(2, Math.round((tk / maxTok) * 68));
            var hc = Math.max(2, Math.round((cs / maxCost) * 68));
            return '<div class="dcol" title="' + esc(d.date) + ': ' + fmtCompact(tk, zh) + ' · ' + fmtCost(cs, k.fx) + (en ? ' · ' + (zh ? "失败尝试 " : "failed ") + en : '') + '">' +
              '<div class="dpair"><div class="dbar" style="height:' + ht + 'px"></div><div class="dbar-cost" style="height:' + hc + 'px"></div></div>' +
              (hasErr ? '<div class="dbar-err" style="height:' + (en ? Math.max(2, Math.round(en / maxErr * 6)) : 0) + 'px"></div>' : '') +
              '<div class="dlbl">' + esc(d.date.slice(5)) + '</div></div>';
          }).join("") + '</div>' +
          '<div class="daily-legend"><span><i style="background:var(--accent)"></i>Token</span><span><i style="background:var(--ok)"></i>' + (zh ? "费用（仅含支持计价映射的模型）" : "Cost (priced models only)") + '</span>' +
          (hasErr ? '<span><i style="background:var(--err,#ef4444)"></i>' + (zh ? "失败尝试" : "Failed attempts") + '</span>' : '') + '</div></div>';
        html += '</div>';

        // Row 2: Token 统计（实测五分 + 折叠的估算八分类）& 耗时（实测三段）
        var bi = cur ? (cur.inp || 0) : k.inputTokens, bo = cur ? (cur.out || 0) : k.outputTokens;
        var bcr = cur ? (cur.cr || 0) : k.cacheReadTokens, bcw = cur ? (cur.cw || 0) : 0, bre = cur ? (cur.reas || 0) : 0;
        var tokenSplit = [
          { id: "cacheRead", tokens: bcr }, { id: "cacheWrite", tokens: bcw },
          { id: "bareInput", tokens: Math.max(0, bi - bcr - bcw) },
          { id: "reasoning", tokens: bre }, { id: "answers", tokens: Math.max(0, bo - bre) }
        ];
        var tm = snap.timingBreakdown || {};
        var tmSegs = [
          { l: zh ? "首字等待" : "TTFT", v: cur ? (cur.ttftMs || 0) : (tm.ttftMs || 0), c: "#3b82f6" },
          { l: zh ? "模型生成" : "Generation", v: cur ? (cur.genMs || 0) : (tm.genMs || 0), c: "#10b981" },
          { l: zh ? "工具执行" : "Tool runs", v: cur ? 0 : (tm.toolRunsMs || 0), c: "#f59e0b" }
        ];
        var tmTot = tmSegs.reduce(function (s, x) { return s + x.v; }, 0) || 1;

        html += '<div class="top-grid">' +
          '<div class="card" style="margin-bottom:0"><div class="card-h"><span>' + (zh ? "Token 统计（实测）" : "Token Stats (measured)") + '</span><span class="num">' + fmtCompact(bi + bo, zh) + '</span></div>' +
          splitDonutHtml(tokenSplit, bi + bo, zh) + estimateDetailsHtml(snap.tokenBreakdown, snap.tokenBreakdownBasis, zh) + '</div>' +

          '<div class="card" style="margin-bottom:0"><div class="card-h"><span>' + (zh ? "耗时统计（实测）" : "Timing (measured)") + '</span><span class="tps-badge">' + tpsNow + ' tok/s</span></div>' +
          '<div class="donut-wrap">' + svgDonut(tmSegs, fmtDur(tmTot), zh ? "活跃时长" : "Active") +
          '<div class="leg-grid">' + tmSegs.map(function (x) {
            return '<div class="leg-item"><span class="leg-l"><span class="dot" style="background:' + x.c + '"></span><span>' + esc(x.l) + '</span></span>' +
              '<span class="num">' + fmtDur(x.v) + ' · ' + ((x.v / tmTot) * 100).toFixed(1) + '%</span></div>';
          }).join("") + '</div></div>' +
          '<div class="qfoot">' + (zh ? "平均首字 " : "Avg TTFT ") + fmtMs(cur ? (cur.ttftMs || 0) / Math.max(1, cur.requests || 0) : tm.avgTtftMs) +
          (cur ? (zh ? " · 工具耗时不按来源分" : " · tool time not split") : '') + '</div></div>' +
          '</div>';

        // Model detail table (Token ↓ / Requests / Avg t/s / Est. cost)
        var modelRows = modelTableRows(snap.topModels, zh, k.fx, splitMode);
        html += '<div class="card"><div class="card-h"><span>' + (zh ? "模型明细" : "Models") + '</span><span class="num">' + (modelRows.match(/<tr[ >]/g) || []).length + '</span></div>' +
          '<table class="mtable"><thead><tr><th>' + (zh ? "模型明细" : "Models") + '</th><th>' + (zh ? "Token 用量 ↓" : "Tokens ↓") + '</th><th>' + (zh ? "请求次数" : "Requests") + '</th><th>' + (zh ? "平均速度" : "Avg t/s") + '</th><th>' + (zh ? "预估费用" : "Est. Cost") + '</th></tr></thead><tbody>' +
          modelRows + '</tbody></table></div>';

        // Quality: 错误与重试 / 压缩健康度 / 工具质量
        html += '<div class="mid-4">' + errorCardHtml(snap.errors, daily, zh) +
          compactionCardHtml(snap.compactionHealth, snap.compactions, zh) + toolQualityHtml(snap.toolQuality, zh) + '</div>';

        // Row 3: 4 columns (Heatmap, Skills, Tools, Commands)
        var heat = snap.heatmap || [];
        var heatVal = function (x) { return heatMode === "sessions" ? (x.sessions || 0) : heatMode === "tps" ? (x.avgTps || 0) : (x.tokens || 0); };
        var maxH = Math.max.apply(null, heat.map(heatVal)) || 1;
        html += '<div class="mid-4">';
        html += '<div class="card" style="margin-bottom:0"><div class="card-h"><span>' + (zh ? "活跃度" : "Activity") + '</span>' +
          '<div class="pills"><button class="pill ' + (heatMode === "sessions" ? "on" : "") + '" data-hmode="sessions">' + (zh ? "会话" : "Sess") + '</button>' +
          '<button class="pill ' + (heatMode === "tokens" ? "on" : "") + '" data-hmode="tokens">Token</button>' +
          '<button class="pill ' + (heatMode === "tps" ? "on" : "") + '" data-hmode="tps">t/s</button></div></div>' +
          '<div class="heat-grid">' + heat.map(function (x) {
            var val = heatVal(x);
            var r = val / maxH;
            var lv = val <= 0 ? "" : (r > 0.75 ? "l4" : r > 0.45 ? "l3" : r > 0.18 ? "l2" : "l1");
            return '<div class="hcell ' + lv + (dayFilter === x.date ? " sel" : "") + '" data-hday="' + esc(x.date) + '" title="' + esc(x.date) + ': ' + (heatMode === "tps" ? (x.avgTps > 0 ? x.avgTps + " t/s" : "—") : (fmtCompact(x.tokens, zh) + ' / ' + x.sessions + ' sess')) + '"></div>';
          }).join("") + '</div>' +
          (dayFilter ? '<div style="margin-top:6px"><button class="pill on" id="clrDay">' + esc(dayFilter) + ' ✕</button></div>' : '') +
          '</div>';

        function modelTableRows(list, zh, fx, mode) {
          // mode=main|sub 时只列该来源有请求的模型，数值取该来源桶
          var arr = [];
          (Array.isArray(list) ? list : []).forEach(function (m) {
            if (mode && mode !== "all") {
              var b = m.bySource && m.bySource[mode];
              if (!b) return;
              m = { modelId: m.modelId, providerId: m.providerId, tokens: b.tokens, requests: b.requests, avgTps: b.tps, costUsd: b.costUsd };
            }
            arr.push(m);
          });
          arr.sort(function (a, b) { return (b.tokens || 0) - (a.tokens || 0); });
          if (!arr.length) return '<tr><td colspan="5" class="m-empty">-</td></tr>';
          return arr.map(function (m) {
            return '<tr>' +
              '<td class="m-name" title="' + esc((m.modelId || "") + (m.providerId ? " · " + m.providerId : "")) + '">' + esc(m.modelId || "unknown") + '</td>' +
              '<td>' + fmtCompact(m.tokens, zh) + '</td>' +
              '<td>' + (m.requests || 0) + '</td>' +
              '<td>' + (m.avgTps > 0 ? m.avgTps + " t/s" : "—") + '</td>' +
              '<td>' + fmtCost(m.costUsd, fx) + '</td></tr>';
          }).join("");
        }

        function rankCard(title, list, maxN) {
          var arr = (list || []).slice(0, maxN || 6);
          var mx = Math.max.apply(null, arr.map(function (x) { return x.count || 0; })) || 1;
          return '<div class="card" style="margin-bottom:0"><div class="card-h"><span>' + esc(title) + '</span><span class="num">' + (list ? list.length : 0) + '</span></div>' +
            (arr.length ? arr.map(function (x) {
              var w = Math.max(4, Math.round((x.count / mx) * 100));
              return '<div class="rank-row"><div class="rank-top"><span>' + esc(x.name) + '</span><span class="num">×' + x.count + (x.lastAt ? ' · ' + fmtAgo(x.lastAt, zh) : '') + '</span></div>' +
                '<div class="rank-bar" style="width:' + w + '%"></div></div>';
            }).join("") : '<div class="empty">-</div>') + '</div>';
        }
        html += rankCard(zh ? "技能加载" : "Skill Loads", snap.topSkills, 6);
        html += rankCard(zh ? "工具调用" : "Tool Calls", snap.topTools, 6);
        html += rankCard(zh ? "命令执行" : "Commands", snap.topPrograms, 6);
        html += '</div>';

        // Sessions list
        var q = search.trim().toLowerCase();
        var sessList = (snap.sessions || []).filter(function (s) {
          if (dayFilter) {
            // 按本地自然日筛，与热力图格子同口径（zusage.py insights_json 的日桶按本地时间）：
            // toISOString 是 UTC 日期，UTC+8 下本地 0–8 点更新的会话会被算进前一天。updatedAt 非法
            // （缺失或不是时间）的会话不匹配任何日筛选——不能让一次 RangeError 把整页渲染打断
            var t = new Date(s.updatedAt).getTime();
            if (!isFinite(t)) return false;
            var da = new Date(t), mo = da.getMonth() + 1, dd = da.getDate();
            var ds = da.getFullYear() + "-" + (mo < 10 ? "0" : "") + mo + "-" + (dd < 10 ? "0" : "") + dd;
            if (ds !== dayFilter) return false;
          }
          if (!q) return true;
          return ((s.title || "") + " " + (s.directory || "") + " " + (s.id || "")).toLowerCase().indexOf(q) >= 0;
        }).slice();
        if (sortBy === "tokens") sessList.sort(function (a, b) { return (b.tokens || 0) - (a.tokens || 0); });
        else if (sortBy === "context") sessList.sort(function (a, b) { return (b.lastContext || 0) - (a.lastContext || 0); });

        html += '<div class="card"><div class="card-h"><span>' + (zh ? "会话" : "Sessions") + ' (' + sessList.length + ')</span>' +
          (toast ? '<span class="num">' + esc(toast) + '</span>' : '') + '</div>' +
          '<div class="toolbar">' +
          '<input class="input" id="sSearch" placeholder="' + (zh ? "搜索标题 / 目录 / ID…" : "Search title / path / ID…") + '" value="' + esc(search) + '">' +
          '<button class="pill ' + (sortBy === "updated" ? "on" : "") + '" data-sort="updated">' + (zh ? "最近更新" : "Recent") + '</button>' +
          '<button class="pill ' + (sortBy === "tokens" ? "on" : "") + '" data-sort="tokens">' + (zh ? "Token 总用量" : "Tokens") + '</button>' +
          '<button class="pill ' + (sortBy === "context" ? "on" : "") + '" data-sort="context">' + (zh ? "当前 Context" : "Context") + '</button>' +
          '</div>' +
          '<div class="sess-grid">' +
          (sessList.slice(0, 60).map(function (s) {
            // 两种分隔符都认：会话目录原样来自库，Windows 下是反斜杠路径（只按 / 切会让每个会话的项目名都是整条路径）
            var proj = (s.directory || "").split(/[\\/]+/).filter(Boolean).pop() || s.id.slice(0, 10);
            var ctxPct = Math.min(100, Math.round(((s.lastContext || 0) / 1000000) * 100));
            return '<div class="sess-card" data-sid="' + esc(s.id) + '">' +
              '<div class="sess-top"><span>' + esc(s.title) + '</span><span class="num">' + fmtAgo(s.updatedAt, zh) + '</span></div>' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><span class="sess-proj">' + esc(proj) + '</span>' +
              (s.tps ? '<span class="tps-badge">' + s.tps + ' tok/s</span>' : '') + '</div>' +
              '<div class="sess-body">' +
              svgDonut([{ v: ctxPct, c: "#3b82f6" }, { v: Math.max(0, 100 - ctxPct), c: "rgba(128,128,128,.16)" }], fmtCompact(s.lastContext || 0, zh), ctxPct + "%") +
              '<div class="sess-stats">' +
              '<div class="sess-line"><span class="num">' + (zh ? "轮次/步数" : "Turns/Steps") + '</span><span>' + (s.turns || 0) + ' / ' + (s.steps || 0) + '</span></div>' +
              '<div class="sess-line"><span class="num">' + (zh ? "Token 总用量" : "Total Tokens") + '</span><span>' + fmtCompact(s.tokens, zh) + '</span></div>' +
              '<div class="sess-line"><span class="num">' + (zh ? "总预估费用" : "Est. Cost") + '</span><span>' + fmtCost(s.costUsd, k.fx) + '</span></div>' +
              '<div class="sess-line"><span class="num">' + (zh ? "起止时间" : "Period") + '</span><span>' + fmtSpan(s.createdAt, s.endTime || s.updatedAt) + '</span></div>' +
              '</div></div></div>';
          }).join("") || '<div class="empty">' + (zh ? "无匹配会话" : "No matching sessions") + '</div>') +
          '</div></div>';

        el.innerHTML = html;

        var sInput = document.getElementById("sSearch");
        if (sInput) sInput.oninput = function () { search = sInput.value || ""; render(); var ns = document.getElementById("sSearch"); if (ns) { ns.focus(); ns.setSelectionRange(search.length, search.length); } };
        var clr = document.getElementById("clrDay");
        if (clr) clr.onclick = function () { dayFilter = ""; render(); };
        el.querySelectorAll("[data-hday]").forEach(function (c) {
          c.onclick = function () { var d = c.getAttribute("data-hday") || ""; dayFilter = dayFilter === d ? "" : d; render(); };
        });
        el.querySelectorAll("[data-hmode]").forEach(function (b) {
          b.onclick = function () { heatMode = b.getAttribute("data-hmode") || "tokens"; render(); };
        });
        document.querySelectorAll("[data-split]").forEach(function (b) {
          b.onclick = function () { splitMode = b.getAttribute("data-split") || "all"; render(); };
        });
        el.querySelectorAll("[data-sort]").forEach(function (b) {
          b.onclick = function () { sortBy = b.getAttribute("data-sort") || "updated"; render(); };
        });
        el.querySelectorAll("[data-sid]").forEach(function (card) {
          card.onclick = async function () {
            var sid = card.getAttribute("data-sid") || "";
            if (!sid) return;
            try {
              var res = await window.zcode.callTool("insights_open_session", { sessionId: sid });
              var r = res && (res.structuredContent || res);
              if (typeof r === "string") r = JSON.parse(r);
              if (r && r.ok) return;
            } catch { /* ignore */ }
            toast = (zh ? "会话 ID: " : "Session: ") + sid.slice(0, 16);
            render();
          };
        });
      }

      async function refresh() {
        var mySeq = ++reqSeq;
        var el = document.getElementById("content");
        if (el) el.classList.add("loading");
        try {
          var res = await window.zcode.callTool("insights_snapshot", { days: days });
          if (mySeq !== reqSeq) return;
          snap = res && (res.structuredContent || res);
          if (typeof snap === "string") snap = JSON.parse(snap);
          render();
        } catch {
          if (mySeq === reqSeq) render();
        } finally {
          if (el) el.classList.remove("loading");
        }
      }

      document.querySelectorAll("[data-days]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var nd = Number(btn.getAttribute("data-days"));
          if (Number.isNaN(nd)) return;
          days = nd;
          document.querySelectorAll("[data-days]").forEach(function (b) {
            b.classList.toggle("on", Number(b.getAttribute("data-days")) === days);
          });
          void refresh();
        });
      });

      window.zcode.ready().then(function () {
        applyTheme(window.zcode.hostContext);
        window.zcode.subscribe(function (ctx) { applyTheme(ctx); });
        window.zcode.onResourceUpdated(function (uri) {
          if (!uri || uri === STATE_URI) void refresh();
        });
        if (window.zcode.subscribeResource) {
          void window.zcode.subscribeResource(STATE_URI);
        }
        void refresh();
      });
    })();
  </script>
</body>
</html>
