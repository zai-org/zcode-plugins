import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  KEY_PATTERN,
  LIBRARY_URI_PREFIX,
  LIMITS,
  PANEL_URI,
  PLUGIN_VERSION,
  SERVER_NAME,
  STATE_URI,
  SURFACE_ID,
  URIS,
  ZoteroError,
  decodeQuery,
  type CollectionNode,
  type ItemQuery,
  type LibraryId,
} from "#z/contract.ts";
import { annotationLine, highlightLine, itemLine, renderDetail, summarize } from "#z/domain/items.ts";
import { parsePages, readableText, searchPages } from "#z/domain/text.ts";
import { COLORS, pageIndexFor, type ZoteroSession } from "#z/app/session.ts";

const HTML_MIME = "text/html;profile=mcp-app";
const JSON_MIME = "application/json";
type Visibility = ("model" | "app")[];
const BOTH: Visibility = ["model", "app"];

interface ToolOutput {
  text: string;
  structured?: Record<string, unknown>;
}

/** pdf.js 运行时数据：页面经资源读取（面板没有网络）。 */
const PDFJS_KINDS = { cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" } as const;

function collectionTree(collections: CollectionNode[]): string[] {
  const lines: string[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const node of collections.filter((entry) => entry.parent === parent)) {
      lines.push(`${"  ".repeat(depth)}- ${node.name} [${node.key}] (${node.numItems} item${node.numItems === 1 ? "" : "s"})`);
      walk(node.key, depth + 1);
    }
  };
  walk(null, 0);
  return lines;
}

