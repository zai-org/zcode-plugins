import { createHash, randomUUID } from "node:crypto";
import {
  JupyterError,
  type Actor,
  type Cell,
  type EditOperation,
  type EditResult,
  type KernelInfo,
  type KernelSpecInfo,
  type KernelStatus,
  type NotebookDoc,
  type NotebookEntry,
  type ServerInfo,
} from "#nb/contract.ts";
import type { KernelConnection } from "#nb/jupyter/kernel.ts";
import type { KernelMessage } from "#nb/jupyter/messages.ts";
import { parentId } from "#nb/jupyter/messages.ts";
import type { JupyterClient, SessionModel } from "#nb/jupyter/rest.ts";
import {
  applyOperations,
  emptyNotebook,
  normalizeNotebook,
  serializeNotebook,
} from "#nb/domain/notebook.ts";
import { reduceOutput, updateDisplay } from "#nb/domain/outputs.ts";
import { toServerPath } from "#nb/servers/registry.ts";

export interface ServerHandle {
  info: ServerInfo;
  client: JupyterClient;
}

export interface OwnerDeps {
  resolveServer: (server?: string | null) => ServerHandle;
  now?: () => number;
  saveDelayMs?: number;
  onLog?: (line: string) => void;
}

interface OpenNotebook {
  doc: NotebookDoc;
  server: ServerHandle;
  lastModified: string | null;
  session: { id: string; kernelId: string; created: boolean } | null;
  conn: KernelConnection | null;
  kernelStarting: Promise<void> | null;
  /** msg_id → cell id：每个 cell 只保留最近一次运行，迟到的后台输出也能归位。 */
  runs: Map<string, string>;
  clearPending: Set<string>;
  /** 最近一次排队用的序号（CellRun.seq）。 */
  runSeq: number;
  saveTimer: ReturnType<typeof setTimeout> | null;
  saving: Promise<void> | null;
  /** 有未写盘的变化（内容或输出）。 */
  pending: boolean;
  disposers: (() => void)[];
}

export interface ExecuteResult {
  notebookId: string;
  cellIds: string[];
  finished: boolean;
}

export interface ExecuteOptions {
  /** 谁请求了运行；模型工具为 agent，面板专用工具为 user。 */
  by?: Actor;
  wait?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, message: string) => void;
}

export const notebookIdFor = (serverId: string, path: string) =>
  `nb-${createHash("sha256").update(`${serverId}\0${path}`).digest("hex").slice(0, 12)}`;

const emptyKernel = (): KernelInfo => ({
  status: "none",
  name: null,
  displayName: null,
  language: null,
  id: null,
});

const RUNNING = new Set(["queued", "running"]);
const HEARTBEAT_MS = 10_000;

/**
 * 已打开 notebook 的唯一 owner：文档、revision、kernel session、执行与保存都在这里。
 * 页面与模型只经它读写；对外一律给快照副本。
 */
