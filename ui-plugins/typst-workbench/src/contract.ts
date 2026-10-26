export const PLUGIN_NAME = "typst-workbench";
export const PLUGIN_VERSION = "0.2.0";
/** manifest `mcpServers` 键与 `ui.surfaces[].id`。 */
export const SERVER_NAME = "typst";
export const SURFACE_ID = "typst";
export const PANEL_URI = "ui://typst-workbench/panel.html";
/** 会话状态：工具链、主文件、编译状态、诊断、当前快照、面板视图与 Agent 高亮。页面订阅它。 */
export const STATE_URI = "ui://typst-workbench/state.json";

export const URIS = {
  /** 快照按 seq 不可变；页面按 seq 分块读取，不会混读两次编译的字节。 */
  pdfPart: (seq: number, part: number) => `ui://typst-workbench/pdf/${seq}/${part}`,
  pdfjsData: (kind: string, file: string) => `ui://typst-workbench/pdfjs/${kind}/${file}`,
  /**
   * 设置页：check 立即重新查找 Typst，handoff 记下“已交给 Agent”。两者都返回 SessionState。
   * 用资源而不是工具：宿主对页面发起的工具调用要求审批，读取资源不需要。nonce 让每次读取都到达 server。
   */
  setup: (op: "check" | "handoff", nonce: string) => `ui://typst-workbench/setup/${op}/${nonce}`,
} as const;

/** 已验证的最低 Typst 版本：render_pages 需要 `--pages`（0.12 引入）。 */
export const MIN_TYPST: [number, number, number] = [0, 12, 0];

export const LIMITS = {
  /** 页面读取 PDF 的分块大小（宿主单次资源读取上限 8 MiB，base64 后约 2.7 MiB）。 */
  chunkBytes: 2 * 1024 * 1024,
  /** 预览快照的上限。 */
  pdfBytes: 256 * 1024 * 1024,
  /** 内存中保留的快照数：页面读取旧快照的分块时，新快照可能已经到来。 */
  snapshots: 3,
  /** render_pages 一次最多页数与分辨率范围。 */
  renderPages: 4,
  ppiDefault: 110,
  ppiMin: 36,
  ppiMax: 300,
  /** check 默认等待时间。 */
  checkTimeoutMs: 60_000,
  /** 修改后等待 watch 开始编译的时间；超时则重启 watch（它可能漏掉了事件）。 */
  settleMs: 1_500,
  /** 一次性编译（渲染、导出）的超时。 */
  oneshotTimeoutMs: 120_000,
  /** 主文件候选扫描：深度与数量。 */
  scanDepth: 4,
  scanFiles: 4_000,
  /** 返回给模型的诊断条数。 */
  diagnostics: 30,
  /** 状态通知节流。 */
  notifyMs: 30,
  /** 面板打开且 Typst 不可用时重新查找的间隔；每 setupShellEvery 次连同登录 shell 一起查。 */
  setupWatchMs: 3_000,
  setupShellEvery: 5,
  /** “已交给 Agent”在 Typst 就绪或这段时间后清除。 */
  handoffMs: 30 * 60_000,
} as const;

// ---------------------------------------------------------------------------
// 工具链
// ---------------------------------------------------------------------------

export type ToolchainState =
  /** 尚未探测。 */
  | "unknown"
  | "ready"
  /** 找不到 typst。 */
  | "missing"
  /** 版本低于 MIN_TYPST。 */
  | "too_old"
  /** 设置的路径不可执行或 `typst --version` 失败。 */
  | "error";

export interface Toolchain {
  state: ToolchainState;
  path?: string;
  /** 如 "0.14.2"。 */
  version?: string;
  /** 从哪里找到的。 */
  source?: "setting" | "path" | "common" | "shell";
  error?: string;
}

/** 本机事实：设置页的页脚与交给 Agent 的消息使用。 */
export interface HostFacts {
  os: "macos" | "windows" | "linux" | "other";
  /** 如 "macOS 15.4"、"Windows 11"、"Ubuntu 24.04.1 LTS"。 */
  osName: string;
  /** 如 "Apple silicon"、"Intel"、"x64"、"arm64"。 */
  arch: string;
  /** 找到的包管理器与相关工具（Homebrew、winget、cargo…）。path 的家目录缩写为 ~。 */
  tools: { name: string; version?: string; path: string }[];
}

