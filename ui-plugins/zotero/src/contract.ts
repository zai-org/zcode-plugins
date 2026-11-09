export const PLUGIN_NAME = "zotero";
export const PLUGIN_VERSION = "0.2.1";
/** manifest `mcpServers` 键、`ui.surfaces[].id` 与资源命名空间保持一致。 */
export const SERVER_NAME = "zotero";
export const SURFACE_ID = "zotero";
export const PANEL_URI = "ui://zotero/panel.html";
/** 会话级状态：Zotero 连接、写入授权、面板视图与 Agent 高亮。页面订阅它。 */
export const STATE_URI = "ui://zotero/state.json";
/** 写入请求在 Zotero 授权对话框里显示的应用名。 */
export const APP_NAME = "ZCode";

/** 资源 URI。查询参数编码进路径（URI 模板不匹配查询串）。 */
export const URIS = {
  collections: (library: string) => `ui://zotero/lib/${library}/collections.json`,
  items: (library: string, query: ItemQuery) => `ui://zotero/lib/${library}/items/${encodeQuery(query)}.json`,
  item: (library: string, key: string) => `ui://zotero/lib/${library}/item/${key}.json`,
  annotations: (library: string, attachmentKey: string) =>
    `ui://zotero/lib/${library}/annotations/${attachmentKey}.json`,
  pdfInfo: (library: string, attachmentKey: string) => `ui://zotero/lib/${library}/pdf/${attachmentKey}/info.json`,
  pdfPart: (library: string, attachmentKey: string, part: number) =>
    `ui://zotero/lib/${library}/pdf/${attachmentKey}/${part}`,
  pdfjsData: (kind: string, file: string) => `ui://zotero/pdfjs/${kind}/${file}`,
  /**
   * 设置页：check 立即重新检查 Zotero，handoff 记下“已交给 Agent”。两者都返回 SessionState。
   * 用资源而不是工具：宿主对页面发起的工具调用要求审批，读取资源不需要。nonce 让每次读取都到达 server。
   */
  setup: (op: "check" | "handoff", nonce: string) => `ui://zotero/setup/${op}/${nonce}`,
} as const;
export const LIBRARY_URI_PREFIX = "ui://zotero/lib/";

export const LIMITS = {
  /** 页面读取 PDF 的分块大小（宿主单次资源读取上限 8 MiB，base64 后约 2.7 MiB）。 */
  chunkBytes: 2 * 1024 * 1024,
  /** 面板可打开的 PDF 上限。 */
  pdfBytes: 256 * 1024 * 1024,
  /** add_item / attach_pdf 下载 PDF 的上限与超时。 */
  downloadBytes: 100 * 1024 * 1024,
  downloadTimeoutMs: 60_000,
  /** 元数据服务（doi.org、arXiv）超时。 */
  metadataTimeoutMs: 20_000,
  /** 模型摘要的字符预算。 */
  summaryChars: 40_000,
  /** read_fulltext 默认返回的字符数。 */
  fulltextChars: 30_000,
  /** search_library 默认 / 最大条数。 */
  searchDefault: 25,
  searchMax: 100,
  /** 面板列表一页的条数。 */
  pageSize: 50,
  /** Zotero 本地 API 一次写入的对象上限。 */
  writeBatch: 50,
  /** 内存中缓存的已解析 PDF 数。 */
  pdfCache: 4,
  /** 等待用户在 Zotero 里点“允许”的时间。 */
  authorizeTimeoutMs: 180_000,
  /** 面板订阅时轮询 Zotero 的间隔。 */
  pollMs: 2_500,
  /** “已交给 Agent”在 Zotero 就绪或这段时间后清除。 */
  handoffMs: 30 * 60_000,
} as const;

/** 本地 API 需要的最低 Zotero 主版本。 */
export const MIN_ZOTERO = 7;

/** 库标识：个人库 "user"，群组库 "g<id>"。 */
export type LibraryId = string;

export interface ItemQuery {
  /** 快速搜索文本。 */
  q?: string;
  /** titleCreatorYear（默认）或 everything（含全文与笔记）。 */
  mode?: "titleCreatorYear" | "everything";
  collection?: string;
  tag?: string;
  /** 已保存的搜索。 */
  search?: string;
  /** 只取这些条目（show_items）。 */
  keys?: string[];
  sort?: "dateModified" | "dateAdded" | "title" | "creator" | "date";
  direction?: "asc" | "desc";
  start?: number;
  limit?: number;
}

