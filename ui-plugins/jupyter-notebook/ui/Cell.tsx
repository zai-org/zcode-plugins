import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import type { Cell, CellType } from "#nb/contract.ts";
import { ToolError } from "#ui/bridge.ts";
import { createEditor, type CellEditor } from "#ui/editor.ts";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { Menu, MenuItem, MenuSeparator, useMenu } from "#ui/Menu.tsx";
import { Outputs } from "#ui/Outputs.tsx";
import { renderMarkdown } from "#ui/render.ts";
import { duration, relativeTime } from "#ui/text.ts";

/** Notebook 通过它驱动 cell：把未提交的草稿写回、聚焦编辑器。 */
export interface CellHandle {
  flush: () => Promise<void>;
  focus: (at?: "start" | "end") => void;
  blur: () => void;
}

export interface CellActions {
  select: (id: string, mode?: "command" | "edit", focus?: boolean) => void;
  run: (id: string, mode: "stay" | "next" | "insert") => void;
  interrupt: () => void;
  commandMode: () => void;
  leave: (id: string, direction: "up" | "down") => void;
  /** 提交 source；冲突时抛 ToolError(revision_conflict)。 */
  update: (id: string, source: string, expectedRevision: number) => Promise<void>;
  move: (id: string, delta: -1 | 1) => void;
  remove: (id: string) => void;
  setType: (id: string, type: CellType) => void;
  clearOutput: (id: string) => void;
  reference: (id: string) => void;
  fix: (id: string) => void;
  openLink: (url: string) => void;
  canMessage: boolean;
  canReference: boolean;
}

const FLUSH_DELAY_MS = 700;
/** Agent 修改过的 cell 在这段时间内注明。注记不随选中变化，选中 cell 不会让下方内容移动。 */
const AGENT_NOTE_MS = 10 * 60_000;

