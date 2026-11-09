import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { URIS, type AgentHighlight, type Annotation, type AnnotationsDoc, type ItemDetail, type Rect, type SessionState } from "#z/contract.ts";
import { host } from "#ui/bridge.ts";
import { addQuoteToContext, askAboutQuote, type QuoteRef } from "#ui/chat.ts";
import { AskBox, Empty, IconButton, errorText, zoteroOpenPdfUrl } from "#ui/common.tsx";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { loadPdf, TextLayer, toViewport, type LoadedPdf, type PDFDocumentProxy } from "#ui/pdf.ts";
import { replace, useResource, type Route } from "#ui/store.ts";

type Notify = (message: string, tone?: "info" | "error") => void;
type ReaderRoute = Extract<Route, { kind: "reader" }>;

interface PageSize {
  width: number;
  height: number;
}

const GAP = 12;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

/** 页面尺寸（scale 1）：逐页读取，未读到的页沿用第一页尺寸。 */
async function pageSizes(doc: PDFDocumentProxy): Promise<PageSize[]> {
  const sizes: PageSize[] = [];
  for (let index = 1; index <= doc.numPages; index++) {
    const page = await doc.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
  }
  return sizes;
}

type Mark =
  | { kind: "annotation"; annotation: Annotation }
  | { kind: "highlight"; highlight: AgentHighlight };

function PageView({
  doc,
  index,
  size,
  scale,
  visible,
  marks,
  focused,
  onMark,
}: {
  doc: PDFDocumentProxy;
  index: number;
  size: PageSize;
  scale: number;
  visible: boolean;
  marks: Mark[];
  focused: string | null;
  onMark: (mark: Mark, element: HTMLElement) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["getViewport"]> | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!visible) {
      setRendered(false);
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      if (textRef.current) textRef.current.replaceChildren();
      return;
    }
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let textLayer: { cancel: () => void } | null = null;
    void (async () => {
      const page = await doc.getPage(index + 1);
      if (cancelled) return;
      const view = page.getViewport({ scale });
      setViewport(view);
      const canvas = canvasRef.current!;
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.floor(view.width * ratio);
      canvas.height = Math.floor(view.height * ratio);
      canvas.style.width = `${view.width}px`;
      canvas.style.height = `${view.height}px`;
      const context = canvas.getContext("2d")!;
      const renderTask = page.render({ canvas, canvasContext: context, viewport: view, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined } as never);
      task = renderTask;
      try {
        await renderTask.promise;
      } catch {
        return; // 取消（缩放或滚出视野）。
      }
      if (cancelled) return;
      setRendered(true);
      const container = textRef.current!;
      container.replaceChildren();
      const layer = new TextLayer({ textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }), container, viewport: view });
      textLayer = layer;
      await layer.render().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
    };
  }, [doc, index, scale, visible]);

  const width = size.width * scale;
  const height = size.height * scale;
  // 文字层在注释之上（为了能选中文字），所以点击按坐标命中注释；选中文字时不当作点击。
  const hit = (event: React.MouseEvent<HTMLDivElement>) => {
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>(".mark")];
    // 重叠时取最上层（Agent 高亮绘制在用户注释之后）。
    return elements.findLast((element) => {
      const box = element.getBoundingClientRect();
      return event.clientX >= box.left - 1 && event.clientX <= box.right + 1 && event.clientY >= box.top - 1 && event.clientY <= box.bottom + 1;
    });
  };
  return (
    <div
      className="page"
      data-page={index}
      style={{ width, height, ["--scale-factor" as string]: scale, ["--total-scale-factor" as string]: scale }}
      onClick={(event) => {
        if (window.getSelection()?.toString().trim()) return;
        const element = hit(event);
        const mark = element && marks.find((entry) => (entry.kind === "annotation" ? entry.annotation.key : entry.highlight.id) === element.dataset.mark);
        if (element && mark) onMark(mark, element);
      }}
      onMouseMove={(event) => event.currentTarget.classList.toggle("over-mark", !!hit(event))}
    >
      <canvas ref={canvasRef} className={rendered ? "" : "pending"} />
      <div ref={textRef} className="textLayer" />
      {viewport && (
        <div className="marks">
          {marks.map((mark) => {
            const id = mark.kind === "annotation" ? mark.annotation.key : mark.highlight.id;
            const rects = mark.kind === "annotation" ? mark.annotation.rects : mark.highlight.rects;
            const color = mark.kind === "annotation" ? mark.annotation.color : mark.highlight.color;
            const type = mark.kind === "annotation" ? mark.annotation.type : "agent";
            if (type === "ink") return null;
            return rects.map((rect: Rect, part: number) => {
              const box = toViewport(viewport, rect);
              const style =
                type === "note"
                  ? { left: box.left, top: box.top, width: Math.max(box.width, 16), height: Math.max(box.height, 16), ["--mark" as string]: color }
                  : { left: box.left, top: box.top, width: box.width, height: box.height, ["--mark" as string]: color };
              return (
                <button
                  type="button"
                  key={`${id}-${part}`}
                  className={`mark ${type}${focused === id ? " focused" : ""}`}
                  data-mark={id}
                  style={style}
                  aria-label={mark.kind === "annotation" ? mark.annotation.comment || mark.annotation.text || type : mark.highlight.comment || mark.highlight.quote}
                  onClick={(event) => {
                    // 只有键盘（Enter / 空格）会直接点到按钮；鼠标点击由页面命中处理。
                    event.stopPropagation();
                    onMark(mark, event.currentTarget);
                  }}
                >
                  {part === 0 && mark.kind === "highlight" && <span className="badge">✦</span>}
                </button>
              );
            });
          })}
        </div>
      )}
    </div>
  );
}

