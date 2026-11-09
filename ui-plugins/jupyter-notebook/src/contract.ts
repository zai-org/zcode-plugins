export const PLUGIN_NAME = "jupyter-notebook";
export const PLUGIN_VERSION = "0.2.0";
/** manifest `mcpServers` 键、`ui.surfaces[].id` 与资源命名空间保持一致。 */
export const SERVER_NAME = "jupyter-notebook";
export const SURFACE_ID = "jupyter-notebook";
export const PANEL_URI = "ui://jupyter-notebook/panel.html";
/** 会话级状态：已连接 / 已发现的 server、已打开的 notebook。页面订阅它。 */
export const STATE_URI = "ui://jupyter-notebook/state.json";
/** 单个 notebook 的完整文档与运行状态。页面订阅它。 */
export const notebookUri = (id: string) => `ui://jupyter-notebook/notebooks/${id}.json`;
export const NOTEBOOK_URI_PREFIX = "ui://jupyter-notebook/notebooks/";
/**
 * 设置页：check 立即重新检查工作区的 Python，handoff 记下“已交给 Agent”。两者都返回 SessionState。
 * 用资源而不是工具：宿主对页面发起的工具调用要求审批，读取资源不需要。nonce 让每次读取都到达 server。
 */
export const setupUri = (op: "check" | "handoff", nonce: string) => `ui://jupyter-notebook/setup/${op}/${nonce}`;

/** 工具结果、资源与模型摘要的上限。 */
export const LIMITS = {
  /** 单个 stream 输出保留的字符数；超出时保留首尾。 */
  streamChars: 200_000,
  /** 单个输出 mime 值（如 base64 图片）上限；超出时替换为占位文本。 */
  mimeBytes: 4 * 1024 * 1024,
  /** 页面资源上限低于宿主 8 MiB，留余量。超出时先省略大输出。 */
  resourceBytes: 7 * 1024 * 1024,
  /** 模型摘要的字符预算（宿主模型预算约 50 KB）。 */
  summaryChars: 40_000,
  /** 摘要中每个 cell 输出的默认字符数。 */
  outputCharsPerCell: 2_000,
  /** 一次执行结果最多附带给模型的图片数与单张大小。 */
  modelImages: 4,
  modelImageBytes: 1_500_000,
  /** 模型同步等待执行的默认 / 最大秒数；工具级 _meta.timeoutMs 比最大值多留余量。 */
  waitSecondsDefault: 300,
  waitSecondsMax: 1_700,
  toolTimeoutMs: 1_780_000,
  /** 一次编辑批次的最大操作数。 */
  operations: 200,
  /** 面板打开、还没有可用 server 且缺少依赖时，重新检查工作区 Python 的间隔。 */
  environmentWatchMs: 4_000,
  /** “已交给 Agent”在依赖就绪或这段时间后清除。 */
  handoffMs: 30 * 60_000,
} as const;

// ---------------------------------------------------------------------------
// nbformat v4（只声明本插件读写的字段；未知字段原样保留）
// ---------------------------------------------------------------------------

export type MultilineString = string | string[];
export type MimeBundle = Record<string, unknown>;

export interface StreamOutput {
  output_type: "stream";
  name: "stdout" | "stderr";
  text: string;
}
export interface DisplayDataOutput {
  output_type: "display_data";
  data: MimeBundle;
  metadata: Record<string, unknown>;
  /** 仅内存：update_display_data 定位用，保存时剔除。 */
  transient?: { display_id?: string };
}
export interface ExecuteResultOutput {
  output_type: "execute_result";
  data: MimeBundle;
  metadata: Record<string, unknown>;
  execution_count: number | null;
  transient?: { display_id?: string };
}
export interface ErrorOutput {
  output_type: "error";
  ename: string;
  evalue: string;
  traceback: string[];
}
export type Output = StreamOutput | DisplayDataOutput | ExecuteResultOutput | ErrorOutput;

export type CellType = "code" | "markdown" | "raw";

