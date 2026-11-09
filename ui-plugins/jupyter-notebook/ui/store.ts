import { useSyncExternalStore } from "react";
import {
  STATE_URI,
  notebookUri,
  setupUri,
  type NotebookDoc,
  type NotebookRef,
  type SessionState,
} from "#nb/contract.ts";
import { host } from "#ui/bridge.ts";

/**
 * 页面数据只来自资源：state.json 与当前 notebook 的 JSON。
 * 收到 resources/updated 时重读；宿主不支持订阅时退回轮询。页面状态可随时由资源重建。
 */
export interface Snapshot {
  connected: boolean;
  error: string | null;
  state: SessionState | null;
  /** 页面当前显示的 notebook。 */
  active: string | null;
  docs: Record<string, NotebookDoc>;
  /** 已关闭或读取失败的 notebook。 */
  missing: Record<string, true>;
}

let snapshot: Snapshot = { connected: false, error: null, state: null, active: null, docs: {}, missing: {} };
const listeners = new Set<() => void>();
const set = (patch: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
};

export const store = {
  get: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const useSnapshot = () => useSyncExternalStore(store.subscribe, store.get);

// 同一 URI 的读取串行且合并：读取中再次收到通知时，结束后再读一次，因此不会乱序覆盖。
const inflight = new Map<string, { again: boolean }>();
async function load(uri: string) {
  const running = inflight.get(uri);
  if (running) {
    running.again = true;
    return;
  }
  const entry = { again: false };
  inflight.set(uri, entry);
  try {
    do {
      entry.again = false;
      await loadOnce(uri);
    } while (entry.again);
  } finally {
    inflight.delete(uri);
  }
}

async function loadOnce(uri: string) {
  if (uri === STATE_URI) {
    try {
      const state = await host.readJson<SessionState>(STATE_URI);
      let active = snapshot.active;
      if (active && !state.notebooks.some((nb) => nb.id === active)) active = null;
      active ??= state.current ?? state.notebooks.at(-1)?.id ?? null;
      set({ state, active, error: null });
      if (active) watchNotebook(active);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  const id = uri.slice(uri.lastIndexOf("/") + 1, -".json".length);
  try {
    const doc = await host.readJson<NotebookDoc>(uri);
    const missing = { ...snapshot.missing };
    delete missing[id];
    set({ docs: { ...snapshot.docs, [id]: doc }, missing });
  } catch {
    set({ missing: { ...snapshot.missing, [id]: true } });
  }
}

const watched = new Set<string>();
function watchNotebook(id: string) {
  const uri = notebookUri(id);
  if (watched.has(uri)) return;
  watched.add(uri);
  if (host.canSubscribe) void host.subscribe(uri).catch(() => undefined);
  void load(uri);
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
function startPolling() {
  if (pollTimer) return;
  // 宿主不支持资源订阅时的退路：运行中更频繁地读取。
  let tick = 0;
  pollTimer = setInterval(() => {
    tick += 1;
    const doc = snapshot.active ? snapshot.docs[snapshot.active] : undefined;
    const running = doc?.cells.some((cell) => cell.run?.state === "running" || cell.run?.state === "queued");
    if (snapshot.active && (running || tick % 3 === 0)) void load(notebookUri(snapshot.active));
    if (tick % 3 === 0) void load(STATE_URI);
  }, 700);
}

export async function startStore() {
  host.onResourceUpdated((uri) => {
    if (uri === STATE_URI || watched.has(uri)) void load(uri);
  });
  host.onToolResult((structured) => {
    // Agent 用本插件工具操作了某个 notebook：切到它，并刷新。
    const ref = structured?.notebook as NotebookRef | undefined;
    if (ref?.notebookId) selectNotebook(ref.notebookId);
    void load(STATE_URI);
  });
  try {
    await host.ready();
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error) });
    return;
  }
  const saved = host.widgetState as { active?: string } | null;
  if (saved?.active) set({ active: saved.active });
  set({ connected: true });
  if (host.canSubscribe) await host.subscribe(STATE_URI).catch(() => startPolling());
  else startPolling();
  await load(STATE_URI);
}

export function selectNotebook(id: string) {
  if (snapshot.active !== id) {
    set({ active: id });
    void host.setWidgetState({ active: id });
  }
  watchNotebook(id);
}

export const refreshState = () => load(STATE_URI);

/** 设置页：立即重新检查工作区的 Python，或记下已交给 Agent。经资源读取，不触发审批。 */
export async function setupAction(op: "check" | "handoff") {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    const state = await host.readJson<SessionState>(setupUri(op, nonce));
    set({ state, error: null });
  } finally {
    void load(STATE_URI);
  }
}
export const refreshNotebook = (id: string) => load(notebookUri(id));
