/* balance-dashboard left sidebar widget.
 *
 * Injected by the main-process loader into the ZCode renderer. It mounts a
 * compact balance card above the profile footer and re-asserts itself when
 * React re-renders the sidebar. Clicking a provider row opens the analytics
 * modal; the gear opens the same modal on its settings tab.
 *
 * No network requests happen here. The main process pushes balance data via
 * window.__balanceDashboardPush() and answers requests pushed to
 * window.__balanceDashboardRequests.
 */
(function () {
  "use strict";

  if (window.__balanceDashboardDispose) {
    try {
      window.__balanceDashboardDispose();
    } catch {
      // ignore a broken previous instance
    }
  }

  const HOST_ATTR = "data-balance-dashboard-widget";
  const MODAL_ATTR = "data-balance-dashboard-modal";
  const RETRY_MS = 1500;
  const REQUEST_TIMEOUT_MS = 30 * 1000;

  let disposed = false;
  let root = null;
  let shadow = null;
  let latest = null;
  let expanded = false;
  let retryTimer = null;
  let visibilityTimer = null;
  let observer = null;
  let ensureTimer = null;
  let themeObserver = null;
  let themeTimer = null;
  let lastThemeSignature = "";

  let modalHost = null;
  let modalShadow = null;
  let dialog = null;
  let modalBuilt = false;

  const pendingRequests = new Map();
  let requestSeq = 0;

  const PROVIDERS = [
    { id: "all", label: "全部供应商" },
    { id: "deepseek", label: "DeepSeek" },
    { id: "volcano", label: "火山（全部）" },
    { id: "volcanoCodingPlan", label: "火山 Coding Plan" },
    { id: "volcanoAccount", label: "火山账户" },
    { id: "zcode", label: "ZCode" },
  ];

  const PROVIDER_ORDER = ["deepseek", "volcanoCodingPlan", "volcanoAccount", "zcode", "other"];
  const PROVIDER_LABEL = {
    deepseek: "DeepSeek",
    volcanoCodingPlan: "火山 Coding Plan",
    volcanoAccount: "火山账户",
    zcode: "ZCode",
    other: "其他",
  };

  const modalState = {
    tab: "settings",
    analytics: {
      range: "today",
      customStart: "",
      customEnd: "",
      project: "",
      task: "",
      provider: "all",
      metric: "tokens",
      loading: false,
      error: null,
      data: null,
    },
    settings: {
      saving: false,
      message: "",
      messageKind: "",
    },
  };

  const esc = (value) =>
    String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const cur = (currency) => (String(currency || "").toUpperCase() === "USD" ? "$" : "¥");

  function money(amount, currency) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    return n.toLocaleString("zh-CN", {
      minimumFractionDigits: abs > 0 && abs < 1000 ? 2 : 0,
      maximumFractionDigits: abs > 0 && abs < 1000 ? 2 : 0,
    });
  }

  function moneyCny(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return "—";
    return `¥${n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function tokens(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (v >= 1e9) return `${(v / 1e9).toFixed(2).replace(/\.00$/, "")}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2).replace(/\.00$/, "")}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
    return String(Math.round(v));
  }

  function pct(n) {
    const v = Number(n);
    return Number.isFinite(v) ? `${Math.max(0, Math.min(100, v)).toFixed(v % 1 ? 1 : 0)}%` : "—";
  }

  function hostVar(name, fallback) {
    try {
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      return rootStyle.getPropertyValue(name).trim() || bodyStyle.getPropertyValue(name).trim() || fallback;
    } catch {
      return fallback;
    }
  }

  function safeColor(value, fallback) {
    if (!value) return fallback;
    try {
      if (window.CSS && typeof window.CSS.supports === "function" && window.CSS.supports("color", value)) {
        return value;
      }
    } catch {
      // fall through
    }
    return fallback;
  }

  function prefersDark() {
    try {
      const de = document.documentElement;
      const body = document.body;
      const classes = `${de.className || ""} ${body.className || ""}`;
      if (/(^|\s)dark(\s|$)/.test(classes)) return true;
      if (/(^|\s)light(\s|$)/.test(classes)) return false;
      const attr =
        de.getAttribute("data-theme") ||
        body.getAttribute("data-theme") ||
        de.getAttribute("data-color-scheme") ||
        body.getAttribute("data-color-scheme") ||
        "";
      if (/dark/i.test(attr)) return true;
      if (/light/i.test(attr)) return false;
      const scheme = `${getComputedStyle(de).colorScheme || ""} ${getComputedStyle(body).colorScheme || ""}`;
      if (/dark/i.test(scheme) && !/light/i.test(scheme)) return true;
      if (/light/i.test(scheme) && !/dark/i.test(scheme)) return false;
      const bg = getComputedStyle(body).backgroundColor || getComputedStyle(de).backgroundColor;
      const m = String(bg).match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
      if (m && (m[4] === undefined || Number(m[4]) > 0.1)) {
        const lum = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
        return lum < 128;
      }
    } catch {
      // fall through
    }
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return true;
    }
  }

  function theme() {
    const dark = prefersDark();
    return {
      dark,
      fg: safeColor(hostVar("--color-foreground", hostVar("--foreground", "")), dark ? "#e8eaf0" : "#15171c"),
      muted: safeColor(
        hostVar("--color-foreground-subtle", hostVar("--muted-foreground", "")),
        dark ? "#98a0b3" : "#6b7180",
      ),
      border: safeColor(hostVar("--color-border", hostVar("--border", "")), dark ? "rgba(255,255,255,.12)" : "rgba(15,23,42,.10)"),
      panel: safeColor(hostVar("--color-popover", hostVar("--card", "")), dark ? "#1c1f26" : "#ffffff"),
      card: safeColor(hostVar("--color-card", ""), dark ? "rgba(255,255,255,.045)" : "rgba(255,255,255,.72)"),
      accent: safeColor(hostVar("--primary", hostVar("--accent", "")), "#2563eb"),
      radius: hostVar("--radius-2xl", "14px"),
      shadow: hostVar("--shadow-md", "0 18px 48px rgba(0,0,0,.28)"),
      chart: [
        safeColor(hostVar("--color-usage-chart-1", ""), "#2f81f7"),
        safeColor(hostVar("--color-usage-chart-2", ""), "#f59e0b"),
        safeColor(hostVar("--color-usage-chart-3", ""), "#22c55e"),
        safeColor(hostVar("--color-usage-chart-4", ""), "#a855f7"),
        safeColor(hostVar("--color-usage-chart-5", ""), "#ec4899"),
      ],
    };
  }

  function applyWidgetTheme() {
    if (!root) return;
    const t = theme();
    root.style.setProperty("--bd-fg", t.fg);
    root.style.setProperty("--bd-muted", t.muted);
    root.style.setProperty("--bd-border", t.border);
    root.style.setProperty("--bd-panel", t.card);
    root.style.setProperty("--bd-accent", t.accent);
  }

  function applyModalTheme() {
    if (!modalHost) return;
    const t = theme();
    modalHost.style.setProperty("--bd-fg", t.fg);
    modalHost.style.setProperty("--bd-muted", t.muted);
    modalHost.style.setProperty("--bd-border", t.border);
    modalHost.style.setProperty("--bd-panel", t.panel);
    modalHost.style.setProperty("--bd-accent", t.accent);
    modalHost.style.setProperty("--bd-radius", t.radius);
    modalHost.style.setProperty("--bd-shadow", t.shadow);
  }

  /* ------------------------------------------------------------------ */
  /* Sidebar mounting                                                    */
  /* ------------------------------------------------------------------ */

  function visible(el) {
    try {
      const rect = el.getBoundingClientRect();
      return rect && rect.width >= 80 && rect.height >= 80;
    } catch {
      return true;
    }
  }

  function findAside() {
    const list = [
      document.querySelector('aside[data-testid="sidebar"]'),
      document.querySelector('[data-workspace-sidebar-panel="true"] aside'),
      document.querySelector('nav[data-testid="sidebar"]'),
    ].filter(Boolean);
    return list.find(visible) || list[0] || null;
  }

  /**
   * Locate the compact profile row that hosts the avatar / settings buttons.
   *
   * The row is not always a direct child of `aside` and not always a `<footer>`:
   * it can sit inside a flex wrapper together with the whole sidebar content.
   * Walking up to the first direct child of the sidebar would then put the
   * widget at the very top. Instead, climb until the block stops looking like a
   * compact footer row (height <= 140px), and insert before that block.
   */
  function findProfileBlock(aside) {
    const panel = aside.closest('[data-workspace-sidebar-panel="true"]') || aside.parentElement || aside;
    const triggers = [];
    for (const selector of ['[data-testid="login-trigger"]', '[data-testid="task-settings-button"]']) {
      for (const root of [aside, panel]) {
        for (const el of root.querySelectorAll(selector)) {
          if (!triggers.includes(el)) triggers.push(el);
        }
      }
    }
    // The profile controls live at the bottom of the sidebar. If a version also
    // exposes a settings button in the header, prefer the lowest one.
    let trigger = null;
    let lowest = -Infinity;
    for (const el of triggers) {
      try {
        const rect = el.getBoundingClientRect();
        if (!rect || rect.height <= 0 || rect.top < lowest) continue;
        lowest = rect.top;
        trigger = el;
      } catch {
        // ignore detached nodes
      }
    }
    if (!trigger) return null;

    let best = null;
    let node = trigger;
    while (node && node !== aside && node !== panel && node !== document.body) {
      if (isCompactProfileBlock(node, aside, panel)) best = node;
      node = node.parentElement;
    }
    if (!best || !best.parentElement) return null;
    return { parent: best.parentElement, node: best };
  }

  function isCompactProfileBlock(el, aside, panel) {
    if (!el || el === aside || el === panel || el === document.body) return false;
    if (!(aside.contains(el) || panel.contains(el))) return false;
    if (el.querySelector('aside[data-testid="sidebar"], nav[data-testid="sidebar"]')) return false;
    try {
      const rect = el.getBoundingClientRect();
      if (!rect || rect.height <= 0 || rect.height > 140) return false;
    } catch {
      return false;
    }
    return true;
  }

  function isSidebarVisible(aside) {
    try {
      // Geometry only. ZCode popovers (mode switch, model picker, command
      // palette) temporarily set pointer-events:none / opacity on the
      // background; those must not hide the widget.
      if (!visible(aside)) return false;
      const cs = getComputedStyle(aside);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      return true;
    } catch {
      return true;
    }
  }

  function attachRoot() {
    const host = document.createElement("div");
    host.setAttribute(HOST_ATTR, "");
    host.style.cssText = "display:block;flex:none;margin:0 12px 8px;";
    const localShadow = host.attachShadow({ mode: "open" });
    localShadow.addEventListener("click", onClick, true);
    localShadow.addEventListener("keydown", onKeydown, true);
    root = host;
    shadow = localShadow;
    render();
  }

  function resolveMount(aside) {
    const footer = aside.querySelector(':scope > footer');
    if (footer) return { parent: aside, anchor: footer };
    const profile = findProfileBlock(aside);
    if (profile && profile.parent && profile.node) return { parent: profile.parent, anchor: profile.node };
    return { parent: aside, anchor: null };
  }

  function ensureMounted() {
    if (disposed) return;
    const aside = findAside();
    if (!aside) {
      if (root) root.style.display = "none";
      scheduleEnsure();
      return;
    }

    // Drop duplicate hosts (for example after a hot reload).
    for (const el of document.querySelectorAll(`[${HOST_ATTR}]`)) {
      if (el !== root) {
        try {
          el.remove();
        } catch {
          // ignore
        }
      }
    }

    if (!root) attachRoot();

    const { parent, anchor } = resolveMount(aside);
    if (root.parentElement !== parent) {
      try {
        parent.appendChild(root);
      } catch {
        // ignore
      }
    }
    if (anchor && root.nextElementSibling !== anchor) {
      try {
        parent.insertBefore(root, anchor);
      } catch {
        // ignore
      }
    }
    if (!anchor) scheduleEnsure();
    updateVisibility();
  }

  function scheduleEnsure() {
    if (disposed || ensureTimer) return;
    ensureTimer = window.setTimeout(() => {
      ensureTimer = null;
      ensureMounted();
    }, 250);
  }

  function updateVisibility() {
    if (!root) return;
    const aside = findAside();
    if (!aside) {
      root.style.display = "none";
      return;
    }
    root.style.display = isSidebarVisible(aside) ? "block" : "none";
  }

  /* ------------------------------------------------------------------ */
  /* Compact card                                                        */
  /* ------------------------------------------------------------------ */

  function planWindows(windows) {
    if (!Array.isArray(windows) || !windows.length) return "";
    return windows
      .map((w) => {
        const value = Math.max(0, Math.min(100, Number(w.percent) || 0));
        return `<div class="win">
          <div class="win-line"><span>${esc(w.label)}</span><b>${pct(value)}</b></div>
          <div class="bar"><i class="${value >= 90 ? "bad" : value >= 70 ? "warn" : ""}" style="width:${value}%"></i></div>
        </div>`;
      })
      .join("");
  }

  function maxPlanPercent(plan) {
    const wins = Array.isArray(plan?.windows) ? plan.windows : Array.isArray(plan?.plan?.windows) ? plan.plan.windows : [];
    if (!wins.length) return null;
    return wins.reduce((a, b) => (Number(b.percent) > Number(a.percent) ? b : a), wins[0]);
  }

  function deepSeekBalance(ds) {
    if (!ds) return "—";
    if (ds.status === "ok" && ds.balance) return `${cur(ds.balance.currency)}${money(ds.balance.amount)}`;
    if (ds.status === "unconfigured") return "未配置";
    return "—";
  }

  function deepSeekTodayLine(ds) {
    const today = ds?.today;
    if (!today) return "今日 —";
    const cost = today.cost
      ? `${today.cost.estimated !== false ? "≈" : ""}${cur(today.cost.currency)}${money(today.cost.amount)}`
      : "—";
    return `今日 ${cost} · ${tokens(today.totalTokens ?? today.inputTokens + today.outputTokens)} tok`;
  }

  function volcanoBalance(volcano) {
    if (!volcano) return "—";
    const account = volcano.account || {};
    if (account.status === "ok" && account.balance) {
      return `${cur(account.balance.currency)}${money(account.balance.amount)}`;
    }
    if (account.status === "unconfigured") return "未配置";
    if (account.error?.message) return "查询失败";
    return "—";
  }

  function volcanoTodayLine(volcano) {
    const account = volcano?.account || {};
    const plan = volcano?.codingPlan || {};
    const parts = [];
    if (account.officialToday && account.officialToday.rows > 0) {
      parts.push(`今日 ${cur(account.officialToday.currency || "CNY")}${money(account.officialToday.amount)}`);
    } else if (account.today?.cost) {
      parts.push(`今日 ≈${cur(account.today.cost.currency)}${money(account.today.cost.amount)}`);
    } else {
      parts.push("今日 —");
    }
    const accountTokens = account.today?.totalTokens ?? (account.today ? account.today.inputTokens + account.today.outputTokens : 0);
    const planTokens = plan.today?.totalTokens ?? (plan.today ? plan.today.inputTokens + plan.today.outputTokens : 0);
    const total = accountTokens + planTokens;
    if (total) parts.push(`${tokens(total)} tok`);
    const win = maxPlanPercent(plan);
    if (win) parts.push(`套餐 ${pct(win.percent)}`);
    return parts.join(" · ");
  }

  function zcodeBalance(zcode) {
    if (!zcode) return "—";
    const plan = zcode.plan || {};
    if (plan.status === "ok" && plan.plan) {
      const win = maxPlanPercent(plan.plan);
      return win ? `${esc(plan.plan.name || "套餐")} ${pct(win.percent)}` : esc(plan.plan.name || "套餐");
    }
    if (plan.status === "no_plan") return "无套餐";
    return "套餐不可用";
  }

  function zcodeTodayLine(zcode) {
    const today = zcode?.today;
    if (!today) return "今日 0 tok · 0 次";
    return `今日 ${tokens(today.totalTokens ?? today.inputTokens + today.outputTokens)} tok · ${today.requests} 次`;
  }

  function deepSeekDetail(ds) {
    if (!ds) return "";
    if (ds.status === "ok" && ds.balance) {
      const parts = ds.balance.parts || [];
      const today = ds.today;
      return `<div class="detail-block">
        <div class="detail-title">DeepSeek</div>
        <div class="kv"><span>可用余额</span><b>${cur(ds.balance.currency)}${money(ds.balance.amount)}</b></div>
        <div class="kv"><span>赠送 / 充值</span><b>${cur(ds.balance.currency)}${money(parts[0]?.amount ?? 0)} / ${cur(ds.balance.currency)}${money(parts[1]?.amount ?? 0)}</b></div>
        <div class="kv"><span>今日消耗</span><b>${today?.cost ? `≈${cur(today.cost.currency)}${money(today.cost.amount)}` : "—"}</b></div>
        ${today ? `<div class="note">${today.requests} 次 · ${tokens(today.inputTokens)} 输入 · ${tokens(today.outputTokens)} 输出</div>` : `<div class="note">今日暂无本机记录</div>`}
      </div>`;
    }
    return `<div class="detail-block"><div class="detail-title">DeepSeek</div><div class="note">${esc(ds.hint || "未配置 DeepSeek API Key")}</div></div>`;
  }

  function volcanoDetail(volcano) {
    if (!volcano) return "";
    const account = volcano.account || {};
    const plan = volcano.codingPlan || {};
    const accountLines = [];
    if (account.status === "ok" && account.balance) {
      accountLines.push(`<div class="kv"><span>账户余额</span><b>${cur(account.balance.currency)}${money(account.balance.amount)}</b></div>`);
      if (account.officialToday?.rows) {
        accountLines.push(`<div class="kv"><span>今日账单</span><b>${cur(account.officialToday.currency || "CNY")}${money(account.officialToday.amount)}</b></div>`);
      } else if (account.today?.cost) {
        accountLines.push(`<div class="kv"><span>今日估算</span><b>≈${cur(account.today.cost.currency)}${money(account.today.cost.amount)}</b></div>`);
      }
    } else if (account.status === "unconfigured") {
      accountLines.push(`<div class="note">账户余额需配置火山 AK/SK</div>`);
    } else {
      accountLines.push(`<div class="note">${esc(account.error?.message || "账户余额查询失败")}</div>`);
    }
    const planLines = Array.isArray(plan.windows) && plan.windows.length
      ? planWindows(plan.windows)
      : `<div class="note">${esc(plan.hint || (plan.status === "no_plan" ? "未检测到 Coding Plan 额度" : "暂无额度数据"))}</div>`;
    return `<div class="detail-block">
      <div class="detail-title">火山引擎</div>
      ${accountLines.join("")}
      <div class="sub-title">${esc(plan.plan?.name || "Coding Plan")}</div>
      ${planLines}
      ${plan.today ? `<div class="note">套餐内今日 ${plan.today.requests} 次 · ${tokens(plan.today.inputTokens)} 输入 · ${tokens(plan.today.outputTokens)} 输出</div>` : ""}
    </div>`;
  }

  function zcodeDetail(zcode) {
    if (!zcode) return "";
    const plan = zcode.plan || {};
    const today = zcode.today;
    const planBody = plan.status === "ok" && plan.plan
      ? planWindows(plan.plan.windows)
      : `<div class="note">${esc(plan.hint || (plan.status === "no_plan" ? "未检测到套餐" : "套餐余额不可用"))}</div>`;
    const all = latest?.todayAll;
    const allNote = all
      ? `<div class="kv"><span>全部供应商今日</span><b>${tokens(all.totalTokens ?? all.inputTokens + all.outputTokens)} tok · ${all.requests} 次</b></div>`
      : "";
    return `<div class="detail-block">
      <div class="detail-title">ZCode</div>
      ${planBody}
      <div class="kv"><span>今日 tokens</span><b>${today ? tokens(today.inputTokens + today.outputTokens) : "0"}</b></div>
      <div class="note">${today ? `${today.requests} 次 · ${tokens(today.inputTokens)} 输入 · ${tokens(today.outputTokens)} 输出` : "今日暂无本机用量"}</div>
      ${allNote}
    </div>`;
  }

  function providerRow(id, dotClass, name, value, sub) {
    return `<button class="row" type="button" data-provider="${esc(id)}" title="点击查看消耗分析">
      <span class="dot ${dotClass}"></span>
      <span class="row-main">
        <span class="name">${esc(name)}</span>
        <span class="sub">${esc(sub)}</span>
      </span>
      <span class="val">${esc(value)}</span>
    </button>`;
  }

  function uiFlags() {
    const ui = latest?.settings?.ui || {};
    return {
      showDeepseek: ui.showDeepseek !== false,
      showVolcano: ui.showVolcano !== false,
      showZcode: ui.showZcode !== false,
      hideUnconfigured: ui.hideUnconfigured !== false,
    };
  }

  function isConfigured(id, ds, volcano, zcode) {
    if (id === "deepseek") return !!ds && ds.status !== "unconfigured";
    if (id === "volcano") {
      const account = volcano?.account || {};
      const plan = volcano?.codingPlan || {};
      return !!(account.configured || plan.configured);
    }
    if (id === "zcode") return !!zcode?.plan?.configured;
    return true;
  }

  function render() {
    if (!shadow) return;
    if (!latest) {
      shadow.innerHTML = `${styles()}<div class="card"><div class="head static"><span class="title">余额</span><span class="time">加载中…</span></div><div class="loading"><i></i><i></i><i></i></div></div>`;
      return;
    }
    if (latest.error) {
      shadow.innerHTML = `${styles()}<div class="card"><div class="head static"><span class="title">余额</span><span class="time">不可用</span></div><div class="note">${esc(latest.error.message || "数据服务暂时不可用")}</div></div>`;
      return;
    }

    const ds = latest.deepseek || {};
    const volcano = latest.volcano || {};
    const zcode = latest.zcode || {};
    const time = (() => {
      try {
        return new Date(latest.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      } catch {
        return "";
      }
    })();

    const ui = uiFlags();
    const rowDefs = [
      { id: "deepseek", dot: "ds", name: "DeepSeek", show: ui.showDeepseek, configured: isConfigured("deepseek", ds, volcano, zcode), value: deepSeekBalance(ds), sub: deepSeekTodayLine(ds) },
      { id: "volcano", dot: "vol", name: "火山", show: ui.showVolcano, configured: isConfigured("volcano", ds, volcano, zcode), value: volcanoBalance(volcano), sub: volcanoTodayLine(volcano) },
      { id: "zcode", dot: "zc", name: "ZCode", show: ui.showZcode, configured: isConfigured("zcode", ds, volcano, zcode), value: zcodeBalance(zcode), sub: zcodeTodayLine(zcode) },
    ];
    const rowsHtml = rowDefs
      .filter((row) => row.show && (!ui.hideUnconfigured || row.configured))
      .map((row) => providerRow(row.id, row.dot, row.name, row.value, row.sub))
      .join("");
    const rowsBlock = rowsHtml
      ? `<div class="rows">${rowsHtml}</div>`
      : `<div class="rows empty-hint">未显示任何供应商；可在 ⚙ 设置中调整</div>`;

    shadow.innerHTML = `${styles()}
      <div class="card">
        <div class="head">
          <button class="head-main" type="button" aria-expanded="${expanded ? "true" : "false"}">
            <span class="title">余额</span>
            <span class="time">${esc(time)}</span>
          </button>
          <button class="gear" type="button" title="设置与消耗分析" aria-label="设置与消耗分析">⚙</button>
          <button class="chev-btn" type="button" title="${expanded ? "收起" : "展开"}" aria-label="${expanded ? "收起" : "展开"}">
            <span class="chev ${expanded ? "up" : ""}">⌄</span>
          </button>
        </div>
        ${rowsBlock}
        <div class="detail" ${expanded ? "" : "hidden"}>
          ${deepSeekDetail(ds)}
          ${volcanoDetail(volcano)}
          ${zcodeDetail(zcode)}
        </div>
      </div>`;
  }

  function styles() {
    applyWidgetTheme();
    return `<style>
      :host { display:block; font-family: var(--font-sans, ui-sans-serif, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif); color: var(--bd-fg); font-size: 11px; line-height: 1.4; font-variant-numeric: tabular-nums; }
      * { box-sizing: border-box; }
      .card { border:1px solid var(--bd-border); border-radius:10px; background:var(--bd-panel); padding:7px 9px 8px; overflow:hidden; }
      .head { display:flex; align-items:center; gap:4px; width:100%; padding:0 0 5px; margin:0; }
      .head-main { display:flex; align-items:center; gap:6px; flex:1; min-width:0; padding:0; border:0; background:transparent; color:inherit; font:inherit; cursor:pointer; text-align:left; border-radius:5px; }
      .head-main:focus-visible, .gear:focus-visible, .chev-btn:focus-visible, .row:focus-visible { outline:2px solid var(--bd-accent); outline-offset:2px; }
      .head.static { padding-bottom:5px; }
      .title { font-size:11px; font-weight:650; letter-spacing:.01em; }
      .time { margin-left:2px; font-size:10px; color:var(--bd-muted); }
      .gear, .chev-btn { border:0; background:transparent; color:var(--bd-muted); font:inherit; cursor:pointer; padding:1px 3px; border-radius:4px; line-height:1; }
      .gear { font-size:11px; }
      .gear:hover, .chev-btn:hover { color:var(--bd-fg); background:color-mix(in srgb, var(--bd-fg) 7%, transparent); }
      .chev { display:inline-block; font-size:12px; line-height:1; transition:transform .15s ease; transform:translateY(-1px); }
      .chev.up { transform:translateY(1px) rotate(180deg); }
      .rows { display:flex; flex-direction:column; gap:2px; }
      .empty-hint { padding:5px 4px; font-size:10px; color:var(--bd-muted); }
      .row { display:flex; align-items:center; gap:6px; width:100%; min-height:30px; padding:3px 4px; margin:0 -4px; border:0; border-radius:6px; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; }
      .row:hover { background:color-mix(in srgb, var(--bd-fg) 6%, transparent); }
      .dot { width:6px; height:6px; border-radius:2px; flex:none; align-self:flex-start; margin-top:5px; }
      .dot.ds { background:#2f81f7; }
      .dot.vol { background:#f59e0b; }
      .dot.zc { background:#22c55e; }
      .row-main { display:flex; flex-direction:column; min-width:0; flex:1; gap:0; }
      .name { color:var(--bd-fg); font-size:10.5px; font-weight:600; line-height:1.35; }
      .sub { color:var(--bd-muted); font-size:9.5px; line-height:1.35; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .val { margin-left:auto; font-weight:650; font-size:11px; max-width:42%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; align-self:flex-start; margin-top:0; }
      .detail { margin-top:6px; padding-top:6px; border-top:1px solid var(--bd-border); max-height:38vh; overflow:auto; overscroll-behavior:contain; }
      .detail[hidden] { display:none; }
      .detail-block { padding:3px 0 5px; }
      .detail-block + .detail-block { border-top:1px dashed var(--bd-border); margin-top:3px; padding-top:7px; }
      .detail-title { font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--bd-muted); margin-bottom:4px; }
      .sub-title { margin:7px 0 4px; font-size:10px; font-weight:600; color:var(--bd-muted); }
      .kv { display:flex; align-items:baseline; justify-content:space-between; gap:8px; padding:1px 0; }
      .kv span { color:var(--bd-muted); font-size:10.5px; }
      .kv b { font-size:10.5px; font-weight:600; }
      .note { margin-top:3px; font-size:10px; color:var(--bd-muted); overflow-wrap:anywhere; }
      .win { margin:4px 0 6px; }
      .win-line { display:flex; justify-content:space-between; font-size:10px; color:var(--bd-muted); margin-bottom:2px; }
      .win-line b { color:var(--bd-fg); font-weight:600; }
      .bar { height:4px; border-radius:999px; background:color-mix(in srgb, var(--bd-fg) 10%, transparent); overflow:hidden; }
      .bar i { display:block; height:100%; border-radius:inherit; background:var(--bd-accent); }
      .bar i.warn { background:#f59e0b; }
      .bar i.bad { background:#ef4444; }
      .loading { display:flex; flex-direction:column; gap:4px; }
      .loading i { display:block; height:9px; border-radius:3px; background:color-mix(in srgb, var(--bd-fg) 8%, transparent); animation:pulse 1.2s ease-in-out infinite; }
      .loading i:nth-child(2) { width:78%; animation-delay:.1s; }
      .loading i:nth-child(3) { width:62%; animation-delay:.2s; }
      @keyframes pulse { 0%,100% { opacity:.45 } 50% { opacity:1 } }
      @media (prefers-reduced-motion: reduce) { .loading i { animation:none } .chev { transition:none } }
    </style>`;
  }

  function onClick(event) {
    const target = event.target;
    if (!target || !target.closest) return;

    if (target.closest(".gear")) {
      event.preventDefault();
      event.stopPropagation();
      openModal("settings");
      return;
    }
    if (target.closest(".chev-btn") || target.closest(".head-main")) {
      event.preventDefault();
      event.stopPropagation();
      expanded = !expanded;
      render();
      return;
    }
    const row = target.closest(".row");
    if (row) {
      event.preventDefault();
      event.stopPropagation();
      openModal("analytics", row.getAttribute("data-provider") || "all");
    }
  }

  function onKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target && event.target.closest && event.target.closest(".row");
    if (row) {
      event.preventDefault();
      openModal("analytics", row.getAttribute("data-provider") || "all");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Request bridge                                                      */
  /* ------------------------------------------------------------------ */

  function bridgeRequest(op, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = `bd_${Date.now().toString(36)}_${++requestSeq}`;
      const timer = window.setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error("请求超时：主进程未响应"));
        }
      }, timeoutMs);
      pendingRequests.set(id, {
        resolve: (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      });
      if (!Array.isArray(window.__balanceDashboardRequests)) window.__balanceDashboardRequests = [];
      window.__balanceDashboardRequests.push({ id, op, ...payload });
    });
  }

  window.__balanceDashboardRequestResult = (id, result) => {
    const entry = pendingRequests.get(id);
    if (!entry) return;
    pendingRequests.delete(id);
    if (result && result.ok === false) {
      const message =
        (result.error && (result.error.message || result.error)) || "操作失败";
      entry.reject(new Error(String(message)));
    } else {
      entry.resolve(result && "data" in result ? result.data : result);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Modal shell                                                         */
  /* ------------------------------------------------------------------ */

  function modalStyles() {
    const t = theme();
    return `<style>
      :host { all: initial; font-family: var(--font-sans, ui-sans-serif, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif); }
      * { box-sizing: border-box; }
      dialog { display: none; width: min(1080px, calc(100vw - 40px)); max-height: min(820px, calc(100vh - 40px)); padding: 0; border: 1px solid var(--bd-border); border-radius: var(--bd-radius); background: var(--bd-panel); color: var(--bd-fg); box-shadow: var(--bd-shadow); pointer-events: auto; overflow: hidden; font-size: 13px; line-height: 1.5; font-variant-numeric: tabular-nums; }
      dialog[open] { display: flex; flex-direction: column; }
      dialog::backdrop { background: rgba(8, 10, 14, .48); backdrop-filter: blur(2px); }
      .dlg-head { display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid var(--bd-border); flex:none; }
      .tabs { display:flex; gap:4px; }
      .tab { border:0; background:transparent; color:var(--bd-muted); font:inherit; font-weight:600; padding:6px 12px; border-radius:8px; cursor:pointer; }
      .tab:hover { color:var(--bd-fg); background:color-mix(in srgb, var(--bd-fg) 6%, transparent); }
      .tab.active { color:var(--bd-fg); background:color-mix(in srgb, var(--bd-accent) 14%, transparent); }
      .close { margin-left:auto; border:0; background:transparent; color:var(--bd-muted); font:inherit; font-size:16px; line-height:1; padding:6px 9px; border-radius:8px; cursor:pointer; }
      .close:hover { color:var(--bd-fg); background:color-mix(in srgb, var(--bd-fg) 8%, transparent); }
      .dlg-body { flex:1; min-height:0; min-width:0; display:flex; flex-direction:column; }
      .pane { padding:14px 16px 16px; flex:1; min-height:0; min-width:0; max-width:100%; }
      .pane[hidden] { display:none !important; }
      .pane.settings { overflow:auto; }
      .pane.analytics { display:flex; flex-direction:column; gap:10px; overflow:hidden; }
      .field { display:flex; flex-direction:column; gap:4px; margin-bottom:11px; }
      .ui-section { border:1px solid var(--bd-border); border-radius:10px; padding:10px 12px; margin-bottom:12px; display:flex; flex-direction:column; gap:8px; }
      .ui-title { font-size:12px; font-weight:600; }
      .switch-row { display:flex; align-items:center; gap:8px; font-size:12px; font-weight:500; cursor:pointer; }
      .switch-row input { width:auto; margin:0; accent-color:var(--bd-accent); }
      .field label { font-size:12px; font-weight:600; }
      .field .hint { font-size:11px; color:var(--bd-muted); }
      input[type="text"], input[type="password"], input[type="date"], select {
        width:100%; padding:7px 9px; border:1px solid var(--bd-border); border-radius:8px;
        background:color-mix(in srgb, var(--bd-fg) 4%, transparent); color:var(--bd-fg);
        font:inherit; font-size:12px; outline:none;
      }
      input:focus, select:focus { border-color:var(--bd-accent); }
      select option { background:var(--bd-panel); color:var(--bd-fg); }
      .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
      .actions { display:flex; align-items:center; gap:10px; margin-top:14px; flex-wrap:wrap; }
      .btn { border:1px solid var(--bd-border); background:transparent; color:var(--bd-fg); font:inherit; font-weight:600; padding:7px 14px; border-radius:8px; cursor:pointer; }
      .btn:hover { background:color-mix(in srgb, var(--bd-fg) 7%, transparent); }
      .btn.primary { background:var(--bd-accent); border-color:var(--bd-accent); color:#fff; }
      .btn.primary:hover { filter:brightness(1.08); }
      .btn:disabled { opacity:.55; cursor:default; }
      .status { font-size:12px; color:var(--bd-muted); }
      .status.ok { color:#22c55e; }
      .status.err { color:#ef4444; }
      .sep { height:1px; background:var(--bd-border); margin:14px 0; }
      .filters { display:flex; flex-wrap:wrap; gap:8px; align-items:center; flex:none; min-width:0; max-width:100%; }
      .seg { display:flex; gap:2px; padding:2px; border:1px solid var(--bd-border); border-radius:9px; }
      .seg button { border:0; background:transparent; color:var(--bd-muted); font:inherit; font-size:12px; padding:5px 10px; border-radius:7px; cursor:pointer; }
      .seg button:hover { color:var(--bd-fg); }
      .seg button.active { background:color-mix(in srgb, var(--bd-accent) 16%, transparent); color:var(--bd-fg); font-weight:600; }
      .filters select { width:auto; min-width:120px; max-width:190px; }
      .filters input[type="date"] { width:auto; }
      .custom-range { display:none; gap:6px; align-items:center; }
      .custom-range.show { display:flex; }
      .spacer { flex:1; }
      .metric-toggle { display:flex; gap:2px; padding:2px; border:1px solid var(--bd-border); border-radius:9px; }
      .metric-toggle button { border:0; background:transparent; color:var(--bd-muted); font:inherit; font-size:12px; padding:4px 9px; border-radius:7px; cursor:pointer; }
      .metric-toggle button.active { background:color-mix(in srgb, var(--bd-accent) 16%, transparent); color:var(--bd-fg); font-weight:600; }
      .results { flex:1; min-height:0; min-width:0; overflow-y:auto; overflow-x:hidden; padding-right:2px; max-width:100%; }
      .summary-cards { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; margin-bottom:12px; min-width:0; }
      .s-card { border:1px solid var(--bd-border); border-radius:10px; padding:9px 11px; background:color-mix(in srgb, var(--bd-fg) 3%, transparent); }
      .s-label { font-size:11px; color:var(--bd-muted); margin-bottom:3px; }
      .s-value { font-size:19px; font-weight:700; letter-spacing:-.01em; }
      .s-sub { font-size:11px; color:var(--bd-muted); margin-top:2px; }
      .chart-box { position:relative; border:1px solid var(--bd-border); border-radius:10px; padding:10px 10px 4px; margin-bottom:12px; min-width:0; max-width:100%; }
      .chart-title { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; font-size:12px; font-weight:600; }
      .legend { display:flex; flex-wrap:wrap; gap:10px; font-size:11px; color:var(--bd-muted); }
      .legend i { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
      .chart svg { display:block; width:100%; height:auto; overflow:visible; }
      .chart rect.seg { transition:opacity .12s ease; }
      .chart rect.seg:hover { opacity:.82; }
      .chart text { fill:var(--bd-muted); font-size:9px; }
      .chart-tip { position:absolute; pointer-events:none; z-index:5; max-width:260px; padding:7px 9px; border-radius:8px; border:1px solid var(--bd-border); background:var(--bd-panel); box-shadow:var(--bd-shadow); font-size:11px; line-height:1.5; display:none; }
      .chart-tip.show { display:block; }
      .chart-tip .tip-title { font-weight:700; margin-bottom:3px; }
      .chart-tip .tip-row { display:flex; gap:10px; justify-content:space-between; }
      .dual { display:grid; grid-template-columns:1.1fr .9fr; gap:12px; margin-bottom:12px; min-width:0; }
      .box { border:1px solid var(--bd-border); border-radius:10px; padding:10px 12px; min-width:0; max-width:100%; overflow:hidden; }
      .box-title { font-size:12px; font-weight:600; margin-bottom:8px; }
      .share-row { display:flex; align-items:center; gap:8px; margin-bottom:7px; font-size:11px; }
      .share-name { width:110px; flex:none; color:var(--bd-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .share-track { flex:1; height:6px; border-radius:999px; background:color-mix(in srgb, var(--bd-fg) 9%, transparent); overflow:hidden; }
      .share-track i { display:block; height:100%; border-radius:inherit; }
      .share-val { width:74px; flex:none; text-align:right; font-variant-numeric:tabular-nums; }
      .list-row { display:flex; align-items:baseline; gap:8px; padding:4px 0; border-top:1px dashed var(--bd-border); font-size:11px; }
      .list-row:first-child { border-top:0; }
      .list-row .lr-main { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .list-row .lr-sub { color:var(--bd-muted); font-size:10px; }
      .list-row .lr-val { flex:none; font-weight:600; font-variant-numeric:tabular-nums; }
      .empty { padding:34px 10px; text-align:center; color:var(--bd-muted); font-size:12px; }
      .loading-inline { padding:30px 10px; text-align:center; color:var(--bd-muted); font-size:12px; }
      .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
      @media (max-width: 720px) {
        .summary-cards { grid-template-columns:1fr; }
        .dual { grid-template-columns:1fr; }
        .grid2 { grid-template-columns:1fr; }
      }
    </style>`;
  }

  function buildModal() {
    if (modalHost && modalHost.isConnected) return;
    modalHost = document.createElement("div");
    modalHost.setAttribute(MODAL_ATTR, "");
    modalHost.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none;";
    applyModalTheme();
    modalShadow = modalHost.attachShadow({ mode: "open" });

    modalShadow.innerHTML = `${modalStyles()}
      <dialog>
        <div class="dlg-head">
          <div class="tabs">
            <button class="tab" type="button" data-tab="settings">设置</button>
            <button class="tab" type="button" data-tab="analytics">消耗分析</button>
          </div>
          <button class="close" type="button" aria-label="关闭">✕</button>
        </div>
        <div class="dlg-body">
          <section class="pane settings" data-pane="settings">
            <form class="settings-form">
              <div class="ui-section">
                <div class="ui-title">显示设置</div>
                <label class="switch-row"><input type="checkbox" data-ui="show_deepseek"><span>显示 DeepSeek</span></label>
                <label class="switch-row"><input type="checkbox" data-ui="show_volcano"><span>显示 火山</span></label>
                <label class="switch-row"><input type="checkbox" data-ui="show_zcode"><span>显示 ZCode</span></label>
                <label class="switch-row"><input type="checkbox" data-ui="hide_unconfigured"><span>未接入的供应商自动隐藏</span></label>
              </div>
              <div class="field">
                <label for="bd-ds-key">DeepSeek API Key</label>
                <input id="bd-ds-key" type="password" data-field="deepseek_api_key" autocomplete="off" placeholder="sk-...">
                <span class="hint" data-hint="deepseek_api_key"></span>
              </div>
              <div class="grid2">
                <div class="field">
                  <label for="bd-volc-ak">火山 Access Key ID</label>
                  <input id="bd-volc-ak" type="password" data-field="volc_access_key_id" autocomplete="off">
                </div>
                <div class="field">
                  <label for="bd-volc-sk">火山 Secret Access Key</label>
                  <input id="bd-volc-sk" type="password" data-field="volc_secret_access_key" autocomplete="off">
                </div>
              </div>
              <div class="grid2">
                <div class="field">
                  <label for="bd-volc-region">火山 Region（可选）</label>
                  <input id="bd-volc-region" type="text" data-field="volc_region" placeholder="cn-beijing / cn-north-1">
                </div>
                <div class="field">
                  <label for="bd-usage-db">ZCode 用量库路径（可选）</label>
                  <input id="bd-usage-db" type="text" data-field="zcode_usage_db" placeholder="默认 ~/.zcode/cli/db/db.sqlite">
                </div>
              </div>
              <div class="field">
                <label for="bd-jwt">ZCode JWT Token（可选）</label>
                <input id="bd-jwt" type="password" data-field="zcode_jwt_token" autocomplete="off" placeholder="留空自动读取 ZCode 凭据">
                <span class="hint" data-hint="zcode_jwt_token"></span>
              </div>
              <div class="field">
                <label for="bd-device">ZCode Device Mid（可选）</label>
                <input id="bd-device" type="text" data-field="zcode_device_mid" placeholder="留空自动读取 telemetry-state.json">
              </div>
              <div class="hint">密钥只保存在本机 <code>runtime/options.json</code>（明文，与 ZCode 自身的插件密钥存储同级别）。留空的密钥字段表示保持原值不变。</div>
              <div class="actions">
                <button class="btn primary" type="submit">保存</button>
                <button class="btn" type="button" data-action="open-plugin-settings">打开 ZCode 插件设置</button>
                <span class="status" data-el="settings-status"></span>
              </div>
            </form>
          </section>
          <section class="pane analytics" data-pane="analytics" hidden>
            <div class="filters">
              <div class="seg" data-seg="range">
                <button type="button" data-range="today" class="active">今天</button>
                <button type="button" data-range="yesterday">昨天</button>
                <button type="button" data-range="week">本周</button>
                <button type="button" data-range="month">本月</button>
                <button type="button" data-range="custom">自定义</button>
              </div>
              <div class="custom-range" data-el="custom-range">
                <input type="date" data-el="custom-start">
                <span>—</span>
                <input type="date" data-el="custom-end">
              </div>
              <select data-el="project" aria-label="项目筛选"><option value="">全部项目</option></select>
              <select data-el="task" aria-label="任务筛选"><option value="">全部任务</option></select>
              <select data-el="provider" aria-label="供应商筛选"></select>
              <div class="spacer"></div>
              <div class="metric-toggle" data-seg="metric">
                <button type="button" data-metric="tokens" class="active">Token</button>
                <button type="button" data-metric="cost">费用</button>
              </div>
            </div>
            <div class="results" data-el="results"></div>
          </section>
        </div>
      </dialog>`;

    dialog = modalShadow.querySelector("dialog");
    wireModal();
    modalBuilt = true;
  }

  function wireModal() {
    modalShadow.addEventListener("click", (event) => {
      const target = event.target;
      if (!target || !target.closest) return;

      const tab = target.closest("[data-tab]");
      if (tab) {
        switchTab(tab.getAttribute("data-tab"));
        return;
      }
      if (target.closest(".close")) {
        closeModal();
        return;
      }
      const rangeBtn = target.closest("[data-range]");
      if (rangeBtn) {
        const a = modalState.analytics;
        a.range = rangeBtn.getAttribute("data-range");
        a.task = "";
        syncFilterUI();
        loadAnalytics();
        return;
      }
      const metricBtn = target.closest("[data-metric]");
      if (metricBtn) {
        modalState.analytics.metric = metricBtn.getAttribute("data-metric");
        syncFilterUI();
        renderAnalytics();
        return;
      }
      if (target.closest('[data-action="open-plugin-settings"]')) {
        openPluginSettings();
      }
    });

    modalShadow.addEventListener("change", (event) => {
      const target = event.target;
      if (!target || !target.dataset) return;
      const a = modalState.analytics;
      if (target.dataset.el === "project") {
        a.project = target.value;
        a.task = "";
        loadAnalytics();
      } else if (target.dataset.el === "task") {
        a.task = target.value;
        loadAnalytics();
      } else if (target.dataset.el === "provider") {
        a.provider = target.value || "all";
        loadAnalytics();
      } else if (target.dataset.el === "custom-start" || target.dataset.el === "custom-end") {
        if (target.dataset.el === "custom-start") a.customStart = target.value;
        else a.customEnd = target.value;
        if (a.range === "custom" && a.customStart && a.customEnd) loadAnalytics();
      } else if (target.dataset.ui) {
        target.dataset.uiTouched = "1";
      }
    });

    modalShadow.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      saveSettings();
    });

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeModal();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeModal();
    });

    // Chart tooltip: react to pointer movement over the SVG bars.
    const results = modalShadow.querySelector('[data-el="results"]');
    results.addEventListener("mousemove", (event) => {
      const tip = results.querySelector(".chart-tip");
      if (!tip) return;
      const seg = event.target && event.target.closest ? event.target.closest("[data-tip]") : null;
      if (!seg) {
        tip.classList.remove("show");
        return;
      }
      const box = results.getBoundingClientRect();
      tip.innerHTML = seg.getAttribute("data-tip");
      tip.classList.add("show");
      const left = Math.min(box.width - 270, Math.max(0, event.clientX - box.left + 12));
      const top = Math.max(0, event.clientY - box.top - 20);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    });
    results.addEventListener("mouseleave", () => {
      const tip = results.querySelector(".chart-tip");
      if (tip) tip.classList.remove("show");
    });
  }

  function openModal(tab, provider) {
    buildModal();
    if (!modalHost.isConnected) document.body.appendChild(modalHost);
    applyModalTheme();
    if (tab === "analytics") {
      const a = modalState.analytics;
      if (provider) a.provider = provider;
      modalState.tab = "analytics";
    } else {
      modalState.tab = "settings";
    }
    switchTab(modalState.tab, { load: false });
    syncFilterUI();
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    }
    if (tab === "settings") fillSettingsForm();
    else loadAnalytics();
  }

  function closeModal() {
    if (!dialog) return;
    try {
      dialog.close();
    } catch {
      dialog.removeAttribute("open");
    }
  }

  function switchTab(tab, options = {}) {
    const shouldLoad = options.load !== false;
    modalState.tab = tab;
    for (const btn of modalShadow.querySelectorAll("[data-tab]")) {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
    }
    for (const pane of modalShadow.querySelectorAll("[data-pane]")) {
      pane.hidden = pane.getAttribute("data-pane") !== tab;
    }
    if (tab === "settings") fillSettingsForm();
    else if (shouldLoad && !modalState.analytics.data && !modalState.analytics.loading) loadAnalytics();
  }

  function openPluginSettings() {
    try {
      window.dispatchEvent(
        new CustomEvent("zcode:open-plugin-store", {
          detail: { pluginId: "balance-dashboard@dev-zcode-plugins" },
        }),
      );
      closeModal();
    } catch {
      // ignore: navigation is a best-effort fallback
    }
  }

  /* ------------------------------------------------------------------ */
  /* Settings pane                                                       */
  /* ------------------------------------------------------------------ */

  function fillSettingsForm() {
    if (!modalBuilt) return;
    const form = modalShadow.querySelector("form");
    if (!form) return;
    const settings = latest?.settings || {};
    const values = settings.values || {};
    const secrets = settings.secrets || {};
    const ui = settings.ui || {};
    const auto = settings.autoDetected || {};
    const textFields = ["volc_access_key_id", "volc_region", "zcode_usage_db", "zcode_device_mid"];

    const camel = (key) => key.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
    for (const box of form.querySelectorAll("[data-ui]")) {
      if (box.dataset.uiTouched) continue;
      const flag = ui[camel(box.dataset.ui)];
      box.checked = flag !== false;
    }

    for (const input of form.querySelectorAll("[data-field]")) {
      const name = input.dataset.field;
      if (textFields.includes(name)) {
        if (!input.dataset.touched) input.value = values[name] || "";
      } else {
        input.value = "";
        input.dataset.touched = "";
      }
    }

    const hints = {
      deepseek_api_key: secrets.deepseek_api_key
        ? "已配置。留空保持不变。"
        : auto.deepseek
          ? "未单独配置，正在使用 ZCode DeepSeek 供应商的 Key。"
          : "未配置。",
      zcode_jwt_token: secrets.zcode_jwt_token
        ? "已配置。留空保持不变。"
        : auto.zcodeToken
          ? "未单独配置，正在使用 ZCode 登录凭据。"
          : "未配置。",
      volc_access_key_id: secrets.volc_access_key_id
        ? "已配置。留空保持不变。"
        : auto.volcano
          ? "已从环境变量或 ZCode 配置中检测到 AK/SK。"
          : "未配置火山 AK/SK，无法查询官方余额。",
    };
    for (const hint of form.querySelectorAll("[data-hint]")) {
      hint.textContent = hints[hint.getAttribute("data-hint")] || "";
    }
  }

  async function saveSettings() {
    if (modalState.settings.saving) return;
    const form = modalShadow.querySelector("form");
    const status = modalShadow.querySelector('[data-el="settings-status"]');
    const values = {};
    for (const input of form.querySelectorAll("[data-field]")) {
      const name = input.dataset.field;
      const value = String(input.value || "").trim();
      const isSecret = ["deepseek_api_key", "volc_secret_access_key", "zcode_jwt_token"].includes(name);
      if (isSecret) {
        if (value) values[name] = value;
      } else {
        values[name] = value;
      }
      input.dataset.touched = "1";
    }
    for (const box of form.querySelectorAll("[data-ui]")) {
      values[box.dataset.ui] = box.checked ? "1" : "0";
      box.dataset.uiTouched = "";
    }
    if (!Object.keys(values).length) {
      status.textContent = "没有需要保存的修改。";
      status.className = "status";
      return;
    }
    modalState.settings.saving = true;
    status.textContent = "保存中…";
    status.className = "status";
    try {
      await bridgeRequest("save-settings", { values });
      status.textContent = "已保存，正在刷新余额…";
      status.className = "status ok";
      for (const input of form.querySelectorAll("[data-field]")) {
        if (["deepseek_api_key", "volc_secret_access_key", "zcode_jwt_token"].includes(input.dataset.field)) {
          input.value = "";
          input.dataset.touched = "";
        }
      }
    } catch (error) {
      status.textContent = `保存失败：${error.message || error}`;
      status.className = "status err";
    } finally {
      modalState.settings.saving = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Analytics pane                                                      */
  /* ------------------------------------------------------------------ */

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function dateKey(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function hourKey(d) {
    return `${dateKey(d)} ${pad2(d.getHours())}:00`;
  }

  function localMidnight(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function mondayOf(date) {
    const d = localMidnight(date);
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return d;
  }

  function parseDateInput(value) {
    if (!value) return null;
    const parts = String(value).split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setHours(0, 0, 0, 0);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function computeRange(a) {
    const now = new Date();
    let start;
    let end;
    let bucket = "day";
    if (a.range === "yesterday") {
      start = localMidnight(now);
      start.setDate(start.getDate() - 1);
      end = new Date(start);
      end.setDate(end.getDate() + 1);
      bucket = "hour";
    } else if (a.range === "week") {
      start = mondayOf(now);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
    } else if (a.range === "month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else if (a.range === "custom") {
      start = parseDateInput(a.customStart);
      end = parseDateInput(a.customEnd);
      if (!start) start = localMidnight(now);
      if (!end) end = new Date(start);
      end = new Date(end);
      end.setDate(end.getDate() + 1);
      if (end <= start) end = new Date(start.getTime() + 24 * 3600 * 1000);
      if (end - start > 62 * 24 * 3600 * 1000) bucket = "week";
    } else {
      start = localMidnight(now);
      end = new Date(start);
      end.setDate(end.getDate() + 1);
      bucket = "hour";
    }
    return { start: start.getTime(), end: end.getTime(), bucket };
  }

  async function loadAnalytics() {
    const a = modalState.analytics;
    if (!a.customStart || !a.customEnd) {
      const today = dateKey(new Date());
      if (!a.customStart) a.customStart = today;
      if (!a.customEnd) a.customEnd = today;
    }
    const range = computeRange(a);
    a.loading = true;
    a.error = null;
    renderAnalytics();
    try {
      const project = a.project ? JSON.parse(a.project) : null;
      const data = await bridgeRequest("analytics", {
        args: {
          start: range.start,
          end: range.end,
          bucket: range.bucket,
          projectId: project?.id || "",
          directory: project?.directory || "",
          sessionId: a.task || "",
          provider: a.provider === "all" ? "" : a.provider,
        },
      });
      if (!data || data.ok === false) {
        throw new Error((data?.error && (data.error.message || data.error)) || "查询失败");
      }
      a.data = data;
      syncFilterOptions();
    } catch (error) {
      a.error = error.message || String(error);
    } finally {
      a.loading = false;
      if (modalState.tab === "analytics") renderAnalytics();
    }
  }

  function projectValue(project) {
    return JSON.stringify({ id: project.id, directory: project.directory });
  }

  function syncFilterOptions() {
    const data = modalState.analytics.data;
    if (!data) return;
    const projectSel = modalShadow.querySelector('[data-el="project"]');
    const taskSel = modalShadow.querySelector('[data-el="task"]');
    const a = modalState.analytics;

    if (projectSel) {
      const current = a.project;
      projectSel.innerHTML =
        `<option value="">全部项目</option>` +
        (data.projects || [])
          .map((p) => `<option value="${esc(projectValue(p))}">${esc(p.label || p.directory || p.id)}</option>`)
          .join("");
      projectSel.value = current;
      if (projectSel.value !== current) {
        a.project = "";
        projectSel.value = "";
      }
    }

    if (taskSel) {
      const tasks = (data.tasks || []).filter((t) => {
        if (!a.project) return true;
        try {
          const p = JSON.parse(a.project);
          return t.projectId === p.id && (!p.directory || t.directory === p.directory);
        } catch {
          return true;
        }
      });
      taskSel.innerHTML =
        `<option value="">全部任务</option>` +
        tasks.map((t) => `<option value="${esc(t.id)}">${esc(t.title || t.id)}</option>`).join("");
      taskSel.value = a.task;
      if (taskSel.value !== a.task) {
        a.task = "";
        taskSel.value = "";
      }
    }
  }

  function syncFilterUI() {
    if (!modalBuilt) return;
    const a = modalState.analytics;
    for (const btn of modalShadow.querySelectorAll("[data-range]")) {
      btn.classList.toggle("active", btn.getAttribute("data-range") === a.range);
    }
    const custom = modalShadow.querySelector('[data-el="custom-range"]');
    if (custom) custom.classList.toggle("show", a.range === "custom");
    for (const btn of modalShadow.querySelectorAll("[data-metric]")) {
      btn.classList.toggle("active", btn.getAttribute("data-metric") === a.metric);
    }
    const start = modalShadow.querySelector('[data-el="custom-start"]');
    const end = modalShadow.querySelector('[data-el="custom-end"]');
    if (start && !start.value) start.value = a.customStart;
    if (end && !end.value) end.value = a.customEnd;
    const provider = modalShadow.querySelector('[data-el="provider"]');
    if (provider) {
      if (!provider.options.length) {
        provider.innerHTML = PROVIDERS.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
      }
      provider.value = a.provider;
    }
  }

  function seriesRows(r) {
    const data = r.data;
    const range = r.range || {};
    const map = new Map();
    for (const point of data?.series || []) map.set(String(point.key), point);

    const rows = [];
    const start = new Date(range.start);
    const end = new Date(range.end);
    if (range.bucket === "hour") {
      const cursor = new Date(start);
      while (cursor < end) {
        const key = hourKey(cursor);
        rows.push({ key, label: `${pad2(cursor.getHours())}:00`, point: map.get(key) || null });
        cursor.setHours(cursor.getHours() + 1);
      }
    } else if (range.bucket === "week") {
      const cursor = mondayOf(start);
      const endTime = end.getTime();
      while (cursor.getTime() < endTime) {
        const key = dateKey(cursor);
        rows.push({
          key,
          label: `${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`,
          point: map.get(key) || null,
        });
        cursor.setDate(cursor.getDate() + 7);
      }
    } else {
      const cursor = localMidnight(start);
      const endTime = end.getTime();
      while (cursor.getTime() < endTime) {
        const key = dateKey(cursor);
        rows.push({
          key,
          label: `${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`,
          point: map.get(key) || null,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return rows;
  }

  function pointProviderValue(point, provider, metric) {
    const entry = point?.providers?.[provider];
    if (!entry) return 0;
    return metric === "cost" ? Number(entry.cost) || 0 : Number(entry.tokens) || 0;
  }

  function chartSvg(rows, metric, colors) {
    const W = 760;
    const H = 232;
    const padL = 46;
    const padR = 8;
    const padT = 10;
    const padB = 26;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const n = Math.max(1, rows.length);
    const slot = innerW / n;
    const barW = Math.max(2, Math.min(30, slot * 0.68));

    let max = 0;
    for (const row of rows) {
      let sum = 0;
      for (const provider of PROVIDER_ORDER) sum += pointProviderValue(row.point, provider, metric);
      if (sum > max) max = sum;
    }
    if (!(max > 0)) max = 1;

    const y = (value) => padT + innerH - (value / max) * innerH;
    const parts = [];
    parts.push(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="消耗堆叠柱状图">`);
    parts.push(`<title>消耗趋势</title><desc>按时间分桶并按供应商堆叠的消耗柱状图</desc>`);
    for (let i = 0; i <= 4; i += 1) {
      const value = (max / 4) * i;
      const yPos = y(value);
      parts.push(`<line x1="${padL}" y1="${yPos}" x2="${W - padR}" y2="${yPos}" stroke="var(--bd-border)" stroke-width="1" />`);
      const label = metric === "cost" ? `¥${value.toFixed(1)}` : tokens(value);
      parts.push(`<text x="${padL - 6}" y="${yPos + 3}" text-anchor="end">${esc(label)}</text>`);
    }

    const labelEvery = Math.max(1, Math.ceil(n / 9));
    rows.forEach((row, index) => {
      const x = padL + slot * index + (slot - barW) / 2;
      let base = padT + innerH;
      const tipRows = [];
      for (const provider of PROVIDER_ORDER) {
        const value = pointProviderValue(row.point, provider, metric);
        if (!(value > 0)) continue;
        const height = (value / max) * innerH;
        const yPos = base - height;
        const fill = colors[PROVIDER_ORDER.indexOf(provider)] || colors[0];
        const tipValue = metric === "cost" ? moneyCny(value) : `${tokens(value)} tok`;
        tipRows.push(`<div class="tip-row"><span><i style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${fill};margin-right:4px"></i>${esc(PROVIDER_LABEL[provider] || provider)}</span><b>${esc(tipValue)}</b></div>`);
        const tip = `<div class="tip-title">${esc(row.key)}</div>${tipRows.join("")}`;
        parts.push(
          `<rect class="seg" x="${x.toFixed(2)}" y="${yPos.toFixed(2)}" width="${barW.toFixed(2)}" height="${Math.max(0.6, height).toFixed(2)}" rx="1.5" fill="${fill}" data-tip="${esc(tip)}" />`,
        );
        base = yPos;
      }
      if (index % labelEvery === 0) {
        parts.push(`<text x="${(x + barW / 2).toFixed(2)}" y="${H - 8}" text-anchor="middle">${esc(row.label)}</text>`);
      }
    });
    parts.push("</svg>");
    return parts.join("");
  }

  function providerColor(provider, t) {
    const idx = PROVIDER_ORDER.indexOf(provider);
    return t.chart[idx >= 0 ? idx % t.chart.length : t.chart.length - 1];
  }

  function renderAnalytics() {
    if (!modalBuilt) return;
    const a = modalState.analytics;
    const results = modalShadow.querySelector('[data-el="results"]');
    if (!results) return;
    const t = theme();

    if (a.loading) {
      results.innerHTML = `<div class="loading-inline">正在统计…</div>`;
      return;
    }
    if (a.error) {
      results.innerHTML = `<div class="empty">统计失败：${esc(a.error)}</div>`;
      return;
    }
    const data = a.data;
    if (!data) {
      results.innerHTML = `<div class="empty">选择时间范围后开始统计</div>`;
      return;
    }
    const summary = data.summary || {};
    if (!summary.totalTokens && !summary.requests && !(data.series || []).length) {
      results.innerHTML = `<div class="empty">该区间没有消耗记录</div>`;
      return;
    }

    const range = computeRange(a);
    const rows = seriesRows({ data, range });
    const metric = a.metric;
    const svg = chartSvg(rows, metric, t.chart);

    const providerBars = (data.providers || [])
      .map((p) => {
        const share = Math.max(0, Math.min(1, Number(p.share) || 0));
        return `<div class="share-row">
          <span class="share-name" title="${esc(p.label || p.id)}">${esc(p.label || p.id)}</span>
          <span class="share-track"><i style="width:${(share * 100).toFixed(1)}%;background:${providerColor(p.id, t)}"></i></span>
          <span class="share-val">${tokens(p.tokens)}</span>
        </div>`;
      })
      .join("");

    const modelRows = (data.models || [])
      .slice(0, 8)
      .map(
        (m) => `<div class="list-row">
          <span class="lr-main" title="${esc(m.modelId)}">${esc(m.modelId)}<span class="lr-sub"> · ${esc(PROVIDER_LABEL[m.bucket] || m.bucket)}</span></span>
          <span class="lr-val">${tokens(m.tokens)}</span>
        </div>`,
      )
      .join("");

    const projectRows = (data.projects || [])
      .slice(0, 6)
      .map(
        (p) => `<div class="list-row">
          <span class="lr-main" title="${esc(p.directory)}">${esc(p.label || p.directory)}<span class="lr-sub"> · ${p.sessions} 个会话</span></span>
          <span class="lr-val">${tokens(p.tokens)}</span>
        </div>`,
      )
      .join("");

    const taskRows = (data.tasks || [])
      .slice(0, 6)
      .map(
        (task) => `<div class="list-row">
          <span class="lr-main" title="${esc(task.title)}">${esc(task.title)}</span>
          <span class="lr-val">${tokens(task.tokens)}</span>
        </div>`,
      )
      .join("");

    const legend = PROVIDER_ORDER.filter((p) => (data.providers || []).some((item) => item.id === p))
      .map(
        (p) =>
          `<span><i style="background:${providerColor(p, t)}"></i>${esc(PROVIDER_LABEL[p] || p)}</span>`,
      )
      .join("");

    const hiddenTable = `<table class="sr"><caption>消耗数据</caption><thead><tr><th>时间</th><th>Token</th><th>费用</th></tr></thead><tbody>${rows
      .map((row) => {
        let tok = 0;
        let cost = 0;
        for (const provider of PROVIDER_ORDER) {
          tok += pointProviderValue(row.point, provider, "tokens");
          cost += pointProviderValue(row.point, provider, "cost");
        }
        return `<tr><td>${esc(row.key)}</td><td>${tok}</td><td>${cost.toFixed(2)}</td></tr>`;
      })
      .join("")}</tbody></table>`;

    results.innerHTML = `
      <div class="summary-cards">
        <div class="s-card"><div class="s-label">总 Token</div><div class="s-value">${tokens(summary.totalTokens)}</div><div class="s-sub">输入 ${tokens(summary.inputTokens)} · 输出 ${tokens(summary.outputTokens)}</div></div>
        <div class="s-card"><div class="s-label">估算费用</div><div class="s-value">${moneyCny(summary.cost)}</div><div class="s-sub">按公开牌价估算</div></div>
        <div class="s-card"><div class="s-label">请求 / 会话</div><div class="s-value">${summary.requests}</div><div class="s-sub">${summary.sessions} 个会话 · ${summary.attempts} 次尝试</div></div>
      </div>
      <div class="chart-box">
        <div class="chart-title">
          <span>消耗趋势</span>
          <span class="legend">${legend}</span>
        </div>
        <div class="chart">${svg}</div>
        <div class="chart-tip"></div>
      </div>
      <div class="dual">
        <div class="box"><div class="box-title">供应商占比</div>${providerBars || '<div class="empty">暂无数据</div>'}</div>
        <div class="box"><div class="box-title">Top 模型</div>${modelRows || '<div class="empty">暂无数据</div>'}</div>
      </div>
      <div class="dual">
        <div class="box"><div class="box-title">项目消耗</div>${projectRows || '<div class="empty">暂无数据</div>'}</div>
        <div class="box"><div class="box-title">任务消耗</div>${taskRows || '<div class="empty">暂无数据</div>'}</div>
      </div>
      ${hiddenTable}`;
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  function themeSignature() {
    const t = theme();
    return [t.dark, t.fg, t.muted, t.border, t.panel, t.card, t.accent].join("|");
  }

  function syncTheme() {
    if (disposed) return;
    lastThemeSignature = themeSignature();
    applyWidgetTheme();
    if (!modalHost) return;
    applyModalTheme();
    if (dialog && dialog.open && modalState.tab === "analytics" && modalState.analytics.data) {
      renderAnalytics();
    }
  }

  function checkTheme() {
    if (disposed) return;
    if (themeSignature() === lastThemeSignature) return;
    syncTheme();
  }

  function scheduleThemeSync() {
    if (disposed || themeTimer) return;
    themeTimer = window.setTimeout(() => {
      themeTimer = null;
      checkTheme();
    }, 120);
  }

  function dispose() {
    disposed = true;
    if (retryTimer) clearInterval(retryTimer);
    if (visibilityTimer) clearInterval(visibilityTimer);
    if (ensureTimer) clearTimeout(ensureTimer);
    if (observer) {
      try {
        observer.disconnect();
      } catch {
        // ignore
      }
    }
    if (themeObserver) {
      try {
        themeObserver.disconnect();
      } catch {
        // ignore
      }
    }
    if (themeTimer) clearTimeout(themeTimer);
    for (const entry of pendingRequests.values()) {
      try {
        entry.reject(new Error("组件已卸载"));
      } catch {
        // ignore
      }
    }
    pendingRequests.clear();
    if (root) {
      try {
        root.remove();
      } catch {
        // ignore
      }
    }
    if (modalHost) {
      try {
        modalHost.remove();
      } catch {
        // ignore
      }
    }
    root = null;
    shadow = null;
    modalHost = null;
    modalShadow = null;
    dialog = null;
    modalBuilt = false;
    delete window.__balanceDashboardPush;
    delete window.__balanceDashboardDispose;
    delete window.__balanceDashboardConfig;
    delete window.__balanceDashboardRequestResult;
  }

  window.__balanceDashboardPush = (data) => {
    latest = data && typeof data === "object" ? data : null;
    render();
    updateVisibility();
  };
  window.__balanceDashboardDispose = dispose;

  try {
    observer = new MutationObserver(() => {
      if (!root || !root.isConnected) {
        scheduleEnsure();
        return;
      }
      const aside = findAside();
      if (aside) {
        const { parent, anchor } = resolveMount(aside);
        if (parent && anchor && root.parentElement === parent && root.nextElementSibling !== anchor) {
          try {
            parent.insertBefore(root, anchor);
          } catch {
            // ignore
          }
        } else if (parent && root.parentElement !== parent) {
          scheduleEnsure();
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  } catch {
    // MutationObserver is optional; the interval below still re-asserts
  }

  try {
    themeObserver = new MutationObserver(scheduleThemeSync);
    const themeOptions = { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-color-scheme"] };
    themeObserver.observe(document.documentElement, themeOptions);
    themeObserver.observe(document.body, themeOptions);
  } catch {
    // theme changes are also caught by the periodic signature check below
  }
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", scheduleThemeSync);
  } catch {
    // older webview
  }
  lastThemeSignature = themeSignature();

  retryTimer = window.setInterval(() => {
    if (!root || !root.isConnected) ensureMounted();
    else updateVisibility();
  }, RETRY_MS);
  visibilityTimer = window.setInterval(() => {
    updateVisibility();
    checkTheme();
  }, 2500);

  ensureMounted();
  render();
})();