/** 谁做的修改或运行：模型（经模型工具）或用户（经面板专用工具）。 */
export type Actor = "agent" | "user";

/** 页面与模型看到的 cell。source 恒为字符串；outputs / executionCount 只对 code cell 有意义。 */
export interface Cell {
  id: string;
  type: CellType;
  source: string;
  /** 每次 source / type 变化加一；页面编辑以它做乐观并发。 */
  revision: number;
  executionCount: number | null;
  outputs: Output[];
  metadata: Record<string, unknown>;
  attachments?: Record<string, MimeBundle>;
  run: CellRun | null;
  /** 最近一次 source / type 修改的来源与时间；仅内存，不写入文件。 */
  edit?: { by: Actor; at: number } | null;
}

export type CellRunState = "queued" | "running" | "ok" | "error" | "aborted";
export interface CellRun {
  state: CellRunState;
  /** 本次运行的请求 id，用于区分同一 cell 的多次运行。 */
  runId: string;
  /** 谁请求了这次运行。 */
  by: Actor;
  /** 本 notebook 内递增的排队序号：排队中的 cell 按它决定先后。 */
  seq: number;
  /** 同一次运行请求（一次 execute_cells / 全部运行）的 cell 共享同一 batch。 */
  batch: string;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

// ---------------------------------------------------------------------------
// server 与 kernel
// ---------------------------------------------------------------------------

export type ServerKind = "launched" | "attached";
export type ServerStatus = "starting" | "ready" | "error" | "stopped";

/** 对外的 server 描述：永远不含 token。 */
export interface ServerInfo {
  id: string;
  kind: ServerKind;
  /** 不含 token 的 base URL，以 `/` 结尾。 */
  url: string;
  status: ServerStatus;
  /** server 的 root_dir（已知时）。notebook 路径相对于它。 */
  rootDir: string | null;
  version: string | null;
  error: string | null;
  /** launched 时的 Python 解释器。 */
  python: string | null;
}

/** 从 Jupyter runtime 目录发现的本机 server；token 留在插件进程内。 */
export interface DiscoveredServer {
  url: string;
  rootDir: string | null;
  pid: number;
  version: string | null;
  /** 已作为某个 ServerInfo 连接时为其 id。 */
  connectedAs: string | null;
}

export type KernelStatus =
  | "none"
  | "starting"
  | "idle"
  | "busy"
  | "restarting"
  | "dead"
  | "disconnected";

export interface KernelInfo {
  status: KernelStatus;
  /** kernelspec 名称（如 python3）。 */
  name: string | null;
  displayName: string | null;
  language: string | null;
  id: string | null;
}

export interface KernelSpecInfo {
  name: string;
  displayName: string;
  language: string;
}

// ---------------------------------------------------------------------------
// notebook 文档
// ---------------------------------------------------------------------------

export type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface NotebookDoc {
  id: string;
  serverId: string;
  /** 相对 server root_dir 的路径，使用 `/` 分隔。 */
  path: string;
  name: string;
  /** 内容（cell 结构 / source / type）每批编辑加一。 */
  revision: number;
  /** 任何可见变化（含输出、kernel 状态、保存状态）都加一；页面据此丢弃旧读。 */
  version: number;
  cells: Cell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformatMinor: number;
  kernel: KernelInfo;
  save: { state: SaveState; savedAt: number | null; error: string | null };
  /** 资源超限时被省略的输出数量；每个被省略的输出在原位换成一段说明，文件中仍保留。 */
  omittedOutputs?: number;
}

/** state.json 中 notebook 的摘要。 */
export interface NotebookEntry {
  id: string;
  serverId: string;
  path: string;
  name: string;
  kernelStatus: KernelStatus;
  saveState: SaveState;
  running: number;
}

export interface SessionState {
  version: number;
  servers: ServerInfo[];
  discovered: DiscoveredServer[];
  notebooks: NotebookEntry[];
  /** 最近打开 / 操作的 notebook；工具省略 notebook 参数时以它为默认。 */
  current: string | null;
  /** start_server 首先尝试的解释器（工作区内的写成相对路径），供面板说明。 */
  launchPython: string | null;
  environment: JupyterEnvironment;
  setup: {
    /** 面板把安装交给 Agent 的时间；依赖就绪、有可用 server 或 LIMITS.handoffMs 后为 null。 */
    handoffAt: number | null;
  };
}

/**
 * 工作区能否启动 Jupyter Server：启动前就检查（设置页的要求清单），不必等 start_server 失败。
 * 与 start_server 按同样的顺序查找解释器。
 */
export interface JupyterEnvironment {
  /** unknown：尚未检查；ready：有解释器同时装有 jupyter-server 与 ipykernel；missing：没有。 */
  state: "unknown" | "ready" | "missing";
  /** ready 时为找到的解释器；missing 时为安装目标（第一个能运行的解释器）；一个都没有时为 null。 */
  python: {
    /** 给人看的写法：工作区内的写成相对路径。 */
    executable: string;
    /** 如 "workspace .venv"、"PATH"。 */
    source: string;
    version: string;
    /** 所在虚拟环境（工作区内的写成相对路径，家目录缩写为 ~）；系统 Python 为 null。 */
    venv: string | null;
    /** 由 uv 管理的环境（uv 创建的 venv，或项目有 uv.lock）。 */
    uv: boolean;
  } | null;
  /** 目标解释器中两个包的版本（null 表示未安装）。 */
  packages: { name: "jupyter-server" | "ipykernel"; version: string | null }[];
  /** 检查过的解释器（给人看的写法）。 */
  checked: string[];
  /** 装进目标环境的命令；没有能运行的解释器时为 null。 */
  installCommand: string | null;
  /** 本机的 uv（可以 useUv 启动，或管理项目环境）。 */
  uv: { path: string; version?: string } | null;
  checkedAt: number;
}

/** 本机事实（host/facts.ts 使用）。 */
export interface HostFacts {
  os: "macos" | "windows" | "linux" | "other";
  osName: string;
  arch: string;
  tools: { name: string; version?: string; path: string }[];
}

/** jupyter_not_installed 的 details：检查过的解释器与建议的安装命令。 */
export interface MissingJupyterDetails {
  checked: string[];
  pythons: { executable: string; source: string; version: string | null; missing: string[] }[];
  installCommand: string;
}

// ---------------------------------------------------------------------------
// 编辑操作
// ---------------------------------------------------------------------------

/** 插入位置：index（0 起）、after / before 某 cell；都省略时追加到末尾。 */
export interface Position {
  index?: number;
  after?: string;
  before?: string;
}

export type EditOperation =
  | ({ op: "insert"; type?: CellType; source?: string; id?: string } & Position)
  | { op: "update"; cellId: string; source: string; expectedRevision?: number }
  | ({ op: "move"; cellId: string } & Position)
  | { op: "delete"; cellId: string }
  | { op: "set_type"; cellId: string; type: CellType }
  | { op: "clear_outputs"; cellId?: string };

export interface EditResult {
  revision: number;
  /** insert 产生的新 cell id，按操作顺序。 */
  inserted: string[];
}

// ---------------------------------------------------------------------------
// 工具结构化结果（给页面；模型只需要文本）
// ---------------------------------------------------------------------------

/** 指向 notebook 的工具结果都带这个引用，页面据此切换显示。 */
export interface NotebookRef {
  notebookId: string;
  serverId: string;
  path: string;
  revision: number;
}

export type JupyterErrorCode =
  | "no_server"
  | "server_not_found"
  | "server_unreachable"
  | "unauthorized"
  | "jupyter_not_installed"
  | "launch_failed"
  | "not_launched"
  | "no_notebook"
  | "notebook_not_found"
  | "already_exists"
  | "invalid_path"
  | "cell_not_found"
  | "revision_conflict"
  | "save_conflict"
  | "invalid_operation"
  | "kernel_error"
  | "kernel_not_found"
  | "jupyter_error";

export class JupyterError extends Error {
  constructor(
    readonly code: JupyterErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "JupyterError";
  }
}
