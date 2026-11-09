import {
  executeRequest,
  parentId,
  parseMessage,
  type KernelMessage,
} from "#nb/jupyter/messages.ts";

/** 最小 WebSocket 形状，便于测试替换。 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}
export type WebSocketFactory = (
  url: string,
  init: { headers: Record<string, string> },
) => WebSocketLike;

/** Node 24 内置 WebSocket（undici）支持第二个参数里的 headers。 */
const defaultWebSocket: WebSocketFactory = (url, init) =>
  new (globalThis.WebSocket as unknown as new (url: string, init: unknown) => WebSocketLike)(
    url,
    init,
  );

export type ExecuteStatus = "ok" | "error" | "aborted";
export interface ExecuteOutcome {
  status: ExecuteStatus;
  executionCount: number | null;
}

interface PendingExecution {
  onIopub: (message: KernelMessage) => void;
  onStarted: () => void;
  resolve: (outcome: ExecuteOutcome) => void;
  reply: ExecuteOutcome | null;
  idle: boolean;
  started: boolean;
  fallback: ReturnType<typeof setTimeout> | null;
}

const OPEN = 1;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
const RECONNECT_ATTEMPTS = 30;
/** execute_reply 到达后最多再等 iopub idle 这么久（不同 channel 可能乱序或丢帧）。 */
const IDLE_GRACE_MS = 3_000;

/**
 * 一个 kernel 的 WebSocket 连接。按 parent msg_id 把 iopub / shell 消息路由到对应执行；
 * 意外断开时以同一 session_id 重连（Jupyter Server 会补发断线期间缓冲的消息）。
 */
export class KernelConnection {
  private ws: WebSocketLike | null = null;
  private closed = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private outbox: string[] = [];
  private readonly executions = new Map<string, PendingExecution>();
  private readonly messageListeners = new Set<(message: KernelMessage) => void>();
  private readonly connectionListeners = new Set<(connected: boolean) => void>();
  private firstOpen: Promise<void>;
  private settleFirstOpen!: { resolve: () => void; reject: (error: Error) => void };
  private connectedOnce = false;
  connected = false;

  constructor(
    private readonly options: {
      url: string;
      token: string | null;
      session: string;
      webSocket?: WebSocketFactory;
    },
  ) {
    this.firstOpen = new Promise((resolve, reject) => {
      this.settleFirstOpen = { resolve, reject };
    });
    // 首次连接失败由 open() 的调用方处理；避免未处理的 rejection。
    this.firstOpen.catch(() => undefined);
    this.connect();
  }

  get session() {
    return this.options.session;
  }

  /** 等待首次连接成功。 */
  open(): Promise<void> {
    return this.firstOpen;
  }