/** 路径安全的查询编码：base64url(JSON)。 */
export function encodeQuery(query: ItemQuery): string {
  const clean = Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== "" && value !== null),
  );
  const json = JSON.stringify(clean);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") || "e30";
}

export function decodeQuery(encoded: string): ItemQuery {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "===".slice((base64.length + 3) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid query");
  return value as ItemQuery;
}

// ---------------------------------------------------------------------------
// 连接与状态
// ---------------------------------------------------------------------------

export type ConnectionState =
  /** 尚未探测。 */
  | "unknown"
  | "ready"
  /** 端口无应答：Zotero 未运行。 */
  | "not_running"
  /** Zotero 在运行但本地 API 未开启。 */
  | "api_disabled"
  | "error";

/** 写入能力：Zotero 7 的本地 API 只读；Zotero 8+ 支持经授权的写入。 */
export type WriteSupport = "unknown" | "available" | "unsupported";
/** 写入授权：remembered 表示用户选了“始终允许”，plugin 保存了 key。 */
export type WriteAuth = "none" | "remembered" | "pending" | "denied";

export interface ZoteroStatus {
  state: ConnectionState;
  /** Zotero 版本，如 11.0-beta.1。 */
  version?: string;
  /** Zotero-Server-ID：写入时必须回传。 */
  serverId?: string;
  /** 个人库在 zotero.org 上的用户 id（若已登录同步）。 */
  userId?: number;
  writes: WriteSupport;
  auth: WriteAuth;
  error?: string;
  checkedAt: number;
}

/** 本机事实：设置页的页脚与交给 Agent 的消息使用。 */
export interface HostFacts {
  os: "macos" | "windows" | "linux" | "other";
  /** 如 "macOS 15.4"、"Windows 11"、"Ubuntu 24.04.1 LTS"。 */
  osName: string;
  /** 如 "Apple silicon"、"Intel"、"x64"、"arm64"。 */
  arch: string;
  /** 找到的包管理器（Homebrew、winget、Flatpak…）。path 的家目录缩写为 ~。 */
  tools: { name: string; version?: string; path: string }[];
}

/** 本机安装的 Zotero 桌面程序。 */
export interface ZoteroInstall {
  state: "found" | "missing";
  /** 程序位置（macOS 为 .app），家目录缩写为 ~。 */
  path?: string;
  /** 如 "7.0.15"。 */
  version?: string;
  /** 未找到时查找过的位置。 */
  searched: string[];
}

/** Zotero 不可用时设置页需要的信息。 */
export interface SetupInfo {
  /** 探测完成前为 null。 */
  facts: HostFacts | null;
  /** Zotero 未就绪时检查；就绪后保留最后一次结果。 */
  app: ZoteroInstall | null;
  /** 面板把安装交给 Agent 的时间；Zotero 就绪或 LIMITS.handoffMs 后为 null。 */
  handoffAt: number | null;
  /** 本地 API 的地址，如 "127.0.0.1:23119"。 */
  address: string;
}

export interface LibraryInfo {
  id: LibraryId;
  name: string;
  type: "user" | "group";
  editable: boolean;
  /** Last-Modified-Version；变化即库内容有改动。 */
  version?: number;
}

// ---------------------------------------------------------------------------
// 条目
// ---------------------------------------------------------------------------

export interface Creator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

export interface CollectionNode {
  key: string;
  name: string;
  parent: string | null;
  numItems: number;
  numCollections: number;
}

export interface SavedSearch {
  key: string;
  name: string;
}

export interface CollectionsDoc {
  library: LibraryId;
  version: number;
  collections: CollectionNode[];
  searches: SavedSearch[];
}

export interface AttachmentInfo {
  key: string;
  title: string;
  contentType: string;
  linkMode: string;
  filename?: string;
  url?: string;
  isPdf: boolean;
  /** 父条目 key；独立附件为 null。 */
  parent: string | null;
}

export interface NoteInfo {
  key: string;
  html: string;
  /** 纯文本摘录（列表与模型摘要用）。 */
  excerpt: string;
  dateModified: string;
}

export interface ItemSummary {
  key: string;
  itemType: string;
  title: string;
  /** Zotero 的作者摘要，如 "Xhebraj et al."。 */
  creatorSummary: string;
  year: string;
  /** 期刊 / 会议 / 出版社等。 */
  venue: string;
  tags: string[];
  numChildren: number;
  /** 首选 PDF 附件（条目本身为 PDF 附件时是它自己）。 */
  pdf: { key: string; size?: number } | null;
  dateAdded: string;
  dateModified: string;
}

export interface ItemList {
  library: LibraryId;
  version: number;
  query: ItemQuery;
  total: number;
  items: ItemSummary[];
}

export interface ItemDetail extends ItemSummary {
  library: LibraryId;
  version: number;
  /** 条目自身版本（PATCH 时的 If-Unmodified-Since-Version）。 */
  itemVersion: number;
  creators: Creator[];
  /** 除 title / creators / abstract / tags / collections / relations 外的非空字段。 */
  fields: Record<string, string>;
  abstract: string;
  collections: { key: string; name: string }[];
  attachments: AttachmentInfo[];
  notes: NoteInfo[];
  /** 父条目（条目本身为子附件时）。 */
  parent: string | null;
}

// ---------------------------------------------------------------------------
// 注释与高亮
// ---------------------------------------------------------------------------

/** PDF 用户空间坐标（原点左下，单位 pt）：[x1, y1, x2, y2]。 */
export type Rect = [number, number, number, number];

export interface Annotation {
  key: string;
  type: "highlight" | "underline" | "note" | "image" | "ink" | "text" | string;
  text: string;
  comment: string;
  color: string;
  pageIndex: number;
  pageLabel: string;
  rects: Rect[];
  sortIndex: string;
  tags: string[];
  dateModified: string;
}

/** Agent 的高亮：只存在于本会话，可保存为 Zotero 注释。 */
export interface AgentHighlight {
  id: string;
  library: LibraryId;
  attachmentKey: string;
  itemKey: string;
  pageIndex: number;
  pageLabel: string;
  quote: string;
  comment: string;
  color: string;
  rects: Rect[];
  createdAt: number;
  /** 已保存为 Zotero 注释时的 key。 */
  savedAs?: string;
}

export interface AnnotationsDoc {
  library: LibraryId;
  attachmentKey: string;
  version: number;
  annotations: Annotation[];
  highlights: AgentHighlight[];
}

export interface PdfInfo {
  library: LibraryId;
  attachmentKey: string;
  itemKey: string;
  title: string;
  filename: string;
  bytes: number;
  parts: number;
  sha256: string;
}

// ---------------------------------------------------------------------------
// 会话状态
// ---------------------------------------------------------------------------

/** Agent 请面板显示的视图。页面以 viewSeq 判断是否为新请求。 */
export type PanelView =
  | { kind: "library"; library: LibraryId; query?: ItemQuery }
  | { kind: "items"; library: LibraryId; title: string; keys: string[] }
  | { kind: "item"; library: LibraryId; key: string }
  | {
      kind: "reader";
      library: LibraryId;
      itemKey: string;
      attachmentKey: string;
      pageIndex?: number;
      highlightId?: string;
    };

export interface SessionState {
  version: number;
  status: ZoteroStatus;
  libraries: LibraryInfo[];
  view: PanelView | null;
  viewSeq: number;
  highlights: AgentHighlight[];
  /** 正在等待用户在 Zotero 里批准写入。 */
  authorizing: boolean;
  setup: SetupInfo;
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

export type ZoteroErrorCode =
  | "zotero_not_running"
  | "zotero_not_installed"
  | "local_api_disabled"
  | "zotero_error"
  | "not_found"
  | "invalid_input"
  | "not_pdf"
  | "file_missing"
  | "quote_not_found"
  | "writes_unsupported"
  | "write_denied"
  | "authorize_rate_limited"
  | "version_conflict"
  | "write_failed"
  | "metadata_not_found"
  | "download_failed"
  | "path_outside_workspace";

export class ZoteroError extends Error {
  constructor(
    readonly code: ZoteroErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ZoteroError";
  }
}

/** 库 id 到本地 API 路径前缀。 */
export function libraryPrefix(library: LibraryId): string {
  if (library === "user") return "/api/users/0";
  const match = /^g(\d+)$/.exec(library);
  if (!match) throw new ZoteroError("invalid_input", `Unknown library "${library}". Use "user" or "g<groupId>".`);
  return `/api/groups/${match[1]}`;
}

/** Zotero 条目 key：8 位，字符集 23456789ABCDEFGHIJKLMNPQRSTUVWXYZ。 */
export const KEY_PATTERN = /^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$/;