function CellViewInner({
  cell,
  index,
  selected,
  editing,
  isFirst,
  isLast,
  queuePos,
  now,
  s,
  actions,
  handle,
}: {
  cell: Cell;
  index: number;
  selected: boolean;
  editing: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** 排队中时在队列里的位置（1 = 下一个）。 */
  queuePos: number | null;
  /** 运行中每 0.5 s、否则每 30 s 更新的时钟，用于时长与“几分钟前”。 */
  now: number;
  s: Strings;
  actions: CellActions;
  handle: Ref<CellHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<CellEditor | null>(null);
  // 草稿：用户尚未提交到 server 的 source。base：草稿所基于的 cell revision。
  const draft = useRef<string | null>(null);
  const base = useRef(cell.revision);
  const sent = useRef<{ source: string; expected: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [conflict, setConflict] = useState(false);
  const [compare, setCompare] = useState(false);
  const [flash, setFlash] = useState(false);
  const menu = useMenu();
  const latest = useRef(cell);
  latest.current = cell;

  const showEditor = cell.type !== "markdown" || editing;

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const source = draft.current;
    if (source === null || conflict) return;
    if (source === latest.current.source) {
      draft.current = null;
      base.current = latest.current.revision;
      return;
    }
    const expected = base.current;
    sent.current = { source, expected };
    try {
      await actions.update(cell.id, source, expected);
      if (sent.current?.source === source) {
        base.current = expected + 1;
        sent.current = null;
      }
      if (draft.current === source) draft.current = null;
    } catch (error) {
      sent.current = null;
      if (error instanceof ToolError && error.code === "revision_conflict") setConflict(true);
    }
  }, [actions, cell.id, conflict]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), FLUSH_DELAY_MS);
  }, [flush]);

  // 编辑器随 showEditor 挂载 / 卸载。
  useEffect(() => {
    if (!showEditor || !host.current) return;
    const instance = createEditor(
      host.current,
      {
        value: draft.current ?? latest.current.source,
        type: latest.current.type,
        placeholder: latest.current.type === "markdown" ? s.emptyMarkdown : undefined,
      },
      {
        onChange: (value) => {
          draft.current = value;
          schedule();
        },
        onRun: (mode) => actions.run(cell.id, mode),
        onEscape: () => actions.commandMode(),
        onFocus: () => actions.select(cell.id, "edit", false),
        onLeave: (direction) => actions.leave(cell.id, direction),
      },
    );
    editor.current = instance;
    return () => {
      instance.destroy();
      if (editor.current === instance) editor.current = null;
    };
    // 只在显示状态变化时重建；其他变化经 setValue / setType 应用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEditor]);

  useEffect(() => editor.current?.setType(cell.type), [cell.type]);

  // 远端（Agent 或重载）对 source 的修改。
  const firstSync = useRef(true);
  useEffect(() => {
    const inflight = sent.current;
    if (inflight && cell.revision === inflight.expected + 1 && cell.source === inflight.source) {
      base.current = cell.revision;
      sent.current = null;
      if (draft.current === cell.source) draft.current = null;
      return;
    }
    if (draft.current === null) {
      if (editor.current && editor.current.value !== cell.source) {
        editor.current.setValue(cell.source);
        if (!firstSync.current) setFlash(true);
      }
      base.current = cell.revision;
    } else if (draft.current === cell.source) {
      draft.current = null;
      base.current = cell.revision;
    } else if (cell.revision > base.current && !sent.current) {
      setConflict(true);
    }
    firstSync.current = false;
  }, [cell.source, cell.revision]);

  useEffect(() => {
    if (!flash) return;
    const reset = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(reset);
  }, [flash]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useImperativeHandle(
    handle,
    () => ({
      flush,
      focus: (at = "end") => editor.current?.focus(at),
      blur: () => editor.current?.view.contentDOM.blur(),
    }),
    [flush],
  );

  const takeAgents = () => {
    draft.current = null;
    base.current = latest.current.revision;
    editor.current?.setValue(latest.current.source);
    setConflict(false);
    setCompare(false);
  };
  const keepMine = () => {
    base.current = latest.current.revision;
    setConflict(false);
    setCompare(false);
    // conflict 状态在下一次渲染才清除；直接提交当前草稿。
    const source = draft.current;
    if (source !== null) {
      sent.current = { source, expected: base.current };
      void actions.update(cell.id, source, base.current).then(
        () => {
          if (sent.current?.source === source) {
            base.current += 1;
            sent.current = null;
          }
        },
        () => {
          sent.current = null;
          setConflict(true);
        },
      );
    }
  };

  const markdownHtml = useMemo(
    () => (cell.type === "markdown" && !editing ? renderMarkdown(cell.source, cell.attachments) : ""),
    [cell.type, cell.source, cell.attachments, editing],
  );

  const run = cell.run;
  const state = run?.state;
  const isCode = cell.type === "code";
  const failed = isCode && (state === "error" || (!run && cell.outputs.some((output) => output.output_type === "error")));
  const count = cell.executionCount !== null ? `[${cell.executionCount}]` : "[ ]";
  const hasError = cell.outputs.some((output) => output.output_type === "error");

  // ---- 运行结束的一拍：成功时勾号 1.5 s，失败时红圈 0.9 s，之后回到 [n] ----
  const previous = useRef(state);
  const [finish, setFinish] = useState<"ok" | "error" | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    if ((before === "running" || before === "queued") && (state === "ok" || state === "error")) setFinish(state);
    else if (state === "running" || state === "queued") setFinish(null);
  }, [state]);
  useEffect(() => {
    if (!finish) return;
    const timer = setTimeout(() => setFinish(null), finish === "ok" ? 1500 : 900);
    return () => clearTimeout(timer);
  }, [finish]);

  // ---- cell 下方的说明行：运行状态与 Agent 的修改 ----
  let note: ReactNode = null;
  let right: ReactNode = null;
  if (isCode && state === "running") {
    note = (
      <>
        {run!.by === "agent" && <Icon name="sparkles" size={12} className="fg2" />}
        <span className="shimmer">{run!.by === "agent" ? s.agentRunning : s.running}</span>
      </>
    );
    right = (
      <>
        {run!.startedAt && <span className="time">{duration(now - run!.startedAt)}</span>}
        <button type="button" className="btn xs ghost" onMouseDown={(event) => event.stopPropagation()} onClick={actions.interrupt}>
          <Icon name="stop" size={12} />
          {s.stop}
        </button>
      </>
    );
  } else if (isCode && state === "queued") {
    note = <span>{queuePos === 1 ? s.next : s.queuedNth(queuePos ?? 1)}</span>;
  } else {
    const edit = cell.edit?.by === "agent" ? cell.edit : null;
    if (edit && now - edit.at < AGENT_NOTE_MS) {
      note = (
        <>
          <span className="who">
            <Icon name="sparkles" size={12} />
            {s.agentEdited}
          </span>
          <span>·</span>
          <span>{relativeTime(edit.at, now, s)}</span>
        </>
      );
    }
    if (note && isCode && cell.executionCount !== null)
      right = (
        <span>
          {count}
          {run?.startedAt && run.finishedAt ? ` · ${duration(run.finishedAt - run.startedAt)}` : ""}
        </span>
      );
  }

  const otherTypes: { type: CellType; label: string; shortcut: string; icon: "text" | "code" | "raw" }[] = (
    [
      { type: "markdown", label: s.toMarkdown, shortcut: "M", icon: "text" },
      { type: "code", label: s.toCode, shortcut: "Y", icon: "code" },
      { type: "raw", label: s.toRaw, shortcut: "R", icon: "raw" },
    ] as const
  ).filter((item) => item.type !== cell.type);

  return (
    <div
      className={[
        "cell",
        cell.type,
        selected ? "sel" : "",
        selected && editing ? "editing" : "",
        state ? `run-${state}` : "",
        flash ? "flash" : "",
        // 说明行已显示 [n] 时，选中 / 悬停不再在左侧重复。
        right && !(isCode && state === "running") ? "count-in-meta" : "",
      ].join(" ")}
      data-cell-id={cell.id}
      data-index={index}
      onMouseDown={() => {
        if (!selected) actions.select(cell.id, "command");
      }}
    >
      <div className="gut">
        {isCode &&
          (state === "running" ? (
            <button
              type="button"
              className="gut-btn running ring"
              title={s.stop}
              aria-label={s.stop}
              onMouseDown={(event) => (event.stopPropagation(), event.preventDefault())}
              onClick={actions.interrupt}
            >
              <svg className="ring-track" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10.25" />
              </svg>
              <svg className="ring-arc" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10.25" />
              </svg>
              <span className="ring-stop" />
            </button>
          ) : state === "queued" ? (
            <span className="gut-btn queued" title={s.queued}>
              <span className="qring">{queuePos ?? ""}</span>
            </span>
          ) : finish === "ok" ? (
            <span className="gut-btn finish ok" aria-hidden="true">
              <Icon name="check" size={14} />
            </span>
          ) : finish === "error" ? (
            <span className="gut-btn finish error" aria-hidden="true" />
          ) : (
            <>
              <button
                type="button"
                className={`gut-btn idle ${failed ? "error" : ""}`}
                title={s.run}
                aria-label={s.run}
                // 按下时不选中、不抢焦点：选中会改变布局，按钮移开后 click 就不会发生。
                onMouseDown={(event) => (event.stopPropagation(), event.preventDefault())}
                onClick={() => {
                  if (!selected) actions.select(cell.id, "command");
                  actions.run(cell.id, "stay");
                }}
              >
                <span className="prompt">{count}</span>
                <span className="play">
                  <Icon name="play" size={12} />
                </span>
              </button>
              {cell.executionCount !== null && <span className={`gut-count ${failed ? "error" : ""}`}>{count}</span>}
            </>
          ))}
      </div>
      <div className="body">
        {selected && (
          <div className="cell-tools" ref={menu.root} onMouseDown={(event) => event.stopPropagation()}>
            <div className="toolbar">
              <button
                type="button"
                className="btn sm ghost icon-only"
                title={s.moveUp}
                aria-label={s.moveUp}
                disabled={isFirst}
                onClick={() => actions.move(cell.id, -1)}
              >
                <Icon name="arrowUp" size={14} />
              </button>
              <button
                type="button"
                className="btn sm ghost icon-only"
                title={s.moveDown}
                aria-label={s.moveDown}
                disabled={isLast}
                onClick={() => actions.move(cell.id, 1)}
              >
                <Icon name="arrowDown" size={14} />
              </button>
              <span className="sep" />
              {actions.canReference && (
                <button
                  type="button"
                  className="btn sm ghost icon-only"
                  title={s.reference}
                  aria-label={s.reference}
                  onClick={() => actions.reference(cell.id)}
                >
                  <Icon name="at" size={14} />
                </button>
              )}
              <button
                type="button"
                ref={menu.anchor}
                className={`btn sm ghost icon-only ${menu.open ? "open" : ""}`}
                title={s.cellActions}
                aria-label={s.cellActions}
                aria-haspopup="menu"
                aria-expanded={menu.open}
                onClick={menu.toggle}
              >
                <Icon name="more" size={14} />
              </button>
            </div>
            {menu.open && (
              <Menu onClose={menu.close} align="right" width={232} label={s.cellActions}>
                {otherTypes.map((item) => (
                  <MenuItem
                    key={item.type}
                    icon={item.icon}
                    label={item.label}
                    shortcut={item.shortcut}
                    onSelect={() => {
                      menu.close();
                      actions.setType(cell.id, item.type);
                    }}
                  />
                ))}
                {isCode && (
                  <MenuItem
                    icon="eraser"
                    label={s.clearOutput}
                    onSelect={() => {
                      menu.close();
                      actions.clearOutput(cell.id);
                    }}
                  />
                )}
                {actions.canReference && (
                  <MenuItem
                    icon="at"
                    label={s.reference}
                    onSelect={() => {
                      menu.close();
                      actions.reference(cell.id);
                    }}
                  />
                )}
                <MenuSeparator />
                <MenuItem
                  icon="trash"
                  label={s.deleteCell}
                  shortcut="D D"
                  danger
                  onSelect={() => {
                    menu.close();
                    actions.remove(cell.id);
                  }}
                />
              </Menu>
            )}
          </div>
        )}
        {showEditor ? (
          <div className="src-wrap">
            <div className={`src editor ${conflict ? "with-bar" : ""}`} ref={host} />
            {isCode && state === "running" && <div className="sweep" aria-hidden="true" />}
            {isCode && finish === "ok" && <div className="sweep full" aria-hidden="true" />}
          </div>
        ) : (
          <div
            className={`prose md rendered ${cell.source.trim() ? "" : "empty"}`}
            onDoubleClick={() => actions.select(cell.id, "edit")}
            dangerouslySetInnerHTML={{
              __html: cell.source.trim() ? markdownHtml : `<p>${s.emptyMarkdown}</p>`,
            }}
          />
        )}
        {conflict && (
          <div className="cbar" role="alert">
            <span className="msg">
              <Icon name="sparkles" size={14} />
              {s.cellConflict}
            </span>
            <span className="actions">
              <button type="button" className="btn sm ghost" aria-expanded={compare} onClick={() => setCompare(!compare)}>
                {compare ? s.hideCompare : s.compare}
              </button>
              <button type="button" className="btn sm outline" onClick={takeAgents}>
                {s.useAgents}
              </button>
              <button type="button" className="btn sm outline" onClick={keepMine}>
                {s.keepMine}
              </button>
            </span>
          </div>
        )}
        {conflict && compare && (
          <div className="compare">
            <div className="label">{s.agentVersion}</div>
            <pre>{cell.source}</pre>
          </div>
        )}
        {(note || right) && (
          <div className="meta">
            {note}
            <span className="spacer" />
            {right}
          </div>
        )}
        {isCode && (
          <Outputs
            outputs={cell.outputs}
            s={s}
            onLink={actions.openLink}
            onFix={hasError && actions.canMessage && state !== "running" ? () => actions.fix(cell.id) : undefined}
            running={state === "running"}
          />
        )}
      </div>
    </div>
  );
}

export const CellView = memo(CellViewInner);