function MarkPopover({
  mark,
  anchor,
  s,
  route,
  onClose,
  notify,
}: {
  mark: Mark;
  anchor: { left: number; top: number };
  s: Strings;
  route: ReaderRoute;
  onClose: () => void;
  notify: Notify;
}) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node) && !(event.target as HTMLElement).closest?.(".mark")) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);
  const isAgent = mark.kind === "highlight";
  const text = isAgent ? mark.highlight.quote : mark.annotation.text;
  const comment = isAgent ? mark.highlight.comment : mark.annotation.comment;
  return (
    <div className="popover" ref={ref} style={{ left: anchor.left, top: anchor.top }} role="dialog">
      <div className="popover-head">
        {isAgent ? (
          <span className="who agent">
            <Icon name="sparkles" size={12} />
            {s.agent}
          </span>
        ) : (
          <span className="who">
            <span className="swatch" style={{ background: mark.annotation.color }} />
            {s.you}
          </span>
        )}
        <span className="muted small">
          {s.page} {isAgent ? mark.highlight.pageLabel : mark.annotation.pageLabel}
        </span>
        <div className="grow" />
        <IconButton icon="x" label={s.close} size={14} onClick={onClose} />
      </div>
      {text && <p className="quote">{text}</p>}
      {comment && <p className="comment">{comment}</p>}
      {isAgent && (
        <div className="popover-actions">
          {mark.highlight.savedAs ? (
            <span className="muted small">
              <Icon name="check" size={12} /> {s.saved}
            </span>
          ) : (
            <button
              type="button"
              className="btn primary sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void host
                  .call("save_highlights", { ids: [mark.highlight.id] })
                  .then(() => notify(s.saved))
                  .catch((error) => notify(errorText(error), "error"))
                  .finally(() => setBusy(false));
              }}
            >
              <Icon name="save" size={14} />
              {busy ? s.saving : s.saveToZotero}
            </button>
          )}
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              void host.call("clear_highlights", { ids: [mark.highlight.id] }).catch((error) => notify(errorText(error), "error"));
              onClose();
            }}
          >
            <Icon name="trash" size={14} />
            {s.remove}
          </button>
        </div>
      )}
      {!isAgent && (
        <div className="popover-actions">
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void host.openLink(`${zoteroOpenPdfUrl(route.library, route.attachmentKey)}?annotation=${mark.annotation.key}`)}
          >
            <Icon name="external" size={14} />
            {s.showInZotero}
          </button>
        </div>
      )}
    </div>
  );
}

