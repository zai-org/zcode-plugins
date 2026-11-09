import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CellType, EditOperation, NotebookDoc, SessionState } from "#nb/contract.ts";
import { host, ToolError } from "#ui/bridge.ts";
import { CellView, type CellActions, type CellHandle } from "#ui/Cell.tsx";
import { Bars, Header, type HeaderActions } from "#ui/Header.tsx";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { duration, stripAnsi } from "#ui/text.ts";

const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) => byte.toString(16).padStart(2, "0")).join("");

type Mode = "command" | "edit";

const RUNNING = new Set(["queued", "running"]);

/** 运行中每 0.5 s 走一次（显示时长），否则每 30 s（“几分钟前”）。 */
function useClock(fast: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), fast ? 500 : 30_000);
    return () => clearInterval(timer);
  }, [fast]);
  return now;
}

export function Notebook({
  doc,
  state,
  s,
  notice,
  onDismiss,
  onError,
  onOpenPicker,
  onClose,
}: {
  doc: NotebookDoc;
  state: SessionState;
  s: Strings;
  notice: string | null;
  onDismiss: () => void;
  onError: (error: unknown) => void;
  onOpenPicker: (mode: "open" | "new") => void;
  onClose: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(doc.cells[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>("command");
  const handles = useRef(new Map<string, CellHandle>());
  const container = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ id: string; at: "start" | "end" } | null>(null);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  /** 只有键盘移动与新插入的 cell 才滚动到可见；鼠标选中不滚动，否则按下时内容移开，click 落空。 */
  const reveal = useRef(false);
  const moveTo = useCallback((id: string) => {
    reveal.current = true;
    setSelected(id);
  }, []);

  const running = doc.cells.some((cell) => cell.run?.state === "running" || cell.run?.state === "queued");
  const now = useClock(running);

  // 排队位置（按排队序号），以及当前这批运行的进度（“正在运行 3 / 5”）。
  const { queue, progress, runningCell } = useMemo(() => {
    const queued = doc.cells
      .filter((cell) => cell.run?.state === "queued")
      .sort((a, b) => a.run!.seq - b.run!.seq);
    const runningCell = doc.cells.find((cell) => cell.run?.state === "running") ?? null;
    const batch = (runningCell ?? queued[0])?.run?.batch;
    let progress: { done: number; total: number } | null = null;
    if (batch) {
      const members = doc.cells.filter((cell) => cell.run?.batch === batch);
      const done = members.filter((cell) => !RUNNING.has(cell.run!.state)).length;
      if (members.length > 1) progress = { done, total: members.length };
    }
    return { queue: new Map(queued.map((cell, index) => [cell.id, index + 1])), progress, runningCell };
  }, [doc.cells]);

  // 运行中的 cell 不在视野内时，底部的提示条指向它。
  const [away, setAway] = useState<"above" | "below" | null>(null);
  const runningId = runningCell?.id ?? null;
  useEffect(() => {
    setAway(null);
    const root = container.current;
    const element = runningId ? root?.querySelector(`[data-cell-id="${runningId}"]`) : null;
    if (!root || !element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry || entry.isIntersecting) setAway(null);
        else setAway(entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) ? "above" : "below");
      },
      { root },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [runningId]);

  // 选中的 cell 被删除时，选中原位置上的相邻 cell。
  const selectedIndex = useRef(0);
  useEffect(() => {
    const index = selected ? doc.cells.findIndex((cell) => cell.id === selected) : -1;
    if (index >= 0) {
      selectedIndex.current = index;
      return;
    }
    if (selected && pendingFocus.current?.id === selected) return; // 新插入的 cell 尚未到达
    setSelected(doc.cells[Math.min(selectedIndex.current, doc.cells.length - 1)]?.id ?? null);
  }, [doc.cells, selected]);

  // 新插入的 cell 出现后进入编辑。
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const handle = handles.current.get(target.id);
    if (!handle) return;
    pendingFocus.current = null;
    requestAnimationFrame(() => handles.current.get(target.id)?.focus(target.at));
  });

  useEffect(() => {
    if (!selected || !reveal.current) return;
    const element = container.current?.querySelector(`[data-cell-id="${selected}"]`);
    if (!element) return; // 新插入的 cell 尚未到达：等它出现
    reveal.current = false;
    element.scrollIntoView({ block: "nearest" });
  });

  const call = useCallback(
    async (name: string, args: Record<string, unknown> = {}) => {
      try {
        return await host.call(name, { notebook: docRef.current.id, ...args });
      } catch (error) {
        onError(error);
        throw error;
      }
    },
    [onError],
  );
  // 面板里的编辑与运行走面板专用工具，server 据此把它们记为用户所做。
  const edit = useCallback(
    (operations: EditOperation[]) => call("panel_edit_notebook", { operations }).catch(() => undefined),
    [call],
  );
  const execute = useCallback(
    (args: { cellIds?: string[]; all?: boolean; restart?: boolean }) =>
      call("panel_execute_cells", args).catch(() => undefined),
    [call],
  );

  const flushAll = useCallback(async () => {
    await Promise.all([...handles.current.values()].map((handle) => handle.flush()));
  }, []);

  const indexOf = (id: string) => docRef.current.cells.findIndex((cell) => cell.id === id);

  const focusContainer = () => container.current?.focus({ preventScroll: true });

  /** focus：是否把焦点移进编辑器（编辑器自己获得焦点时不需要，避免移动光标）。 */
  const select = useCallback((id: string, next: Mode = "command", focus = next === "edit") => {
    setSelected(id);
    setMode(next);
    if (next === "edit" && focus) pendingFocus.current = { id, at: "end" };
  }, []);

  /** 插入新 cell 并进入编辑。anchor 为 null 时插到最前（where=above）或最后（where=below / end）。 */
  const insert = useCallback(
    async (where: "above" | "below" | "end", type: CellType = "code", anchor: string | null = selected) => {
      const id = newId();
      const position =
        where === "end" || !anchor ? (where === "above" ? { index: 0 } : {}) : where === "above" ? { before: anchor } : { after: anchor };
      pendingFocus.current = { id, at: "start" };
      moveTo(id);
      setMode("edit");
      await edit([{ op: "insert", id, type, source: "", ...position }]);
    },
    [edit, selected, moveTo],
  );

  const run = useCallback(
    async (id: string, how: "stay" | "next" | "insert") => {
      const cells = docRef.current.cells;
      const index = indexOf(id);
      const cell = cells[index];
      if (!cell) return;
      await handles.current.get(id)?.flush();
      if (how === "next") {
        const next = cells[index + 1];
        if (next) {
          moveTo(next.id);
          setMode("command");
          focusContainer();
        } else void insert("below", "code", id);
      } else if (how === "insert") void insert("below", "code", id);
      else if (cell.type === "markdown") {
        setMode("command");
        focusContainer();
      }
      if (cell.type === "code") await execute({ cellIds: [id] });
    },
    [execute, insert, moveTo],
  );

  const runAll = useCallback(async () => {
    await flushAll();
    await execute({ all: true });
  }, [execute, flushAll]);

  const interrupt = useCallback(() => void call("interrupt_kernel").catch(() => undefined), [call]);

  const actions: CellActions = useMemo(
    () => ({
      select,
      run: (id, how) => void run(id, how),
      interrupt,
      commandMode: () => {
        setMode("command");
        focusContainer();
      },
      leave: (id, direction) => {
        const cells = docRef.current.cells;
        const target = cells[indexOf(id) + (direction === "up" ? -1 : 1)];
        if (!target) return;
        moveTo(target.id);
        setMode("edit");
        pendingFocus.current = { id: target.id, at: direction === "up" ? "end" : "start" };
      },
      update: async (id, source, expectedRevision) => {
        await host.call("panel_edit_notebook", {
          notebook: docRef.current.id,
          operations: [{ op: "update", cellId: id, source, expectedRevision }],
        });
      },
      move: (id, delta) => {
        const index = indexOf(id) + delta;
        if (index < 0 || index >= docRef.current.cells.length) return;
        void edit([{ op: "move", cellId: id, index }]);
      },
      remove: (id) => void edit([{ op: "delete", cellId: id }]),
      setType: (id, type) => {
        void (async () => {
          await handles.current.get(id)?.flush();
          await edit([{ op: "set_type", cellId: id, type }]);
        })();
      },
      clearOutput: (id) => void edit([{ op: "clear_outputs", cellId: id }]),
      reference: (id) => {
        const cell = docRef.current.cells.find((item) => item.id === id);
        if (!cell) return;
        const index = indexOf(id);
        void host
          .updateModelContext(`${s.referenceText(docRef.current.path, index, id)}\n\n${cell.source}`, {
            notebook: docRef.current.id,
            path: docRef.current.path,
            cellId: id,
            index,
          })
          .catch(onError);
      },
      fix: (id) => {
        const cell = docRef.current.cells.find((item) => item.id === id);
        const error = cell?.outputs.find((output) => output.output_type === "error");
        if (!cell || !error || error.output_type !== "error") return;
        const trace = stripAnsi(error.traceback.join("\n")).split("\n").slice(-12).join("\n");
        void host
          .sendMessage(s.fixMessage(docRef.current.path, indexOf(id), id, trace || `${error.ename}: ${error.evalue}`))
          .catch(onError);
      },
      openLink: (url) => void host.openLink(url),
      canMessage: host.canMessage,
      canReference: host.canUpdateContext,
    }),
    [select, run, interrupt, edit, s, onError, moveTo],
  );

  const kernel = useCallback(
    (tool: string, args: Record<string, unknown> = {}) =>
      void (async () => {
        await flushAll();
        await call(tool, args).catch(() => undefined);
      })(),
    [call, flushAll],
  );
  const headerActions: HeaderActions = {
    runAll: () => void runAll(),
    kernel,
    restartRunAll: () =>
      void (async () => {
        await flushAll();
        await execute({ all: true, restart: true });
      })(),
    clearOutputs: () => void edit([{ op: "clear_outputs" }]),
    save: () =>
      void (async () => {
        await flushAll();
        await call("save_notebook").catch(() => undefined);
      })(),
    close: (id) =>
      void (async () => {
        if (id === docRef.current.id) await flushAll();
        onClose(id);
      })(),
    openPicker: onOpenPicker,
  };

  // 命令模式快捷键，挂在 document 上：按钮卸载后焦点落回 body 时依然可用。
  // 编辑器里的按键由 CodeMirror 处理。
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    if (event.target.closest(".cm-editor, .menu")) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key === "s") {
      event.preventDefault();
      headerActions.save();
      return;
    }
    if (event.key === "Escape") {
      // 从按钮等处回到命令模式。
      event.preventDefault();
      setMode("command");
      focusContainer();
      return;
    }
    if (event.target.closest("input, select, textarea, button")) return;
    const cells = docRef.current.cells;
    const index = selected ? indexOf(selected) : -1;
    const current = cells[index];
    const twice = (key: string) => {
      const previous = lastKey.current;
      lastKey.current = { key, at: Date.now() };
      return previous?.key === key && Date.now() - previous.at < 600;
    };
    let handled = true;
    if (event.key === "Enter" && event.shiftKey && current) void run(current.id, "next");
    else if (event.key === "Enter" && mod && current) void run(current.id, "stay");
    else if (event.key === "Enter" && event.altKey && current) void run(current.id, "insert");
    else if (event.key === "Enter" && current) select(current.id, "edit");
    else if ((event.key === "ArrowUp" || event.key === "k") && index > 0) moveTo(cells[index - 1]!.id);
    else if ((event.key === "ArrowDown" || event.key === "j") && index < cells.length - 1)
      moveTo(cells[index + 1]!.id);
    else if (event.key === "a") void insert("above");
    else if (event.key === "b") void insert(selected ? "below" : "end");
    else if (event.key === "d" && current) {
      if (twice("d")) void edit([{ op: "delete", cellId: current.id }]);
    } else if (event.key === "m" && current) actions.setType(current.id, "markdown");
    else if (event.key === "y" && current) actions.setType(current.id, "code");
    else if (event.key === "r" && current) actions.setType(current.id, "raw");
    else if (event.key === "i") {
      if (twice("i")) interrupt();
    } else if (event.key === "0") {
      if (twice("0")) kernel("restart_kernel", { wait: false });
    } else handled = false;
    if (handled) event.preventDefault();
  };

  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const addButtons = (anchor: string | null, where: "below" | "end", className: string) => (
    <>
      <button
        type="button"
        className={`btn sm ${className}`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => void insert(where, "code", anchor)}
      >
        <Icon name="plus" size={13} />
        {s.addCode}
      </button>
      <button
        type="button"
        className={`btn sm ${className}`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => void insert(where, "markdown", anchor)}
      >
        <Icon name="plus" size={13} />
        {s.addText}
      </button>
    </>
  );

  return (
    <div className="shell">
      <Header doc={doc} state={state} s={s} actions={headerActions} onError={onError} progress={progress} />
      <Bars
        doc={doc}
        s={s}
        notice={notice}
        onDismiss={onDismiss}
        onError={onError}
        onRestart={() => kernel("restart_kernel", { wait: false })}
      />
      <div className="cells-wrap">
      <div
        className={`cells mode-${mode}`}
        ref={container}
        tabIndex={0}
        onFocus={(event) => {
          if (event.target === container.current) setMode("command");
        }}
      >
        {doc.cells.length === 0 ? (
          <div className="empty">
            <div className="tile lg">
              <Icon name="notebook" size={20} />
            </div>
            <div>
              <div className="strong">{s.emptyTitle}</div>
              <div className="sm fg2">{s.emptyBody}</div>
            </div>
            <div className="actions">
              <button type="button" className="btn outline" onClick={() => void insert("end", "code")}>
                <Icon name="code" size={15} />
                {s.codeCell}
              </button>
              <button type="button" className="btn outline" onClick={() => void insert("end", "markdown")}>
                <Icon name="text" size={15} />
                {s.textCell}
              </button>
            </div>
          </div>
        ) : (
          <>
            {doc.cells.map((cell, index) => (
              <Fragment key={cell.id}>
                {index > 0 && (
                  <div className="ins">
                    <div className="ins-line">{addButtons(doc.cells[index - 1]!.id, "below", "outline")}</div>
                  </div>
                )}
                <CellView
                  cell={cell}
                  index={index}
                  selected={cell.id === selected}
                  editing={cell.id === selected && mode === "edit"}
                  isFirst={index === 0}
                  isLast={index === doc.cells.length - 1}
                  queuePos={queue.get(cell.id) ?? null}
                  now={now}
                  s={s}
                  actions={actions}
                  handle={(value: CellHandle | null) => {
                    if (value) handles.current.set(cell.id, value);
                    else handles.current.delete(cell.id);
                  }}
                />
              </Fragment>
            ))}
            <div className="add-row">{addButtons(null, "end", "ghost quiet")}</div>
          </>
        )}
      </div>
      {away && runningCell && (
        <button
          type="button"
          className={`pill ${away}`}
          onClick={() =>
            container.current
              ?.querySelector(`[data-cell-id="${runningCell.id}"]`)
              ?.scrollIntoView({ block: "center", behavior: "smooth" })
          }
        >
          <span className="mini-ring" aria-hidden="true">
            <svg className="ring-track" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
            </svg>
            <svg className="ring-arc" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
            </svg>
          </span>
          <span>{s.runningCellN(doc.cells.indexOf(runningCell) + 1)}</span>
          {runningCell.run?.startedAt && <span className="time">{duration(now - runningCell.run.startedAt)}</span>}
          <Icon name={away === "above" ? "arrowUp" : "arrowDown"} size={14} className="fg3" />
        </button>
      )}
      </div>
    </div>
  );
}

export { ToolError };