/** Typst 不可用时设置页需要的信息。 */
export interface SetupInfo {
  /** 探测完成前为 null。 */
  facts: HostFacts | null;
  /** 查找过的目录（PATH 之外，家目录缩写为 ~），与本机最相关的在前。 */
  searched: string[];
  /** 面板把安装交给 Agent 的时间；Typst 就绪或 LIMITS.handoffMs 后为 null。 */
  handoffAt: number | null;
}

// ---------------------------------------------------------------------------
// 编译
// ---------------------------------------------------------------------------

export interface SourceLocation {
  /** 工作区相对路径；包内文件为 "@preview/name:1.0.0/lib.typ"；工作区外的文件为绝对路径。 */
  file: string;
  /** 1 起。 */
  line: number;
  /** 1 起（字符）。 */
  column: number;
}

export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  location: SourceLocation | null;
  /** typst 的 hint。 */
  hints: string[];
  /** 调用栈（typst 的 help: error occurred in this call …）。 */
  trace: { message: string; location: SourceLocation | null }[];
  /** 出错行的源码（工作区内文件）。 */
  excerpt?: string;
}

export type CompilePhase =
  /** watch 尚未启动（没有工具链或主文件）。 */
  | "idle"
  | "starting"
  | "compiling"
  | "ok"
  | "warnings"
  | "error"
  /** watch 进程意外退出。 */
  | "crashed";

export interface CompileStatus {
  phase: CompilePhase;
  /** 最近一次结束的编译（成功或失败）的序号；check 用它判断结果是否覆盖了最新修改。 */
  run: number;
  /** typst 报告的耗时。 */
  durationMs?: number;
  /** 最近一次编译结束的时间（ms since epoch）。 */
  finishedAt?: number;
  /** watch 意外退出、启动失败时的说明。 */
  error?: string;
}

/** 一次成功编译的 PDF。页面按 seq 读取分块。 */
export interface SnapshotInfo {
  seq: number;
  bytes: number;
  parts: number;
  pages: number;
  sha256: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

/** PDF 用户空间坐标（原点左下，单位 pt）：[x1, y1, x2, y2]。 */
export type Rect = [number, number, number, number];

/** Agent 在预览中标出的文字。每次新快照后按原文重新定位；找不到时 stale。 */
export interface Highlight {
  id: string;
  quote: string;
  comment: string;
  /** 来源位置（show 用 file/line 定位时）。 */
  source?: { file: string; line: number; endLine: number };
  /** 定位所在的快照。 */
  seq: number;
  pageIndex: number;
  rects: Rect[];
  stale: boolean;
  createdAt: number;
}

/** Agent 请面板显示的位置。页面以 viewSeq 判断是否为新请求。 */
export type PanelView = { kind: "page"; pageIndex: number; y?: number } | { kind: "highlight"; id: string };

export interface SessionState {
  version: number;
  toolchain: Toolchain;
  /** 工作区根目录名（显示用）。 */
  workspace: string;
  /** 主文件，工作区相对路径。 */
  main: string | null;
  /** 工作区内的 .typ 文件（工作区相对路径）。 */
  candidates: string[];
  status: CompileStatus;
  diagnostics: Diagnostic[];
  snapshot: SnapshotInfo | null;
  view: PanelView | null;
  viewSeq: number;
  highlights: Highlight[];
  setup: SetupInfo;
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

export type TypstErrorCode =
  | "typst_missing"
  | "typst_too_old"
  | "typst_error"
  | "no_main"
  | "no_preview"
  | "compile_failed"
  | "not_found"
  | "invalid_input"
  | "quote_not_found"
  | "path_outside_workspace"
  | "timeout";

export class TypstError extends Error {
  constructor(
    readonly code: TypstErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TypstError";
  }
}

export function formatLocation(location: SourceLocation | null): string {
  return location ? `${location.file}:${location.line}:${location.column}` : "(no location)";
}