export function createNotebookOwner(deps: OwnerDeps) {
  const now = deps.now ?? Date.now;
  const saveDelay = deps.saveDelayMs ?? 800;
  const notebooks = new Map<string, OpenNotebook>();
  const listeners = new Set<(notebookId: string | null) => void>();
  let current: string | null = null;

  const emit = (id: string | null) => {
    for (const listener of listeners) listener(id);
  };
  /** 任何可见变化：version 加一并通知。 */
  const touch = (nb: OpenNotebook) => {
    nb.doc.version += 1;
    emit(nb.doc.id);
  };
  const snapshot = (nb: OpenNotebook): NotebookDoc => structuredClone(nb.doc);

  function get(id?: string | null): OpenNotebook {
    const key = id ?? current;
    if (!key)
      throw new JupyterError(
        "no_notebook",
        "No notebook is open. Call open_notebook with a path first.",
      );
    const nb = notebooks.get(key) ?? [...notebooks.values()].find((item) => item.doc.path === key);
    if (!nb)
      throw new JupyterError(
        "notebook_not_found",
        `Notebook ${key} is not open. Open it with open_notebook.`,
      );
    return nb;
  }

  const setCurrent = (nb: OpenNotebook) => {
    if (current === nb.doc.id) return;
    current = nb.doc.id;
    emit(null);
  };

  // -------------------------------------------------------------------------
  // 保存
  // -------------------------------------------------------------------------

  function markPending(nb: OpenNotebook) {
    nb.pending = true;
    if (nb.doc.save.state === "saved" || nb.doc.save.state === "error") nb.doc.save.state = "dirty";
    scheduleSave(nb);
  }

  function scheduleSave(nb: OpenNotebook, delay = saveDelay) {
    if (nb.doc.save.state === "conflict") return;
    if (nb.saveTimer) clearTimeout(nb.saveTimer);
    nb.saveTimer = setTimeout(() => {
      nb.saveTimer = null;
      void save(nb).catch(() => undefined);
    }, delay);
    nb.saveTimer.unref?.();
  }

  async function save(nb: OpenNotebook, { overwrite = false } = {}): Promise<void> {
    if (nb.saveTimer) {
      clearTimeout(nb.saveTimer);
      nb.saveTimer = null;
    }
    // 串行化：等上一次保存结束再判断是否还需要保存。
    while (nb.saving) await nb.saving.catch(() => undefined);
    if (!nb.pending && !overwrite && nb.doc.save.state !== "conflict") return;
    if (nb.doc.save.state === "conflict" && !overwrite) {
      throw new JupyterError("save_conflict", conflictMessage(nb));
    }
    const run = (async () => {
      const client = nb.server.client;
      if (!overwrite && nb.lastModified) {
        const remote = await client.getContents(nb.doc.path, { content: false }).catch((error) => {
          if (error instanceof JupyterError && error.code === "notebook_not_found") return null;
          throw error;
        });
        if (remote && remote.last_modified !== nb.lastModified) {
          nb.doc.save = { state: "conflict", savedAt: nb.doc.save.savedAt, error: conflictMessage(nb) };
          touch(nb);
          throw new JupyterError("save_conflict", conflictMessage(nb));
        }
      }
      nb.pending = false;
      nb.doc.save = { ...nb.doc.save, state: "saving", error: null };
      touch(nb);
      const content = serializeNotebook({
        cells: nb.doc.cells,
        metadata: nb.doc.metadata,
        nbformat: nb.doc.nbformat,
        nbformatMinor: nb.doc.nbformatMinor,
      });
      try {
        const model = await client.saveNotebook(nb.doc.path, content);
        nb.lastModified = model.last_modified;
        nb.doc.save = { state: nb.pending ? "dirty" : "saved", savedAt: now(), error: null };
      } catch (error) {
        nb.pending = true;
        nb.doc.save = {
          state: "error",
          savedAt: nb.doc.save.savedAt,
          error: error instanceof Error ? error.message : String(error),
        };
        throw error;
      } finally {
        touch(nb);
      }
      if (nb.pending) scheduleSave(nb);
    })();
    nb.saving = run;
    try {
      await run;
    } finally {
      if (nb.saving === run) nb.saving = null;
    }
  }

  const conflictMessage = (nb: OpenNotebook) =>
    `${nb.doc.path} was changed on the server by someone else since it was opened. Save with overwrite to replace it, or reopen with reload to discard local changes.`;

  // -------------------------------------------------------------------------
  // 读入
  // -------------------------------------------------------------------------

  function loadContent(nb: OpenNotebook, content: unknown, lastModified: string) {
    const parsed = normalizeNotebook(content);
    const previous = new Map(nb.doc.cells.map((cell) => [cell.id, cell]));
    // 同 id 的 cell 保持 revision 单调，页面里挂着的 expectedRevision 不会误匹配。
    nb.doc.cells = parsed.cells.map((cell) => {
      const old = previous.get(cell.id);
      if (!old) return cell;
      const same = old.source === cell.source && old.type === cell.type;
      return { ...cell, revision: same ? old.revision : old.revision + 1, edit: same ? old.edit : null };
    });
    nb.doc.metadata = parsed.metadata;
    nb.doc.nbformat = parsed.nbformat;
    nb.doc.nbformatMinor = parsed.nbformatMinor;
    nb.doc.revision += 1;
    nb.lastModified = lastModified;
    nb.pending = false;
    nb.runs.clear();
    nb.clearPending.clear();
    nb.doc.save = { state: "saved", savedAt: nb.doc.save.savedAt ?? now(), error: null };
    const spec = nb.doc.metadata.kernelspec as { name?: string; display_name?: string; language?: string } | undefined;
    if (!nb.session) {
      nb.doc.kernel = {
        ...emptyKernel(),
        name: spec?.name ?? null,
        displayName: spec?.display_name ?? null,
        language: spec?.language ?? null,
      };
    }
  }

  /** 文件被他人修改且本地没有未保存修改时自动重载；返回是否重载。 */
  async function refreshIfChanged(nb: OpenNotebook): Promise<boolean> {
    if (nb.pending || nb.saving || nb.doc.save.state === "conflict") return false;
    if (nb.doc.cells.some((cell) => cell.run && RUNNING.has(cell.run.state))) return false;
    const remote = await nb.server.client.getContents(nb.doc.path, { content: false }).catch(() => null);
    if (!remote || remote.last_modified === nb.lastModified) return false;
    const full = await nb.server.client.getContents(nb.doc.path, { type: "notebook" });
    loadContent(nb, full.content, full.last_modified);
    touch(nb);
    return true;
  }

  // -------------------------------------------------------------------------
  // kernel
  // -------------------------------------------------------------------------

  function setKernelStatus(nb: OpenNotebook, status: KernelStatus) {
    if (nb.doc.kernel.status === status) return;
    nb.doc.kernel = { ...nb.doc.kernel, status };
    touch(nb);
  }

  /** kernel 重启 / 死亡：所有在途运行记为 aborted。 */
  function abortRuns(nb: OpenNotebook, reason: string | null) {
    // kernel 按提交顺序执行：最早提交且未结束的请求就是正在运行的那个。
    // 崩溃时 iopub 可能来不及发出 execute_input，所以不能只看 run.state。
    const active = [...nb.runs].find(([msgId, cellId]) => {
      const run = nb.doc.cells.find((cell) => cell.id === cellId)?.run;
      return run?.runId === msgId && RUNNING.has(run.state);
    })?.[1];
    nb.conn?.abortAll();
    let changed = false;
    for (const cell of nb.doc.cells) {
      if (cell.run && RUNNING.has(cell.run.state)) {
        const wasRunning = cell.id === active;
        cell.run = { ...cell.run, state: "aborted", finishedAt: now() };
        if (wasRunning && reason)
          cell.outputs = [
            ...cell.outputs,
            { output_type: "error", ename: "KernelRestarted", evalue: reason, traceback: [] },
          ];
        changed = true;
      }
    }
    if (changed) {
      markPending(nb);
      touch(nb);
    }
  }

  function handleMessage(nb: OpenNotebook, message: KernelMessage) {
    const type = message.header.msg_type;
    if (message.channel === "iopub" && type === "status") {
      const state = message.content.execution_state as string;
      if (state === "busy" || state === "idle" || state === "starting") {
        setKernelStatus(nb, state);
      } else if (state === "restarting" || state === "dead") {
        setKernelStatus(nb, state);
        abortRuns(nb, state === "dead" ? "The kernel died." : "The kernel died and was restarted.");
        // 自动重启（kernel 崩溃）后同样需要新连接才能继续收到 iopub。
        if (state === "restarting") scheduleReconnect(nb);
      }
      return;
    }
    if (message.channel !== "iopub") return;
    if (type === "update_display_data") {
      const displayId = (message.content.transient as { display_id?: string } | undefined)?.display_id;
      if (!displayId) return;
      let changed = false;
      for (const cell of nb.doc.cells) {
        const next = updateDisplay(cell.outputs, displayId, message.content);
        if (next) {
          cell.outputs = next;
          changed = true;
        }
      }
      if (changed) {
        markPending(nb);
        touch(nb);
      }
      return;
    }
    const parent = parentId(message);
    const cellId = parent ? nb.runs.get(parent) : undefined;
    const cell = cellId ? nb.doc.cells.find((item) => item.id === cellId) : undefined;
    if (!cell) return;
    if (type === "execute_input") {
      if (typeof message.content.execution_count === "number") {
        cell.executionCount = message.content.execution_count;
        touch(nb);
      }
      return;
    }
    const state = reduceOutput(
      { outputs: cell.outputs, clearPending: nb.clearPending.has(cell.id) },
      type,
      message.content,
    );
    if (state.outputs === cell.outputs && state.clearPending === nb.clearPending.has(cell.id)) return;
    cell.outputs = state.outputs;
    if (state.clearPending) nb.clearPending.add(cell.id);
    else nb.clearPending.delete(cell.id);
    if (type === "execute_result" && typeof message.content.execution_count === "number")
      cell.executionCount = message.content.execution_count;
    touch(nb);
  }

  /** 自动重启后等 kernel 起来再重连；重连成功即视为 idle。 */
  function scheduleReconnect(nb: OpenNotebook) {
    const conn = nb.conn;
    const timer = setTimeout(() => {
      if (nb.conn !== conn || !conn) return;
      void conn.reconnect().then(
        () => {
          if (nb.conn === conn && (nb.doc.kernel.status === "restarting" || nb.doc.kernel.status === "disconnected"))
            setKernelStatus(nb, "idle");
        },
        () => setKernelStatus(nb, "disconnected"),
      );
    }, 1_000);
    timer.unref?.();
  }

  async function kernelSpecs(client: JupyterClient): Promise<{ default: string; specs: KernelSpecInfo[] }> {
    const model = await client.kernelspecs();
    return {
      default: model.default,
      specs: Object.values(model.kernelspecs).map((spec) => ({
        name: spec.name,
        displayName: spec.spec.display_name,
        language: spec.spec.language,
      })),
    };
  }

  async function connectSession(nb: OpenNotebook, session: SessionModel, created: boolean) {
    if (!session.kernel) throw new JupyterError("kernel_error", "The Jupyter session has no kernel.");
    nb.conn?.close();
    for (const dispose of nb.disposers.splice(0)) dispose();
    nb.session = { id: session.id, kernelId: session.kernel.id, created };
    const conn = nb.server.client.connectKernel(session.kernel.id, randomUUID());
    nb.conn = conn;
    nb.disposers.push(
      conn.onMessage((message) => handleMessage(nb, message)),
      conn.onConnection((connected) => {
        if (!connected) setKernelStatus(nb, "disconnected");
        else if (nb.doc.kernel.status === "disconnected") setKernelStatus(nb, "idle");
      }),
    );
    const specs = await kernelSpecs(nb.server.client).catch(() => null);
    const spec = specs?.specs.find((item) => item.name === session.kernel!.name);
    nb.doc.kernel = {
      status: (session.kernel.execution_state as KernelStatus) || "starting",
      name: session.kernel.name,
      displayName: spec?.displayName ?? session.kernel.name,
      language: spec?.language ?? null,
      id: session.kernel.id,
    };
    if (spec) {
      nb.doc.metadata = {
        ...nb.doc.metadata,
        kernelspec: { name: spec.name, display_name: spec.displayName, language: spec.language },
      };
    }
    touch(nb);
    try {
      await conn.open();
    } catch (error) {
      setKernelStatus(nb, "disconnected");
      throw new JupyterError(
        "kernel_error",
        `Cannot connect to the kernel: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (nb.doc.kernel.status === "disconnected" || nb.doc.kernel.status === "starting")
      setKernelStatus(nb, "idle");
  }

  /** 若 Jupyter 中已有该 path 的 session（如 JupyterLab 打开着），直接加入它。 */
  async function joinExistingSession(nb: OpenNotebook) {
    const sessions = await nb.server.client.listSessions().catch(() => [] as SessionModel[]);
    const existing = sessions.find((session) => session.path === nb.doc.path && session.kernel);
    if (existing) await connectSession(nb, existing, false).catch(() => undefined);
  }

  async function ensureKernel(nb: OpenNotebook): Promise<KernelConnection> {
    if (nb.conn && nb.session) {
      if (!nb.conn.connected) nb.conn.reconnectNow();
      return nb.conn;
    }
    if (!nb.kernelStarting) {
      nb.kernelStarting = (async () => {
        setKernelStatus(nb, "starting");
        const specs = await kernelSpecs(nb.server.client);
        const wanted = nb.doc.kernel.name;
        const name = wanted && specs.specs.some((spec) => spec.name === wanted) ? wanted : specs.default;
        const before = await nb.server.client.listSessions().catch(() => [] as SessionModel[]);
        const existed = before.some((session) => session.path === nb.doc.path);
        const session = await nb.server.client.createSession(nb.doc.path, name);
        await connectSession(nb, session, !existed);
      })().finally(() => {
        nb.kernelStarting = null;
      });
    }
    try {
      await nb.kernelStarting;
    } catch (error) {
      setKernelStatus(nb, "none");
      throw error;
    }
    return nb.conn!;
  }

  // -------------------------------------------------------------------------
  // 对外接口
  // -------------------------------------------------------------------------

  return {
    onChange(listener: (notebookId: string | null) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    get current() {
      return current;
    },

    list(): NotebookEntry[] {
      return [...notebooks.values()].map((nb) => ({
        id: nb.doc.id,
        serverId: nb.doc.serverId,
        path: nb.doc.path,
        name: nb.doc.name,
        kernelStatus: nb.doc.kernel.status,
        saveState: nb.doc.save.state,
        running: nb.doc.cells.filter((cell) => cell.run && RUNNING.has(cell.run.state)).length,
      }));
    },

    has: (id: string) => notebooks.has(id),

    async open({
      server,
      path,
      create = false,
      reload = false,
    }: {
      server?: string | null;
      path: string;
      create?: boolean;
      reload?: boolean;
    }): Promise<{ doc: NotebookDoc; created: boolean; reloaded: boolean }> {
      const handle = deps.resolveServer(server);
      const nbPath = toServerPath(path, handle.info.rootDir);
      if (!nbPath.toLowerCase().endsWith(".ipynb"))
        throw new JupyterError("invalid_path", `${nbPath} is not a .ipynb notebook.`);
      const id = notebookIdFor(handle.info.id, nbPath);
      const existing = notebooks.get(id);
      if (existing) {
        existing.server = handle;
        let reloaded = false;
        if (reload) {
          const full = await handle.client.getContents(nbPath, { type: "notebook" });
          loadContent(existing, full.content, full.last_modified);
          touch(existing);
          reloaded = true;
        } else {
          reloaded = await refreshIfChanged(existing);
        }
        setCurrent(existing);
        return { doc: snapshot(existing), created: false, reloaded };
      }

      let created = false;
      let model;
      try {
        model = await handle.client.getContents(nbPath, { type: "notebook" });
      } catch (error) {
        if (!(error instanceof JupyterError && error.code === "notebook_not_found") || !create) {
          if (error instanceof JupyterError && error.code === "notebook_not_found")
            throw new JupyterError(
              "notebook_not_found",
              `${nbPath} does not exist on server ${handle.info.id}. Pass create: true to create it.`,
            );
          throw error;
        }
        const specs = await kernelSpecs(handle.client).catch(() => null);
        const spec = specs?.specs.find((item) => item.name === specs.default);
        const parent = nbPath.split("/").slice(0, -1).join("/");
        if (parent) await handle.client.ensureDirectory(parent);
        await handle.client.saveNotebook(nbPath, emptyNotebook(spec));
        model = await handle.client.getContents(nbPath, { type: "notebook" });
        created = true;
      }
      const nb: OpenNotebook = {
        doc: {
          id,
          serverId: handle.info.id,
          path: nbPath,
          name: nbPath.split("/").pop() ?? nbPath,
          revision: 0,
          version: 0,
          cells: [],
          metadata: {},
          nbformat: 4,
          nbformatMinor: 5,
          kernel: emptyKernel(),
          save: { state: "saved", savedAt: null, error: null },
        },
        server: handle,
        lastModified: null,
        session: null,
        conn: null,
        kernelStarting: null,
        runs: new Map(),
        clearPending: new Set(),
        runSeq: 0,
        saveTimer: null,
        saving: null,
        pending: false,
        disposers: [],
      };
      loadContent(nb, model.content, model.last_modified);
      notebooks.set(id, nb);
      current = id;
      await joinExistingSession(nb);
      touch(nb);
      emit(null);
      return { doc: snapshot(nb), created, reloaded: false };
    },

    /** 读取快照；模型读取时顺便检查文件是否被他人修改。 */
    async read(id?: string | null, { refresh = false } = {}): Promise<NotebookDoc> {
      const nb = get(id);
      if (refresh) await refreshIfChanged(nb).catch(() => false);
      return snapshot(nb);
    },

    peek(id: string): NotebookDoc | null {
      const nb = notebooks.get(id);
      return nb ? snapshot(nb) : null;
    },

    select(id: string) {
      setCurrent(get(id));
    },

    edit(
      id: string | null | undefined,
      operations: EditOperation[],
      expectedRevision?: number,
      by: Actor = "agent",
    ): EditResult & { notebookId: string; touched: string[] } {
      const nb = get(id);
      if (expectedRevision !== undefined && expectedRevision !== nb.doc.revision)
        throw new JupyterError(
          "revision_conflict",
          `The notebook changed (revision ${nb.doc.revision}, expected ${expectedRevision}). Read it again before editing.`,
          { revision: nb.doc.revision },
        );
      const result = applyOperations(nb.doc.cells, operations);
      const touched = new Set(result.touched);
      const at = now();
      result.cells = result.cells.map((cell) => (touched.has(cell.id) ? { ...cell, edit: { by, at } } : cell));
      const removed = new Set(nb.doc.cells.map((cell) => cell.id));
      for (const cell of result.cells) removed.delete(cell.id);
      nb.doc.cells = result.cells;
      if (result.contentChanged) nb.doc.revision += 1;
      for (const [msgId, cellId] of nb.runs) if (removed.has(cellId)) nb.runs.delete(msgId);
      markPending(nb);
      setCurrent(nb);
      touch(nb);
      return {
        notebookId: nb.doc.id,
        revision: nb.doc.revision,
        inserted: result.inserted,
        touched: result.touched,
      };
    },

    /**
     * 运行 code cell：清空输出、记为 queued，并把所有请求立即发给 kernel（kernel 自己排队）。
     * wait 时等到全部结束、超时或 signal 取消（取消会中断 kernel）。
     */
    async execute(
      id: string | null | undefined,
      target: { cellIds?: string[]; all?: boolean },
      options: ExecuteOptions = {},
    ): Promise<ExecuteResult> {
      const nb = get(id);
      setCurrent(nb);
      let cells: Cell[];
      if (target.all) cells = nb.doc.cells.filter((cell) => cell.type === "code");
      else {
        if (!target.cellIds?.length)
          throw new JupyterError("invalid_operation", "Give cellIds, or all: true.");
        cells = target.cellIds.map((cellId) => {
          const cell = nb.doc.cells.find((item) => item.id === cellId);
          if (!cell) throw new JupyterError("cell_not_found", `No cell with id "${cellId}".`, { cellId });
          return cell;
        });
        cells = cells.filter((cell) => cell.type === "code");
      }
      const wanted = cells.map((cell) => cell.id);
      const conn = await ensureKernel(nb);
      // kernel 启动可能要几秒，期间 cell 可能被编辑或删除：按 id 取最新对象和 source。
      cells = wanted
        .map((cellId) => nb.doc.cells.find((cell) => cell.id === cellId))
        .filter((cell): cell is Cell => !!cell && cell.type === "code");
      const batch = randomUUID().slice(0, 8);
      const done: Promise<unknown>[] = [];
      const ids: string[] = [];
      let finished = 0;
      for (const cell of cells) {
        ids.push(cell.id);
        // 与 JupyterLab 一致：请求运行时即清空输出。
        cell.outputs = [];
        cell.executionCount = null;
        nb.clearPending.delete(cell.id);
        for (const [msgId, cellId] of nb.runs) if (cellId === cell.id) nb.runs.delete(msgId);
        if (!cell.source.trim()) {
          cell.run = null;
          finished += 1;
          continue;
        }
        const queuedAt = now();
        const { msgId, done: outcome } = conn.execute(cell.source, {
          onIopub: () => undefined,
          onStarted: () => {
            const live = nb.doc.cells.find((item) => item.id === cell.id);
            if (live?.run?.runId === msgId && live.run.state === "queued") {
              live.run = { ...live.run, state: "running", startedAt: now() };
              touch(nb);
            }
          },
        });
        nb.runs.set(msgId, cell.id);
        nb.runSeq += 1;
        cell.run = { state: "queued", runId: msgId, by: options.by ?? "agent", seq: nb.runSeq, batch, queuedAt };
        done.push(
          outcome.then((result) => {
            finished += 1;
            const live = nb.doc.cells.find((item) => item.id === cell.id);
            if (live?.run?.runId !== msgId) return;
            live.run = {
              ...live.run,
              state: result.status === "ok" ? "ok" : result.status === "aborted" ? "aborted" : "error",
              finishedAt: now(),
              startedAt: live.run.startedAt ?? (result.status === "aborted" ? undefined : now()),
            };
            if (result.executionCount !== null) live.executionCount = result.executionCount;
            nb.clearPending.delete(live.id);
            markPending(nb);
            touch(nb);
          }),
        );
      }
      markPending(nb);
      touch(nb);
      const result = (complete: boolean): ExecuteResult => ({
        notebookId: nb.doc.id,
        cellIds: ids,
        finished: complete,
      });
      if (!options.wait || !done.length) return result(done.length === 0);

      const total = ids.length;
      const started = now();
      const progress = () => {
        const running = nb.doc.cells.find((cell) => ids.includes(cell.id) && cell.run?.state === "running");
        options.onProgress?.(
          finished,
          total,
          running
            ? `Running cell ${ids.indexOf(running.id) + 1}/${total} (${Math.round((now() - started) / 1000)}s)`
            : `${finished}/${total} cells finished`,
        );
      };
      const heartbeat = setInterval(progress, HEARTBEAT_MS);
      heartbeat.unref?.();
      const all = Promise.all(done.map((promise) => promise.then(progress)));
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), options.timeoutMs ?? 300_000);
        timer.unref?.();
      });
      const aborted = new Promise<"aborted">((resolve) => {
        if (options.signal?.aborted) resolve("aborted");
        options.signal?.addEventListener("abort", () => resolve("aborted"), { once: true });
      });
      try {
        const outcome = await Promise.race([all.then(() => "done" as const), timeout, aborted]);
        if (outcome === "aborted") {
          // 模型调用被取消（用户停止 Agent）：中断仍在运行的 cell。
          if (ids.some((cellId) => RUNNING.has(nb.doc.cells.find((cell) => cell.id === cellId)?.run?.state ?? "")))
            await nb.server.client.interruptKernel(nb.session!.kernelId).catch(() => undefined);
        }
        return result(outcome === "done");
      } finally {
        clearInterval(heartbeat);
        if (timer) clearTimeout(timer);
      }
    },

    async interrupt(id?: string | null) {
      const nb = get(id);
      if (!nb.session) throw new JupyterError("kernel_error", "The notebook has no running kernel.");
      await nb.server.client.interruptKernel(nb.session.kernelId);
      return snapshot(nb);
    },

    async restart(id?: string | null) {
      const nb = get(id);
      if (!nb.session) {
        await ensureKernel(nb);
        return snapshot(nb);
      }
      setKernelStatus(nb, "restarting");
      abortRuns(nb, "The kernel restarted.");
      await nb.server.client.restartKernel(nb.session.kernelId);
      await nb.conn?.reconnect().catch(() => undefined);
      if (nb.doc.kernel.status === "restarting") setKernelStatus(nb, "idle");
      return snapshot(nb);
    },

    async kernelSpecs(server?: string | null) {
      return kernelSpecs(deps.resolveServer(server).client);
    },

    async setKernel(id: string | null | undefined, name: string) {
      const nb = get(id);
      const specs = await kernelSpecs(nb.server.client);
      const spec = specs.specs.find((item) => item.name === name);
      if (!spec)
        throw new JupyterError(
          "kernel_not_found",
          `No kernelspec "${name}". Available: ${specs.specs.map((item) => item.name).join(", ")}.`,
        );
      nb.doc.metadata = {
        ...nb.doc.metadata,
        kernelspec: { name: spec.name, display_name: spec.displayName, language: spec.language },
        language_info: { name: spec.language },
      };
      nb.doc.kernel = { ...nb.doc.kernel, name: spec.name, displayName: spec.displayName, language: spec.language };
      if (nb.session) {
        abortRuns(nb, "The kernel was changed.");
        setKernelStatus(nb, "starting");
        const session = await nb.server.client.changeSessionKernel(nb.session.id, name);
        await connectSession(nb, session, nb.session.created);
      }
      markPending(nb);
      touch(nb);
      return snapshot(nb);
    },

    async save(id?: string | null, { overwrite = false } = {}) {
      const nb = get(id);
      if (overwrite) nb.pending = true;
      await save(nb, { overwrite });
      return snapshot(nb);
    },

    async close(id: string) {
      const nb = notebooks.get(id);
      if (!nb) return;
      await save(nb).catch(() => undefined);
      nb.conn?.close();
      for (const dispose of nb.disposers.splice(0)) dispose();
      // 只关闭本插件创建的 session；加入的已有 session（如 JupyterLab 的）保留。
      if (nb.session?.created)
        await nb.server.client.deleteSession(nb.session.id).catch(() => undefined);
      notebooks.delete(id);
      if (current === id) current = [...notebooks.keys()].at(-1) ?? null;
      emit(null);
    },

    /** server 断开或停止时，关掉其上的 notebook（不再尝试保存）。 */
    dropServer(serverId: string) {
      for (const [id, nb] of notebooks) {
        if (nb.doc.serverId !== serverId) continue;
        if (nb.saveTimer) clearTimeout(nb.saveTimer);
        nb.conn?.close();
        for (const dispose of nb.disposers.splice(0)) dispose();
        notebooks.delete(id);
        if (current === id) current = null;
      }
      emit(null);
    },

    async closeAll() {
      await Promise.allSettled([...notebooks.keys()].map((id) => this.close(id)));
    },
  };
}

export type NotebookOwner = ReturnType<typeof createNotebookOwner>;
