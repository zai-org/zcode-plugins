// 面板入口：与宿主建立 MCP App 连接，订阅/轮询用量快照并驱动渲染。
// 连接顺序遵循官方模板：先注册通知处理，再 connect，最后发起订阅。
import { App } from "@modelcontextprotocol/ext-apps";
import { EmptyResultSchema, ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/core";
import { buildSkeleton, render, renderPrompt, setStatus, type UiState, type Containers } from "./ui.js";
import type { UsageSnapshot } from "../server/db.js";
import type { PromptComposition } from "../server/prompt.js";

const AUTO_URI = "usage://current";
const VERSION = "0.2.0";

const app = new App({ name: "zcode-usage-panel", version: VERSION }, {});

let containers: Containers;
let uiState: UiState = { open: { tools: true, models: false, turns: false, prompt: false } };
let currentUri = AUTO_URI;
let currentSessionId: string | null = null;
let lastJson = "";
let refreshing = false;
let promptBusy = false;
let canSubscribe = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ---------- 主题 ----------
function applyTheme(): void {
  const theme = app.getHostContext()?.theme;
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

// ---------- 数据刷新 ----------
async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const res = await app.readServerResource({ uri: currentUri }, { timeout: 10_000 });
    const text = res.contents?.find((c) => "text" in c)?.text;
    if (typeof text !== "string") throw new Error("资源返回为空");
    if (text === lastJson) return;
    lastJson = text;
    const snap = JSON.parse(text) as UsageSnapshot;
    const sidChanged = snap.session?.id !== currentSessionId;
    currentSessionId = snap.session?.id ?? null;
    render(containers, snap);
    setStatus(containers, canSubscribe ? "live" : "poll", canSubscribe ? "订阅实时" : "轮询 2s");
    // 会话变化时提示词构成跟着换（项目级 AGENTS.md/记忆项目/真实注入记录都随会话）
    if (sidChanged) void refreshPrompt();
  } catch (e) {
    setStatus(containers, "error", `读取失败：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    refreshing = false;
  }
}

// ---------- 提示词构成 ----------
async function refreshPrompt(): Promise<void> {
  if (!currentSessionId || promptBusy) return;
  promptBusy = true;
  try {
    const res = await app.readServerResource(
      { uri: `usage://prompt/${encodeURIComponent(currentSessionId)}` },
      { timeout: 30_000 },
    );
    const text = res.contents?.find((c) => "text" in c)?.text;
    if (typeof text === "string") renderPrompt(containers, JSON.parse(text) as PromptComposition);
  } catch {
    // 提示词构成读取失败不阻塞主面板
  } finally {
    promptBusy = false;
  }
}

async function subscribe(uri: string): Promise<void> {
  if (!canSubscribe) return;
  try {
    await app.request({ method: "resources/subscribe", params: { uri } }, EmptyResultSchema, { timeout: 10_000 });
  } catch {
    canSubscribe = false; // 订阅失败转轮询
    startPolling();
  }
}

async function unsubscribe(uri: string): Promise<void> {
  if (!canSubscribe) return;
  try {
    await app.request({ method: "resources/unsubscribe", params: { uri } }, EmptyResultSchema, { timeout: 10_000 });
  } catch {
    // 忽略：宿主可能已自动清理
  }
}

function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => void refresh(), 2000);
}

// ---------- widget state ----------
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveStateSoon(): void {
  const caps = app.getHostCapabilities() as { experimental?: Record<string, unknown> } | undefined;
  if (!caps?.experimental?.["zcode/widgetState"]) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void app
      .request({ method: "ui/set-widget-state", params: { widgetState: uiState } }, EmptyResultSchema, { timeout: 10_000 })
      .catch(() => {});
  }, 400);
}

// ---------- 切换会话 ----------
async function switchSession(sessionId: string): Promise<void> {
  const next = sessionId ? `usage://session/${encodeURIComponent(sessionId)}` : AUTO_URI;
  if (next === currentUri) return;
  const prev = currentUri;
  currentUri = next;
  lastJson = ""; // 切换后强制重绘
  await unsubscribe(prev);
  await subscribe(next);
  await refresh();
}

// ---------- 启动 ----------
async function boot(): Promise<void> {
  containers = buildSkeleton(document.body, uiState, {
    onSessionChange: (id) => void switchSession(id),
    onToggleState: (next) => {
      const openedPrompt = next.open.prompt && !uiState.open.prompt;
      uiState = next;
      saveStateSoon();
      if (openedPrompt) void refreshPrompt(); // 展开时重扫，保证新鲜
    },
  });

  // 通知处理必须先于 connect 注册，避免错过一次性通知
  app.onhostcontextchanged = () => {
    applyTheme();
  };

  await app.connect();
  applyTheme();

  // 恢复保存的展开状态
  const saved = (app.getHostContext() as Record<string, unknown> | undefined)?.["zcode/widgetState"] as UiState | undefined;
  if (saved?.open) {
    uiState = { open: { ...saved.open } };
    for (const [id, open] of Object.entries(saved.open)) {
      const el = document.getElementById(`sec-${id}`) as HTMLDetailsElement | null;
      if (el) el.open = open;
    }
  }
  const caps = app.getHostCapabilities() as { experimental?: Record<string, unknown> } | undefined;
  canSubscribe = Boolean(caps?.experimental?.["zcode/resourceSubscribe"]);

  // 资源更新通知处理先注册，再发起订阅
  if (canSubscribe) {
    app.setNotificationHandler(ResourceUpdatedNotificationSchema, (ntf) => {
      if (ntf.params.uri === currentUri) void refresh();
    });
    await subscribe(currentUri);
    setStatus(containers, "live", "订阅实时");
  }
  if (!canSubscribe) startPolling();

  await refresh();
}

boot().catch((e) => {
  document.body.replaceChildren();
  const div = document.createElement("div");
  div.className = "boot-error";
  div.textContent = `面板初始化失败：${e instanceof Error ? e.message : String(e)}`;
  document.body.append(div);
});
