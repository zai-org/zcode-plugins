import { useEffect, useSyncExternalStore } from "react";
import { STATE_URI, URIS, type ItemQuery, type LibraryId, type PanelView, type SessionState } from "#z/contract.ts";
import { host } from "#ui/bridge.ts";

/**
 * 页面数据只来自资源。每个 URI 一份缓存：组件挂载时读取并订阅，收到 resources/updated 时重读；
 * 宿主不支持订阅时退回轮询。导航栈保存在宿主 widget state，页面重建后恢复。
 */

export type Route =
  | { kind: "library"; library: LibraryId; query: ItemQuery }
  | { kind: "items"; library: LibraryId; title: string; keys: string[] }
  | { kind: "item"; library: LibraryId; key: string }
  | { kind: "reader"; library: LibraryId; itemKey: string; attachmentKey: string; pageIndex?: number; highlightId?: string; nonce?: number };

interface Entry {
  data?: unknown;
  error?: string;
  loading: boolean;
  refs: number;
  subscribed: boolean;
}

export interface Snapshot {
  connected: boolean;
  error: string | null;
  state: SessionState | null;
  stack: Route[];
  /** 资源缓存的版本号：任一资源变化时加一，组件据此重渲染。 */
  tick: number;
}

const HOME: Route = { kind: "library", library: "user", query: {} };
let snapshot: Snapshot = { connected: false, error: null, state: null, stack: [HOME], tick: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
};
const cache = new Map<string, Entry>();
let seenSeq = 0;

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
  const marker = { again: false };
  inflight.set(uri, marker);
  try {
    do {
      marker.again = false;
      await loadOnce(uri);
    } while (marker.again);
  } finally {
    inflight.delete(uri);
  }
}

async function loadOnce(uri: string) {
  if (uri === STATE_URI) {
    try {
      const state = await host.readJson<SessionState>(STATE_URI);
      set({ state, error: null });
      followAgent(state);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  const entry = cache.get(uri);
  if (!entry) return;
  entry.loading = true;
  try {
    entry.data = await host.readJson(uri);
    entry.error = undefined;
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
  } finally {
    entry.loading = false;
    set({ tick: snapshot.tick + 1 });
  }
}

/** Agent 请面板显示的新视图：压入导航栈。 */
function followAgent(state: SessionState) {
  if (!state.view || state.viewSeq <= seenSeq) return;
  seenSeq = state.viewSeq;
  push(routeOf(state.view), { fromAgent: true });
}

export function routeOf(view: PanelView): Route {
  switch (view.kind) {
    case "library":
      return { kind: "library", library: view.library, query: view.query ?? {} };
    case "items":
      return { kind: "items", library: view.library, title: view.title, keys: view.keys };
    case "item":
      return { kind: "item", library: view.library, key: view.key };
    case "reader":
      return { ...view, kind: "reader", nonce: Date.now() };
  }
}

function persist() {
  void host.setWidgetState({ stack: snapshot.stack.slice(-20), seenSeq });
}

const sameRoute = (a: Route, b: Route) =>
  a.kind === b.kind &&
  a.library === b.library &&
  ((a.kind === "item" && b.kind === "item" && a.key === b.key) ||
    (a.kind === "reader" && b.kind === "reader" && a.attachmentKey === b.attachmentKey) ||
    (a.kind === "items" && b.kind === "items" && a.title === b.title && a.keys.join() === b.keys.join()) ||
    (a.kind === "library" && b.kind === "library"));

export function push(route: Route, options: { fromAgent?: boolean } = {}) {
  const current = snapshot.stack.at(-1)!;
  // 同一页面（如同一 PDF 换页）就地替换，避免返回时层层回退。
  const stack = sameRoute(current, route) && (options.fromAgent || route.kind !== "library") ? [...snapshot.stack.slice(0, -1), route] : [...snapshot.stack, route];
  set({ stack: stack.slice(-30) });
  persist();
}

export function replace(route: Route) {
  set({ stack: [...snapshot.stack.slice(0, -1), route] });
  persist();
}

export function back() {
  if (snapshot.stack.length <= 1) return;
  set({ stack: snapshot.stack.slice(0, -1) });
  persist();
}

export function home(library: LibraryId = "user") {
  set({ stack: [{ kind: "library", library, query: {} }] });
  persist();
}

/** 读取并订阅一个资源；uri 为 null 时不读取。 */
export function useResource<T>(uri: string | null): { data?: T; error?: string; loading: boolean; reload: () => void } {
  useSnapshot();
  useEffect(() => {
    if (!uri) return;
    let entry = cache.get(uri);
    if (!entry) {
      entry = { loading: true, refs: 0, subscribed: false };
      cache.set(uri, entry);
    }
    entry.refs += 1;
    // 首次读取；重新挂载时也刷新一次（缓存的数据可能已过期）。
    void load(uri);
    if (host.canSubscribe && !entry.subscribed) {
      entry.subscribed = true;
      void host.subscribe(uri).catch(() => undefined);
    }
    return () => {
      const current = cache.get(uri);
      if (!current) return;
      current.refs -= 1;
      if (current.refs <= 0 && current.subscribed) {
        current.subscribed = false;
        void host.unsubscribe(uri);
      }
    };
  }, [uri]);
  const entry = uri ? cache.get(uri) : undefined;
  return {
    data: entry?.data as T | undefined,
    error: entry?.error,
    loading: !!uri && (entry?.loading ?? true) && entry?.data === undefined,
    reload: () => {
      if (uri) void load(uri);
    },
  };
}

/** 一次性读取（不订阅、不缓存），如 PDF 分块。 */
export const readJson = host.readJson;

let pollTimer: ReturnType<typeof setInterval> | null = null;
function startPolling() {
  if (pollTimer) return;
  // 宿主不支持资源订阅时的退路。
  pollTimer = setInterval(() => {
    void load(STATE_URI);
    for (const [uri, entry] of cache) if (entry.refs > 0) void load(uri);
  }, 3_000);
}

export async function startStore() {
  host.onResourceUpdated((uri) => {
    if (uri === STATE_URI) void load(uri);
    else if ((cache.get(uri)?.refs ?? 0) > 0) void load(uri);
    else cache.delete(uri);
  });
  host.onToolResult(() => void load(STATE_URI));
  try {
    await host.ready();
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error) });
    return;
  }
  const saved = host.widgetState as { stack?: Route[]; seenSeq?: number } | null;
  if (saved?.stack?.length) set({ stack: saved.stack });
  if (typeof saved?.seenSeq === "number") seenSeq = saved.seenSeq;
  set({ connected: true });
  if (host.canSubscribe) await host.subscribe(STATE_URI).catch(() => startPolling());
  else startPolling();
  await load(STATE_URI);
}

export const refreshState = () => load(STATE_URI);

/** 设置页：立即重新检查 Zotero，或记下已交给 Agent。经资源读取，不触发审批。 */
export async function setupAction(op: "check" | "handoff") {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    const state = await host.readJson<SessionState>(URIS.setup(op, nonce));
    set({ state, error: null });
  } finally {
    void load(STATE_URI);
  }
}
