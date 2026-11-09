import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatLocation, type Diagnostic, type Highlight, type SessionState } from "#t/contract.ts";
import type { SourceMatch } from "#t/domain/match.ts";
import { host } from "#ui/bridge.ts";
import { addProblemsToContext, addSelectionToContext, askAboutSelection, askToFix, type SelectionRef } from "#ui/chat.ts";
import { AskBox, Empty, IconButton, errorText } from "#ui/common.tsx";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { loadOutline, loadPreview, TextLayer, toViewport, type LoadedPreview, type OutlineEntry, type PageSize, type PageViewport } from "#ui/pdf.ts";
import { setPrefs, useSnapshot, type Zoom } from "#ui/store.ts";

type Notify = (message: string, tone?: "info" | "error") => void;

const GAP = 12;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// ---------------------------------------------------------------------------
// 快照：新快照加载完成后再替换，旧的继续显示
// ---------------------------------------------------------------------------

function usePreview(state: SessionState) {
  const [preview, setPreview] = useState<LoadedPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = useRef<LoadedPreview | null>(null);
  const info = state.snapshot;
  useEffect(() => {
    if (!info || shown.current?.seq === info.seq) return;
    let alive = true;
    loadPreview(info)
      .then((loaded) => {
        // 只前进：较早开始的加载晚到时丢弃。
        if (!alive || (shown.current && shown.current.seq >= loaded.seq)) {
          void loaded.destroy();
          return;
        }
        const previous = shown.current;
        shown.current = loaded;
        setPreview(loaded);
        setError(null);
        // 旧文档在新页面画好之后再释放。
        if (previous) setTimeout(() => void previous.destroy(), 2_000);
      })
      .catch((reason) => {
        // 快照已被更新的替换（not_found）时等待下一次状态更新。
        if (alive && !/no longer available/.test(errorText(reason))) setError(errorText(reason));
      });
    return () => {
      alive = false;
    };
  }, [info?.seq]);
  useEffect(() => () => void shown.current?.destroy(), []);
  return { preview, error };
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

function PageView({
  preview,
  index,
  size,
  scale,
  visible,
  highlights,
  focused,
  onMark,
}: {
  preview: LoadedPreview;
  index: number;
  size: PageSize;
  scale: number;
  visible: boolean;
  highlights: Highlight[];
  focused: string | null;
  onMark: (highlight: Highlight, element: HTMLElement) => void;
}) {
  const canvasHolder = useRef<HTMLDivElement>(null);
  const textHolder = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const holder = canvasHolder.current!;
    if (!visible) {
      // 离开视野：释放画布内存。
      holder.replaceChildren();
      textHolder.current?.replaceChildren();
      setRendered(false);
      return;
    }
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let layer: { cancel: () => void } | null = null;
    void (async () => {
      const page = await preview.doc.getPage(index + 1).catch(() => null);
      if (!page || cancelled) return;
      const view = page.getViewport({ scale });
      // 在新画布上绘制，完成后替换旧画布：编辑时预览不闪烁。
      const canvas = document.createElement("canvas");
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.floor(view.width * ratio);
      canvas.height = Math.floor(view.height * ratio);
      const renderTask = page.render({
        canvas,
        canvasContext: canvas.getContext("2d")!,
        viewport: view,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      } as never);
      task = renderTask;
      try {
        await renderTask.promise;
      } catch {
        return; // 取消（缩放、滚出视野或新快照）。
      }
      if (cancelled) return;
      holder.replaceChildren(canvas);
      setViewport(view);
      setRendered(true);
      const container = document.createElement("div");
      container.className = "textLayer";
      const text = new TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
        container,
        viewport: view,
      });
      layer = text;
      await text.render().catch(() => undefined);
      if (!cancelled) textHolder.current?.replaceChildren(container);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [preview, index, scale, visible]);

  const width = size.width * scale;
  const height = size.height * scale;
  // 文字层在高亮之上（为了能选中文字），所以点击按坐标命中高亮。
  const hit = (event: React.MouseEvent<HTMLDivElement>) =>
    [...event.currentTarget.querySelectorAll<HTMLElement>(".mark")].findLast((element) => {
      const box = element.getBoundingClientRect();
      return event.clientX >= box.left - 1 && event.clientX <= box.right + 1 && event.clientY >= box.top - 1 && event.clientY <= box.bottom + 1;
    });
  return (
    <div
      className={`page${rendered ? "" : " pending"}`}
      data-page={index}
      style={{ width, height, ["--scale-factor" as string]: scale, ["--total-scale-factor" as string]: scale }}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || window.getSelection()?.toString().trim()) return;
        const element = hit(event);
        const highlight = element && highlights.find((entry) => entry.id === element.dataset.mark);
        if (element && highlight) onMark(highlight, element);
      }}
      onMouseMove={(event) => event.currentTarget.classList.toggle("over-mark", !!hit(event))}
    >
      <div ref={canvasHolder} className="canvas-holder" />
      <div ref={textHolder} className="text-holder" />
      {viewport && (
        <div className="marks">
          {highlights.map((highlight) =>
            highlight.rects.map((rect, part) => {
              // 视口按当前缩放；页面尺寸变了（新快照）时按比例换算。
              const box = toViewport(viewport, rect);
              const ratio = scale / viewport.scale;
              return (
                <button
                  type="button"
                  key={`${highlight.id}-${part}`}
                  className={`mark${focused === highlight.id ? " focused" : ""}`}
                  data-mark={highlight.id}
                  style={{ left: box.left * ratio, top: box.top * ratio, width: box.width * ratio, height: box.height * ratio }}
                  aria-label={highlight.comment || highlight.quote}
                  onClick={(event) => {
                    // 只有键盘（Enter / 空格）会直接点到按钮；鼠标点击由页面命中处理。
                    event.stopPropagation();
                    onMark(highlight, event.currentTarget);
                  }}
                >
                  {part === 0 && <span className="badge">✦</span>}
                </button>
              );
            }),
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 浮层：选中文字、⌘-点击的源码、Agent 高亮
// ---------------------------------------------------------------------------

type SourceLookup = { status: "pending" } | { status: "found"; match: SourceMatch } | { status: "none" };

async function lookupSource(text: string, focus?: string): Promise<SourceLookup> {
  try {
    const result = await host.call<{ matches: SourceMatch[] }>("locate_source", { text: text.slice(0, 5_000), ...(focus ? { focus: focus.slice(0, 2_000) } : {}) });
    const match = result.matches?.[0];
    return match ? { status: "found", match } : { status: "none" };
  } catch {
    return { status: "none" };
  }
}

function SourceChip({ lookup, s }: { lookup: SourceLookup; s: Strings }) {
  if (lookup.status === "pending") return <span className="source-chip muted">{s.findingSource}</span>;
  if (lookup.status === "none") return <span className="source-chip muted" title={s.clickHint(isMac)}>{s.noSource}</span>;
  const { match } = lookup;
  return (
    <span className="source-chip" title={`${match.excerpt}\n\n${s.clickHint(isMac)}`}>
      <Icon name="code" size={12} />
      {match.file}:{match.line}
      {match.endLine !== match.line ? `–${match.endLine}` : ""}
    </span>
  );
}

interface Floating {
  kind: "selection" | "source";
  text: string;
  focus?: string;
  pageIndex: number;
  lookup: SourceLookup;
  left: number;
  top: number;
  asking: boolean;
}

function FloatTools({ floating, s, notify, onClose, onAsk }: { floating: Floating; s: Strings; notify: Notify; onClose: () => void; onAsk: () => void }) {
  const ref: SelectionRef = {
    text: floating.focus ?? floating.text,
    pageIndex: floating.pageIndex,
    source: floating.lookup.status === "found" ? floating.lookup.match : null,
  };
  return (
    <div
      className={`float-tools${floating.kind === "source" ? " source-pop" : ""}`}
      style={{ left: floating.left, top: floating.top }}
      onMouseDown={(event) => event.preventDefault()}
      role="dialog"
    >
      {floating.asking ? (
        <AskBox
          placeholder={s.askPlaceholder}
          sendLabel={s.send}
          onClose={onClose}
          onSend={(question) =>
            askAboutSelection(question, ref).catch((reason) => {
              notify(errorText(reason), "error");
              throw reason;
            })
          }
        />
      ) : (
        <>
          {floating.kind === "source" && floating.lookup.status === "found" && <pre className="excerpt">{floating.lookup.match.excerpt}</pre>}
          <div className="float-row">
            <SourceChip lookup={floating.lookup} s={s} />
            <div className="grow" />
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                void addSelectionToContext(ref)
                  .then(() => notify(s.selectionAdded))
                  .catch((reason) => notify(errorText(reason), "error"));
                onClose();
              }}
            >
              <Icon name="quote" size={14} />
              {s.addToChat}
            </button>
            <button type="button" className="btn ghost sm" onClick={onAsk}>
              <Icon name="message" size={14} />
              {s.ask}
            </button>
            {floating.kind === "source" && <IconButton icon="x" label={s.close} size={14} onClick={onClose} />}
          </div>
        </>
      )}
    </div>
  );
}

function MarkPopover({ highlight, anchor, s, notify, onClose }: { highlight: Highlight; anchor: { left: number; top: number }; s: Strings; notify: Notify; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node) && !(event.target as HTMLElement).closest?.(".mark")) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);
  return (
    <div className="popover" ref={ref} style={{ left: anchor.left, top: anchor.top }} role="dialog">
      <div className="popover-head">
        <span className="who agent">
          <Icon name="sparkles" size={12} />
          {s.agent}
        </span>
        <span className="muted small">
          {s.page} {highlight.pageIndex + 1}
        </span>
        {highlight.source && (
          <span className="source-chip">
            <Icon name="code" size={12} />
            {highlight.source.file}:{highlight.source.line}
            {highlight.source.endLine !== highlight.source.line ? `–${highlight.source.endLine}` : ""}
          </span>
        )}
        <div className="grow" />
        <IconButton icon="x" label={s.close} size={14} onClick={onClose} />
      </div>
      {highlight.comment ? <p className="comment">{highlight.comment}</p> : <p className="quote">{highlight.quote}</p>}
      <div className="popover-actions">
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            void host.call("clear_highlights", { ids: [highlight.id] }).catch((error) => notify(errorText(error), "error"));
            onClose();
          }}
        >
          <Icon name="trash" size={14} />
          {s.remove}
        </button>
      </div>
    </div>
  );
}

