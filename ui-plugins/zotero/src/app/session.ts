import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { marked } from "marked";
import {
  LIMITS,
  ZoteroError,
  type AgentHighlight,
  type Annotation,
  type HostFacts,
  type AnnotationsDoc,
  type ItemDetail,
  type LibraryId,
  type LibraryInfo,
  type PanelView,
  type PdfInfo,
  type Rect,
  type SessionState,
  type ZoteroInstall,
} from "#z/contract.ts";
import { parseAnnotation, summarize, type RawItem } from "#z/domain/items.ts";
import { findQuote, rectsFor, sortIndex, textAt, type PageText } from "#z/domain/text.ts";
import {
  downloadPdf,
  parseIdentifier,
  resolveIdentifier,
  zoteroFilename,
  type Fetcher,
  type NewItem,
} from "#z/metadata/metadata.ts";
import { PdfStore, isPdf, type PdfText } from "#z/pdf/extract.ts";
import { detectFacts } from "#z/host/facts.ts";
import { ZoteroClient } from "#z/zotero/client.ts";
import { findZotero, launchZotero } from "#z/zotero/install.ts";
import { Library } from "#z/zotero/library.ts";
import { Writer } from "#z/zotero/writes.ts";

/** Zotero 的注释颜色。 */
export const COLORS: Record<string, string> = {
  yellow: "#ffd400",
  red: "#ff6666",
  green: "#5fb236",
  blue: "#2ea8e5",
  purple: "#a28ae5",
  magenta: "#e56eee",
  orange: "#f19837",
  gray: "#aaaaaa",
};
export const AGENT_COLOR = COLORS.purple!;

export type ChangeEvent = { kind: "state" } | { kind: "library"; library: LibraryId };

export interface SessionOptions {
  baseUrl?: string;
  keyFile?: string | null;
  workspaceRoot: string;
  pdfjsDataDir: string | null;
  fetcher?: Fetcher;
  authorizeTimeoutMs?: number;
  log?: (line: string) => void;
  /** 测试注入：替换本机事实探测、Zotero 安装查找与启动。 */
  facts?: () => Promise<HostFacts>;
  findApp?: () => Promise<ZoteroInstall>;
  launchApp?: () => Promise<string>;
}

export function resolveColor(color: string | undefined): string {
  if (!color) return AGENT_COLOR;
  const named = COLORS[color.toLowerCase()];
  if (named) return named;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  throw new ZoteroError("invalid_input", `Unknown color "${color}". Use ${Object.keys(COLORS).join(", ")} or #rrggbb.`);
}

/**
 * 会话的唯一 owner：Zotero 连接、库缓存、PDF 文本、面板视图与 Agent 高亮。
 * 工具与资源都经它读写；面板状态可随时由资源重建。
 */
export class ZoteroSession {
  readonly client: ZoteroClient;
  readonly library: Library;
  readonly writer: Writer;
  readonly pdfs: PdfStore;
  readonly workspaceRoot: string;
  private fetcher: Fetcher;
  private log: (line: string) => void;
  private listeners = new Set<(event: ChangeEvent) => void>();
  private stateVersion = 0;
  private view: PanelView | null = null;
  private viewSeq = 0;
  private highlights: AgentHighlight[] = [];
  private highlightSeq = 0;
  private libraries: LibraryInfo[] = [{ id: "user", name: "My Library", type: "user", editable: true }];
  private librariesLoaded = false;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  // 设置页：本机事实、已安装的 Zotero、“已交给 Agent”。
  private facts: HostFacts | null = null;
  private factsPending: Promise<void> | null = null;
  private app: ZoteroInstall | null = null;
  private handoffAt: number | null = null;
  private readonly options: SessionOptions;

  constructor(options: SessionOptions) {
    this.options = options;
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.fetcher = options.fetcher ?? fetch;
    this.log = options.log ?? (() => undefined);
    this.client = new ZoteroClient({
      baseUrl: options.baseUrl,
      keyFile: options.keyFile,
      authorizeTimeoutMs: options.authorizeTimeoutMs,
      onChange: () => this.emit({ kind: "state" }),
      log: this.log,
    });
    this.library = new Library(this.client);
    this.writer = new Writer(this.client, this.library);
    this.pdfs = new PdfStore(options.pdfjsDataDir);
  }