export function createZoteroMcpServer({
  session,
  assetRoot,
  pdfjsDataDir,
  log = () => undefined,
}: {
  session: ZoteroSession;
  assetRoot: string;
  pdfjsDataDir: string | null;
  log?: (line: string) => void;
}) {
  const server = new McpServer(
    { name: SERVER_NAME, version: PLUGIN_VERSION },
    { capabilities: { resources: { subscribe: true, listChanged: true }, logging: {} } },
  );

  // -------------------------------------------------------------------------
  // 订阅与通知（节流）
  // -------------------------------------------------------------------------
  const subscribed = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const notify = (uri: string, delay: number) => {
    if (!subscribed.has(uri) || timers.has(uri)) return;
    const timer = setTimeout(() => {
      timers.delete(uri);
      server.server.sendResourceUpdated({ uri }).catch(() => undefined);
    }, delay);
    timer.unref?.();
    timers.set(uri, timer);
  };
  session.onChange((event) => {
    if (event.kind === "state") notify(STATE_URI, 100);
    else
      for (const uri of subscribed)
        if (uri.startsWith(`${LIBRARY_URI_PREFIX}${event.library}/`) && !/\/pdf\/[^/]+\/\d+$/.test(uri)) notify(uri, 150);
  });
  const updateWatch = () => session.watch(subscribed.size > 0);
  server.server.setRequestHandler(SubscribeRequestSchema, async ({ params }) => {
    subscribed.add(params.uri);
    updateWatch();
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async ({ params }) => {
    subscribed.delete(params.uri);
    updateWatch();
    return {};
  });

  // -------------------------------------------------------------------------
  // 工具
  // -------------------------------------------------------------------------
  const register = (
    name: string,
    config: {
      description: string;
      input: Record<string, z.ZodType>;
      visibility?: Visibility;
      openPanel?: boolean;
      timeoutMs?: number;
      readOnly?: boolean;
      destructive?: boolean;
      openWorld?: boolean;
    },
    run: (input: any, extra: any) => Promise<ToolOutput>,
  ) => {
    server.registerTool(
      name,
      {
        description: config.description,
        inputSchema: config.input,
        annotations: {
          readOnlyHint: !!config.readOnly,
          ...(config.readOnly ? {} : { destructiveHint: !!config.destructive }),
          openWorldHint: !!config.openWorld,
        },
        _meta: {
          ui: { resourceUri: PANEL_URI, surface: SURFACE_ID, visibility: config.visibility ?? BOTH },
          ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
          // 宿主只从这个兼容键读取“自动打开侧栏”偏好。
          ...(config.openPanel ? { "openai/ui": { preferredModelDisplayMode: "fullscreen" } } : {}),
        },
      },
      async (input: unknown, extra: unknown) => {
        try {
          const output = await run(input, extra);
          return {
            content: [{ type: "text" as const, text: output.text }],
            ...(output.structured ? { structuredContent: output.structured } : {}),
          };
        } catch (error) {
          const code = error instanceof ZoteroError ? error.code : "zotero_error";
          const message = error instanceof Error ? error.message : String(error);
          if (!(error instanceof ZoteroError)) log(`${name} failed: ${error instanceof Error ? error.stack : message}`);
          return {
            isError: true,
            content: [{ type: "text" as const, text: `[${code}] ${message}` }],
            structuredContent: {
              error: { code, message, ...(error instanceof ZoteroError && error.details ? { details: error.details } : {}) },
            },
          };
        }
      },
    );
  };

  const libraryParam = z
    .string()
    .regex(/^(user|g\d+)$/)
    .optional()
    .describe('Library: "user" (My Library, default) or "g<groupId>" for a group library (see list_collections).');
  const keyParam = z.string().regex(KEY_PATTERN, "An 8-character Zotero item key such as 7ERC5QFW.");
  const lib = (input: { library?: string }): LibraryId => input.library ?? "user";
  const writeNote =
    " Writing needs Zotero 8 or later; the first write shows a permission dialog in Zotero (the user should choose Always Allow to avoid repeated prompts).";

  register(
    "list_collections",
    {
      description:
        "Show the state of the Zotero connection and the library structure: libraries (My Library and groups), the collection tree with keys and item counts, and saved searches. Call this first to orient yourself or when a collection name is needed.",
      input: { library: libraryParam },
      readOnly: true,
    },
    async (input) => {
      await session.ready();
      const library = lib(input);
      const doc = await session.library.collections(library);
      const state = session.state();
      const status = state.status;
      const lines = [
        `Zotero ${status.version ?? ""} is running. Writes: ${status.writes === "available" ? `available (${status.auth === "remembered" ? "always allowed" : "Zotero asks the user on the first write"})` : status.writes === "unsupported" ? "not supported by this Zotero version (read-only)" : "unknown"}.`,
        `Libraries: ${state.libraries.map((entry) => `${entry.name} [${entry.id}]${entry.editable ? "" : " (read-only)"}`).join(", ")}`,
        "",
        `Collections in ${state.libraries.find((entry) => entry.id === library)?.name ?? library}:`,
        ...(collectionTree(doc.collections).length ? collectionTree(doc.collections) : ["(none)"]),
      ];
      if (doc.searches.length) lines.push("", "Saved searches:", ...doc.searches.map((search) => `- ${search.name} [${search.key}]`));
      return { text: lines.join("\n"), structured: { library, collections: doc.collections, searches: doc.searches, status } };
    },
  );

  register(
    "search_library",
    {
      description:
        "Search the user's Zotero library and list matching items with their keys. Searches titles, creators and years by default; mode \"everything\" also searches full text of PDFs, notes and annotations. Filter by collection (key or name), tag or saved search; with no query, lists recent items. Results are not shown in the panel; use show_items for that.",
      input: {
        query: z.string().optional().describe("Search text."),
        mode: z.enum(["titleCreatorYear", "everything"]).optional(),
        collection: z.string().optional().describe("Collection key or name (\"Parent/Child\" for nested)."),
        tag: z.string().optional(),
        savedSearch: z.string().optional().describe("Saved search key."),
        sort: z.enum(["dateModified", "dateAdded", "title", "creator", "date"]).optional(),
        limit: z.number().int().min(1).max(LIMITS.searchMax).optional().describe(`Default ${LIMITS.searchDefault}.`),
        start: z.number().int().min(0).optional().describe("Offset for paging."),
        library: libraryParam,
      },
      readOnly: true,
    },
    async (input) => {
      await session.ready();
      const library = lib(input);
      const query: ItemQuery = {
        q: input.query,
        mode: input.mode,
        tag: input.tag,
        search: input.savedSearch,
        sort: input.sort,
        start: input.start,
        limit: input.limit ?? LIMITS.searchDefault,
      };
      if (input.collection) query.collection = (await session.library.resolveCollection(library, input.collection)).key;
      const list = await session.library.items(library, query);
      const shown = list.items.length;
      const header = `${list.total} item(s) match${list.total > shown ? `; showing ${(input.start ?? 0) + 1}–${(input.start ?? 0) + shown}` : ""}.`;
      return {
        text: [header, ...list.items.map(itemLine)].join("\n"),
        structured: { library, total: list.total, items: list.items.map((item) => ({ key: item.key, title: item.title, pdf: item.pdf?.key ?? null })) },
      };
    },
  );

  register(
    "get_item",
    {
      description:
        "Read one Zotero item in full: all metadata, abstract, collections, tags, attachments, child notes, and the user's PDF annotations (highlights with comments). Accepts the key of a regular item, an attachment or a note.",
      input: { key: keyParam, library: libraryParam },
      readOnly: true,
    },
    async (input) => {
      const library = lib(input);
      const { item, annotations } = await session.itemDetail(library, input.key);
      const text = renderDetail(item, annotations, session.findHighlights(undefined, item.key));
      return {
        text: text.length > LIMITS.summaryChars ? `${text.slice(0, LIMITS.summaryChars)}\n… (truncated)` : text,
        structured: { library, key: item.key, title: item.title, pdf: item.pdf?.key ?? null },
      };
    },
  );

  register(
    "search_annotations",
    {
      description:
        "Search the user's own PDF annotations (highlights, underlines, notes on pages) across the library: by words in the highlighted text, comment or tags, and optionally by item, collection, color or tag. Use it for questions like \"what did I highlight about X\".",
      input: {
        query: z.string().optional().describe("Words that must all appear in the text, comment or tags."),
        item: keyParam.optional().describe("Limit to one item (or attachment) key."),
        collection: z.string().optional().describe("Collection key or name; includes subcollections."),
        color: z.string().optional().describe(`${Object.keys(COLORS).join(", ")} or #rrggbb.`),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional().describe("Default 100."),
        library: libraryParam,
      },
      readOnly: true,
    },
    async (input) => {
      const library = lib(input);
      const { total, results } = await session.searchAnnotations(library, {
        query: input.query,
        itemKey: input.item,
        collection: input.collection,
        color: input.color,
        tag: input.tag,
        limit: input.limit,
      });
      const lines = [`${total} annotation(s) match${total > results.length ? `; showing ${results.length}` : ""}.`];
      let current = "";
      for (const result of results) {
        const itemKey = result.item?.key ?? result.attachmentKey;
        if (itemKey !== current) {
          current = itemKey;
          lines.push("", result.item ? itemLine(summarize(result.item)) : `[${itemKey}]`);
        }
        lines.push(annotationLine(result.annotation).replace(/^- /, "  - "));
      }
      return { text: lines.join("\n"), structured: { library, total } };
    },
  );

  register(
    "read_fulltext",
    {
      description:
        "Read the text of an item's PDF page by page (\"--- page N ---\" markers use physical page numbers; printed page labels are shown when different). Give an item key (its PDF is used) or a PDF attachment key. Use pages to read a range; long documents are cut at maxChars, and the result says where to continue.",
      input: {
        key: keyParam,
        pages: z.string().optional().describe('Physical pages, e.g. "1-3", "5", "2,7-9", "10-". Default: from the start.'),
        maxChars: z.number().int().min(1_000).max(100_000).optional().describe(`Default ${LIMITS.fulltextChars}.`),
        library: libraryParam,
      },
      readOnly: true,
    },
    async (input) => {
      const library = lib(input);
      const { item, attachment, pdf } = await session.pdfText(library, input.key);
      let indexes: number[];
      try {
        indexes = input.pages ? parsePages(input.pages, pdf.pageCount) : pdf.pages.map((page) => page.index);
      } catch (error) {
        throw new ZoteroError("invalid_input", error instanceof Error ? error.message : String(error));
      }
      if (!indexes.length) throw new ZoteroError("invalid_input", `The PDF has ${pdf.pageCount} pages.`);
      const budget = input.maxChars ?? LIMITS.fulltextChars;
      const parts: string[] = [];
      let used = 0;
      let lastPage = -1;
      for (const index of indexes) {
        const page = pdf.pages[index]!;
        const marker = `--- page ${index + 1}${page.label !== String(index + 1) ? ` (printed ${page.label})` : ""} ---`;
        const body = readableText(page.text) || "(no text on this page; it may be a scanned image)";
        if (used && used + marker.length + body.length > budget) break;
        const room = budget - used - marker.length;
        parts.push(marker, body.length > room ? `${body.slice(0, room)}…` : body);
        used += marker.length + body.length;
        lastPage = index;
      }
      const remaining = indexes.filter((index) => index > lastPage);
      const title = summarize(item).title;
      const header = `"${title}" [${item.key}], PDF ${attachment.key}, ${pdf.pageCount} pages.`;
      const footer = remaining.length ? `\n… stopped after page ${lastPage + 1}. Continue with pages: "${remaining[0]! + 1}-${remaining.at(-1)! + 1}".` : "";
      const scanned = pdf.pages.every((page) => !page.text.trim()) ? "\nThis PDF has no text layer (scanned); Zotero cannot index it either." : "";
      return {
        text: `${header}\n\n${parts.join("\n")}${footer}${scanned}`,
        structured: { library, key: item.key, attachmentKey: attachment.key, pageCount: pdf.pageCount, lastPage: lastPage + 1 },
      };
    },
  );

  register(
    "find_in_pdf",
    {
      description:
        "Find a word or phrase in an item's PDF and return each occurrence with its page and surrounding text. Matching ignores case, line breaks, hyphenation and ligatures. Useful before highlight or open_item to locate a passage.",
      input: {
        key: keyParam,
        query: z.string().min(2),
        maxResults: z.number().int().min(1).max(100).optional().describe("Default 20."),
        library: libraryParam,
      },
      readOnly: true,
    },
    async (input) => {
      const library = lib(input);
      const { item, attachment, pdf } = await session.pdfText(library, input.key);
      const results = searchPages(pdf.pages, input.query, input.maxResults ?? 20);
      const title = summarize(item).title;
      return {
        text: results.length
          ? [
              `${results.length} match(es) for "${input.query}" in "${title}" (PDF ${attachment.key}):`,
              ...results.map(
                (result) => `- page ${result.pageIndex + 1}${result.label !== String(result.pageIndex + 1) ? ` (printed ${result.label})` : ""}: ${result.snippet}`,
              ),
            ].join("\n")
          : `No match for "${input.query}" in "${title}".`,
        structured: { library, key: item.key, attachmentKey: attachment.key, matches: results.map((result) => ({ page: result.pageIndex + 1, label: result.label })) },
      };
    },
  );

  register(
    "cite",
    {
      description:
        "Format citations for items: BibTeX or BibLaTeX entries, CSL-JSON, RIS, or formatted text in a citation style (in-text citation plus bibliography entry, e.g. style \"apa\", \"chicago-author-date\", \"ieee\", \"nature\"). To keep a .bib file in the workspace, use export_bib instead.",
      input: {
        keys: z.array(keyParam).min(1).max(200),
        format: z.enum(["bibtex", "biblatex", "csljson", "ris", "text"]).optional().describe("Default bibtex."),
        style: z.string().optional().describe('CSL style id for format "text" (default "apa").'),
        locale: z.string().optional().describe('For format "text", e.g. "en-US", "zh-CN".'),
        library: libraryParam,
      },
      readOnly: true,
    },
    async (input) => {
      await session.ready();
      const library = lib(input);
      const format = input.format ?? "bibtex";
      if (format === "text") {
        const entries = await session.library.cite(library, input.keys, input.style ?? "apa", input.locale);
        return {
          text: entries.map((entry) => `[${entry.key}] in-text: ${entry.citation}\n${entry.bib}`).join("\n\n"),
          structured: { library, entries },
        };
      }
      const text = await session.library.export(library, input.keys, format);
      return { text, structured: { library, format } };
    },
  );

  register(
    "open_item",
    {
      description:
        "Show an item in the Zotero side panel: its PDF in the reader (optionally at a physical page, or at the page of a quote), or its details. Use it to point the user at evidence.",
      input: {
        key: keyParam,
        page: z.number().int().min(1).optional().describe("Physical page to open (as in read_fulltext)."),
        quote: z.string().optional().describe("Open at the page containing this text."),
        view: z.enum(["reader", "details"]).optional().describe("Default: reader when the item has a PDF, otherwise details."),
        library: libraryParam,
      },
      openPanel: true,
      readOnly: true,
    },
    async (input) => {
      await session.ready();
      const library = lib(input);
      const detail = await session.library.item(library, input.key);
      const pdfKey = detail.itemType === "attachment" && detail.attachments[0]?.isPdf ? detail.key : detail.pdf?.key;
      if (input.view === "details" || !pdfKey) {
        session.show({ kind: "item", library, key: detail.parent ?? detail.key });
        return {
          text: `Showing "${detail.title}" in the Zotero panel${!pdfKey && input.view !== "details" ? " (it has no PDF)" : ""}.`,
          structured: { library, key: detail.key, view: "item" },
        };
      }
      let pageIndex: number | undefined;
      let note = "";
      if (input.quote || input.page) {
        const { item, pdf } = await session.pdfText(library, pdfKey);
        if (input.page) pageIndex = pageIndexFor(pdf.pages, input.page);
        if (input.quote) {
          const found = searchPages(pdf.pages, input.quote, 1)[0];
          if (found) pageIndex = found.pageIndex;
          else note = " The quote was not found; opened at the start.";
        }
        if (input.page && pageIndex === undefined) note = ` The PDF has ${pdf.pageCount} pages.`;
        session.show({ kind: "reader", library, itemKey: item.key, attachmentKey: pdfKey, pageIndex });
      } else session.show({ kind: "reader", library, itemKey: detail.parent ?? detail.key, attachmentKey: pdfKey });
      return {
        text: `Opened "${detail.title}" in the Zotero panel${pageIndex !== undefined ? ` at page ${pageIndex + 1}` : ""}.${note}`,
        structured: { library, key: detail.key, attachmentKey: pdfKey, view: "reader", page: pageIndex !== undefined ? pageIndex + 1 : null },
      };
    },
  );

  register(
    "show_items",
    {
      description:
        "Show a list of items in the Zotero side panel under a title, e.g. the papers you used for an answer, so the user can browse, open and select them.",
      input: {
        keys: z.array(keyParam).min(1).max(200),
        title: z.string().min(1).max(120).describe("Heading for the list, e.g. \"Papers on capture checking\"."),
        library: libraryParam,
      },
      openPanel: true,
      readOnly: true,
    },
    async (input) => {
      await session.ready();
      const library = lib(input);
      const keys = [...new Set<string>(input.keys)];
      const found = await session.library.itemsByKey(library, keys);
      const missing = keys.filter((key) => !found.some((item) => item.key === key));
      if (missing.length === keys.length) throw new ZoteroError("not_found", `None of these keys exist: ${missing.join(", ")}.`);
      session.show({ kind: "items", library, title: input.title, keys: keys.filter((key) => !missing.includes(key)) });
      return {
        text: `Showing ${keys.length - missing.length} item(s) in the Zotero panel under "${input.title}".${missing.length ? ` Unknown keys skipped: ${missing.join(", ")}.` : ""}`,
        structured: { library, keys, view: "items" },
      };
    },
  );

  register(
    "highlight",
    {
      description:
        "Highlight a passage in an item's PDF with an optional comment, shown in the panel's reader as your highlight (distinct from the user's). It lasts for this session; use save: true or save_highlights to store it as a real Zotero annotation. The quote must be copied from the PDF text (read_fulltext / find_in_pdf); matching ignores case, spacing and hyphenation, and \"start … end\" spans a longer passage.",
      input: {
        key: keyParam.describe("Item key or PDF attachment key."),
        quote: z.string().min(3).max(5_000),
        page: z.number().int().min(1).optional().describe("Physical page to look on first."),
        comment: z.string().max(5_000).optional(),
        color: z.string().optional().describe(`${Object.keys(COLORS).join(", ")} or #rrggbb (default purple).`),
        save: z.boolean().optional().describe(`Also save it to Zotero as an annotation now.${writeNote}`),
        open: z.boolean().optional().describe("Open the reader at the highlight (default true)."),
        library: libraryParam,
      },
      openPanel: true,
      timeoutMs: LIMITS.authorizeTimeoutMs + 60_000,
    },
    async (input) => {
      const library = lib(input);
      const { highlight, exact } = await session.highlight(library, input.key, {
        quote: input.quote,
        page: input.page,
        comment: input.comment,
        color: input.color,
      });
      if (input.open !== false)
        session.show({ kind: "reader", library, itemKey: highlight.itemKey, attachmentKey: highlight.attachmentKey, pageIndex: highlight.pageIndex, highlightId: highlight.id });
      let saved = "";
      if (input.save) {
        const [result] = await session.saveHighlights([highlight]);
        saved = result ? ` Saved to Zotero as annotation ${result.key}.` : "";
      }
      return {
        text: `Highlighted ${highlight.id} on page ${highlight.pageIndex + 1}${highlight.pageLabel !== String(highlight.pageIndex + 1) ? ` (printed ${highlight.pageLabel})` : ""}: “${exact}”.${saved}`,
        structured: { library, highlight: { id: highlight.id, page: highlight.pageIndex + 1, attachmentKey: highlight.attachmentKey, savedAs: highlight.savedAs ?? null } },
      };
    },
  );

  register(
    "clear_highlights",
    {
      description: "Remove your session highlights from the panel: the given ids, all on one item, or all. Annotations already saved to Zotero stay in Zotero.",
      input: {
        ids: z.array(z.string()).optional(),
        key: keyParam.optional().describe("Remove all highlights on this item or attachment."),
      },
      readOnly: true,
    },
    async (input) => {
      const count = session.clearHighlights(input.ids, input.key);
      return { text: `Removed ${count} highlight(s).`, structured: { removed: count } };
    },
  );

  // ---------------------------------------------------------------- 写入

  register(
    "save_highlights",
    {
      description: `Save your session highlights to Zotero as highlight annotations on the PDF (with their comments), so they stay in the user's library. Without ids, saves all unsaved highlights (or those on key).${writeNote}`,
      input: { ids: z.array(z.string()).optional(), key: keyParam.optional() },
      timeoutMs: LIMITS.authorizeTimeoutMs + 60_000,
    },
    async (input) => {
      const highlights = session.findHighlights(input.ids, input.key);
      const saved = await session.saveHighlights(highlights);
      const already = highlights.length - saved.length;
      return {
        text: saved.length
          ? `Saved ${saved.length} highlight(s) to Zotero: ${saved.map((entry) => `${entry.id} → ${entry.key}`).join(", ")}.${already ? ` ${already} were already saved.` : ""}`
          : "Nothing to save; those highlights are already in Zotero.",
        structured: { saved },
      };
    },
  );

  const creatorSchema = z.object({
    creatorType: z.string().optional().describe("author (default), editor, …"),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    name: z.string().optional().describe("Single-field name for organisations."),
  });

  register(
    "add_item",
    {
      description: `Add a paper to the user's Zotero library. With a DOI or arXiv id, metadata comes from doi.org or arXiv; arXiv papers get their PDF attached automatically. For anything else, pass metadata (itemType + fields). A PDF can also be attached from a direct URL or a workspace file. If an item with the same DOI exists, nothing is added and its key is returned.${writeNote}`,
      input: {
        identifier: z.string().optional().describe("DOI (10.…, doi.org link) or arXiv id / link."),
        metadata: z
          .object({
            itemType: z.string().describe("Zotero item type: journalArticle, conferencePaper, preprint, book, bookSection, thesis, report, webpage, …"),
            title: z.string(),
            creators: z.array(creatorSchema).optional(),
          })
          .catchall(z.unknown())
          .optional()
          .describe("Zotero fields such as date, publicationTitle, proceedingsTitle, DOI, url, abstractNote, volume, pages. Overrides fetched metadata when used with identifier."),
        collections: z.array(z.string()).optional().describe("Collection keys or names to add it to."),
        tags: z.array(z.string()).optional(),
        pdfUrl: z.string().optional().describe("Direct link to the PDF to attach."),
        pdfPath: z.string().optional().describe("Workspace PDF file to attach."),
        attachPdf: z.boolean().optional().describe("Attach the arXiv PDF automatically (default true)."),
        note: z.string().optional().describe("Markdown text for a child note."),
        library: libraryParam,
      },
      timeoutMs: LIMITS.authorizeTimeoutMs + 180_000,
      openWorld: true,
    },
    async (input) => {
      const library = lib(input);
      const metadata = input.metadata
        ? { ...input.metadata, creators: (input.metadata.creators ?? []).map((creator: Record<string, string>) => ({ creatorType: "author", ...creator })) }
        : undefined;
      const result = await session.addItem(library, { ...input, metadata });
      if (!result.duplicate) session.show({ kind: "item", library, key: result.key });
      const lines = result.duplicate
        ? [`"${result.title}" is already in the library as ${result.duplicate}; nothing was added.`]
        : [
            `Added "${result.title}" as ${result.key} (metadata from ${result.source}).`,
            result.attachmentKey ? `Attached PDF ${result.attachmentKey}.` : "",
            result.noteKey ? `Added note ${result.noteKey}.` : "",
            ...result.warnings,
          ];
      return { text: lines.filter(Boolean).join("\n"), structured: { library, ...result } };
    },
  );

  register(
    "attach_pdf",
    {
      description: `Attach a PDF to an existing item, from a direct URL or a workspace file.${writeNote}`,
      input: {
        key: keyParam,
        pdfUrl: z.string().optional(),
        pdfPath: z.string().optional().describe("Workspace-relative path."),
        title: z.string().optional().describe('Attachment title (default "Full Text PDF").'),
        library: libraryParam,
      },
      timeoutMs: LIMITS.authorizeTimeoutMs + 180_000,
      openWorld: true,
    },
    async (input) => {
      const library = lib(input);
      const result = await session.attachPdf(library, input.key, input);
      return {
        text: `Attached a ${Math.round(result.bytes / 1024)} KB PDF to "${result.title}" as ${result.attachmentKey}.`,
        structured: { library, key: input.key, attachmentKey: result.attachmentKey },
      };
    },
  );

  register(
    "update_item",
    {
      description: `Change an item: set fields (e.g. title, date, extra, url), add or remove tags, add it to or remove it from collections. Other fields are left as they are.${writeNote}`,
      input: {
        key: keyParam,
        fields: z.record(z.string(), z.string()).optional().describe("Zotero field name → new value (empty string clears it)."),
        addTags: z.array(z.string()).optional(),
        removeTags: z.array(z.string()).optional(),
        addToCollections: z.array(z.string()).optional().describe("Collection keys or names."),
        removeFromCollections: z.array(z.string()).optional(),
        library: libraryParam,
      },
      timeoutMs: LIMITS.authorizeTimeoutMs + 60_000,
    },
    async (input) => {
      const library = lib(input);
      const result = await session.updateItem(library, input.key, input);
      return {
        text: result.changed ? `Updated "${result.title}" (${input.key}): ${result.changes.join("; ")}.` : `"${result.title}" already had those values; nothing changed.`,
        structured: { library, key: input.key, changed: result.changed },
      };
    },
  );

  register(
    "add_note",
    {
      description: `Add a note written in Markdown: a child note on an item (parentKey), or a standalone note in collections. Notes are stored as HTML in Zotero.${writeNote}`,
      input: {
        markdown: z.string().min(1).max(200_000),
        parentKey: keyParam.optional(),
        collections: z.array(z.string()).optional().describe("For standalone notes: collection keys or names."),
        tags: z.array(z.string()).optional(),
        library: libraryParam,
      },
      timeoutMs: LIMITS.authorizeTimeoutMs + 60_000,
    },
    async (input) => {
      const library = lib(input);
      const key = await session.addNote(library, input);
      if (input.parentKey) session.show({ kind: "item", library, key: input.parentKey });
      return { text: `Added note ${key}${input.parentKey ? ` to ${input.parentKey}` : ""}.`, structured: { library, key } };
    },
  );

  register(
    "create_collection",
    {
      description: `Create a collection (optionally inside a parent collection). Returns the existing one if a collection with that name already exists there.${writeNote}`,
      input: { name: z.string().min(1).max(200), parent: z.string().optional().describe("Parent collection key or name."), library: libraryParam },
      timeoutMs: LIMITS.authorizeTimeoutMs + 60_000,
    },
    async (input) => {
      const library = lib(input);
      const result = await session.createCollection(library, input.name, input.parent);
      return {
        text: result.created ? `Created collection "${input.name}" [${result.key}].` : `Collection "${input.name}" already exists [${result.key}].`,
        structured: { library, ...result },
      };
    },
  );

  register(
    "export_bib",
    {
      description:
        "Write a BibTeX (or BibLaTeX) file into the workspace from a collection (with subcollections) and/or item keys, and return the citation keys to use with \\cite. Run it again to refresh the file after the library changes. Only writes the .bib file; does not change Zotero.",
      input: {
        path: z.string().optional().describe("Workspace-relative .bib path (default references.bib)."),
        collection: z.string().optional().describe("Collection key or name."),
        recursive: z.boolean().optional().describe("Include subcollections (default true)."),
        keys: z.array(keyParam).optional(),
        format: z.enum(["bibtex", "biblatex"]).optional(),
        library: libraryParam,
      },
    },
    async (input) => {
      const library = lib(input);
      const result = await session.exportBib(library, { ...input, path: input.path ?? "references.bib" });
      const keys = result.citeKeys.length > 60 ? `${result.citeKeys.slice(0, 60).join(", ")}, …` : result.citeKeys.join(", ");
      return {
        text: `${result.replaced ? "Updated" : "Wrote"} ${result.path} with ${result.count} entr${result.count === 1 ? "y" : "ies"} from ${result.label}.${result.skipped ? ` Skipped ${result.skipped} note(s) or attachment(s).` : ""}\nCitation keys: ${keys}`,
        structured: { library, ...result },
      };
    },
  );

  register(
    "authorize_writes",
    {
      description: "Ask the user for write access in Zotero ahead of time (Zotero shows Allow / Always Allow / Deny). Writing tools also ask on their own when needed.",
      input: {},
      timeoutMs: LIMITS.authorizeTimeoutMs + 10_000,
    },
    async () => {
      await session.ready();
      if (session.client.status.writes === "unsupported")
        throw new ZoteroError("writes_unsupported", "This Zotero version cannot write through its local API; Zotero 8 or later is required.");
      if (session.client.status.auth === "remembered") return { text: "Write access is already granted (Always Allow).", structured: { auth: "remembered" } };
      await session.client.authorize();
      const auth = session.client.status.auth as string;
      return {
        text: auth === "remembered" ? "The user allowed writes (Always Allow)." : "The user allowed a single write; Zotero will ask again for later writes.",
        structured: { auth },
      };
    },
  );

  // 面板专用：刷新连接状态（Zotero 刚启动时）。
  // 面板专用：打开已安装的 Zotero（设置页的“打开 Zotero”）。
  register(
    "panel_launch_zotero",
    { description: "Open the Zotero desktop app installed on this computer.", input: {}, visibility: ["app"] },
    async () => {
      const path = await session.launchApp();
      return { text: `Started Zotero (${path}).`, structured: { path } };
    },
  );

  register(
    "panel_refresh",
    { description: "Check the Zotero connection again.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      await session.poll();
      return { text: session.client.status.state, structured: { status: session.client.status } };
    },
  );

  // -------------------------------------------------------------------------
  // 资源
  // -------------------------------------------------------------------------
  const json = (uri: string, value: unknown) => ({ contents: [{ uri, mimeType: JSON_MIME, text: JSON.stringify(value) }] });
  const blob = (uri: string, bytes: Uint8Array) => ({
    contents: [{ uri, mimeType: "application/octet-stream", blob: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64") }],
  });
  const libraryOf = (value: unknown): LibraryId => {
    const library = String(value);
    if (!/^(user|g\d+)$/.test(library)) throw new ZoteroError("invalid_input", `Unknown library ${library}`);
    return library;
  };
  const keyOf = (value: unknown): string => {
    const key = String(value);
    if (!KEY_PATTERN.test(key)) throw new ZoteroError("invalid_input", `Invalid key ${key}`);
    return key;
  };
  const panelMeta = { ui: { prefersBorder: false }, "zcode/csp": { wasmUnsafeEval: true } };

  server.registerResource("panel", PANEL_URI, { mimeType: HTML_MIME, _meta: panelMeta }, async () => ({
    contents: [{ uri: PANEL_URI, mimeType: HTML_MIME, _meta: panelMeta, text: await readFile(join(assetRoot, "panel.html"), "utf8") }],
  }));
  server.registerResource("state", STATE_URI, { mimeType: JSON_MIME }, async () => {
    if (session.client.status.state === "unknown") await session.poll().catch(() => undefined);
    return json(STATE_URI, session.state());
  });
  // 设置页：立即重新检查（check）或记下已交给 Agent（handoff）；返回最新状态。
  server.registerResource(
    "setup",
    new ResourceTemplate("ui://zotero/setup/{op}/{nonce}", { list: undefined }),
    { mimeType: JSON_MIME },
    async (uri, variables) => {
      const op = String(variables.op);
      if (op === "check") await session.recheck();
      else if (op === "handoff") session.handoff();
      else throw new ZoteroError("not_found", `No setup action ${op}`);
      return json(uri.href, session.state());
    },
  );
  server.registerResource(
    "collections",
    new ResourceTemplate("ui://zotero/lib/{library}/collections.json", { list: undefined }),
    { mimeType: JSON_MIME },
    async (uri, variables) => {
      await session.ready();
      return json(uri.href, await session.library.collections(libraryOf(variables.library)));
    },
  );
  server.registerResource(
    "items",
    new ResourceTemplate("ui://zotero/lib/{library}/items/{query}.json", { list: undefined }),
    { mimeType: JSON_MIME },
    async (uri, variables) => {
      await session.ready();
      let query: ItemQuery;
      try {
        query = decodeQuery(String(variables.query));
      } catch {
        throw new ZoteroError("invalid_input", "Invalid item query.");
      }
      return json(uri.href, await session.library.items(libraryOf(variables.library), query));
    },
  );
  server.registerResource(
    "item",
    new ResourceTemplate("ui://zotero/lib/{library}/item/{key}.json", { list: undefined }),
    { mimeType: JSON_MIME },
    async (uri, variables) => {
      const { item } = await session.itemDetail(libraryOf(variables.library), keyOf(variables.key));
      return json(uri.href, item);
    },
  );
  server.registerResource(
    "annotations",
    new ResourceTemplate("ui://zotero/lib/{library}/annotations/{key}.json", { list: undefined }),
    { mimeType: JSON_MIME },
    async (uri, variables) => json(uri.href, await session.annotationsDoc(libraryOf(variables.library), keyOf(variables.key))),
  );
  server.registerResource(
    "pdf-info",
    new ResourceTemplate("ui://zotero/lib/{library}/pdf/{key}/info.json", { list: undefined }),
    { mimeType: JSON_MIME },
    async (uri, variables) => json(uri.href, await session.pdfInfo(libraryOf(variables.library), keyOf(variables.key))),
  );
  server.registerResource(
    "pdf-part",
    new ResourceTemplate("ui://zotero/lib/{library}/pdf/{key}/{part}", { list: undefined }),
    { mimeType: "application/octet-stream" },
    async (uri, variables) =>
      blob(uri.href, await session.pdfPart(libraryOf(variables.library), keyOf(variables.key), Number(variables.part))),
  );
  server.registerResource(
    "pdfjs-data",
    new ResourceTemplate("ui://zotero/pdfjs/{kind}/{file}", { list: undefined }),
    { mimeType: "application/octet-stream" },
    async (uri, variables) => {
      const folder = PDFJS_KINDS[String(variables.kind) as keyof typeof PDFJS_KINDS];
      const file = String(variables.file);
      if (!folder || !pdfjsDataDir || !/^[A-Za-z0-9._-]+$/.test(file)) throw new ZoteroError("not_found", `No pdf.js data ${uri.href}`);
      return blob(uri.href, new Uint8Array(await readFile(join(pdfjsDataDir, folder, file))));
    },
  );

  return server;
}

export { URIS, highlightLine };
