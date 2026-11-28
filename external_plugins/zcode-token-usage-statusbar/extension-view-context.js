<!--
  扩展视图页面（Context 上下文组成）。宿主按纯文本读取本文件作为沙箱页面内容（view entry）。
  文件放在插件顶层、用 .js 后缀，是因为在野旧版解包器只放行顶层 .py/.cjs/.js 与
  hooks/*.py、commands/*.md、skills/…，新建子目录或 .html 会让旧版用户无法自动更新。
  本文件不是 JavaScript：不要对它做语法检查，也不要当作脚本加载。
-->
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Context</title>
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
      --warn: #f59e0b;
      --err: #ef4444;
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
      margin: 0; padding: 12px 14px 24px; background: var(--bg); color: var(--fg);
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .hdr { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .title { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); white-space: nowrap; }
    .tps-badge { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; background: rgba(16,185,129,.14); color: #10b981; font-weight: 600; white-space: nowrap; }
    .tabs { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
    .tab {
      padding: 4px 10px; border-radius: 8px; border: 1px solid var(--border);
      background: transparent; color: var(--muted); font-size: 12px; cursor: pointer;
    }
    .tab.active { color: var(--fg); background: var(--card); border-color: var(--accent); font-weight: 600; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 11px; margin-bottom: 10px; min-width: 0; }
    .card-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; font-weight: 600; font-size: 12.5px; min-width: 0; }
    .card-h > span:first-child { white-space: nowrap; flex: 0 0 auto; }
    .card-h > .num { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .kpi-5 { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 7px; margin-bottom: 8px; }
    .kpi { background: var(--card2); border: 1px solid var(--border); border-radius: 8px; padding: 7px 9px; min-width: 0; }
    .kpi-k { font-size: 10.5px; color: var(--muted); }
    .kpi-v { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; }
    .stats-sub { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; border-top: 1px solid var(--border); padding-top: 8px; font-size: 11.5px; }
    .sub-blk-h { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 4px; color: var(--fg); }
    .pills-inline { display: flex; flex-wrap: wrap; gap: 4px; }
    .mini-pill { font-size: 10.5px; padding: 1px 6px; border-radius: 5px; border: 1px solid var(--border); background: var(--card2); color: var(--muted); white-space: nowrap; }
    .donut-wrap { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .donut-box { position: relative; width: 76px; height: 76px; flex: 0 0 76px; }
    .donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; pointer-events: none; }
    .donut-v { font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .donut-k { font-size: 9.5px; color: var(--muted); }
    .leg-grid { flex: 1 1 180px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 10px; font-size: 11px; }
    .leg-item { display: flex; justify-content: space-between; align-items: center; gap: 4px; min-width: 0; }
    .leg-l { display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; }
    .leg-l span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar { display: flex; height: 9px; border-radius: 999px; overflow: hidden; background: rgba(128,128,128,.16); margin: 6px 0 10px; }
    .seg { height: 100%; min-width: 2px; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 11.5px; }
    .row:last-child { border-bottom: none; }
    .row-l { display: flex; align-items: center; gap: 7px; min-width: 0; overflow: hidden; }
    .row-l span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 7px; }
    .num { font-variant-numeric: tabular-nums; color: var(--muted); white-space: nowrap; }
    .sub-items { margin: 4px 0 6px 15px; padding-left: 8px; border-left: 2px solid var(--border); font-size: 11px; color: var(--muted); }
    .sub-item { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; padding: 3px 0; min-width: 0; }
    .sub-item-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
    .sub-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); }
    .ws-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 8px; margin-bottom: 8px; border-radius: 7px; background: var(--card2); border: 1px solid var(--border); font-size: 11px; min-width: 0; }
    .cat-paths { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 4px 0 5px 15px; }
    .path-link {
      display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0;
      padding: 1px 6px; border-radius: 5px; border: 1px solid var(--border);
      background: var(--card2); color: var(--accent); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10.5px; cursor: pointer; text-decoration: none; transition: border-color .12s, background .12s;
    }
    .path-link:hover { border-color: var(--accent); background: rgba(59,130,246,.1); }
    .path-link .path-txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .path-link .open-tag { flex: 0 0 auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 10px; opacity: 0.85; }
    .mtable { width: 100%; border-collapse: collapse; font-size: 11px; }
    .mtable th { text-align: right; color: var(--muted); font-weight: 500; font-size: 10px; padding: 3px 6px; border-bottom: 1px solid var(--border); white-space: nowrap; }
    .mtable th:first-child, .mtable td:first-child { text-align: left; }
    .mtable td { text-align: right; padding: 4px 6px; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .mtable tr:last-child td { border-bottom: none; }
    .mtable td.m-name { max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
    .mtable td.m-empty { color: var(--muted); }
    .est-box { margin-top: 8px; border-top: 1px dashed var(--border); padding-top: 6px; }
    .est-box > summary { font-size: 11px; color: var(--muted); }
    .qrow { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px; padding: 2px 0; flex-wrap: wrap; }
    .qrow .num { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .qbar { height: 3px; border-radius: 2px; background: rgba(128,128,128,.18); margin: 1px 0 4px; overflow: hidden; }
    .qbar > i { display: block; height: 100%; }
    .qfoot { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); font-size: 11px; color: var(--muted); }
    .warn { color: var(--warn, #f59e0b); }
    .cap-note { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 11px; color: var(--muted); }
    .cap-note .chip { flex: 0 0 auto; }
    .tscroll { overflow-x: auto; }
    .ttable { font-size: 10.5px; }
    .ttable tbody tr { cursor: pointer; }
    .ttable tbody tr:hover td, .ttable tr.sel td { background: rgba(59,130,246,.1); }
    .toast {
      position: fixed; right: 14px; bottom: 14px; padding: 6px 11px; border-radius: 8px;
      background: var(--card); border: 1px solid var(--accent); color: var(--fg);
      font-size: 11.5px; box-shadow: 0 4px 14px rgba(0,0,0,.22); opacity: 0; pointer-events: none; transition: opacity .15s; z-index: 99;
    }
    .toast.show { opacity: 1; }
    details > summary { cursor: pointer; list-style: none; }
    details > summary::-webkit-details-marker { display: none; }
    .timeline-wrap { display: flex; align-items: flex-end; gap: 3px; height: 92px; overflow-x: auto; padding: 6px 2px 2px; border-bottom: 1px solid var(--border); }
    .tbar {
      flex: 0 0 13px; display: flex; flex-direction: column; justify-content: flex-end;
      cursor: pointer; border-radius: 3px 3px 0 0; opacity: 0.85; min-height: 4px; background: var(--accent);
    }
    .tbar:hover, .tbar.sel { opacity: 1; outline: 2px solid var(--fg); }
    .tbar.delta-neg { background: var(--ok); }
    .toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .input {
      flex: 1 1 160px; height: 28px; padding: 0 8px; border-radius: 7px;
      border: 1px solid var(--border); background: var(--bg); color: var(--fg); font: inherit; font-size: 11.5px;
    }
    .chip {
      padding: 3px 8px; border-radius: 999px; border: 1px solid var(--border);
      background: transparent; color: var(--muted); font-size: 11px; cursor: pointer;
    }
    .chip.on { background: var(--accent); color: #fff; border-color: var(--accent); }
    .msg-card { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; background: var(--card2); }
    .msg-hdr { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); margin-bottom: 4px; flex-wrap: wrap; }
    .role-tag { font-weight: 600; color: var(--fg); text-transform: uppercase; font-size: 10px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border); }
    .part-box { margin-top: 5px; border-top: 1px dashed var(--border); padding-top: 5px; }
    pre {
      margin: 4px 0 0; padding: 8px; border-radius: 6px; background: rgba(0,0,0,.18);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
      white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto;
    }
    html[data-theme="light"] pre { background: rgba(0,0,0,.05); }
    .empty { color: var(--muted); text-align: center; padding: 22px 12px; }
  </style>
</head>
<body>
  <div class="hdr">
    <div class="title" id="tTitle">Context 上下文仪表板</div>
    <span class="badge" id="tBadge">加载中…</span>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="stats" id="tabStats">Stats &amp; 构成</button>
    <button class="tab" data-tab="browser" id="tabBrowser">上下文浏览器</button>
    <button class="tab" data-tab="events" id="tabEvents">事件 &amp; 活动</button>
  </div>
  <div id="content"><div class="card"><div class="empty">正在读取当前会话上下文…</div></div></div>
  <div id="toast" class="toast"></div>

  <script>
    (function () {
      var STATE_URI = "ui://zcode-token-usage-statusbar/context/state";
      var CAT_COLORS = {
        system_prompt: "#6366f1", meta_user_context: "#8b5cf6", skills: "#ec4899",
        tool_prompt: "#f59e0b", system_tool_schemas: "#10b981", mcp_tool_schemas: "#06b6d4",
        app_tool_schemas: "#14b8a6", deferred_tool_schemas: "#84cc16", reminders: "#eab308",
        compact_summary: "#f97316", messages: "#3b82f6"
      };
      var CAT_LABELS = {
        zh: {
          system_prompt: "系统提示词", meta_user_context: "元上下文(规则/记忆)", skills: "技能注入",
          tool_prompt: "工具提示词", system_tool_schemas: "内置工具定义", mcp_tool_schemas: "MCP 工具定义",
          app_tool_schemas: "页面工具定义", deferred_tool_schemas: "延迟工具定义",
          reminders: "系统提醒", compact_summary: "压缩摘要", messages: "对话消息与结果"
        },
        en: {
          system_prompt: "System prompt", meta_user_context: "Meta context", skills: "Skills",
          tool_prompt: "Tool prompt", system_tool_schemas: "System tools", mcp_tool_schemas: "MCP tools",
          app_tool_schemas: "App tools", deferred_tool_schemas: "Deferred tools",
          reminders: "Reminders", compact_summary: "Compact summary", messages: "Messages"
        }
      };
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

      var activeTab = "stats";
      var lastRenderedCtx = "";   // 上一次实际渲染的「分段|会话|逐轮模式」：三者都没变才保留滚动位置，否则回顶
      var lastSnap = null;
      var lastBrowser = null;
      var browserLoadedKey = "";   // "<会话id>|<轮号>"：会话或逐轮切换时丢弃迟到载荷
      var olderPages = [];         // 「加载更多」按游标取到的更老页（流式新增不影响已加载页）
      var browserTurn = "";        // 非空=逐轮模式（只看该轮消息，时间正序）
      var loadingMore = false;
      var captureBusy = false;
      var pagingStale = false;   // 对端没认 before 游标（返回的还是同一页）：扩展进程仍是旧版
      var turnStale = false;     // 对端没认 turnId：同上
      var timelineMode = "total";
      var pinnedStep = null;
      var filterQuery = "";
      var kindFilter = "all";
      var openCats = {};
      var toastTimer = null;
      var inflight = false;
      var pending = false;

      function isZh(locale) { return !locale || String(locale).toLowerCase().indexOf("zh") === 0; }
      function applyTheme(ctx) {
        if (ctx && ctx.theme) document.documentElement.dataset.theme = ctx.theme === "dark" ? "dark" : "light";
      }
      function esc(s) {
        return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      }
      function shortPath(p, homeDir) {
        if (!p) return "";
        var s = String(p);
        if (homeDir && s.indexOf(homeDir) === 0) {
          var rest = s.slice(homeDir.length);
          if (!rest || rest.charAt(0) === "/" || rest.charAt(0) === "\\") return "~" + rest;
        }
        return s;
      }
      function baseName(p) {
        var s = String(p || "").replace(/[\\/]+$/, "");
        var idx = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
        return idx >= 0 ? s.slice(idx + 1) : s;
      }
      function pathBtnHtml(displayText, fullPath, zh) {
        if (!fullPath) return "";
        var openTxt = "↗";
        return '<button type="button" class="path-link" data-open-path="' + esc(fullPath) + '" title="' + esc(fullPath) + '">' +
          '<span class="path-txt">' + esc(displayText) + '</span>' +
          '<span class="open-tag">' + openTxt + '</span></button>';
      }
      function showToast(msg) {
        var t = document.getElementById("toast");
        if (!t) return;
        t.textContent = msg;
        t.classList.add("show");
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
      }
      async function openFolder(targetPath, zh) {
        if (!targetPath) return;
        try {
          var res = await window.zcode.callTool("context_open_folder", { path: targetPath });
          var d = res && (res.structuredContent || res);
          if (typeof d === "string") { try { d = JSON.parse(d); } catch {} }
          if (d && d.ok) {
            showToast(zh ? "已在文件管理器中打开" : "Opened in file manager");
          } else {
            showToast((zh ? "打开失败: " : "Open failed: ") + ((d && d.error) || "unavailable"));
          }
        } catch (e) {
          showToast(zh ? "打开文件夹失败" : "Failed to open folder");
        }
      }
      function fmtNum(n) { return typeof n === "number" ? n.toLocaleString() : "-"; }
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
        if (typeof fx === "number" && fx > 0) return "¥" + (usd * fx).toFixed(4);
        return "$" + usd.toFixed(4);
      }
      function fmtMs(ms) {
        if (typeof ms !== "number" || ms <= 0) return "0s";
        if (ms < 1000) return ms + "ms";
        var s = ms / 1000;
        if (s < 60) return s.toFixed(1) + "s";
        var m = Math.floor(s / 60), rs = Math.round(s % 60);
        return m + "m" + rs + "s";
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
      function fmtDateTime(ts) {
        if (!ts) return "—";
        var d = new Date(ts);
        var p = function (n) { return (n < 10 ? "0" : "") + n; };
        return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
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
      function compactionRowHtml(c, zh) {
        return '<div class="qrow"><span>' + esc(fmtDateTime(c.time)) + '</span>' +
          '<span class="num">' + fmtCompact(c.preTokens, zh) + ' → <b style="color:var(--fg)">' + fmtCompact(c.postTokens, zh) + '</b>' +
          (c.preTokens > 0 && c.postTokens < c.preTokens ? ' <span class="warn">-' + pctOf(c.preTokens - c.postTokens, c.preTokens) + '</span>' : '') +
          (c.willRetrigger ? ' <span class="warn">' + (zh ? "下轮再压缩" : "retrigger") + '</span>' : '') + '</span></div>' +
          '<div style="font-size:10.5px;color:var(--muted)">' + (c.auto ? (zh ? "自动" : "auto") : (zh ? "手动" : "manual")) + (c.trigger ? ' · ' + esc(c.trigger) : '') +
          (c.summarized ? ' · ' + (zh ? "摘要 " : "summarized ") + c.summarized + (zh ? " 条" : "") : '') + '</div>';
      }
      function qualityHtml(err, tq, zh) {
        var e = err || {};
        var types = Object.keys(e.byType || {}).map(function (t) { return { t: t, n: e.byType[t] }; }).sort(function (a, b) { return b.n - a.n; });
        var mx = types.length ? types[0].n : 1;
        var q = tq || {};
        function row(l, v) { return '<div class="qrow"><span>' + l + '</span><span class="num">' + v + '</span></div>'; }
        return '<div class="card"><div class="card-h"><span>' + (zh ? "错误与重试" : "Errors & Retries") + '</span><span class="num">' + (e.failedAttempts || 0) + ' / ' + (e.requests || 0) + '</span></div>' +
          (types.length ? types.map(function (x) {
            return '<div class="qrow"><span>' + esc(errLabel(x.t, zh)) + '</span><span class="num">' + x.n + ' · ' + pctOf(x.n, e.requests) + '</span></div>' +
              '<div class="qbar"><i style="width:' + Math.max(4, Math.round(x.n / mx * 100)) + '%;background:var(--err)"></i></div>';
          }).join("") : '<div class="empty">' + (zh ? "本会话没有失败尝试" : "No failed attempts in this session") + '</div>') +
          '<div class="qfoot">' + (zh ? "最终失败 " : "Failed ") + '<b>' + (e.failed || 0) + '</b>' + (zh ? " · 取消 " : " · Cancelled ") + '<b>' + (e.cancelled || 0) + '</b>' + (zh ? " · 重试 " : " · Retries ") + '<b>' + (e.retries || 0) + '</b></div></div>' +
          '<div class="card"><div class="card-h"><span>' + (zh ? "工具质量" : "Tool Quality") + '</span><span class="num">' + (q.total || 0) + (zh ? " 次调用" : " calls") + '</span></div>' +
          row(zh ? "错误状态" : "Error status", (q.errorStatus || 0) + ' · ' + pctOf(q.errorStatus, q.total)) +
          row(zh ? "非零退出" : "Non-zero exit", (q.nonZeroExit || 0) + ' · ' + pctOf(q.nonZeroExit, q.total)) +
          (q.truncated ? row(zh ? "输出被截断" : "Truncated", q.truncated) : '') +
          row(zh ? "只读占比" : "Read-only", pctOf(q.readOnly, q.total)) +
          (q.destructive ? row(zh ? "破坏性操作" : "Destructive", q.destructive) : '') +
          row(zh ? "耗时 P50 / P95" : "P50 / P95", fmtMs(q.p50Ms) + ' / ' + fmtMs(q.p95Ms)) + '</div>';
      }
      function turnsHtml(turns, zh, activeTurn) {
        var arr = turns || [];
        if (!arr.length) return "";
        var rows = arr.slice().reverse().map(function (t) {
          var bad = t.status && t.status !== "completed";
          return '<tr class="' + (activeTurn === t.turnId ? "sel" : "") + '" data-turn="' + esc(t.turnId) + '">' +
            '<td>#' + t.n + '</td><td>' + esc(fmtDateTime(t.startedAt)) + '</td><td>' + fmtMs(t.durationMs) + '</td>' +
            '<td>' + t.requests + (t.retries ? ' <span class="warn">+' + t.retries + (zh ? " 重试" : " retries") + '</span>' : '') + '</td>' +
            '<td>' + t.toolCalls + (t.toolErrors ? ' <span class="warn">-' + t.toolErrors + '</span>' : '') + '</td>' +
            '<td>' + fmtCompact(t.inputTokens, zh) + ' / ' + fmtCompact(t.outputTokens, zh) + '</td>' +
            '<td' + (bad || t.cancelled ? ' class="warn"' : '') + '>' + esc(t.cancelled ? (zh ? "已取消" : "cancelled") : (t.errorType || t.status || "—")) + '</td></tr>';
        }).join("");
        return '<div class="card"><div class="card-h"><span>' + (zh ? "逐轮" : "Turns") + '</span><span class="num">' + arr.length + (zh ? " 轮 · 点击一行看该轮消息" : " turns · click a row to open") + '</span></div>' +
          '<div class="tscroll"><table class="mtable ttable"><thead><tr><th>#</th><th>' + (zh ? "开始" : "Start") + '</th><th>' + (zh ? "耗时" : "Duration") + '</th><th>' + (zh ? "请求" : "Reqs") + '</th><th>' + (zh ? "工具" : "Tools") + '</th><th>Token in / out</th><th>' + (zh ? "状态" : "Status") + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
      }
      function modelTableRows(list, zh, fx) {
        var arr = Array.isArray(list) ? list : [];
        if (!arr.length) return '<tr><td colspan="5" class="m-empty">-</td></tr>';
        return arr.map(function (m) {
          return '<tr>' +
            '<td class="m-name" title="' + esc((m.model || "") + (m.provider ? " · " + m.provider : "")) + '">' + esc(m.model || "unknown") + '</td>' +
            '<td>' + fmtCompact(m.tokens, zh) + '</td>' +
            '<td>' + (m.requests || 0) + '</td>' +
            '<td>' + (m.avgTps > 0 ? m.avgTps + " t/s" : "—") + '</td>' +
            '<td>' + fmtCost(m.costUsd, fx) + '</td></tr>';
        }).join("");
      }
      function renderStatsTab(snap, zh) {
        var html = "";
        var st = snap.stats;
        if (st && st.ok) {
          var k = st.kpi, tm = st.timing, io = st.inputOutput || {}, ev = k.contextEvents || {};
          // 1. Context Stats card (dsh-context parity)
          html += '<div class="card"><div class="card-h"><span>Context Stats</span></div>' +
            '<div class="kpi-5">' +
            '<div class="kpi"><div class="kpi-k">' + (zh ? "轮次 Turns" : "Turns") + '</div><div class="kpi-v">' + k.turns + '</div></div>' +
            '<div class="kpi"><div class="kpi-k">' + (zh ? "步数 Steps" : "Steps") + '</div><div class="kpi-v">' + k.steps + '</div></div>' +
            '<div class="kpi"><div class="kpi-k">' + (zh ? "技能加载" : "Skill Loads") + '</div><div class="kpi-v">' + (k.skillLoads || 0) + '</div></div>' +
            '<div class="kpi"><div class="kpi-k">' + (zh ? "回复 Answers" : "Answers") + '</div><div class="kpi-v">' + (k.answers || 0) + '</div></div>' +
            '<div class="kpi"><div class="kpi-k">' + (zh ? "事件 Inject/Cmp" : "Events") + '</div><div class="kpi-v">' + (ev.inject || 0) + ' / ' + (ev.compact || 0) + '</div></div>' +
            '</div>' +
            '<div class="stats-sub">' +
            '<div><div class="sub-blk-h"><span>' + (zh ? "输入 / 输出" : "Input / Output") + '</span><span class="num">' + ((io.user || 0) + (io.read || 0) + (io.write || 0) + (io.search || 0)) + '</span></div>' +
            '<div class="pills-inline">' +
            '<span class="mini-pill">User ' + (io.user || 0) + '</span>' +
            '<span class="mini-pill">Read ' + (io.read || 0) + '</span>' +
            '<span class="mini-pill">Write ' + (io.write || 0) + '</span>' +
            '<span class="mini-pill">Search ' + (io.search || 0) + '</span>' +
            (io.images ? '<span class="mini-pill">Images ' + io.images + '</span>' : '') +
            '</div></div>' +
            '<div><div class="sub-blk-h"><span>' + (zh ? "工具调用" : "Tool Calls") + '</span><span class="num">' + k.toolCalls + (k.toolErrors ? ' (' + k.toolErrors + ' err)' : '') + '</span></div>' +
            '<div class="pills-inline">' +
            ((st.tools || []).slice(0, 5).map(function (t) {
              return '<span class="mini-pill">' + esc(t.name) + ' ' + t.count + '</span>';
            }).join("") || '<span class="mini-pill">-</span>') +
            '</div></div>' +
            '<div><div class="sub-blk-h"><span>' + (zh ? "命令执行" : "Commands") + '</span><span class="num">' + (st.commandPrograms || []).reduce(function (s, x) { return s + x.count; }, 0) + '</span></div>' +
            '<div class="pills-inline">' +
            ((st.commandPrograms || []).slice(0, 5).map(function (c) {
              return '<span class="mini-pill">' + esc(c.program) + ' ' + c.count + '</span>';
            }).join("") || '<span class="mini-pill">-</span>') +
            '</div></div>' +
            '<div><div class="sub-blk-h"><span>Fleet</span><span class="num">' + fmtCompact(k.billedTokens, zh) + ' · ' + fmtCost(k.costUsd, k.fx) + '</span></div>' +
            '<div class="pills-inline">' +
            '<span class="mini-pill">' + (zh ? "当前 Agent " : "Self ") + (k.tps || 0) + ' tok/s</span>' +
            '<span class="mini-pill">' + (zh ? "子代理 " : "Subagents ") + ((st.fleet && st.fleet.subagents) ? st.fleet.subagents.length : 0) + '</span>' +
            '</div></div>' +
            '</div></div>';

          // 2. Token Stats：实测五分（缓存读写是 input 的子集）+ 折叠的估算八分类
          html += '<div class="card"><div class="card-h"><span>Token Stats（' + (zh ? "实测" : "measured") + '）</span><span class="num">Cache Hit ' + k.cacheHitRate + '% · ' + fmtCost(k.costUsd, k.fx) + '</span></div>' +
            splitDonutHtml(st.tokenSplit, k.billedTokens, zh) + estimateDetailsHtml(st.tokenBreakdown, st.tokenBreakdownBasis, zh) + '</div>';

          // 2.5 Model detail table (Token ↓ / Requests / Avg t/s / Est. cost)
          html += '<div class="card"><div class="card-h"><span>' + (zh ? "模型明细" : "Models") + '</span><span class="num">' + (st.models || []).length + '</span></div>' +
            '<table class="mtable"><thead><tr><th>' + (zh ? "模型明细" : "Models") + '</th><th>' + (zh ? "Token 用量 ↓" : "Tokens ↓") + '</th><th>' + (zh ? "请求次数" : "Requests") + '</th><th>' + (zh ? "平均速度" : "Avg t/s") + '</th><th>' + (zh ? "预估费用" : "Est. Cost") + '</th></tr></thead><tbody>' +
            modelTableRows(st.models, zh, k.fx) + '</tbody></table></div>';

          // 3. Timing Stats：实测三段（每行 dur = ttft + gen，三段相加即总活跃时长）
          var tmSegs = [
            { l: zh ? "首字等待" : "TTFT", v: tm.ttftMs || 0, c: "#3b82f6" },
            { l: zh ? "模型生成" : "Generation", v: tm.genMs || 0, c: "#10b981" },
            { l: zh ? "工具执行" : "Tool runs", v: tm.toolRunsMs || 0, c: "#f59e0b" }
          ];
          var tmTot = tmSegs.reduce(function (s, x) { return s + x.v; }, 0) || 1;
          html += '<div class="card"><div class="card-h"><span>Timing Stats（' + (zh ? "实测" : "measured") + '）</span><span class="tps-badge">TPS ' + (tm.tps || 0) + ' tok/s</span></div>' +
            '<div class="donut-wrap">' + svgDonut(tmSegs, fmtMs(tm.totalDurationMs), "Active") +
            '<div class="leg-grid">' + tmSegs.map(function (x) {
              return '<div class="leg-item"><span class="leg-l"><span class="dot" style="background:' + x.c + '"></span><span>' + esc(x.l) + '</span></span>' +
                '<span class="num">' + fmtMs(x.v) + ' · ' + ((x.v / tmTot) * 100).toFixed(1) + '%</span></div>';
            }).join("") + '</div></div>' +
            '<div class="bar" style="margin-top:8px;margin-bottom:0">' + tmSegs.map(function (x) {
              return '<div class="seg" style="width:' + ((x.v / tmTot) * 100).toFixed(2) + '%;background:' + x.c + '"></div>';
            }).join("") + '</div>' +
            '<div class="qfoot">' + (zh ? "平均首字 " : "Avg TTFT ") + fmtMs(tm.avgTtftMs) + '</div></div>';

          // 4. 压缩记录 / 错误与重试 + 工具质量 / 逐轮
          var cps = st.compactions || [];
          html += '<div class="card"><div class="card-h"><span>' + (zh ? "压缩记录" : "Compactions") + '</span><span class="num">' + cps.length + (zh ? " 次" : "") + '</span></div>' +
            (cps.length ? cps.slice().reverse().map(function (c) { return compactionRowHtml(c, zh); }).join("")
              : '<div class="empty">' + (zh ? "本会话没有压缩记录" : "No compactions in this session") + '</div>') + '</div>';
          html += qualityHtml(st.errors, st.toolQuality, zh);
          html += turnsHtml(st.turns, zh, browserTurn);
        }

        if (snap.composition) {
          var c = snap.composition;
          var cp = snap.contextPaths || {};
          var homeDir = cp.homeDir || "";
          var wsDir = cp.workspaceDir || (st && st.session && st.session.directory) || "";
          var used = typeof c.providerContextTokens === "number" ? c.providerContextTokens : (typeof c.providerInputTokens === "number" ? c.providerInputTokens : c.estimatedTokens);
          var win = c.model && c.model.contextWindow ? c.model.contextWindow : 0;
          var pct = win > 0 ? Math.min(100, (used / win) * 100).toFixed(1) + "%" : "-";
          var cats = Array.isArray(c.categories) ? c.categories.slice().sort(function (a, b) { return b.tokens - a.tokens; }) : [];
          var totalCatTok = cats.reduce(function (s, x) { return s + (x.tokens || 0); }, 0) || 1;
          var labels = zh ? CAT_LABELS.zh : CAT_LABELS.en;
          html += '<div class="card"><div class="card-h"><span>Current Context</span><span class="num">' + fmtCompact(used, zh) + (win > 0 ? ' / ' + fmtCompact(win, zh) + ' (' + pct + ')' : '') + '</span></div>' +
            '<div class="bar">' + cats.map(function (cat) {
              return '<div class="seg" style="width:' + ((cat.tokens / totalCatTok) * 100).toFixed(2) + '%;background:' + (CAT_COLORS[cat.id] || "#64748b") + '"></div>';
            }).join("") + '</div>' +
            (wsDir ? '<div class="ws-bar"><span style="color:var(--muted);white-space:nowrap">' + (zh ? "工作区目录" : "Workspace") + '</span>' + pathBtnHtml(shortPath(wsDir, homeDir), wsDir, zh) + '</div>' : '') +
            cats.map(function (cat) {
              var p = ((cat.tokens / totalCatTok) * 100).toFixed(1) + "%";
              var itemMap = (cp.itemPaths && cp.itemPaths[cat.id]) || {};
              var catPathList = (cp.categories && cp.categories[cat.id]) || [];
              var shownItemPaths = {};
              var items = Array.isArray(cat.items) ? cat.items : [];
              items.forEach(function (it) { if (it && itemMap[it.name]) shownItemPaths[itemMap[it.name]] = 1; });
              var extraCatPaths = catPathList.filter(function (x) { return x && x.path && !shownItemPaths[x.path]; });
              var isOpen = openCats[cat.id] !== undefined ? openCats[cat.id] : (cat.id === "meta_user_context" || cat.id === "skills" || cat.id === "mcp_tool_schemas");

              var catPathsHtml = extraCatPaths.length
                ? '<div class="cat-paths">' + extraCatPaths.map(function (xp) {
                    var lbl = (zh ? xp.labelZh : xp.labelEn) + ": " + shortPath(xp.path, homeDir);
                    return pathBtnHtml(lbl, xp.path, zh);
                  }).join("") + '</div>'
                : "";

              var itemsHtml = items.length
                ? '<div class="sub-items">' + items.map(function (it) {
                    var ip = itemMap[it.name] || "";
                    var isRawPath = ip && (it.name === ip || it.name.charAt(0) === "/" || it.name.charAt(0) === "~" || /^[A-Za-z]:[\\/]/.test(it.name));
                    var displayTitle = isRawPath ? baseName(it.name) : it.name;
                    return '<div class="sub-item"><div class="sub-item-main"><span class="sub-item-name" title="' + esc(it.name) + '">' + esc(displayTitle) + '</span>' +
                      (ip ? '<div>' + pathBtnHtml(shortPath(ip, homeDir), ip, zh) + '</div>' : '') +
                      '</div><span class="num">' + fmtNum(it.tokens) + '</span></div>';
                  }).join("") + '</div>'
                : "";
              return '<details data-cat="' + esc(cat.id) + '"' + (isOpen ? ' open' : '') + '><summary class="row"><span class="row-l"><span class="dot" style="background:' + (CAT_COLORS[cat.id] || "#64748b") + '"></span><span>' + esc(labels[cat.id] || cat.id) + '</span></span>' +
                '<span class="num">' + fmtNum(cat.tokens) + ' · ' + p + '</span></summary>' + catPathsHtml + itemsHtml + '</details>';
            }).join("") + '</div>';
        }
        return html || '<div class="card"><div class="empty">' + (zh ? "暂无统计数据" : "No stats available") + '</div></div>';
      }

      function renderBrowserTab(snap, zh) {
        var html = "";
        var st = snap.stats;
        if (st && st.ok && Array.isArray(st.steps) && st.steps.length) {
          var steps = st.steps;
          var vals = steps.map(function (s, idx) {
            if (timelineMode === "delta" && idx > 0) return s.inputTokens - steps[idx - 1].inputTokens;
            return s.inputTokens + s.outputTokens;
          });
          var maxAbs = Math.max.apply(null, vals.map(function (v) { return Math.abs(v); })) || 1;
          html += '<div class="card"><div class="card-h"><span>Context Timeline (' + steps.length + ' steps)</span>' +
            '<div><button class="chip ' + (timelineMode === "total" ? "on" : "") + '" data-tmode="total">Total</button> ' +
            '<button class="chip ' + (timelineMode === "delta" ? "on" : "") + '" data-tmode="delta">Delta</button></div></div>' +
            '<div class="timeline-wrap">' + steps.map(function (s, idx) {
              var v = vals[idx];
              var h = Math.max(4, Math.round((Math.abs(v) / maxAbs) * 80));
              var cls = "tbar" + (v < 0 ? " delta-neg" : "") + (pinnedStep === s.step ? " sel" : "");
              return '<div class="' + cls + '" style="height:' + h + 'px" data-step="' + s.step + '" title="Step #' + s.step + ': ' + fmtNum(v) + ' tok · ' + (s.tps || 0) + ' tok/s"></div>';
            }).join("") + '</div>';
          if (pinnedStep != null) {
            var ps = steps.find(function (x) { return x.step === pinnedStep; });
            if (ps) {
              html += '<div style="margin-top:8px;font-size:11.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
                '<b>Step #' + ps.step + '</b><span>' + esc(ps.modelId) + '</span>' +
                (ps.tps ? '<span class="tps-badge">' + ps.tps + ' tok/s</span>' : '') +
                '<span>in ' + fmtNum(ps.inputTokens) + ' (cache ' + fmtNum(ps.cacheReadTokens) + ') · out ' + fmtNum(ps.outputTokens) + ' · ' + fmtMs(ps.durationMs) + ' (TTFT ' + fmtMs(ps.ttftMs) + ')</span></div>';
            }
          }
          html += '</div>';
        }

        if (!lastBrowser || browserLoadedKey !== browserKey(lastSnap.sessionId)) {
          html += '<div class="card"><div class="empty">' + (zh ? "正在加载会话消息与工具明细…" : "Loading session messages & tools…") + '</div></div>';
          return html;
        }
        if (!lastBrowser.ok) {
          html += '<div class="card"><div class="empty">' + esc(lastBrowser.error || "unavailable") + '</div></div>';
          return html;
        }

        var kinds = [["all", zh ? "全部" : "All"], ["thinking", "Thinking"], ["tools", "Tools"], ["answer", "Answer"], ["user", zh ? "用户" : "User"], ["file", zh ? "文件" : "Files"], ["command", zh ? "命令" : "Commands"], ["event", zh ? "事件" : "Events"]];
        // 首页在前、更老页依次接在后面（显式 push：不依赖 concat 对嵌套数组的展平）
        var allMsgs = [];
        [lastBrowser].concat(olderPages).forEach(function (pg) {
          (pg && pg.messages ? pg.messages : []).forEach(function (mm) { allMsgs.push(mm); });
        });
        html += '<div class="card"><div class="card-h"><span>' + (browserTurn ? (zh ? "逐轮消息" : "Turn messages") : "Context Browser") + '</span><span class="num">' +
          allMsgs.length + ' / ' + lastBrowser.totalMessages + (zh ? " 条消息" : " msgs") + '</span></div>' +
          '<div class="toolbar">' +
          '<input class="input" id="bSearch" placeholder="' + (zh ? "搜索消息、工具名、参数或输出…" : "Search messages, tools, args or output…") + '" value="' + esc(filterQuery) + '">' +
          kinds.map(function (kk) {
            return '<button class="chip ' + (kindFilter === kk[0] ? "on" : "") + '" data-kind="' + kk[0] + '">' + esc(kk[1]) + '</button>';
          }).join("") + '</div>';

        var capOn = !!(lastSnap && lastSnap.capture && lastSnap.capture.enabled);
        function capToggle() {
          return '<button class="chip" id="bCapture"' + (captureBusy ? " disabled" : "") + ' title="' + esc(zh ? "只落 system 与工具 schema（去重存 blobs/），不落消息正文、请求头或凭据" : "Stores only the system prompt and tool schemas (deduplicated); never message bodies, headers or credentials") + '">' +
            (captureBusy ? (zh ? "处理中…" : "Working…") : capOn ? (zh ? "关闭抓包" : "Stop capture") : (zh ? "启用抓包" : "Start capture")) + '</button>';
        }
        if (turnStale) {
          html += '<div class="empty">' + (zh ? "逐轮视图暂不可用：扩展进程还在运行旧版本，重启 ZCode 后生效。" : "Turn view is unavailable: the extension process is still on the old version. Restart ZCode.") +
            '</div><div style="margin-top:8px"><button class="chip on" id="bExitTurn">← ' + (zh ? "返回" : "Back") + '</button></div></div>';
          return html;
        }
        var hasCaps = Array.isArray(lastBrowser.capturedRequests) && lastBrowser.capturedRequests.length > 0;
        html += '<div class="cap-note">' + capToggle() + '<span>' + (capOn
          ? (hasCaps ? "" : (zh ? "抓包已开启，还没有本会话的记录：开关对之后新启动的会话进程生效，发一条消息后再看。"
                                : "Capture is on but nothing recorded for this session yet: the switch applies to session processes started afterwards; send a message and check again."))
          : (zh ? "请求抓包未启用：System Prompt 与工具 schema 原文由 ZCode 动态拼装、不进用量库。启用后新会话的请求会记下原文。"
                : "Request capture is off: the raw system prompt and tool schemas are assembled in memory and never stored. When on, requests from new sessions are recorded.")) +
          '</span></div>';
        if (hasCaps) {
          var caps = lastBrowser.capturedRequests;
          var latestCap = caps[caps.length - 1];
          html += '<details class="msg-card"><summary class="msg-hdr"><span><span class="role-tag">CAPTURED RAW PROMPT</span> ' + esc(latestCap.model || "") + '</span>' +
            '<span>' + caps.length + (zh ? " 条" : " captured") + (latestCap.tools ? ' · ' + latestCap.tools.length + ' tools' : '') + (latestCap.traced ? ' · ' + (zh ? "按 trace 归并" : "joined by trace") : '') + '</span></summary>' +
            (latestCap.system ? '<pre>' + esc(typeof latestCap.system === "string" ? latestCap.system : JSON.stringify(latestCap.system, null, 2)) + '</pre>' : '') +
            '</details>';
        }

        var q = filterQuery.trim().toLowerCase();
        var shown = 0;
        // 默认最新在前（后端 order=desc，数组序即显示序）；逐轮模式时间正序
        for (var i = 0; i < allMsgs.length; i++) {
          var m = allMsgs[i];
          var parts = (m.parts || []).filter(function (p) {
            if (kindFilter === "thinking" && p.type !== "reasoning") return false;
            if (kindFilter === "tools" && p.type !== "tool") return false;
            if (kindFilter === "answer" && !(p.type === "text" && m.role === "assistant")) return false;
            if (kindFilter === "user" && !(p.type === "text" && m.role === "user")) return false;
            if (kindFilter === "file" && !(p.type === "file" || p.cat === "file")) return false;
            if (kindFilter === "command" && p.cat !== "command") return false;
            if (kindFilter === "event" && !(p.type === "compaction" || p.type === "timeline")) return false;
            if (!q) return true;
            var hay = (p.text || "") + " " + (p.toolName || "") + " " + (p.input || "") + " " + (p.output || "");
            return hay.toLowerCase().indexOf(q) >= 0;
          });
          if (!parts.length) continue;
          shown++;
          html += '<div class="msg-card"><div class="msg-hdr"><span><span class="role-tag">' + esc(m.role) + '</span> #' + m.sequence + (m.modelId ? ' · ' + esc(m.modelId) : '') + '</span>' +
            '<span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="num">' + esc(fmtDateTime(m.time)) + '</span>' +
            (m.inputTokens > 0 ? '<span>in ' + fmtCompact(m.inputTokens, zh) + (m.cacheReadTokens > 0 ? ' <span class="num">(cache ' + pctOf(m.cacheReadTokens, m.inputTokens) + ')</span>' : '') + ' · out ' + fmtCompact(m.outputTokens, zh) + '</span>' : '') +
            (m.tps ? '<span class="tps-badge">' + m.tps + ' tok/s</span>' : '') + (m.durationMs ? '<span>' + fmtMs(m.durationMs) + '</span>' : '') + '<span>' + parts.length + ' parts</span></span></div>';
          for (var j = 0; j < parts.length; j++) {
            var pt = parts[j];
            if (pt.type === "text" || pt.type === "reasoning") {
              html += '<details class="part-box"' + (j === 0 && parts.length <= 2 ? ' open' : '') + '><summary>' +
                (pt.type === "reasoning" ? "💭 Thinking" : "💬 Text") + ' <span class="num">(≈' + fmtNum(pt.estTokens) + ' tok)</span></summary>' +
                '<pre>' + esc(pt.text) + '</pre></details>';
            } else if (pt.type === "tool") {
              html += '<details class="part-box"><summary>🔧 <b>' + esc(pt.toolName) + '</b> · ' + esc(pt.status) + ' <span class="num">(≈' + fmtNum(pt.estTokens) + ' tok)</span></summary>' +
                (pt.input ? '<pre>IN: ' + esc(pt.input) + '</pre>' : '') +
                (pt.output ? '<pre>OUT: ' + esc(pt.output) + '</pre>' : '') +
                (pt.error ? '<pre style="color:var(--err)">ERR: ' + esc(pt.error) + '</pre>' : '') +
                '</details>';
            } else if (pt.type === "compaction") {
              html += '<div class="part-box"><span class="role-tag">' + (zh ? "压缩" : "Compaction") + '</span> ' + compactionRowHtml(pt.compaction || { time: pt.time }, zh) + '</div>';
            } else if (pt.type === "timeline") {
              html += '<div class="part-box"><span class="role-tag">' + esc(pt.timelineType || "timeline") + '</span> <span class="num">' + esc(pt.status || "") + ' · ' + esc(fmtDateTime(pt.time)) + '</span></div>';
            }
          }
          html += '</div>';
          if (shown >= 200) break;
        }
        if (shown === 0) html += '<div class="empty">' + (zh ? "没有匹配的记录" : "No matching items") + '</div>';
        if (browserTurn) {
          html += '<div style="margin-top:8px"><button class="chip on" id="bExitTurn">← ' + (zh ? "退出逐轮，回到最新" : "Back to latest") + '</button></div>';
        } else if (pagingStale) {
          html += '<div class="empty">' + (zh ? "翻页暂不可用：扩展进程还在运行旧版本，重启 ZCode 后生效。" : "Paging is unavailable: the extension process is still on the old version. Restart ZCode.") + '</div>';
        } else {
          var tail = olderPages.length ? olderPages[olderPages.length - 1] : lastBrowser;
          if (tail.hasMore) {
            html += '<div style="margin-top:8px;text-align:center"><button class="chip" id="bMore"' + (loadingMore ? " disabled" : "") + '>' +
              (loadingMore ? (zh ? "加载中…" : "Loading…") : (zh ? "加载更早的消息" : "Load older messages")) + '</button></div>';
          }
          if (olderPages.length) html += '<div style="margin-top:6px;text-align:center"><button class="chip" id="bLatest">' + (zh ? "回到最新" : "Back to latest") + '</button></div>';
        }
        html += '</div>';
        return html;
      }

      function renderEventsTab(zh) {
        if (!lastBrowser || !lastBrowser.ok) {
          return '<div class="card"><div class="empty">' + (zh ? "正在加载事件与文件活动…" : "Loading events & activity…") + '</div></div>';
        }
        var html = "";
        var evs = lastBrowser.events || [];
        html += '<div class="card"><div class="card-h"><span>Context Events</span><span class="num">' + evs.length + '</span></div>' +
          (evs.length ? evs.slice().sort(function (a, b) { return (a.time || 0) - (b.time || 0); }).map(function (ev) {
            return '<div class="qrow"><span>' + esc(fmtDateTime(ev.time)) + ' · ' + esc(ev.kind) + '</span><span class="num">' +
              (ev.compaction ? fmtCompact(ev.compaction.preTokens, zh) + ' → ' + fmtCompact(ev.compaction.postTokens, zh) : esc(ev.status)) + '</span></div>';
          }).join("") : '<div class="empty">' + (zh ? "暂无压缩或边界事件" : "No compaction/boundary events") + '</div>') +
          '</div>';

        var files = lastBrowser.fileActivity || [];
        var homeDir = (lastSnap && lastSnap.contextPaths && lastSnap.contextPaths.homeDir) || "";
        html += '<div class="card"><div class="card-h"><span>File Activity</span><span class="num">' + files.length + ' files</span></div>' +
          (files.length ? files.slice(0, 40).map(function (f) {
            return '<div class="row"><span class="row-l">' + pathBtnHtml(shortPath(f.path, homeDir), f.path, zh) + '</span>' +
              '<span class="num">R:' + f.read + ' W:' + f.write + ' S:' + f.search + '</span></div>';
          }).join("") : '<div class="empty">' + (zh ? "暂无文件读写记录" : "No file activity") + '</div>') +
          '</div>';

        var cmds = lastBrowser.commands || [];
        html += '<div class="card"><div class="card-h"><span>Command Executions</span><span class="num">' + cmds.length + '</span></div>' +
          (cmds.length ? cmds.slice(0, 40).map(function (c) {
            return '<div class="row"><span class="row-l"><code>' + esc(c.command) + '</code></span><span class="num">' + esc(c.status) + '</span></div>';
          }).join("") : '<div class="empty">' + (zh ? "暂无命令执行记录" : "No commands") + '</div>') +
          '</div>';
        return html;
      }

      function render() {
        var snap = lastSnap;
        var el = document.getElementById("content");
        var badge = document.getElementById("tBadge");
        var zh = isZh(snap && snap.locale);
        document.getElementById("tTitle").textContent = zh ? "Context 上下文仪表板" : "Context Dashboard";
        document.getElementById("tabStats").textContent = zh ? "Stats & 构成" : "Stats & Composition";
        document.getElementById("tabBrowser").textContent = zh ? "上下文浏览器" : "Context Browser";
        document.getElementById("tabEvents").textContent = zh ? "事件 & 活动" : "Events & Activity";

        if (!snap) {
          badge.textContent = zh ? "加载中" : "Loading";
          return;
        }
        if (snap.status === "no-session") {
          badge.textContent = zh ? "无活动会话" : "No session";
          el.innerHTML = '<div class="card"><div class="empty">' + (zh ? "请先打开或新建一个会话。" : "Open or start a session first.") + '</div></div>';
          return;
        }
        var c = snap.composition;
        badge.textContent = (c && c.model ? c.model.modelId : (snap.sessionId ? snap.sessionId.slice(0, 12) : "")) + (snap.isDraft ? (zh ? " · 草稿" : " · Draft") : "");

        // 整段 innerHTML 重建会把滚动容器换成新节点（时间线横向滚动、页面纵向滚动都回到起点）。
        // 点柱子、切筛选、快照刷新都属于同一分段内的重绘：先把滚动位置记下来，重建后再还回去。
        var ctxKey = activeTab + "|" + (snap.sessionId || "") + "|" + browserTurn;
        var keepScroll = lastRenderedCtx === ctxKey;
        lastRenderedCtx = ctxKey;
        var scroller = document.scrollingElement || document.documentElement;
        var pageTop = keepScroll && scroller ? scroller.scrollTop : 0;
        var oldTl = keepScroll && el.querySelector ? el.querySelector(".timeline-wrap") : null;
        var tlLeft = oldTl ? oldTl.scrollLeft : 0;

        if (activeTab === "stats") el.innerHTML = renderStatsTab(snap, zh);
        else if (activeTab === "browser") el.innerHTML = renderBrowserTab(snap, zh);
        else el.innerHTML = renderEventsTab(zh);

        if (scroller) { try { scroller.scrollTop = keepScroll ? pageTop : 0; } catch (e) { /* 滚动容器只读时忽略 */ } }
        if (tlLeft) {
          var newTl = el.querySelector ? el.querySelector(".timeline-wrap") : null;
          if (newTl) newTl.scrollLeft = tlLeft;
        }

        wireDynamicEvents();
      }

      function wireDynamicEvents() {
        var el = document.getElementById("content");
        var zh = isZh(lastSnap && lastSnap.locale);
        el.querySelectorAll("details[data-cat]").forEach(function (det) {
          det.addEventListener("toggle", function () {
            var cid = det.getAttribute("data-cat");
            if (cid) openCats[cid] = det.open;
          });
        });
        el.querySelectorAll("[data-open-path]").forEach(function (btn) {
          btn.onclick = function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            var p = btn.getAttribute("data-open-path") || "";
            void openFolder(p, zh);
          };
        });
        el.querySelectorAll("[data-tmode]").forEach(function (btn) {
          btn.onclick = function () { timelineMode = btn.getAttribute("data-tmode") || "total"; render(); };
        });
        el.querySelectorAll("[data-step]").forEach(function (bar) {
          bar.onclick = function () {
            var s = Number(bar.getAttribute("data-step"));
            pinnedStep = pinnedStep === s ? null : s;
            render();
          };
        });
        el.querySelectorAll("[data-kind]").forEach(function (chip) {
          chip.onclick = function () { kindFilter = chip.getAttribute("data-kind") || "all"; render(); };
        });
        var search = document.getElementById("bSearch");
        if (search) {
          search.oninput = function () { filterQuery = search.value || ""; render(); var ns = document.getElementById("bSearch"); if (ns) { ns.focus(); ns.setSelectionRange(filterQuery.length, filterQuery.length); } };
        }
        var bCapture = document.getElementById("bCapture");
        if (bCapture) bCapture.onclick = function () {
          captureBusy = true;
          render();
          var turnOn = !(lastSnap && lastSnap.capture && lastSnap.capture.enabled);
          function captureFail() {
            captureBusy = false;
            showToast(zh ? "抓包开关暂不可用：重启 ZCode 后生效" : "Capture switch unavailable until ZCode restarts");
            render();
          }
          void window.zcode.callTool("context_capture_set", { enabled: turnOn }).then(function (res) {
            var r = res && (res.structuredContent || res);
            if (typeof r === "string") { try { r = JSON.parse(r); } catch { /* ignore */ } }
            if (!r || r.ok !== true) { captureFail(); return; }
            captureBusy = false;
            void refresh();
          }, captureFail);
        };
        var bMore = document.getElementById("bMore");
        if (bMore) bMore.onclick = function () { void loadOlder(); };
        var bLatest = document.getElementById("bLatest");
        if (bLatest) bLatest.onclick = function () { olderPages = []; render(); };
        var bExit = document.getElementById("bExitTurn");
        if (bExit) bExit.onclick = function () { browserTurn = ""; olderPages = []; void loadBrowserIfNeeded(true); };
        el.querySelectorAll("[data-turn]").forEach(function (tr) {
          tr.onclick = function () {
            browserTurn = tr.getAttribute("data-turn") || "";
            olderPages = [];
            activateTab("browser");
          };
        });
      }

      function browserKey(sid) { return sid + "|" + browserTurn; }

      async function loadBrowserIfNeeded(force) {
        if (!lastSnap || !lastSnap.sessionId) return;
        var key = browserKey(lastSnap.sessionId);
        if (!force && browserLoadedKey === key && lastBrowser) return;
        if (browserLoadedKey !== key) { olderPages = []; pagingStale = false; turnStale = false; }   // 换会话或换轮：已加载的更老页不再适用
        browserLoadedKey = key;
        try {
          // 逐轮模式一次取整轮（上限 300）；默认首页取最新 80 条，更老的按游标翻页
          var res = await window.zcode.callTool("context_browser", browserTurn ? { limit: 300, offset: 0, turnId: browserTurn } : { limit: 80, offset: 0 });
          var d = res && (res.structuredContent || res);
          if (typeof d === "string") d = JSON.parse(d);
          if (browserLoadedKey !== key) return;   // 请求期间又切换了：丢弃迟到载荷
          lastBrowser = d;
          if (browserTurn) turnStale = !(d && d.ok && d.turnId === browserTurn);
          render();
        } catch { /* ignore */ }
      }

      async function loadOlder() {
        var tail = olderPages.length ? olderPages[olderPages.length - 1] : lastBrowser;
        if (loadingMore || browserTurn || !tail || !tail.ok || !tail.cursor || !tail.hasMore) return;
        var key = browserLoadedKey;   // 这一页属于哪个会话 / 哪一轮
        loadingMore = true;
        try {
          var res = await window.zcode.callTool("context_browser", { limit: 80, offset: 0, before: tail.cursor });
          var d = res && (res.structuredContent || res);
          if (typeof d === "string") d = JSON.parse(d);
          // 「加载更早」途中切换了会话或轮：迟到的旧会话页不能并进新会话的列表
          if (browserLoadedKey !== key) return;
          if (d && d.ok && Array.isArray(d.messages) && d.messages.length) {
            // 回来的还是同一页（最老一条没变）= 对端没认游标，不重复追加
            if (d.cursor && tail.cursor && d.cursor.id === tail.cursor.id) pagingStale = true;
            else olderPages.push(d);
          }
        } catch { /* ignore */ } finally {
          loadingMore = false;
          render();
        }
      }

      function activateTab(name) {
        document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("active", (b.getAttribute("data-tab") || "stats") === name); });
        activeTab = name;
        render();
        if (activeTab === "browser" || activeTab === "events") void loadBrowserIfNeeded(false);
      }

      async function refresh() {
        if (inflight) { pending = true; return; }
        inflight = true;
        try {
          var res = await window.zcode.callTool("context_snapshot", {});
          lastSnap = res && (res.structuredContent || res);
          if (typeof lastSnap === "string") {
            try { lastSnap = JSON.parse(lastSnap); } catch { /* ignore */ }
          }
          render();
          if (activeTab === "browser" || activeTab === "events") {
            void loadBrowserIfNeeded(true);
          }
        } catch {
          render();
        } finally {
          inflight = false;
          if (pending) { pending = false; void refresh(); }
        }
      }

      document.querySelectorAll(".tab").forEach(function (btn) {
        btn.addEventListener("click", function () { activateTab(btn.getAttribute("data-tab") || "stats"); });
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