/** 点击处的一行文字与上下各一行（给源码定位提供上下文）。 */
function lineAt(target: HTMLElement): { line: string; context: string } | null {
  const span = target.closest<HTMLElement>(".textLayer span");
  const layer = span?.closest<HTMLElement>(".textLayer");
  if (!span || !layer) return null;
  const spans = [...layer.querySelectorAll<HTMLElement>("span")].filter((element) => !element.classList.contains("markedContent") && element.textContent?.trim());
  const rows = new Map<number, HTMLElement[]>();
  const tops: number[] = [];
  for (const element of spans) {
    const box = element.getBoundingClientRect();
    const key = tops.find((top) => Math.abs(top - box.top) < Math.max(3, box.height * 0.4)) ?? box.top;
    if (!rows.has(key)) {
      rows.set(key, []);
      tops.push(key);
    }
    rows.get(key)!.push(element);
  }
  tops.sort((a, b) => a - b);
  const textOf = (top: number) =>
    rows
      .get(top)!
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      .map((element) => element.textContent)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  const own = span.getBoundingClientRect().top;
  const row = tops.findIndex((top) => Math.abs(top - own) < Math.max(3, span.getBoundingClientRect().height * 0.4));
  if (row < 0) return null;
  const line = textOf(tops[row]!);
  const context = tops
    .slice(Math.max(0, row - 1), row + 2)
    .map(textOf)
    .join("\n");
  return { line, context };
}