export function Reader({
  route,
  state,
  s,
  notify,
  onBack,
}: {
  route: ReaderRoute;
  state: SessionState;
  s: Strings;
  notify: Notify;
  onBack: () => void;
}) {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 1]);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [visible, setVisible] = useState<Set<number>>(new Set([0]));
  const [current, setCurrent] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [sidebar, setSidebar] = useState(false);
  const [selection, setSelection] = useState<{ quote: QuoteRef; left: number; top: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const [popover, setPopover] = useState<{ mark: Mark; left: number; top: number } | null>(null);
  const [focused, setFocused] = useState<string | null>(route.highlightId ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const annotations = useResource<AnnotationsDoc>(URIS.annotations(route.library, route.attachmentKey));
  const item = useResource<ItemDetail>(URIS.item(route.library, route.itemKey));
  const title = item.data?.title ?? pdf?.info.title ?? "";

  // 打开文档。
  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setSizes(null);
    setError(null);
    loadPdf(route.library, route.attachmentKey, (done, total) => !cancelled && setProgress([done, total]))
      .then(async (loaded) => {
        const measured = await pageSizes(loaded.doc);
        if (cancelled) return;
        setPdf(loaded);
        setSizes(measured);
      })
      .catch((reason) => !cancelled && setError(errorText(reason)));
    return () => {
      cancelled = true;
    };
  }, [route.library, route.attachmentKey]);

  // 容器宽度（适应宽度时决定缩放）。
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [pdf]);

  const maxWidth = sizes ? Math.max(...sizes.map((size) => size.width)) : 612;
  const fitScale = width ? Math.max(0.3, (width - 2 * GAP) / maxWidth) : 1;
  const scale = zoom === "fit" ? fitScale : zoom;

  // 可见页：滚动时按页面位置计算（含上下一屏的预渲染）。
  const offsets = useMemo(() => {
    if (!sizes) return [];
    const result: number[] = [];
    let y = GAP;
    for (const size of sizes) {
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
    const margin = element.clientHeight;
    const next = new Set<number>();
    let middlePage = 0;
    for (let index = 0; index < sizes.length; index++) {
      const start = offsets[index]!;
      const end = start + sizes[index]!.height * scale;
      if (end >= top - margin && start <= bottom + margin) next.add(index);
      if (start <= top + element.clientHeight / 3) middlePage = index;
    }
    setVisible((previous) => (previous.size === next.size && [...next].every((index) => previous.has(index)) ? previous : next));
    setCurrent(middlePage);
  }, [sizes, offsets, scale]);

  useEffect(() => {
    updateVisible();
  }, [updateVisible]);
  useEffect(() => setPageInput(String(current + 1)), [current]);

  // 跳转：Agent 指定的页或高亮（nonce 变化表示新的请求）。
  const scrollToPage = useCallback(
    (pageIndex: number, rectTop?: number) => {
      const element = scrollRef.current;
      if (!element || !sizes || pageIndex < 0 || pageIndex >= sizes.length) return;
      element.scrollTo({ top: Math.max(0, offsets[pageIndex]! + (rectTop ?? 0) - (rectTop !== undefined ? element.clientHeight / 3 : GAP)) });
    },
    [sizes, offsets],
  );
  useEffect(() => {
    if (!sizes || !pdf) return;
    const highlight = route.highlightId ? state.highlights.find((entry) => entry.id === route.highlightId) : undefined;
    if (highlight) {
      void pdf.doc.getPage(highlight.pageIndex + 1).then((page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>) => {
        const view = page.getViewport({ scale });
        const top = Math.min(...highlight.rects.map((rect) => toViewport(view, rect).top));
        scrollToPage(highlight.pageIndex, Number.isFinite(top) ? top : 0);
        setFocused(highlight.id);
      });
    } else if (route.pageIndex !== undefined) scrollToPage(route.pageIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.nonce, route.highlightId, route.pageIndex, sizes, pdf]);

  // 缩放时保持当前页位置。
  const setZoomKeeping = (next: number | "fit") => {
    const page = current;
    setZoom(next);
    requestAnimationFrame(() => scrollToPage(page));
  };

  // 页面上的注释与 Agent 高亮。
  const marksByPage = useMemo(() => {
    const map = new Map<number, Mark[]>();
    const add = (page: number, mark: Mark) => map.set(page, [...(map.get(page) ?? []), mark]);
    const saved = new Set<string>();
    for (const annotation of annotations.data?.annotations ?? []) {
      add(annotation.pageIndex, { kind: "annotation", annotation });
      saved.add(annotation.key);
    }
    // 已保存到 Zotero 的 Agent 高亮由对应的 Zotero 注释显示，不重复绘制。
    for (const highlight of state.highlights.filter((entry) => entry.library === route.library && entry.attachmentKey === route.attachmentKey))
      if (!highlight.savedAs || !saved.has(highlight.savedAs)) add(highlight.pageIndex, { kind: "highlight", highlight });
    return map;
  }, [annotations.data, state.highlights, route.library, route.attachmentKey]);

  // 选中文字后显示浮动工具条。
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onUp = () => {
      setTimeout(() => {
        const selected = window.getSelection();
        const text = selected?.toString().trim() ?? "";
        if (!selected || !text || selected.rangeCount === 0) {
          if (!asking) setSelection(null);
          return;
        }
        const node = selected.anchorNode instanceof Element ? selected.anchorNode : selected.anchorNode?.parentElement;
        const pageElement = node?.closest<HTMLElement>(".page");
        if (!pageElement || !element.contains(pageElement)) return;
        const pageIndex = Number(pageElement.dataset.page);
        const range = selected.getRangeAt(0).getBoundingClientRect();
        const box = element.getBoundingClientRect();
        setAsking(false);
        setSelection({
          quote: {
            library: route.library,
            itemKey: route.itemKey,
            attachmentKey: route.attachmentKey,
            title,
            pageIndex,
            pageLabel: pdf?.labels?.[pageIndex] || String(pageIndex + 1),
            text,
          },
          left: Math.min(Math.max(range.left - box.left + element.scrollLeft + range.width / 2, 120), element.clientWidth - 120),
          top: range.bottom - box.top + element.scrollTop + 8,
        });
      }, 0);
    };
    element.addEventListener("mouseup", onUp);
    element.addEventListener("keyup", onUp);
    return () => {
      element.removeEventListener("mouseup", onUp);
      element.removeEventListener("keyup", onUp);
    };
  }, [route.library, route.itemKey, route.attachmentKey, title, asking, pdf]);

  const openMark = (mark: Mark, target: HTMLElement) => {
    const element = scrollRef.current!;
    const box = element.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    setSelection(null);
    setFocused(mark.kind === "annotation" ? mark.annotation.key : mark.highlight.id);
    setPopover({
      mark,
      left: Math.min(Math.max(rect.left - box.left + element.scrollLeft, 8), element.clientWidth - 288),
      top: rect.bottom - box.top + element.scrollTop + 6,
    });
  };

  const goTo = (value: string) => {
    const page = Number(value);
    if (Number.isInteger(page) && page >= 1 && sizes && page <= sizes.length) {
      scrollToPage(page - 1);
      replace({ ...route, pageIndex: page - 1, highlightId: undefined, nonce: Date.now() });
    } else setPageInput(String(current + 1));
  };

  const count = sizes?.length ?? 0;
  const list = [...marksByPage.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, marks]) => marks);
  // 当前页的 Agent 高亮可能刚被移除：关闭对应的弹窗。
  const livePopover =
    popover && (popover.mark.kind === "annotation" || state.highlights.some((entry) => entry.id === (popover.mark as { highlight: AgentHighlight }).highlight.id))
      ? popover.mark.kind === "highlight"
        ? { ...popover, mark: { kind: "highlight" as const, highlight: state.highlights.find((entry) => entry.id === (popover.mark as { highlight: AgentHighlight }).highlight.id)! } }
        : popover
      : null;

  return (
    <div className="view reader">
      <header className="bar">
        <IconButton icon="chevronLeft" label={s.back} onClick={onBack} />
        <span className="ellipsis grow strong" title={title}>
          {title}
        </span>
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
        <IconButton icon="minus" label={s.zoomOut} disabled={!pdf} onClick={() => setZoomKeeping(Math.max(MIN_ZOOM, Math.round((scale / 1.2) * 100) / 100))} />
        <button type="button" className={`btn ghost sm zoom${zoom === "fit" ? " active" : ""}`} title={s.fitWidth} disabled={!pdf} onClick={() => setZoomKeeping("fit")}>
          {Math.round(scale * 100)}%
        </button>
        <IconButton icon="plus" label={s.zoomIn} disabled={!pdf} onClick={() => setZoomKeeping(Math.min(MAX_ZOOM, Math.round(scale * 1.2 * 100) / 100))} />
        <IconButton icon="highlighter" label={s.sidebar} active={sidebar} onClick={() => setSidebar(!sidebar)} />
        <IconButton icon="external" label={s.showInZotero} onClick={() => void host.openLink(zoteroOpenPdfUrl(route.library, route.attachmentKey, current + 1))} />
      </header>
      <div className="reader-body">
        <div className="pages scroll" ref={scrollRef} onScroll={updateVisible}>
          {error ? (
            <Empty>
              <Icon name="alert" size={20} />
              <p className="strong">{s.pdfError}</p>
              <p className="error-text">{error}</p>
            </Empty>
          ) : !pdf || !sizes ? (
            <Empty>
              <div className="progress">
                <div style={{ width: `${Math.round((progress[0] / Math.max(progress[1], 1)) * 100)}%` }} />
              </div>
              {s.loadingPdf(progress[0], progress[1])}
            </Empty>
          ) : (
            <div className="page-stack" style={{ paddingTop: GAP, paddingBottom: GAP }}>
              {sizes.map((size, index) => (
                <PageView
                  key={index}
                  doc={pdf.doc}
                  index={index}
                  size={size}
                  scale={scale}
                  visible={visible.has(index)}
                  marks={marksByPage.get(index) ?? []}
                  focused={focused}
                  onMark={openMark}
                />
              ))}
            </div>
          )}
          {selection && (
            <div className="float-tools" style={{ left: selection.left, top: selection.top }} onMouseDown={(event) => event.preventDefault()}>
              {asking ? (
                <AskBox
                  placeholder={s.askPlaceholder}
                  sendLabel={s.send}
                  onClose={() => {
                    setAsking(false);
                    setSelection(null);
                  }}
                  onSend={(question) =>
                    askAboutQuote(question, selection.quote).catch((reason) => {
                      notify(errorText(reason), "error");
                      throw reason;
                    })
                  }
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => {
                      void addQuoteToContext(selection.quote)
                        .then(() => notify(s.quoteAdded))
                        .catch((reason) => notify(errorText(reason), "error"));
                      setSelection(null);
                    }}
                  >
                    <Icon name="quote" size={14} />
                    {s.quote}
                  </button>
                  <button type="button" className="btn ghost sm" onClick={() => setAsking(true)}>
                    <Icon name="message" size={14} />
                    {s.ask}
                  </button>
                </>
              )}
            </div>
          )}
          {livePopover && (
            <MarkPopover
              mark={livePopover.mark}
              anchor={livePopover}
              s={s}
              route={route}
              notify={notify}
              onClose={() => {
                setPopover(null);
                setFocused(null);
              }}
            />
          )}
        </div>
        {sidebar && (
          <aside className="sidebar">
            <div className="sidebar-head">{s.annotations}</div>
            {list.length === 0 ? (
              <p className="muted small pad">{s.noAnnotations}</p>
            ) : (
              <ul className="annotation-list compact">
                {list.map((mark) => {
                  const id = mark.kind === "annotation" ? mark.annotation.key : mark.highlight.id;
                  const pageIndex = mark.kind === "annotation" ? mark.annotation.pageIndex : mark.highlight.pageIndex;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className={`annotation${mark.kind === "highlight" ? " agent" : ""}${focused === id ? " focused" : ""}`}
                        onClick={() => {
                          setFocused(id);
                          if (mark.kind === "highlight") replace({ ...route, highlightId: id, pageIndex, nonce: Date.now() });
                          else scrollToPage(pageIndex, toTop(mark.annotation.rects, sizes?.[pageIndex], scale));
                        }}
                      >
                        <span className="swatch" style={{ background: mark.kind === "annotation" ? mark.annotation.color : mark.highlight.color }} />
                        <span className="annotation-body">
                          <span className="quote">{mark.kind === "annotation" ? mark.annotation.text || mark.annotation.comment : mark.highlight.quote}</span>
                          {mark.kind === "annotation" && mark.annotation.text && mark.annotation.comment && <span className="comment">{mark.annotation.comment}</span>}
                          {mark.kind === "highlight" && mark.highlight.comment && <span className="comment">{mark.highlight.comment}</span>}
                          <span className="muted small">
                            {mark.kind === "highlight" && (
                              <>
                                <Icon name="sparkles" size={11} /> {s.agent} ·{" "}
                              </>
                            )}
                            {s.page} {pageIndex + 1}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        )}
      </div>
      {state.authorizing && <div className="banner">{s.waitingApproval}</div>}
    </div>
  );
}

/** 注释在页面内的顶部位置（CSS 像素，未旋转页面）。 */
function toTop(rects: Rect[], size: PageSize | undefined, scale: number): number | undefined {
  if (!rects.length || !size) return undefined;
  return (size.height - Math.max(...rects.map((rect) => rect[3]))) * scale;
}
