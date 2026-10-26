import { useSyncExternalStore } from "react";
import { STATE_URI, URIS, type PanelView, type SessionState } from "#t/contract.ts";
import { host } from "#ui/bridge.ts";

/**
 * 页面数据只来自 state.json：订阅后收到 resources/updated 即重读；宿主不支持订阅时退回轮询。
 * 阅读偏好（缩放、大纲、问题面板、所在页）与已处理的 viewSeq 保存在宿主 widget state，页面重建后恢复。
 */

export type Zoom = number | "width" | "page";

export interface Prefs {
  zoom: Zoom;
  outline: boolean;
  /** 问题面板：null 表示跟随编译结果（有错误时展开）。 */
  problems: boolean | null;
  pageIndex: number;
}

export interface Snapshot {
  connected: boolean;
  error: string | null;
  state: SessionState | null;
  prefs: Prefs;
  /** Agent 新请求的视图（viewSeq 大于已处理的）。 */
  agentView: { view: PanelView; seq: number } | null;
}

const DEFAULT_PREFS: Prefs = { zoom: "width", outline: false, problems: null, pageIndex: 0 };
let snapshot: Snapshot = { connected: false, error: null, state: null, prefs: DEFAULT_PREFS, agentView: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
};
let seenSeq = 0;

export const store = {
  get: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const useSnapshot = () => useSyncExternalStore(store.subscribe, store.get);

// 读取串行且合并：读取中再次收到通知时，结束后再读一次，因此不会乱序覆盖。
let inflight: { again: boolean } | null = null;
async function load() {
  if (inflight) {
    inflight.again = true;
    return;
  }
  const marker = { again: false };
  inflight = marker;
  try {
    do {
      marker.again = false;
      try {
        const state = await host.readJson<SessionState>(STATE_URI);
        set({ state, error: null });
        followAgent(state);
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    } while (marker.again);
  } finally {
    inflight = null;
  }
}

function followAgent(state: SessionState) {
  if (!state.view || state.viewSeq <= seenSeq) return;
  seenSeq = state.viewSeq;
  set({ agentView: { view: state.view, seq: state.viewSeq } });
  persist();
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void host.setWidgetState({ prefs: snapshot.prefs, seenSeq }), 200);
}

export function setPrefs(patch: Partial<Prefs>) {
  const prefs = { ...snapshot.prefs, ...patch };
  if (Object.entries(patch).every(([key, value]) => snapshot.prefs[key as keyof Prefs] === value)) return;
  set({ prefs });
  persist();
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
function startPolling() {
  if (pollTimer) return;
  // 宿主不支持资源订阅时的退路。
  pollTimer = setInterval(() => void load(), 1_000);
}

export async function startStore() {
  host.onResourceUpdated((uri) => {
    if (uri === STATE_URI) void load();
  });
  host.onToolResult(() => void load());
  try {
    await host.ready();
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error) });
    return;
  }
  const saved = host.widgetState as { prefs?: Partial<Prefs>; seenSeq?: number } | null;
  if (saved?.prefs) set({ prefs: { ...DEFAULT_PREFS, ...saved.prefs } });
  if (typeof saved?.seenSeq === "number") seenSeq = saved.seenSeq;
  set({ connected: true });
  if (host.canSubscribe) await host.subscribe(STATE_URI).catch(() => startPolling());
  else startPolling();
  await load();
}

export const refreshState = () => load();

/** 设置页：立即重新查找 Typst，或记下已交给 Agent。经资源读取，不触发审批。 */
export async function setupAction(op: "check" | "handoff") {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    const state = await host.readJson<SessionState>(URIS.setup(op, nonce));
    set({ state, error: null });
  } finally {
    void load();
  }
}