// ---------------------------------------------------------------------------
// 问题面板
// ---------------------------------------------------------------------------

function Problems({ state, s, notify, full }: { state: SessionState; s: Strings; notify: Notify; full: boolean }) {
  const diagnostics = state.diagnostics;
  const main = state.main ?? "";
  return (
    <section className={`problems${full ? " full" : ""}`} aria-label={s.problems}>
      <div className="problems-head">
        <span className="strong">{s.problems}</span>
        {state.status.phase === "error" && state.snapshot && <span className="muted small ellipsis">{s.outdated}</span>}
        <div className="grow" />
        {diagnostics.length > 0 && host.canUpdateContext && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() =>
              void addProblemsToContext(main, diagnostics)
                .then(() => notify(s.problemsAdded))
                .catch((reason) => notify(errorText(reason), "error"))
            }
          >
            <Icon name="quote" size={14} />
            {s.addToChat}
          </button>
        )}
        {diagnostics.length > 0 && host.canMessage && (
          <button type="button" className="btn primary sm" onClick={() => void askToFix(s.fixRequest(main), diagnostics).catch((reason) => notify(errorText(reason), "error"))}>
            <Icon name="wrench" size={14} />
            {s.fixWithAgent}
          </button>
        )}
      </div>
      <ul className="problem-list scroll">
        {diagnostics.length === 0 && <li className="muted small pad">{s.noProblems}</li>}
        {diagnostics.map((diagnostic: Diagnostic, index) => (
          <li key={index} className={`problem ${diagnostic.severity}`}>
            <Icon name={diagnostic.severity === "error" ? "alert" : "triangle"} size={14} className="problem-icon" />
            <div className="problem-body">
              <div className="problem-message">{diagnostic.message}</div>
              <div className="problem-location">{formatLocation(diagnostic.location)}</div>
              {diagnostic.excerpt !== undefined && <pre className="excerpt">{diagnostic.excerpt}</pre>}
              {diagnostic.hints.map((hint, hintIndex) => (
                <div key={hintIndex} className="hint">
                  hint: {hint}
                </div>
              ))}
              {diagnostic.trace.map((point, pointIndex) => (
                <div key={pointIndex} className="trace muted small">
                  {s.calledFrom} {formatLocation(point.location)}: {point.message}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 工具栏
// ---------------------------------------------------------------------------

function StatusPill({ state, s, onClick }: { state: SessionState; s: Strings; onClick: () => void }) {
  const { status } = state;
  const errors = state.diagnostics.filter((entry) => entry.severity === "error").length;
  const warnings = state.diagnostics.length - errors;
  let tone = "";
  let icon: "check" | "alert" | "triangle" | null = null;
  let label = "";
  switch (status.phase) {
    case "starting":
      label = s.starting;
      tone = "busy";
      break;
    case "compiling":
      label = s.compiling;
      tone = "busy";
      break;
    case "ok":
      icon = "check";
      tone = "ok";
      label = status.durationMs !== undefined ? s.compiledIn(status.durationMs) : "";
      break;
    case "warnings":
      icon = "triangle";
      tone = "warn";
      label = s.warnings(warnings);
      break;
    case "error":
      icon = "alert";
      tone = "bad";
      label = s.errors(errors);
      break;
    case "crashed":
      icon = "alert";
      tone = "bad";
      label = s.crashed;
      break;
    case "idle":
      return null;
  }
  return (
    <button type="button" className={`pill ${tone}`} onClick={onClick} title={s.problems} aria-label={`${s.problems}: ${label}`}>
      {tone === "busy" ? <span className="spinner" /> : icon && <Icon name={icon} size={13} />}
      <span className="ellipsis">{label}</span>
    </button>
  );
}

function MainPicker({ state, s, notify }: { state: SessionState; s: Strings; notify: Notify }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className="main-picker" title={state.main ?? ""}>
      <Icon name="file" size={14} />
      <select
        aria-label={s.mainFile}
        value={state.main ?? ""}
        disabled={busy}
        onChange={(event) => {
          setBusy(true);
          void host
            .call("panel_set_main", { path: event.target.value })
            .catch((error) => notify(errorText(error), "error"))
            .finally(() => setBusy(false));
        }}
      >
        {state.candidates.map((path) => (
          <option key={path} value={path}>
            {path}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={12} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// 预览
// ---------------------------------------------------------------------------

export function Preview({ state, s, notify }: { state: SessionState; s: Strings; notify: Notify }) {
  const { prefs, agentView } = useSnapshot();
  const { preview, error } = usePreview(state);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [visible, setVisible] = useState<Set<number>>(new Set([0]));
  const [current, setCurrent] = useState(prefs.pageIndex);
  const [pageInput, setPageInput] = useState(String(prefs.pageIndex + 1));
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [floating, setFloating] = useState<Floating | null>(null);
  const [popover, setPopover] = useState<{ id: string; left: number; top: number } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  /** 视口顶部所在页与页内位置比例：换快照或缩放后据此恢复位置。 */
  const anchor = useRef<{ pageIndex: number; fraction: number }>({ pageIndex: prefs.pageIndex, fraction: 0 });
  const restoring = useRef(true);

  const errors = state.diagnostics.filter((entry) => entry.severity === "error").length;
  const problemsOpen = prefs.problems ?? errors > 0;

  // 容器尺寸（适应宽度 / 页面时决定缩放）。
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setBox({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setBox({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, [!!preview]);

  const sizes = preview?.sizes;
  const scale = useMemo(() => {
    if (!sizes?.length || !box.width) return 1;
    const maxWidth = Math.max(...sizes.map((size) => size.width));
    const maxHeight = Math.max(...sizes.map((size) => size.height));
    const width = Math.max(0.2, (box.width - 2 * GAP) / maxWidth);
    if (prefs.zoom === "width") return width;
    if (prefs.zoom === "page") return Math.max(0.2, Math.min(width, (box.height - 2 * GAP) / maxHeight));
    return prefs.zoom;
  }, [sizes, box, prefs.zoom]);

  const offsets = useMemo(() => {
    const result: number[] = [];
    let y = GAP;
    for (const size of sizes ?? []) {
      result.push(y);
      y += size.height * scale + GAP;
    }
    return result;
  }, [sizes, scale]);

  const updateVisible = useCallback(() => {
    const element = scrollRef.current;
    if (!element || !sizes) return;
    const top = element.scrollTop;
    const bottom = top + element.clientHeight;
    const margin = element.clientHeight * 0.75;
    const next = new Set<number>();
    let topPage = 0;
    let middlePage = 0;
    for (let index = 0; index < sizes.length; index++) {
      const start = offsets[index]!;
      const end = start + sizes[index]!.height * scale;
      if (end >= top - margin && start <= bottom + margin) next.add(index);
      if (start - GAP <= top) topPage = index;
      if (start <= top + element.clientHeight / 3) middlePage = index;
    }
    setVisible((previous) => (previous.size === next.size && [...next].every((index) => previous.has(index)) ? previous : next));
    setCurrent(middlePage);
    if (!restoring.current) {
      const height = sizes[topPage]!.height * scale + GAP;
      anchor.current = { pageIndex: topPage, fraction: Math.max(0, (top - offsets[topPage]! + GAP) / height) };
    }
  }, [sizes, offsets, scale]);

  // 换快照、缩放或容器尺寸变化后：回到同一页的同一位置。
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !sizes?.length) return;
    const pageIndex = Math.min(anchor.current.pageIndex, sizes.length - 1);
    const height = sizes[pageIndex]!.height * scale + GAP;
    restoring.current = true;
    element.scrollTop = offsets[pageIndex]! - GAP + anchor.current.fraction * height;
    restoring.current = false;
    updateVisible();
  }, [offsets]);

  useEffect(() => setPageInput(String(current + 1)), [current]);
  useEffect(() => {
    const timer = setTimeout(() => setPrefs({ pageIndex: current }), 400);
    return () => clearTimeout(timer);
  }, [current]);

  useEffect(() => {
    if (!preview) return;
    let alive = true;
    void loadOutline(preview).then((entries) => alive && setOutline(entries));
    return () => {
      alive = false;
    };
  }, [preview]);

  const scrollToPage = useCallback(
    (pageIndex: number, top?: number) => {
      const element = scrollRef.current;
      if (!element || !sizes || pageIndex < 0 || pageIndex >= sizes.length) return;
      const target = top !== undefined ? offsets[pageIndex]! + top * scale - element.clientHeight / 3 : offsets[pageIndex]! - GAP;
      element.scrollTop = Math.max(0, target);
      // 立即记下新位置：新快照可能在 scroll 事件之前到达，恢复位置时不能回到旧处。
      updateVisible();
    },
    [sizes, offsets, scale, updateVisible],
  );

  // Agent 请面板显示的位置（页或高亮）。高亮要等它在当前快照上定位后再跳转。
  const handledView = useRef(0);
  useEffect(() => {
    if (!agentView || !preview || handledView.current >= agentView.seq) return;
    const view = agentView.view;
    if (view.kind === "page") {
      handledView.current = agentView.seq;
      scrollToPage(view.pageIndex);
      return;
    }
    const highlight = state.highlights.find((entry) => entry.id === view.id);
    if (!highlight) {
      handledView.current = agentView.seq;
      return;
    }
    if (highlight.seq !== preview.seq) return;
    handledView.current = agentView.seq;
    const size = preview.sizes[highlight.pageIndex];
    const top = size && highlight.rects.length ? size.height - Math.max(...highlight.rects.map((rect) => rect[3])) : undefined;
    scrollToPage(highlight.pageIndex, top);
    setFocused(highlight.id);
  }, [agentView, preview, state.highlights, scrollToPage]);

  // 本快照上的 Agent 高亮，按页分组。
  const highlightsByPage = useMemo(() => {
    const map = new Map<number, Highlight[]>();
    if (!preview) return map;
    for (const highlight of state.highlights)
      if (!highlight.stale && highlight.seq === preview.seq) map.set(highlight.pageIndex, [...(map.get(highlight.pageIndex) ?? []), highlight]);
    return map;
  }, [state.highlights, preview]);

  /** 浮层位置（滚动容器内的坐标）：贴在 rect 下方，左右不超出容器。 */
  const position = (rect: DOMRect, width: number) => {
    const element = scrollRef.current!;
    const outer = element.getBoundingClientRect();
    return {
      left: element.scrollLeft + Math.min(Math.max(rect.left - outer.left, 8), Math.max(8, element.clientWidth - width - 8)),
      top: rect.bottom - outer.top + element.scrollTop + 8,
    };
  };

  // 选中文字后：浮动工具条，并查找对应的源码。
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onUp = (event: MouseEvent | KeyboardEvent) => {
      if ((event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey) return;
      setTimeout(() => {
        const selected = window.getSelection();
        const text = selected?.toString().trim() ?? "";
        if (!selected || !text || selected.rangeCount === 0) {
          setFloating((previous) => (previous?.kind === "selection" && !previous.asking ? null : previous));
          return;
        }
        const node = selected.anchorNode instanceof Element ? selected.anchorNode : selected.anchorNode?.parentElement;
        const pageElement = node?.closest<HTMLElement>(".page");
        if (!pageElement || !element.contains(pageElement)) return;
        const range = selected.getRangeAt(0).getBoundingClientRect();
        const next: Floating = { kind: "selection", text, pageIndex: Number(pageElement.dataset.page), lookup: { status: "pending" }, asking: false, ...position(range, 300) };
        setFloating(next);
        void lookupSource(text).then((lookup) => setFloating((previous) => (previous && previous.text === text ? { ...previous, lookup } : previous)));
      }, 0);
    };
    element.addEventListener("mouseup", onUp);
    element.addEventListener("keyup", onUp);
    return () => {
      element.removeEventListener("mouseup", onUp);
      element.removeEventListener("keyup", onUp);
    };
  }, [!!preview]);

  // ⌘ / Ctrl + 点击：这一行文字来自哪里。
  const onPagesClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const found = lineAt(event.target as HTMLElement);
    const pageElement = (event.target as HTMLElement).closest<HTMLElement>(".page");
    if (!found || !pageElement || !found.line) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    const at = position(new DOMRect(event.clientX, event.clientY, 0, 0), 420);
    const next: Floating = { kind: "source", text: found.context, focus: found.line, pageIndex: Number(pageElement.dataset.page), lookup: { status: "pending" }, asking: false, ...at };
    setFloating(next);
    void lookupSource(found.context, found.line).then((lookup) =>
      setFloating((previous) => (previous && previous.kind === "source" && previous.focus === found.line ? { ...previous, lookup } : previous)),
    );
  };

  const openMark = (highlight: Highlight, target: HTMLElement) => {
    setFloating(null);
    setFocused(highlight.id);
    setPopover({ id: highlight.id, ...position(target.getBoundingClientRect(), 280) });
  };

  const goTo = (value: string) => {
    const page = Number(value);
    if (Number.isInteger(page) && page >= 1 && sizes && page <= sizes.length) scrollToPage(page - 1);
    else setPageInput(String(current + 1));
  };
  const zoomTo = (zoom: Zoom) => setPrefs({ zoom });
  const count = sizes?.length ?? 0;
  const popoverHighlight = popover ? state.highlights.find((entry) => entry.id === popover.id && !entry.stale) : undefined;
  const outdated = state.status.phase === "error" && !!state.snapshot;

  let body;
  if (error && !preview)
    body = (
      <Empty>
        <Icon name="alert" size={20} />
        <p className="strong">{s.previewError}</p>
        <p className="error-text">{error}</p>
      </Empty>
    );
  else if (!state.snapshot)
    body =
      state.status.phase === "error" || state.status.phase === "crashed" ? (
        <Empty>
          <Icon name="alert" size={20} />
          <p className="muted">{state.status.phase === "crashed" ? state.status.error : s.noPreviewErrors}</p>
        </Empty>
      ) : (
        <Empty>
          <span className="spinner lg" />
          <p className="muted">{s.firstCompile}</p>
        </Empty>
      );
  else if (!preview)
    body = (
      <Empty>
        <span className="spinner lg" />
        <p className="muted">{s.loadingPreview}</p>
      </Empty>
    );
  else
    body = (
      <div className={`page-stack${outdated ? " outdated" : ""}`} style={{ paddingTop: GAP, paddingBottom: GAP }} onClickCapture={onPagesClick}>
        {preview.sizes.map((size, index) => (
          <PageView
            key={index}
            preview={preview}
            index={index}
            size={size}
            scale={scale}
            visible={visible.has(index)}
            highlights={highlightsByPage.get(index) ?? []}
            focused={focused}
            onMark={openMark}
          />
        ))}
      </div>
    );

  return (
    <div className="view preview">
      <header className="bar">
        <MainPicker state={state} s={s} notify={notify} />
        <StatusPill state={state} s={s} onClick={() => setPrefs({ problems: !problemsOpen })} />
        <div className="grow" />
        {count > 0 && (
          <span className="pager">
            <input
              aria-label={s.page}
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && goTo(pageInput)}
              onBlur={() => goTo(pageInput)}
            />
            <span className="muted">/ {count}</span>
          </span>
        )}
        <IconButton icon="minus" label={s.zoomOut} disabled={!preview} onClick={() => zoomTo(Math.max(MIN_ZOOM, Math.round((scale / 1.2) * 100) / 100))} />
        <button
          type="button"
          className={`btn ghost sm zoom${typeof prefs.zoom === "string" ? " active" : ""}`}
          title={prefs.zoom === "width" ? s.fitPage : s.fitWidth}
          disabled={!preview}
          onClick={() => zoomTo(prefs.zoom === "width" ? "page" : "width")}
        >
          {Math.round(scale * 100)}%
        </button>
        <IconButton icon="plus" label={s.zoomIn} disabled={!preview} onClick={() => zoomTo(Math.min(MAX_ZOOM, Math.round(scale * 1.2 * 100) / 100))} />
        <IconButton icon="list" label={s.outline} active={prefs.outline} onClick={() => setPrefs({ outline: !prefs.outline })} />
      </header>
      {state.status.phase === "crashed" && state.snapshot && (
        <div className="banner bad">
          <Icon name="alert" size={14} />
          <span className="ellipsis grow" title={state.status.error}>
            {s.crashed}: {state.status.error}
          </span>
          <button type="button" className="btn outline sm" onClick={() => void host.call("restart").catch((reason) => notify(errorText(reason), "error"))}>
            <Icon name="refresh" size={14} />
            {s.restart}
          </button>
        </div>
      )}
      <div className="preview-body">
        {prefs.outline && (
          <aside className="sidebar">
            <div className="sidebar-head">{s.outline}</div>
            {outline.length === 0 ? (
              <p className="muted small pad">{s.noOutline}</p>
            ) : (
              <ul className="outline scroll">
                {outline.map((entry, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      className={`outline-item${entry.pageIndex === current ? " current" : ""}`}
                      style={{ paddingLeft: 10 + entry.depth * 12 }}
                      onClick={() => scrollToPage(entry.pageIndex, entry.top)}
                    >
                      <span className="ellipsis grow">{entry.title}</span>
                      <span className="muted small">{entry.pageIndex + 1}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
        <div className="pages scroll" ref={scrollRef} onScroll={updateVisible}>
          {body}
          {floating && (
            <FloatTools
              floating={floating}
              s={s}
              notify={notify}
              onClose={() => setFloating(null)}
              onAsk={() => setFloating((previous) => (previous ? { ...previous, asking: true } : previous))}
            />
          )}
          {popover && popoverHighlight && (
            <MarkPopover
              highlight={popoverHighlight}
              anchor={popover}
              s={s}
              notify={notify}
              onClose={() => {
                setPopover(null);
                setFocused(null);
              }}
            />
          )}
        </div>
      </div>
      {(problemsOpen || (!state.snapshot && state.diagnostics.length > 0)) && (
        <Problems state={state} s={s} notify={notify} full={!state.snapshot} />
      )}
    </div>
  );
}
