const { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } = window.McpApps;

const DEFAULT_POLL_MS = 10000;
const POLL_KEY = "turnlens.pollMs";
const POLL_OPTIONS = [5000, 10000, 30000, 60000];
const APP_VERSION = "0.11.0";
const THEME_KEY = "turnlens.theme";
const THEMES = ["auto", "light", "dark", "contrast"];
const THEME_LABELS = {
  auto: "跟随 ZCode",
  light: "白色浅色",
  dark: "深色",
  contrast: "高对比度深色",
};
const app = new App(
  { name: "TurnLens", version: APP_VERSION },
  { availableDisplayModes: ["inline", "fullscreen"] },
  { autoResize: true },
);
const root = document.getElementById("app");
const statusEl = document.getElementById("status");
const refreshButton = document.getElementById("refresh");
const themeButton = document.getElementById("theme");
const titleEl = document.getElementById("app-title");
const autoToggle = document.getElementById("auto-toggle");
const autoNote = document.getElementById("auto-note");

let pollTimer = null;
let refreshing = false;
let savingAuto = false;
let autoDisplayEnabled = false;
let autoDisplayReason = null;
let hasRendered = false;
let themeMode = "auto";
let currentLocale = "";
let pollMs = readPollMs();

const COLUMNS_KEY = "turnlens.columns";
const ALIGN_KEY = "turnlens.align.v2";
const WIDTHS_KEY = "turnlens.widths";
const COLUMN_OPTIONS = [
  { id: "turn", label: "轮次 / 缓存命中率" },
  { id: "status", label: "状态" },
  { id: "step", label: "工具 / 模型用时" },
  { id: "speed", label: "TTFT / TPS" },
  { id: "user", label: "用户输入" },
  { id: "context", label: "上下文长度 / 增量" },
  { id: "tokens", label: "模型输入 / 输出" },
  { id: "requests", label: "请求次数 / 错误" },
];
const DEFAULT_WIDTHS = {
  turn: 70,
  status: 70,
  step: 70,
  speed: 70,
  user: 70,
  context: 70,
  tokens: 70,
  requests: 70,
};
const ALIGNMENTS = ["left", "center", "right"];
let hiddenColumns = readHiddenColumns();
let tableAlign = readTableAlign();
let columnWidths = readColumnWidths();
let lastTurns = [];
let lastHasContext = false;

function byId(id) {
  return document.getElementById(id);
}

function readPollMs() {
  try {
    const saved = Number(localStorage.getItem(POLL_KEY));
    return POLL_OPTIONS.includes(saved) ? saved : DEFAULT_POLL_MS;
  } catch {
    return DEFAULT_POLL_MS;
  }
}

function savePollMs() {
  try {
    localStorage.setItem(POLL_KEY, String(pollMs));
  } catch {
    // The choice still applies to this session when storage is unavailable.
  }
}

function pollText(ms) {
  return `每 ${Math.round(ms / 1000)} 秒`;
}

function readHiddenColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_KEY) || "[]");
    if (!Array.isArray(saved)) return new Set();
    return new Set(saved.filter((id) => COLUMN_OPTIONS.some((option) => option.id === id)));
  } catch {
    return new Set();
  }
}

function saveHiddenColumns() {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify([...hiddenColumns]));
  } catch {
    // Persistence is optional; the current session still uses the in-memory choice.
  }
}

function readTableAlign() {
  try {
    const saved = localStorage.getItem(ALIGN_KEY);
    return ALIGNMENTS.includes(saved) ? saved : "left";
  } catch {
    return "left";
  }
}

function saveTableAlign() {
  try {
    localStorage.setItem(ALIGN_KEY, tableAlign);
  } catch {
    // Ignore unavailable storage.
  }
}

function readColumnWidths() {
  const widths = { ...DEFAULT_WIDTHS };
  try {
    const saved = JSON.parse(localStorage.getItem(WIDTHS_KEY) || "{}");
    if (saved && typeof saved === "object") {
      for (const id of Object.keys(DEFAULT_WIDTHS)) {
        const value = Number(saved[id]);
        if (Number.isFinite(value) && value >= 40 && value <= 320) widths[id] = Math.round(value);
      }
    }
  } catch {
    // Use defaults.
  }
  return widths;
}

function saveColumnWidths() {
  try {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(columnWidths));
  } catch {
    // Ignore unavailable storage.
  }
}

function cacheLevel(rate) {
  if (rate === null || rate === undefined || rate === "") return 0;
  const value = Number(rate);
  if (!Number.isFinite(value)) return 0;
  if (value >= 0.95) return 1;
  if (value >= 0.85) return 2;
  if (value >= 0.7) return 3;
  if (value >= 0.5) return 4;
  return 5;
}

function setCacheTone(element, rate) {
  if (!element) return;
  for (let level = 1; level <= 5; level += 1) {
    element.classList.remove(`cache-${level}`);
  }
  const level = cacheLevel(rate);
  if (level > 0) element.classList.add(`cache-${level}`);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}分${seconds}秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours}小时${minutes % 60}分`;
}

function formatTtft(ms) {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}毫秒`;
  return `${(ms / 1000).toFixed(1)}秒`;
}