  onChange(listener: (event: ChangeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ChangeEvent) {
    if (event.kind === "state") this.stateVersion += 1;
    for (const listener of this.listeners) listener(event);
  }

  state(): SessionState {
    return {
      version: this.stateVersion,
      status: this.client.status,
      libraries: this.libraries.map((library) => ({ ...library, version: this.library.versionOf(library.id) || library.version })),
      view: this.view,
      viewSeq: this.viewSeq,
      highlights: this.highlights,
      authorizing: this.client.isAuthorizing,
      setup: {
        facts: this.facts,
        app: this.app,
        handoffAt: this.handoffAt !== null && Date.now() - this.handoffAt < LIMITS.handoffMs ? this.handoffAt : null,
        address: new URL(this.client.baseUrl).host,
      },
    };
  }

  // -------------------------------------------------------------------------
  // 连接与变化检测
  // -------------------------------------------------------------------------

  async ready() {
    try {
      await this.client.ensureReady();
    } catch (error) {
      // Zotero 没有运行时，区分“根本没装”：Agent 应该帮用户安装，而不是让用户去打开它。
      if (error instanceof ZoteroError && error.code === "zotero_not_running") {
        await this.checkSetup();
        if (this.app?.state === "missing")
          throw new ZoteroError(
            "zotero_not_installed",
            `Zotero is not installed on this computer (looked in ${this.app.searched.join(", ")}). It needs the Zotero desktop app, version 7 or later, from https://www.zotero.org/download/ — offer to install it, then ask the user to turn on Settings → Advanced → "Allow other applications on this computer to communicate with Zotero".`,
          );
      }
      throw error;
    }
    if (!this.librariesLoaded) await this.refreshLibraries();
  }

  private async refreshLibraries() {
    try {
      this.libraries = await this.library.libraries();
      this.librariesLoaded = true;
      this.emit({ kind: "state" });
    } catch (error) {
      this.log(`listing libraries failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 检查一次：Zotero 是否在运行、各库版本是否变化；未就绪时同时检查本机是否装了 Zotero。 */
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const before = this.client.status.state;
      const status = await this.client.probe();
      if (status.state !== "ready") {
        await this.checkSetup();
        return;
      }
      if (this.handoffAt !== null) {
        this.handoffAt = null;
        this.emit({ kind: "state" });
      }
      if (before !== "ready" || !this.librariesLoaded) await this.refreshLibraries();
      for (const library of this.libraries) {
        const { changed } = await this.library.checkVersion(library.id).catch(() => ({ changed: false }));
        if (changed) {
          this.library.invalidate(library.id);
          this.emit({ kind: "library", library: library.id });
          this.emit({ kind: "state" });
        }
      }
    } finally {
      this.polling = false;
    }
  }

  /** 面板订阅期间轮询 Zotero，以便在 Zotero 中的修改与启动 / 退出及时显示。 */
  watch(enabled: boolean) {
    if (enabled && !this.watchTimer) {
      void this.poll();
      this.watchTimer = setInterval(() => void this.poll().catch(() => undefined), LIMITS.pollMs);
      this.watchTimer.unref?.();
    } else if (!enabled && this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  close() {
    this.watch(false);
  }

  // -------------------------------------------------------------------------
  // 设置页：本机事实、已安装的 Zotero、交给 Agent、打开 Zotero
  // -------------------------------------------------------------------------

  /** Zotero 未就绪时：本机事实（只探测一次）与安装情况（每次轮询，文件检查很便宜）。 */
  private async checkSetup() {
    if (!this.facts) {
      this.factsPending ??= (this.options.facts ?? (() => detectFacts()))()
        .then((facts) => {
          this.facts = facts;
          this.emit({ kind: "state" });
        })
        .catch((error) => this.log(`could not detect host facts: ${error}`))
        .finally(() => (this.factsPending = null));
    }
    try {
      const { state, path, version, searched } = await (this.options.findApp ?? findZotero)();
      const app: ZoteroInstall = { state, ...(path ? { path } : {}), ...(version ? { version } : {}), searched };
      if (JSON.stringify(app) !== JSON.stringify(this.app)) {
        this.app = app;
        this.emit({ kind: "state" });
      }
    } catch (error) {
      this.log(`could not look for the Zotero app: ${error}`);
    }
  }

  /** 设置页的“重新检查”：立即探测一次。 */
  async recheck() {
    await this.poll();
    if (this.client.status.state !== "ready") await this.checkSetup();
  }

  /** 面板把安装交给了 Agent：设置页据此显示“正在设置”，直到 Zotero 就绪。 */
  handoff() {
    if (this.client.status.state === "ready") return;
    this.handoffAt = Date.now();
    this.emit({ kind: "state" });
  }

  /** 打开已安装的 Zotero；它启动后由轮询发现。 */
  async launchApp(): Promise<string> {
    const path = await (this.options.launchApp ?? launchZotero)();
    this.log(`started Zotero (${path})`);
    return path;
  }

  // -------------------------------------------------------------------------
  // 面板视图
  // -------------------------------------------------------------------------

  show(view: PanelView) {
    this.view = view;
    this.viewSeq += 1;
    this.emit({ kind: "state" });
  }

  // -------------------------------------------------------------------------
  // 读取
  // -------------------------------------------------------------------------

  async itemDetail(library: LibraryId, key: string): Promise<{ item: ItemDetail; annotations: Map<string, Annotation[]> }> {
    await this.ready();
    const item = await this.library.item(library, key);
    const annotations = new Map<string, Annotation[]>();
    for (const attachment of item.attachments.filter((entry) => entry.isPdf))
      annotations.set(attachment.key, await this.library.annotations(library, attachment.key).catch(() => []));
    return { item, annotations };
  }

  async pdfText(library: LibraryId, key: string): Promise<{ item: RawItem; attachment: RawItem; pdf: PdfText; path: string }> {
    await this.ready();
    const { item, attachment } = await this.library.resolvePdf(library, key);
    const path = await this.library.filePath(library, attachment.key);
    const pdf = await this.pdfs.text(path);
    return { item, attachment, pdf, path };
  }

  async pdfInfo(library: LibraryId, attachmentKey: string): Promise<PdfInfo> {
    await this.ready();
    const { item, attachment } = await this.library.resolvePdf(library, attachmentKey);
    const path = await this.library.filePath(library, attachment.key);
    const bytes = await this.pdfs.bytes(path);
    return {
      library,
      attachmentKey: attachment.key,
      itemKey: item.key,
      title: summarize(item).title,
      filename: basename(path),
      bytes: bytes.length,
      parts: Math.max(1, Math.ceil(bytes.length / LIMITS.chunkBytes)),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async pdfPart(library: LibraryId, attachmentKey: string, part: number): Promise<Uint8Array> {
    const path = await this.library.filePath(library, attachmentKey);
    const bytes = await this.pdfs.bytes(path);
    const start = part * LIMITS.chunkBytes;
    if (!Number.isInteger(part) || part < 0 || start >= Math.max(bytes.length, 1))
      throw new ZoteroError("invalid_input", `PDF part ${part} is out of range.`);
    return bytes.subarray(start, start + LIMITS.chunkBytes);
  }

  async annotationsDoc(library: LibraryId, attachmentKey: string): Promise<AnnotationsDoc> {
    await this.ready();
    return {
      library,
      attachmentKey,
      version: this.library.versionOf(library),
      annotations: await this.library.annotations(library, attachmentKey),
      highlights: this.highlights.filter((highlight) => highlight.library === library && highlight.attachmentKey === attachmentKey),
    };
  }

  /** 全库注释检索：按文本 / 评论 / 标签匹配，可限定条目、集合与颜色。 */
  async searchAnnotations(
    library: LibraryId,
    options: { query?: string; itemKey?: string; collection?: string; color?: string; tag?: string; limit?: number },
  ) {
    await this.ready();
    const index = await this.library.annotationIndex(library);
    const words = (options.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const color = options.color ? resolveColor(options.color) : undefined;
    const collectionKeys = options.collection
      ? new Set(await this.library.collectionTree(library, (await this.library.resolveCollection(library, options.collection)).key))
      : null;
    const results: { annotation: Annotation; attachmentKey: string; item: RawItem | undefined }[] = [];
    for (const raw of index.annotations) {
      const attachmentKey = String(raw.data.parentItem ?? "");
      const attachment = index.parents.get(attachmentKey);
      const topKey = (attachment?.data.parentItem as string | undefined) ?? attachmentKey;
      const item = index.parents.get(topKey) ?? attachment;
      if (options.itemKey && options.itemKey !== topKey && options.itemKey !== attachmentKey) continue;
      if (collectionKeys && !((item?.data.collections as string[] | undefined) ?? []).some((key) => collectionKeys.has(key))) continue;
      const annotation = parseAnnotation(raw);
      if (color && annotation.color.toLowerCase() !== color) continue;
      if (options.tag && !annotation.tags.some((tag) => tag.toLowerCase() === options.tag!.toLowerCase())) continue;
      const haystack = `${annotation.text} ${annotation.comment} ${annotation.tags.join(" ")}`.toLowerCase();
      if (words.length && !words.every((word) => haystack.includes(word))) continue;
      results.push({ annotation, attachmentKey, item });
    }
    results.sort(
      (a, b) =>
        String(a.item?.key ?? "").localeCompare(String(b.item?.key ?? "")) || a.annotation.sortIndex.localeCompare(b.annotation.sortIndex),
    );
    return { total: results.length, results: results.slice(0, options.limit ?? 100) };
  }

  // -------------------------------------------------------------------------
  // Agent 高亮
  // -------------------------------------------------------------------------

  /** 在 PDF 中定位引文并加一条 Agent 高亮；返回高亮与引文在 PDF 中的实际写法。 */
  async highlight(
    library: LibraryId,
    key: string,
    options: { quote: string; page?: number; comment?: string; color?: string },
  ): Promise<{ highlight: AgentHighlight; exact: string }> {
    const { item, attachment, pdf } = await this.pdfText(library, key);
    const preferred = options.page !== undefined ? pageIndexFor(pdf.pages, options.page) : undefined;
    const match = findQuote(pdf.pages, options.quote, preferred);
    if (!match)
      throw new ZoteroError(
        "quote_not_found",
        `Could not find the quote in "${summarize(item).title}". Copy the passage exactly from read_fulltext or find_in_pdf (a shorter, distinctive quote works best).`,
      );
    const page = pdf.pages[match.pageIndex]!;
    const rects = rectsFor(page, match.start, match.end);
    const highlight: AgentHighlight = {
      id: `h${++this.highlightSeq}`,
      library,
      attachmentKey: attachment.key,
      itemKey: item.key,
      pageIndex: page.index,
      pageLabel: page.label,
      quote: textAt(page, match.start, match.end),
      comment: options.comment?.trim() ?? "",
      color: resolveColor(options.color),
      rects,
      createdAt: Date.now(),
    };
    this.highlights.push(highlight);
    this.emit({ kind: "state" });
    this.emit({ kind: "library", library });
    return { highlight, exact: highlight.quote };
  }

  findHighlights(ids?: string[], key?: string): AgentHighlight[] {
    if (ids?.length) {
      const missing = ids.filter((id) => !this.highlights.some((highlight) => highlight.id === id));
      if (missing.length) throw new ZoteroError("not_found", `No highlight ${missing.join(", ")} in this session.`);
      return this.highlights.filter((highlight) => ids.includes(highlight.id));
    }
    if (key) return this.highlights.filter((highlight) => highlight.itemKey === key || highlight.attachmentKey === key);
    return [...this.highlights];
  }

  clearHighlights(ids?: string[], key?: string): number {
    const remove = new Set(this.findHighlights(ids, key).map((highlight) => highlight.id));
    this.highlights = this.highlights.filter((highlight) => !remove.has(highlight.id));
    if (remove.size) {
      this.emit({ kind: "state" });
      for (const library of new Set(this.libraries.map((entry) => entry.id))) this.emit({ kind: "library", library });
    }
    return remove.size;
  }

  /** 把 Agent 高亮保存为 Zotero 高亮注释。已保存的跳过。 */
  async saveHighlights(highlights: AgentHighlight[]): Promise<{ id: string; key: string }[]> {
    const pending = highlights.filter((highlight) => !highlight.savedAs);
    if (!pending.length) return [];
    const byLibrary = new Map<LibraryId, AgentHighlight[]>();
    for (const highlight of pending) byLibrary.set(highlight.library, [...(byLibrary.get(highlight.library) ?? []), highlight]);
    const saved: { id: string; key: string }[] = [];
    for (const [library, list] of byLibrary) {
      const objects = [];
      for (const highlight of list) {
        const { pdf } = await this.pdfText(library, highlight.attachmentKey);
        const page = pdf.pages[highlight.pageIndex]!;
        const match = findQuote([page], highlight.quote);
        objects.push({
          itemType: "annotation",
          parentItem: highlight.attachmentKey,
          annotationType: "highlight",
          annotationText: highlight.quote,
          annotationComment: highlight.comment,
          annotationColor: highlight.color,
          annotationPageLabel: highlight.pageLabel,
          annotationSortIndex: sortIndex(page, match?.start ?? 0, highlight.rects),
          annotationPosition: JSON.stringify({ pageIndex: highlight.pageIndex, rects: highlight.rects }),
          tags: [],
        });
      }
      const keys = await this.writer.create(library, "items", objects);
      list.forEach((highlight, index) => {
        highlight.savedAs = keys[index];
        saved.push({ id: highlight.id, key: keys[index]! });
      });
      this.emit({ kind: "library", library });
    }
    this.emit({ kind: "state" });
    return saved;
  }

  // -------------------------------------------------------------------------
  // 写入
  // -------------------------------------------------------------------------

  /** 只保留条目类型允许的字段与非空值。 */
  private async cleanItem(item: NewItem): Promise<Record<string, unknown>> {
    const valid = await this.library.validFields(item.itemType).catch(() => {
      throw new ZoteroError("invalid_input", `Unknown item type "${item.itemType}".`);
    });
    const result: Record<string, unknown> = { itemType: item.itemType, creators: item.creators ?? [], tags: item.tags ?? [], collections: item.collections ?? [] };
    for (const [field, value] of Object.entries(item)) {
      if (field === "itemType" || field === "creators" || field === "tags" || field === "collections") continue;
      if (value === undefined || value === null || value === "") continue;
      if (valid.has(field)) result[field] = typeof value === "string" ? value : String(value);
      else if (field === "DOI" && value) {
        // 没有 DOI 字段的类型（如会议论文在旧 schema 中）把 DOI 写进 Extra。
        result.extra = [result.extra, `DOI: ${String(value)}`].filter(Boolean).join("\n");
      }
    }
    if (!result.title) throw new ZoteroError("invalid_input", "A title is required.");
    return result;
  }

  async addItem(
    library: LibraryId,
    input: {
      identifier?: string;
      metadata?: NewItem;
      collections?: string[];
      tags?: string[];
      pdfUrl?: string;
      pdfPath?: string;
      attachPdf?: boolean;
      note?: string;
    },
  ): Promise<{ key: string; title: string; attachmentKey?: string; noteKey?: string; source: string; warnings: string[]; duplicate?: string }> {
    await this.ready();
    const warnings: string[] = [];
    let item: NewItem;
    let pdfUrl = input.pdfUrl;
    let source = "metadata";
    if (input.identifier) {
      const identifier = parseIdentifier(input.identifier);
      if (!identifier)
        throw new ZoteroError("invalid_input", `"${input.identifier}" is not a DOI or arXiv id. Pass metadata instead for other kinds of items.`);
      const resolved = await resolveIdentifier(identifier, this.fetcher);
      item = { ...resolved.item, ...input.metadata } as NewItem;
      if (input.attachPdf !== false) pdfUrl ??= resolved.pdfUrl;
      source = resolved.source === "arxiv" ? `arXiv ${identifier.value}` : `doi.org (${identifier.value})`;
    } else if (input.metadata) {
      item = input.metadata;
    } else throw new ZoteroError("invalid_input", "Give an identifier (DOI or arXiv id) or metadata.");

    // 重复检查：同 DOI 或 arXiv id 的条目已存在时不重复创建。
    const doi = String(item.DOI ?? "").trim();
    if (doi) {
      const found = await this.library.items(library, { q: doi, mode: "everything", limit: 5 });
      const duplicate = found.items.find((entry) => entry.itemType !== "attachment" && entry.itemType !== "note");
      if (duplicate) {
        const raw = await this.library.raw(library, duplicate.key);
        if (String(raw.data.DOI ?? "").toLowerCase() === doi.toLowerCase() || String(raw.data.extra ?? "").toLowerCase().includes(doi.toLowerCase()))
          return { key: duplicate.key, title: duplicate.title, source, warnings: [`Already in the library as ${duplicate.key}; nothing was added.`], duplicate: duplicate.key };
      }
    }

    const collectionKeys: string[] = [];
    for (const ref of input.collections ?? []) collectionKeys.push((await this.library.resolveCollection(library, ref)).key);
    const tags = [
      ...((item.tags as { tag: string; type?: number }[] | undefined) ?? []),
      ...(input.tags ?? []).map((tag) => ({ tag })),
    ];
    const data = await this.cleanItem({ ...item, tags, collections: collectionKeys });

    // 先准备 PDF（下载失败只警告，不阻止创建条目）。
    let file: { bytes: Uint8Array; filename: string; url?: string } | null = null;
    if (input.pdfPath) {
      const path = await this.workspacePath(input.pdfPath, { mustExist: true });
      const bytes = new Uint8Array(await readFile(path));
      if (!isPdf(bytes)) throw new ZoteroError("not_pdf", `${input.pdfPath} is not a PDF.`);
      file = { bytes, filename: zoteroFilename({ title: String(data.title), creators: item.creators, date: data.date }) };
    } else if (pdfUrl) {
      try {
        const download = await downloadPdf(pdfUrl, this.fetcher);
        file = { bytes: download.bytes, filename: zoteroFilename({ title: String(data.title), creators: item.creators, date: data.date }), url: download.finalUrl };
      } catch (error) {
        warnings.push(`The PDF was not attached: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const [key] = await this.writer.create(library, "items", [data]);
    let attachmentKey: string | undefined;
    if (file) {
      try {
        attachmentKey = await this.writer.attachFile(library, key!, {
          ...file,
          contentType: "application/pdf",
          title: source.startsWith("arXiv") ? "Preprint PDF" : "Full Text PDF",
        });
      } catch (error) {
        warnings.push(`The item was added, but attaching the PDF failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let noteKey: string | undefined;
    if (input.note?.trim()) noteKey = await this.addNote(library, { parentKey: key!, markdown: input.note });
    this.emit({ kind: "library", library });
    return { key: key!, title: String(data.title), attachmentKey, noteKey, source, warnings };
  }

  async attachPdf(library: LibraryId, key: string, input: { pdfUrl?: string; pdfPath?: string; title?: string }) {
    await this.ready();
    const raw = await this.library.raw(library, key);
    if (["attachment", "note", "annotation"].includes(raw.data.itemType))
      throw new ZoteroError("invalid_input", `${key} is a ${raw.data.itemType}; attach PDFs to a regular item.`);
    const summary = summarize(raw);
    const filename = zoteroFilename({ title: summary.title, creators: (raw.data.creators as NewItem["creators"]) ?? [], date: raw.data.date });
    let file: { bytes: Uint8Array; filename: string; url?: string };
    if (input.pdfPath) {
      const path = await this.workspacePath(input.pdfPath, { mustExist: true });
      const bytes = new Uint8Array(await readFile(path));
      if (!isPdf(bytes)) throw new ZoteroError("not_pdf", `${input.pdfPath} is not a PDF.`);
      file = { bytes, filename };
    } else if (input.pdfUrl) {
      const download = await downloadPdf(input.pdfUrl, this.fetcher);
      file = { bytes: download.bytes, filename, url: download.finalUrl };
    } else throw new ZoteroError("invalid_input", "Give pdfUrl or pdfPath.");
    const attachmentKey = await this.writer.attachFile(library, key, {
      ...file,
      contentType: "application/pdf",
      title: input.title?.trim() || "Full Text PDF",
    });
    this.emit({ kind: "library", library });
    return { attachmentKey, title: summary.title, bytes: file.bytes.length };
  }

  async updateItem(
    library: LibraryId,
    key: string,
    input: {
      fields?: Record<string, string>;
      addTags?: string[];
      removeTags?: string[];
      addToCollections?: string[];
      removeFromCollections?: string[];
    },
  ) {
    await this.ready();
    const add: string[] = [];
    const remove: string[] = [];
    for (const ref of input.addToCollections ?? []) add.push((await this.library.resolveCollection(library, ref)).key);
    for (const ref of input.removeFromCollections ?? []) remove.push((await this.library.resolveCollection(library, ref)).key);
    const changes: string[] = [];
    const result = await this.writer.patchItem(library, key, (current) => {
      changes.length = 0;
      const patch: Record<string, unknown> = {};
      if (input.fields && Object.keys(input.fields).length) {
        for (const [field, value] of Object.entries(input.fields)) {
          if (["key", "version", "itemType", "parentItem", "creators", "tags", "collections", "relations"].includes(field))
            throw new ZoteroError("invalid_input", `Field "${field}" cannot be set with fields; use the dedicated options.`);
          if (current.data[field] !== value) {
            patch[field] = value;
            changes.push(`${field} → ${JSON.stringify(value).slice(0, 80)}`);
          }
        }
      }
      const tags = (current.data.tags as { tag: string; type?: number }[] | undefined) ?? [];
      const removeTags = new Set((input.removeTags ?? []).map((tag) => tag.toLowerCase()));
      let nextTags = tags.filter((tag) => !removeTags.has(tag.tag.toLowerCase()));
      for (const tag of input.addTags ?? [])
        if (tag.trim() && !nextTags.some((existing) => existing.tag === tag.trim())) nextTags = [...nextTags, { tag: tag.trim() }];
      if (nextTags.length !== tags.length || nextTags.some((tag, index) => tag.tag !== tags[index]?.tag)) {
        patch.tags = nextTags;
        changes.push(`tags → ${nextTags.map((tag) => tag.tag).join(", ") || "(none)"}`);
      }
      const collections = (current.data.collections as string[] | undefined) ?? [];
      const nextCollections = [...new Set([...collections.filter((ckey) => !remove.includes(ckey)), ...add])];
      if (nextCollections.length !== collections.length || nextCollections.some((ckey) => !collections.includes(ckey))) {
        if (current.data.parentItem) throw new ZoteroError("invalid_input", "Child items cannot be added to collections; use the parent item.");
        patch.collections = nextCollections;
        changes.push(`collections → ${nextCollections.join(", ") || "(none)"}`);
      }
      return Object.keys(patch).length ? patch : null;
    });
    if (result.changed) this.emit({ kind: "library", library });
    return { changed: result.changed, changes: [...changes], title: summarize(result.item).title };
  }

  async addNote(library: LibraryId, input: { parentKey?: string; markdown: string; collections?: string[]; tags?: string[] }): Promise<string> {
    await this.ready();
    if (!input.markdown.trim()) throw new ZoteroError("invalid_input", "The note is empty.");
    const html = `<div data-schema-version="9">${await marked.parse(input.markdown, { gfm: true, breaks: false })}</div>`;
    const collections: string[] = [];
    if (input.parentKey) {
      const parent = await this.library.raw(library, input.parentKey);
      if (["note", "annotation"].includes(parent.data.itemType) || parent.data.parentItem)
        throw new ZoteroError("invalid_input", `${input.parentKey} cannot have child notes; use a top-level item.`);
    } else for (const ref of input.collections ?? []) collections.push((await this.library.resolveCollection(library, ref)).key);
    const [key] = await this.writer.create(library, "items", [
      {
        itemType: "note",
        note: html,
        ...(input.parentKey ? { parentItem: input.parentKey } : { collections }),
        tags: (input.tags ?? []).map((tag) => ({ tag })),
        relations: {},
      },
    ]);
    this.emit({ kind: "library", library });
    return key!;
  }

  async createCollection(library: LibraryId, name: string, parent?: string) {
    await this.ready();
    if (!name.trim()) throw new ZoteroError("invalid_input", "The collection name is empty.");
    const parentKey = parent ? (await this.library.resolveCollection(library, parent)).key : false;
    const { collections } = await this.library.collections(library);
    const existing = collections.find((node) => node.name === name.trim() && (node.parent ?? false) === parentKey);
    if (existing) return { key: existing.key, created: false };
    const [key] = await this.writer.create(library, "collections", [{ name: name.trim(), parentCollection: parentKey }]);
    this.emit({ kind: "library", library });
    return { key: key!, created: true };
  }

  /** 导出 .bib 到工作区文件，返回条目数与引用键。 */
  async exportBib(
    library: LibraryId,
    input: { path: string; keys?: string[]; collection?: string; recursive?: boolean; format?: "bibtex" | "biblatex" },
  ) {
    await this.ready();
    let keys = input.keys ?? [];
    let label = `${keys.length} item(s)`;
    if (input.collection) {
      const node = await this.library.resolveCollection(library, input.collection);
      keys = [...new Set([...keys, ...(await this.library.collectionItemKeys(library, node.key, input.recursive ?? true))])];
      label = `collection "${node.name}"`;
    }
    if (!keys.length) throw new ZoteroError("invalid_input", "Nothing to export: give keys or a collection.");
    // 只导出可引用的条目（跳过独立附件与笔记）。
    const raws = await this.library.itemsByKey(library, keys);
    const exportable = raws.filter((raw) => !["attachment", "note", "annotation"].includes(raw.data.itemType)).map((raw) => raw.key);
    if (!exportable.length) throw new ZoteroError("invalid_input", "None of the items can be cited (only notes or attachments).");
    const text = await this.library.export(library, exportable, input.format ?? "bibtex");
    if (![".bib", ".bibtex"].includes(extname(input.path).toLowerCase()))
      throw new ZoteroError("invalid_input", "The export path must end in .bib.");
    const path = await this.workspacePath(input.path, { mustExist: false });
    await mkdir(dirname(path), { recursive: true });
    const previous = await readFile(path, "utf8").catch(() => null);
    await writeFile(path, text);
    const citeKeys = [...text.matchAll(/^@\w+\{([^,\s]+),/gm)].map((match) => match[1]!);
    const root = await realpath(this.workspaceRoot).catch(() => this.workspaceRoot);
    return { path: relative(root, path) || basename(path), count: citeKeys.length, citeKeys, label, replaced: previous !== null, skipped: keys.length - exportable.length };
  }

  /** 工作区内的路径（拒绝跳出工作区，包括经由符号链接）。 */
  async workspacePath(path: string, { mustExist }: { mustExist: boolean }): Promise<string> {
    const target = isAbsolute(path) ? resolve(path) : resolve(this.workspaceRoot, path);
    const root = await realpath(this.workspaceRoot).catch(() => this.workspaceRoot);
    let real: string;
    if (mustExist) {
      real = await realpath(target).catch(() => {
        throw new ZoteroError("invalid_input", `No such file: ${path}`);
      });
      if (!(await stat(real)).isFile()) throw new ZoteroError("invalid_input", `${path} is not a file.`);
    } else {
      // 不存在的文件：检查最近的已存在上级目录。
      let parent = dirname(target);
      for (;;) {
        const resolved = await realpath(parent).catch(() => null);
        if (resolved) {
          real = resolve(resolved, relative(parent, target));
          break;
        }
        const next = dirname(parent);
        if (next === parent) {
          real = target;
          break;
        }
        parent = next;
      }
    }
    if (!isInside(root, real))
      throw new ZoteroError("path_outside_workspace", `${path} is outside the workspace (${this.workspaceRoot}).`);
    return real;
  }
}

/**
 * target 是否在 root 之中（含 root 本身）。用 relative 判断：root 为盘符根目录（如 D:\）时也成立，
 * Windows 上不区分大小写，跨盘符时 relative 返回绝对路径。
 */
export function isInside(root: string, target: string, path: Pick<typeof import("node:path"), "relative" | "isAbsolute" | "sep"> = { relative, isAbsolute, sep }): boolean {
  const rel = path.relative(root, target);
  return !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`);
}

/** 1 起的物理页码（read_fulltext 中的 "page N"）到页序。 */
export function pageIndexFor(pages: PageText[], page: number): number | undefined {
  const number = Number(page);
  if (Number.isInteger(number) && number >= 1 && number <= pages.length) return number - 1;
  return undefined;
}

export type { Rect };