  onMessage(listener: (message: KernelMessage) => void) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onConnection(listener: (connected: boolean) => void) {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  /**
   * 发送 execute_request。kernel 自己排队；`onStarted` 在该请求的 execute_input 或 busy 到达时触发。
   * 结果在 execute_reply 与同 parent 的 iopub idle 都到达后给出。
   */
  execute(
    code: string,
    handlers: { onIopub: (message: KernelMessage) => void; onStarted?: () => void },
  ): { msgId: string; done: Promise<ExecuteOutcome> } {
    const message = executeRequest(code, this.options.session);
    const msgId = message.header.msg_id;
    const done = new Promise<ExecuteOutcome>((resolve) => {
      this.executions.set(msgId, {
        onIopub: handlers.onIopub,
        onStarted: handlers.onStarted ?? (() => undefined),
        resolve,
        reply: null,
        idle: false,
        started: false,
        fallback: null,
      });
    });
    this.send(JSON.stringify(message));
    return { msgId, done };
  }

  /** 结束所有在途执行（kernel 重启 / 死亡时）。 */
  abortAll() {
    for (const [msgId, pending] of this.executions) {
      if (pending.fallback) clearTimeout(pending.fallback);
      this.executions.delete(msgId);
      pending.resolve({ status: "aborted", executionCount: pending.reply?.executionCount ?? null });
    }
  }

  get pendingCount() {
    return this.executions.size;
  }

  /** 断线后立即尝试重连（用户操作时调用）。 */
  reconnectNow() {
    if (this.closed || this.connected) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempts = 0;
    this.connect();
  }

  /**
   * 换一条新的 WebSocket（同一 session_id）。kernel 重启后 Jupyter Server 不再向旧连接转发 iopub，
   * JupyterLab 同样在重启后重连。返回新连接打开的 Promise。
   */
  reconnect(): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Kernel connection closed"));
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempts = 0;
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      try {
        old.close(1000, "reconnect");
      } catch {
        // 已关闭
      }
    }
    this.setConnected(false);
    const opened = new Promise<void>((resolve, reject) => {
      const off = this.onConnection((connected) => {
        if (!connected) return;
        off();
        clearTimeout(timer);
        resolve();
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error("Kernel WebSocket did not reconnect in time"));
      }, 20_000);
      timer.unref?.();
    });
    this.connect();
    return opened;
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.abortAll();
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, "closed by client");
    } catch {
      // 已关闭
    }
    this.setConnected(false);
    this.settleFirstOpen.reject(new Error("Kernel connection closed"));
  }

  private send(data: string) {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(data);
    else this.outbox.push(data);
  }

  private connect() {
    if (this.closed) return;
    const factory = this.options.webSocket ?? defaultWebSocket;
    let ws: WebSocketLike;
    try {
      ws = factory(this.options.url, {
        headers: this.options.token ? { Authorization: `token ${this.options.token}` } : {},
      });
    } catch (error) {
      this.scheduleReconnect(error);
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.attempts = 0;
      this.setConnected(true);
      this.settleFirstOpen.resolve();
      const queued = this.outbox;
      this.outbox = [];
      for (const data of queued) ws.send(data);
    };
    ws.onmessage = (event) => {
      const message = parseMessage(event.data);
      if (message) this.dispatch(message);
    };
    ws.onerror = () => undefined;
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setConnected(false);
      if (this.closed) return;
      this.scheduleReconnect(
        new Error(`Kernel WebSocket closed${event?.code ? ` (${event.code})` : ""}${opened ? "" : " before opening"}`),
      );
    };
  }

  private scheduleReconnect(error: unknown) {
    if (this.closed) return;
    this.attempts += 1;
    if (this.attempts > RECONNECT_ATTEMPTS) {
      this.settleFirstOpen.reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    // 首次连接失败直接上报，避免调用方长时间等待一个错误 URL / token。
    if (this.attempts === 1 && !this.connectedOnce) {
      this.settleFirstOpen.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.attempts - 1), RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private setConnected(connected: boolean) {
    if (connected) this.connectedOnce = true;
    if (this.connected === connected) return;
    this.connected = connected;
    for (const listener of this.connectionListeners) listener(connected);
  }

  private dispatch(message: KernelMessage) {
    for (const listener of this.messageListeners) listener(message);
    const parent = parentId(message);
    const pending = parent ? this.executions.get(parent) : undefined;
    if (!pending || !parent) return;
    const type = message.header.msg_type;
    if (message.channel === "iopub") {
      if (!pending.started && (type === "execute_input" || (type === "status" && message.content.execution_state === "busy"))) {
        pending.started = true;
        pending.onStarted();
      }
      if (type === "status") {
        if (message.content.execution_state === "idle") {
          pending.idle = true;
          this.maybeFinish(parent, pending);
        }
        return;
      }
      pending.onIopub(message);
      return;
    }
    if (message.channel === "shell" && type === "execute_reply") {
      const status = message.content.status;
      pending.reply = {
        status: status === "ok" ? "ok" : status === "aborted" ? "aborted" : "error",
        executionCount:
          typeof message.content.execution_count === "number" ? message.content.execution_count : null,
      };
      if (!pending.started) {
        pending.started = true;
        pending.onStarted();
      }
      this.maybeFinish(parent, pending);
      if (!pending.idle && !pending.fallback) {
        pending.fallback = setTimeout(() => {
          pending.idle = true;
          this.maybeFinish(parent, pending);
        }, IDLE_GRACE_MS);
        pending.fallback.unref?.();
      }
    }
  }

  private maybeFinish(msgId: string, pending: PendingExecution) {
    // 被 stop_on_error 中止的请求没有输出，不必等 idle。
    if (!pending.reply || (!pending.idle && pending.reply.status !== "aborted")) return;
    if (pending.fallback) clearTimeout(pending.fallback);
    this.executions.delete(msgId);
    pending.resolve(pending.reply);
  }
}