function formatTps(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} tok/s`;
}

const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function formatCompact(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0";
  if (number >= 100_000_000) return `${NUMBER_FORMAT.format(number / 100_000_000)}亿`;
  if (number >= 10_000) return `${NUMBER_FORMAT.format(number / 10_000)}万`;
  return NUMBER_FORMAT.format(Math.round(number));
}

function formatTokens(value) {
  return formatCompact(value);
}

function formatExact(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0";
  return NUMBER_FORMAT.format(Math.round(number));
}

function formatSignedCompact(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number === 0) return "0";
  return `${number > 0 ? "+" : "-"}${formatCompact(Math.abs(number))}`;
}

function formatSignedExact(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number === 0) return "0";
  return `${number > 0 ? "+" : "-"}${formatExact(Math.abs(number))}`;
}

function formatPercent(rate) {
  if (rate === null || rate === undefined || rate === "") return "—";
  const number = Number(rate);
  if (!Number.isFinite(number)) return "—";
  return `${Math.min(100, Math.max(0, Math.round(number * 100)))}%`;
}

function percent(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

const SPEED_LABELS = ["很快", "较快", "一般", "较慢", "很慢"];

function speedLevel(kind, value) {
  if (!Number.isFinite(value)) return 0;
  if (kind === "tool") {
    if (value < 60_000) return 1;
    if (value < 180_000) return 2;
    if (value < 600_000) return 3;
    if (value < 1_800_000) return 4;
    return 5;
  }
  if (kind === "ttft") {
    if (value < 1000) return 1;
    if (value < 2000) return 2;
    if (value < 4000) return 3;
    if (value < 8000) return 4;
    return 5;
  }
  if (value >= 100) return 1;
  if (value >= 60) return 2;
  if (value >= 30) return 3;
  if (value >= 10) return 4;
  return 5;
}

function setSpeed(element, kind, value, detail = "", withTip = true) {
  for (let level = 1; level <= 5; level += 1) {
    element.classList.remove(`speed-${level}`);
  }
  const level = speedLevel(kind, value);
  if (level > 0) {
    element.classList.add(`speed-${level}`);
    if (withTip) {
      element.dataset.tip = detail ? `${detail} · ${SPEED_LABELS[level - 1]}` : SPEED_LABELS[level - 1];
    }
  } else if (withTip) {
    delete element.dataset.tip;
  }
}

function applySpeed(id, kind, value, detail = "") {
  setSpeed(byId(id), kind, value, detail);
}

function setAutoDisplayState(enabled, reason) {
  autoDisplayEnabled = enabled;
  autoDisplayReason = reason;
  autoToggle.setAttribute("aria-checked", String(enabled));
  autoToggle.disabled = reason === "env";
  autoToggle.dataset.tip = enabled ? "关闭单轮统计卡" : "开启单轮统计卡";
  if (reason === "env") {
    autoNote.textContent = "已被环境变量禁用";
  } else if (reason === "plugin" || reason === "global" || reason === "project") {
    autoNote.textContent = "所有会话 · 已关闭";
  } else {
    autoNote.textContent = enabled ? "所有会话 · 每轮结束后显示 · 会多一次模型请求" : "所有会话 · 已关闭";
  }
}

function statusLabel(turn) {
  if (turn.active) return "进行中";
  switch (String(turn.status)) {
    case "completed":
      return "完成";
    case "error":
      return "出错";
    case "cancelled":
      return "取消";
    default:
      return turn.status || "完成";
  }
}

function statusClass(turn) {
  if (turn.active) return "active";
  const status = String(turn.status);
  return status === "error" || status === "cancelled" ? status : "completed";
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
  statusEl.hidden = !text;
}

function setState(state) {
  root.dataset.state = state;
}

function applyHostContext(context) {
  applyLocale(context);
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

function applyLocale(context) {
  const locale = String(
    context?.locale || context?.language || currentLocale || navigator.language || "zh-CN",
  );
  currentLocale = locale;
  const zh = /^zh/i.test(locale);
  if (titleEl) titleEl.textContent = zh ? "会话统计" : "Session Stats";
  document.documentElement.lang = zh ? "zh-CN" : "en";
  document.title = zh ? "会话统计" : "Session Stats";
}

function readSavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.includes(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

function applyTheme(mode, persist = false) {
  const next = THEMES.includes(mode) ? mode : "auto";
  themeMode = next;
  if (next === "auto") {
    delete document.documentElement.dataset.themeMode;
  } else {
    document.documentElement.dataset.themeMode = next;
  }
  if (themeButton) {
    const label = THEME_LABELS[next];
    themeButton.dataset.tip = `主题：${label}\n点击切换`;
    themeButton.setAttribute("aria-label", `切换主题（当前：${label}）`);
  }
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // localStorage can be unavailable in a sandboxed host; the theme still applies for this session.
    }
  }
}

function cycleTheme() {
  const index = THEMES.indexOf(themeMode);
  applyTheme(THEMES[(index + 1) % THEMES.length], true);
}

function render(data) {
  if (!data || data.ok === false) {
    throw new Error(data?.error || "无法读取会话统计");
  }
  if (data.pluginVersion && data.pluginVersion !== APP_VERSION) {
    window.location.reload();
    return;
  }

  const totals = data.totals || {};
  const modelMs = Number(totals.modelMs) || 0;
  const toolMs = Number(totals.toolMs) || 0;
  const requestCount = Number(totals.requests) || 0;
  byId("summary-turns").textContent = formatCompact(totals.turns ?? 0);
  byId("summary-steps").textContent = formatCompact(totals.steps ?? 0);
  byId("summary-requests").textContent = formatCompact(requestCount);
  byId("model-time").textContent = formatDuration(totals.modelMs);
  byId("tool-time").textContent = formatDuration(totals.toolMs);
  byId("ttft").textContent = formatTtft(totals.avgTtftMs);
  byId("tps").textContent = formatTps(totals.tps);
  applySpeed("tool-time", "tool", toolMs);
  applySpeed("ttft", "ttft", totals.avgTtftMs);
  applySpeed("tps", "tps", totals.tps);
  const inputTokens = Number(totals.inputTokens) || 0;
  const outputTokens = Number(totals.outputTokens) || 0;
  const totalTokens = Number.isFinite(Number(totals.totalTokens))
    ? Number(totals.totalTokens)
    : inputTokens + outputTokens;
  const cacheReadTokens = Number(totals.cacheReadTokens) || 0;
  const cacheHitRate =
    totals.cacheHitRate !== null && totals.cacheHitRate !== undefined
      ? Number(totals.cacheHitRate)
      : inputTokens > 0
        ? cacheReadTokens / inputTokens
        : null;
  const uncachedTokens = Math.max(0, inputTokens - cacheReadTokens);
  byId("input-tokens").textContent = formatTokens(inputTokens);
  byId("output-tokens").textContent = formatTokens(outputTokens);
  byId("total-tokens").textContent = formatTokens(totalTokens);
  byId("cache-hit-rate").textContent = formatPercent(cacheHitRate);
  byId("cache-read").textContent = formatTokens(cacheReadTokens);
  byId("cache-uncached").textContent = formatTokens(uncachedTokens);

  const splitBase = totalTokens > 0 ? totalTokens : 1;
  byId("input-split").style.width = `${totalTokens > 0 ? (inputTokens / splitBase) * 100 : 0}%`;
  byId("output-split").style.width = `${totalTokens > 0 ? (outputTokens / splitBase) * 100 : 0}%`;
  const cachePercent =
    Number.isFinite(cacheHitRate) ? Math.min(100, Math.max(0, cacheHitRate * 100)) : 0;
  byId("cache-bar").style.width = `${cachePercent}%`;
  setCacheTone(byId("cache-hit-rate"), cacheHitRate);
  setCacheTone(byId("cache-bar"), cacheHitRate);

  byId("summary-meta").dataset.tip = [
    "• 轮次：会话中的已完成轮次数",
    "• 步数：工具调用次数，按 tool_call_id 去重",
    `• 主轮请求：${formatCompact(requestCount)} 次主轮模型请求`,
  ].join("\n");
  byId("total-card").dataset.tip = [
    `• 累计消耗 ${formatTokens(totalTokens)} tokens`,
    `• 模型输入 ${formatTokens(inputTokens)} tokens`,
    `• 模型输出 ${formatTokens(outputTokens)} tokens`,
  ].join("\n");
  byId("cache-card").dataset.tip = [
    `• 平均缓存命中率 ${formatPercent(cacheHitRate)}`,
    `• 缓存读取 ${formatTokens(cacheReadTokens)} tokens`,
    `• 未缓存读取 ${formatTokens(uncachedTokens)} tokens`,
    "• 未缓存读取 = 模型输入 − 缓存读取",
  ].join("\n");
  byId("updated").textContent = data.generatedAt ? `统计截至 ${data.generatedAt}` : "—";

  const totalMs = modelMs + toolMs;
  byId("bar-model").style.width = `${totalMs > 0 ? (modelMs / totalMs) * 100 : 0}%`;
  byId("bar-tool").style.width = `${totalMs > 0 ? (toolMs / totalMs) * 100 : 0}%`;
  byId("model-pct").textContent = percent(modelMs, totalMs);
  byId("tool-pct").textContent = percent(toolMs, totalMs);
  byId("model-bar-time").textContent = formatDuration(modelMs);
  byId("tool-bar-time").textContent = formatDuration(toolMs);
  byId("bar-total").textContent = totalMs > 0 ? `合计 ${formatDuration(totalMs)}` : "—";

  if (!savingAuto) {
    setAutoDisplayState(data.autoDisplayEnabled !== false, data.autoDisplayReason || null);
  }

  const turns = Array.isArray(data.turns) ? data.turns : [];
  byId("turn-count").textContent = turns.length > 0 ? `共 ${formatCompact(turns.length)} 轮` : "";
  renderTurns(turns);

  if (data.empty) {
    setState("empty");
    setStatus("等待下一轮");
  } else {
    setState("ready");
    setStatus("");
  }
  hasRendered = true;
}

function makeLine(text, className = "line") {
  const line = document.createElement("span");
  line.className = className;
  line.textContent = text;
  return line;
}

function makeTh(def) {
  const th = document.createElement("span");
  const pair = Array.isArray(def.labels);
  th.className = `th${def.num ? " th-num" : ""}${pair ? " th-pair" : ""}`;
  if (pair) {
    for (const label of def.labels) {
      const span = document.createElement("span");
      span.className = "th-label";
      span.textContent = label;
      th.appendChild(span);
    }
  } else {
    th.textContent = def.labels;
  }
  if (def.tip) th.dataset.tip = def.tip;
  return th;
}

function getVisibleColumns(hasContext) {
  const columns = [];
  for (const option of COLUMN_OPTIONS) {
    if (option.id === "context" && !hasContext) continue;
    if (!hiddenColumns.has(option.id)) columns.push(option.id);
  }
  return columns;
}

function applyColumnWidths(table, columns) {
  const widths = columns.map((id) => `${columnWidths[id] ?? DEFAULT_WIDTHS[id]}px`);
  const total = columns.reduce((sum, id) => sum + (columnWidths[id] ?? DEFAULT_WIDTHS[id]), 0);
  table.style.setProperty("--turn-cols", widths.join(" "));
  table.style.minWidth = `${total + 7 * Math.max(0, columns.length - 1) + 28}px`;
  table.dataset.align = tableAlign;
  table.dataset.columns = String(columns.length);
}

function setupColumnResizer(handle, column, columns) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column] ?? DEFAULT_WIDTHS[column];
    const minimum = column === "turn" ? 56 : column === "status" ? 60 : 44;
    const move = (moveEvent) => {
      const next = Math.round(Math.max(minimum, Math.min(320, startWidth + moveEvent.clientX - startX)));
      if (next === columnWidths[column]) return;
      columnWidths[column] = next;
      applyColumnWidths(byId("turns-table"), columns);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.classList.remove("col-resizing");
      handle.classList.remove("dragging");
      saveColumnWidths();
    };
    handle.classList.add("dragging");
    document.body.classList.add("col-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  });
}

function renderTurnsHead(hasContext, head, columns) {
  const turnTip = "• 轮次：会话中的第几轮\n• 缓存命中率：缓存读取 tokens ÷ 模型输入 tokens\n• 缓存命中率按高低分级着色";
  const statusTip = "状态：完成、进行中、出错或取消";
  const stepTip =
    "• 工具步数：工具调用次数，按 tool_call_id 去重\n• 模型用时：主轮模型请求区间的并集";
  const speedTip = "• TTFT：首 token 平均延迟\n• TPS：输出速度，单位 tok/s";
  const tokenTip =
    "• 模型输入：本轮所有主轮请求的输入 tokens 之和，含重复上下文和缓存命中\n• 模型输出：本轮所有主轮请求的输出 tokens 之和";
  const requestTip =
    "• 模型请求次数：本轮主轮模型请求次数\n• 工具请求错误：工具调用中 status=error 的次数";
  const contextTip =
    "• 上下文长度：本轮主轮请求的最大输入 tokens，含缓存命中\n• 上下文增量：本轮上下文长度减上一轮上下文长度\n• 负数表示上下文被压缩";
  const inputTip =
    "• 用户输入：按用户消息文本估算\n• 上下文长度：本轮主轮请求的最大输入 tokens，含缓存命中";

  const userLabels = hasContext ? "用户输入" : ["用户输入", "上下文长度"];
  const definitions = {
    turn: { labels: ["轮次", "缓存命中率"], tip: turnTip },
    status: { labels: "状态", tip: statusTip },
    step: { labels: ["工具步数", "模型用时"], num: true, tip: stepTip },
    speed: { labels: ["TTFT", "TPS"], num: true, tip: speedTip },
    user: {
      labels: userLabels,
      num: true,
      tip: hasContext
        ? "用户输入：按用户消息文本估算\nCJK 约 1 字≈1 token，其他约 4 字符≈1 token"
        : inputTip,
    },
    context: { labels: ["上下文长度", "上下文增量"], num: true, tip: contextTip },
    tokens: { labels: ["模型输入", "模型输出"], num: true, tip: tokenTip },
    requests: { labels: ["模型请求次数", "工具请求错误"], num: true, tip: requestTip },
  };

  head.replaceChildren(...columns.map((id) => makeTh(definitions[id])));
  [...head.children].forEach((th, index) => {
    const handle = document.createElement("span");
    handle.className = "col-resizer";
    handle.dataset.col = columns[index];
    handle.title = "拖动调整列宽";
    setupColumnResizer(handle, columns[index], columns);
    th.appendChild(handle);
  });
}

function renderTurns(turns) {
  hideTip();
  const list = byId("turns-list");
  const head = byId("turns-head");
  const table = byId("turns-table");
  const hasTurns = turns.length > 0;
  const hasContext = turns.some((turn) => Number.isFinite(turn.contextDelta));
  lastTurns = turns;
  lastHasContext = hasContext;
  head.hidden = !hasTurns;

  if (!hasTurns) {
    table.dataset.columns = "8";
    head.replaceChildren();
    list.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "当前会话还没有可统计的轮次。运行一轮后，这里会自动更新。";
    list.appendChild(empty);
    return;
  }

  const columns = getVisibleColumns(hasContext);
  if (columns.length === 0) {
    table.dataset.columns = "0";
    head.hidden = true;
    head.replaceChildren();
    list.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "未选择显示列，点「列设置」恢复至少一列。";
    list.appendChild(empty);
    return;
  }
  renderTurnsHead(hasContext, head, columns);
  applyColumnWidths(table, columns);

  const rows = turns.slice().reverse();
  const currentIndex = turns[turns.length - 1]?.index;
  const fragment = document.createDocumentFragment();
  for (const turn of rows) {
    const row = document.createElement("div");
    row.className = "turn-row";

    const index = document.createElement("span");
    index.className = "turn-cell turn-index";
    const cacheRate = formatPercent(turn.cacheHitRate);
    const hasCache =
      turn.cacheHitRate !== null &&
      turn.cacheHitRate !== undefined &&
      turn.cacheHitRate !== "" &&
      Number.isFinite(Number(turn.cacheHitRate));
    const cacheLine = makeLine(cacheRate, "line sub");
    setCacheTone(cacheLine, turn.cacheHitRate);
    index.append(makeLine(String(turn.index ?? ""), "line"), cacheLine);
    const turnTips = [`第 ${turn.index ?? "?"} 轮`];
    if (hasCache) {
      turnTips.push(`缓存命中率：${cacheRate}`);
      turnTips.push(`缓存读取：${formatTokens(turn.cacheReadTokens)} tokens`);
      turnTips.push(`模型输入：${formatTokens(turn.inputTokens)} tokens`);
    } else {
      turnTips.push("本轮没有缓存数据");
    }
    index.dataset.tip = turnTips.join("\n");

    const dot = document.createElement("span");
    dot.className = `turn-dot ${statusClass(turn)}`;

    const status = document.createElement("span");
    status.className = "turn-status";
    const statusLine = document.createElement("span");
    statusLine.className = "turn-status-line";
    const statusText = document.createElement("span");
    statusText.className = "turn-status-text";
    statusText.textContent = statusLabel(turn);
    statusLine.append(dot, statusText);
    status.appendChild(statusLine);
    const badges = document.createElement("span");
    badges.className = "turn-badges";
    const isCurrent = turn.index === currentIndex;
    const guidedCount = Number(turn.guidedInputs) || 0;
    if (isCurrent) {
      const badge = document.createElement("em");
      badge.className = "current-badge";
      badge.textContent = "当前";
      badges.appendChild(badge);
    }
    const compressed =
      turn.compressed === true || (Number.isFinite(turn.contextDelta) && turn.contextDelta < 0);
    if (compressed) {
      const badge = document.createElement("em");
      badge.className = "compress-badge";
      badge.textContent = "压缩";
      badges.appendChild(badge);
    }
    if (guidedCount > 0) {
      const badge = document.createElement("em");
      badge.className = "guide-badge";
      badge.textContent = "引导";
      badges.appendChild(badge);
    }
    if (badges.childElementCount > 0) status.appendChild(badges);
    const statusTips = [`状态：${statusLabel(turn)}`];
    if (isCurrent) statusTips.push("当前轮是会话中最新的一轮");
    if (compressed) statusTips.push("压缩表示本轮上下文长度低于上一轮");
    if (guidedCount > 0) {
      statusTips.push(`引导：本轮含 ${formatCompact(guidedCount)} 次引导输入`);
      statusTips.push("引导输入会把一轮拆成多个工作分段");
    }
    status.dataset.tip = statusTips.join("\n");

    const stepTime = document.createElement("span");
    stepTime.className = "turn-cell";
    stepTime.append(
      makeLine(`${formatCompact(turn.steps ?? 0)} 步`, "line"),
      makeLine(formatDuration(turn.modelMs), "line sub"),
    );
    const stepTips = [
      `工具步数：${formatCompact(turn.steps ?? 0)} 步`,
      `模型用时：${formatDuration(turn.modelMs)}`,
      "按整轮所有主轮请求区间合并",
    ];
    if (Number.isFinite(turn.lastSegmentMs)) {
      stepTips.push(`ZCode 最新分段工作时间：${formatDuration(turn.lastSegmentMs)}`);
    }
    stepTime.dataset.tip = stepTips.join("\n");

    const speed = document.createElement("span");
    speed.className = "turn-cell";
    const ttftLine = makeLine(formatTtft(turn.avgTtftMs), "line");
    setSpeed(ttftLine, "ttft", turn.avgTtftMs, "", false);
    const tpsLine = makeLine(formatTps(turn.tps), "line");
    setSpeed(tpsLine, "tps", turn.tps, "", false);
    speed.append(ttftLine, tpsLine);
    speed.dataset.tip = [
      `TTFT：${formatTtft(turn.avgTtftMs)}`,
      `TPS：${formatTps(turn.tps)}`,
    ].join("\n");

    const contextTokens =
      Number.isFinite(turn.contextTokens) && turn.contextTokens > 0 ? turn.contextTokens : null;
    const contextDelta = Number.isFinite(turn.contextDelta) ? turn.contextDelta : null;

    const userInput = document.createElement("span");
    userInput.className = "turn-cell";
    const userTokens =
      Number.isFinite(turn.userInputTokens) && turn.userInputTokens > 0 ? turn.userInputTokens : null;
    const userTips = [];
    if (userTokens !== null) {
      userTips.push(`用户输入：约 ${formatTokens(userTokens)} tokens`);
      userTips.push("用户输入按用户消息文本估算");
    } else {
      userTips.push("本轮没有读取到用户消息文本");
    }
    if (guidedCount > 0) {
      userTips.push(`含 ${formatCompact(guidedCount)} 次引导输入`);
      if (Number.isFinite(turn.guidedInputTokens) && turn.guidedInputTokens > 0) {
        userTips.push(`引导输入约 ${formatTokens(turn.guidedInputTokens)} tokens`);
      }
    }
    if (hasContext) {
      userInput.classList.add("single");
      userInput.append(makeLine(userTokens !== null ? `约 ${formatCompact(userTokens)}` : "—", "line"));
    } else {
      userInput.append(
        makeLine(userTokens !== null ? `约 ${formatCompact(userTokens)}` : "—", "line"),
        makeLine(contextTokens !== null ? formatTokens(contextTokens) : "—", "line sub"),
      );
      if (contextTokens !== null) {
        userTips.push(`上下文长度：${formatTokens(contextTokens)} tokens`);
        userTips.push("上下文长度是本轮主轮请求的最大输入");
      } else {
        userTips.push("本轮没有模型输入数据");
      }
    }
    userInput.dataset.tip = userTips.join("\n");

    let contextCell = null;
    if (hasContext) {
      contextCell = document.createElement("span");
      contextCell.className = "turn-cell";
      contextCell.append(
        makeLine(contextTokens !== null ? formatTokens(contextTokens) : "—", "line"),
        makeLine(contextDelta !== null ? formatSignedCompact(contextDelta) : "—", "line sub"),
      );
      const contextTips = [
        contextTokens !== null
          ? `上下文长度：${formatTokens(contextTokens)} tokens`
          : "本轮没有模型输入数据",
      ];
      if (contextDelta !== null) {
        contextTips.push(`上下文增量：${formatSignedCompact(contextDelta)} tokens`);
        contextTips.push("上下文增量是本轮减上一轮");
        contextTips.push("负数表示上下文被压缩");
      } else {
        contextTips.push("没有上一轮上下文可比");
      }
      contextCell.dataset.tip = contextTips.join("\n");
    }

    const tokens = document.createElement("span");
    tokens.className = "turn-cell";
    tokens.append(
      makeLine(formatTokens(turn.inputTokens), "line"),
      makeLine(formatTokens(turn.outputTokens), "line sub"),
    );
    tokens.dataset.tip = [
      `模型输入：${formatTokens(turn.inputTokens)} tokens`,
      `模型输出：${formatTokens(turn.outputTokens)} tokens`,
      "模型输入含重复上下文和缓存命中",
    ].join("\n");

    const requests = document.createElement("span");
    requests.className = "turn-cell";
    const errors = Number(turn.errors) || 0;
    const errorLine = makeLine(`错误 ${formatCompact(errors)}`, "line sub");
    if (errors > 0) errorLine.classList.add("has-errors");
    requests.append(
      makeLine(`${formatCompact(turn.requests ?? 0)} 次`, "line"),
      errorLine,
    );
    requests.dataset.tip = [
      `模型请求次数：${formatCompact(turn.requests ?? 0)} 次`,
      `工具请求错误：${formatCompact(errors)} 次`,
    ].join("\n");

    const cells = {
      turn: index,
      status,
      step: stepTime,
      speed,
      user: userInput,
      context: contextCell,
      tokens,
      requests,
    };
    for (const id of columns) {
      const cell = cells[id];
      if (cell) row.append(cell);
    }
    fragment.appendChild(row);
  }
  list.replaceChildren(fragment);
}

function buildColumnOptions() {
  const container = byId("column-options");
  if (!container) return;
  container.replaceChildren();
  for (const option of COLUMN_OPTIONS) {
    if (option.id === "context" && !lastHasContext) continue;
    const label = document.createElement("label");
    label.className = "column-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !hiddenColumns.has(option.id);
    input.addEventListener("change", () => {
      if (input.checked) hiddenColumns.delete(option.id);
      else hiddenColumns.add(option.id);
      saveHiddenColumns();
      renderTurns(lastTurns);
    });
    const text = document.createElement("span");
    text.textContent = option.label;
    label.append(input, text);
    container.appendChild(label);
  }
}

function updateAlignButtons() {
  const group = byId("align-options");
  if (!group) return;
  for (const button of group.querySelectorAll("[data-align]")) {
    const active = button.dataset.align === tableAlign;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function positionColumnPopover() {
  const button = byId("columns-button");
  const popover = byId("column-popover");
  if (!button || !popover || popover.hidden) return;
  const anchor = button.getBoundingClientRect();
  const rect = popover.getBoundingClientRect();
  let left = anchor.right - rect.width;
  left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
  let top = anchor.bottom + 6;
  if (top + rect.height > window.innerHeight - 8) {
    top = Math.max(8, anchor.top - rect.height - 6);
  }
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function setColumnPopover(open) {
  const button = byId("columns-button");
  const popover = byId("column-popover");
  if (!button || !popover) return;
  if (!open) {
    popover.hidden = true;
    button.setAttribute("aria-expanded", "false");
    return;
  }
  buildColumnOptions();
  updateAlignButtons();
  popover.hidden = false;
  button.setAttribute("aria-expanded", "true");
  positionColumnPopover();
}

function setupColumnSettings() {
  const button = byId("columns-button");
  const popover = byId("column-popover");
  if (!button || !popover) return;

  button.addEventListener("click", () => {
    setColumnPopover(popover.hidden);
  });

  for (const segment of popover.querySelectorAll("[data-align]")) {
    segment.addEventListener("click", () => {
      const next = segment.dataset.align;
      if (!ALIGNMENTS.includes(next)) return;
      tableAlign = next;
      saveTableAlign();
      const table = byId("turns-table");
      if (table) table.dataset.align = tableAlign;
      updateAlignButtons();
    });
  }

  const reset = byId("reset-widths");
  reset?.addEventListener("click", () => {
    columnWidths = { ...DEFAULT_WIDTHS };
    saveColumnWidths();
    renderTurns(lastTurns);
  });

  document.addEventListener("pointerdown", (event) => {
    if (popover.hidden) return;
    if (popover.contains(event.target) || button.contains(event.target)) return;
    setColumnPopover(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popover.hidden) setColumnPopover(false);
  });
  window.addEventListener("resize", () => {
    if (!popover.hidden) setColumnPopover(false);
  });
  window.addEventListener(
    "scroll",
    () => {
      if (!popover.hidden) setColumnPopover(false);
    },
    true,
  );
}

const tipEl = byId("tip");
let tipTarget = null;

function setTipContent(text) {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length > 1) {
    const list = document.createElement("ul");
    list.className = "tip-list";
    for (const line of lines) {
      const item = document.createElement("li");
      const bullet = document.createElement("span");
      bullet.className = "tip-bullet";
      bullet.textContent = "•";
      const body = document.createElement("span");
      body.className = "tip-text";
      body.textContent = line.replace(/^•\s*/, "");
      item.append(bullet, body);
      list.appendChild(item);
    }
    tipEl.replaceChildren(list);
    return;
  }
  tipEl.replaceChildren(document.createTextNode(text.replace(/^•\s*/, "")));
}

function showTip(target) {
  const text = target.dataset.tip;
  if (!text) return;
  setTipContent(text);
  tipEl.style.left = "0px";
  tipEl.style.top = "0px";
  tipEl.classList.add("show");
  tipEl.setAttribute("aria-hidden", "false");

  const rect = target.getBoundingClientRect();
  const tipRect = tipEl.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  let top = rect.top - tipRect.height - 8;
  if (top < 4) top = rect.bottom + 8;
  left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
  if (top + tipRect.height > window.innerHeight - 4) {
    top = window.innerHeight - tipRect.height - 4;
  }
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;
}

function hideTip() {
  if (!tipTarget) return;
  tipTarget = null;
  tipEl.classList.remove("show");
  tipEl.setAttribute("aria-hidden", "true");
}

function setupTooltips() {
  document.addEventListener("pointerover", (event) => {
    const target = event.target.closest?.("[data-tip]");
    if (!target || target === tipTarget) return;
    tipTarget = target;
    showTip(target);
  });
  document.addEventListener("pointerout", (event) => {
    if (!tipTarget) return;
    if (event.relatedTarget && tipTarget.contains(event.relatedTarget)) return;
    hideTip();
  });
  window.addEventListener("scroll", hideTip, true);
  window.addEventListener("resize", hideTip);
}

async function refresh(manual = false) {
  if (refreshing) return;
  refreshing = true;
  refreshButton.disabled = true;
  if (manual) setStatus("刷新中…");

  try {
    const result = await app.callServerTool({
      name: "session_stats",
      arguments: { includeActive: true },
    });
    if (result.isError) {
      const text = (result.content || [])
        .filter((block) => block && block.type === "text")
        .map((block) => block.text)
        .join("\n");
      throw new Error(text || "统计工具返回错误");
    }
    const text = (result.content || []).find((block) => block && block.type === "text")?.text;
    if (!text) throw new Error("统计工具没有返回数据");
    render(JSON.parse(text));
  } catch (error) {
    setState(hasRendered ? "ready" : "error");
    setStatus(`刷新失败：${error?.message || String(error)}`, true);
  } finally {
    refreshing = false;
    refreshButton.disabled = false;
  }
}

async function toggleAutoDisplay() {
  if (savingAuto || autoDisplayReason === "env") return;
  savingAuto = true;
  autoToggle.disabled = true;
  setStatus("保存中…");

  try {
    const result = await app.callServerTool({
      name: "set_auto_display",
      arguments: { enabled: !autoDisplayEnabled },
    });
    const text = (result.content || []).find((block) => block && block.type === "text")?.text;
    const data = text ? JSON.parse(text) : {};
    if (data.ok === false) throw new Error(data.error || "设置失败");
    setAutoDisplayState(data.autoDisplayEnabled !== false, data.autoDisplayReason || null);
    setStatus(data.autoDisplayEnabled ? "已开启单轮统计卡" : "已关闭单轮统计卡");
  } catch (error) {
    setStatus(`设置失败：${error?.message || String(error)}`, true);
  } finally {
    savingAuto = false;
    autoToggle.disabled = autoDisplayReason === "env";
  }
}

function updatePollButton() {
  const label = byId("poll-label");
  if (label) label.textContent = pollText(pollMs);
  const popover = byId("poll-popover");
  if (!popover) return;
  for (const option of popover.querySelectorAll("[data-poll]")) {
    option.setAttribute("aria-checked", String(Number(option.dataset.poll) === pollMs));
  }
}

function buildPollOptions() {
  const popover = byId("poll-popover");
  if (!popover) return;
  popover.replaceChildren();
  for (const ms of POLL_OPTIONS) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "poll-option";
    option.dataset.poll = String(ms);
    option.setAttribute("role", "option");
    option.setAttribute("aria-checked", String(ms === pollMs));
    const text = document.createElement("span");
    text.textContent = `${Math.round(ms / 1000)} 秒`;
    const check = document.createElement("span");
    check.className = "check";
    check.textContent = "✓";
    option.append(text, check);
    option.addEventListener("click", () => {
      pollMs = ms;
      savePollMs();
      updatePollButton();
      setPollPopover(false);
      startPolling();
      refresh();
    });
    popover.appendChild(option);
  }
}

function positionPollPopover() {
  const button = byId("poll-button");
  const popover = byId("poll-popover");
  if (!button || !popover || popover.hidden) return;
  const anchor = button.getBoundingClientRect();
  const rect = popover.getBoundingClientRect();
  let right = window.innerWidth - anchor.right;
  right = Math.max(8, Math.min(right, window.innerWidth - rect.width - 8));
  popover.style.right = `${Math.round(right)}px`;
  popover.style.left = "auto";
  if (anchor.top - rect.height - 6 >= 8) {
    popover.style.top = "auto";
    popover.style.bottom = `${Math.round(window.innerHeight - anchor.top + 6)}px`;
  } else {
    popover.style.bottom = "auto";
    popover.style.top = `${Math.round(anchor.bottom + 6)}px`;
  }
}

function setPollPopover(open) {
  const button = byId("poll-button");
  const popover = byId("poll-popover");
  if (!button || !popover) return;
  if (!open) {
    popover.hidden = true;
    button.setAttribute("aria-expanded", "false");
    return;
  }
  buildPollOptions();
  popover.hidden = false;
  button.setAttribute("aria-expanded", "true");
  positionPollPopover();
}

function setupPollingControl() {
  const button = byId("poll-button");
  const popover = byId("poll-popover");
  if (!button || !popover) return;
  updatePollButton();
  button.addEventListener("click", () => setPollPopover(popover.hidden));
  document.addEventListener("pointerdown", (event) => {
    if (popover.hidden) return;
    if (popover.contains(event.target) || button.contains(event.target)) return;
    setPollPopover(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popover.hidden) setPollPopover(false);
  });
  window.addEventListener("resize", () => {
    if (!popover.hidden) setPollPopover(false);
  });
  window.addEventListener(
    "scroll",
    () => {
      if (!popover.hidden) setPollPopover(false);
    },
    true,
  );
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (!document.hidden) refresh();
  }, pollMs);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function connectWithTimeout() {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("连接宿主超时")), 8000);
  });
  try {
    await Promise.race([app.connect(), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  app.onhostcontextchanged = applyHostContext;
  refreshButton.addEventListener("click", () => refresh(true));
  themeButton.addEventListener("click", cycleTheme);
  autoToggle.addEventListener("click", toggleAutoDisplay);
  setupTooltips();
  setupColumnSettings();
  setupPollingControl();
  applyTheme(readSavedTheme());

  try {
    await connectWithTimeout();
  } catch (error) {
    setState("error");
    setStatus(`无法连接 ZCode：${error?.message || String(error)}`, true);
    return;
  }

  applyHostContext(app.getHostContext());
  await refresh();
  startPolling();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
    } else {
      refresh();
      startPolling();
    }
  });
}

main();
