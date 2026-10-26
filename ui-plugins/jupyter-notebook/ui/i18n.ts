import type { JupyterEnvironment, KernelStatus, SaveState } from "#nb/contract.ts";
import { KIT_EN, KIT_ZH, type AgentMessage } from "#ui/setup-kit.tsx";

const PACKAGES = ["jupyter-server", "ipykernel"] as const;
const missingOf = (env: JupyterEnvironment) => (env.python ? env.packages.filter((pkg) => !pkg.version).map((pkg) => pkg.name) : [...PACKAGES]);

function messageEn(env: JupyterEnvironment): AgentMessage {
  const { python, uv } = env;
  const missing = missingOf(env);
  return {
    lead: "Set up Jupyter for the Jupyter Notebook panel in ZCode.",
    facts: {
      title: "The panel checked this workspace:",
      items: [
        python
          ? python.venv
            ? `Project Python: ${python.executable} (${python.version})${python.uv ? ", managed by uv" : ""}`
            : `Python: ${python.executable} (${python.version}, ${python.source}); this workspace has no virtual environment`
          : `No Python interpreter was found (checked ${env.checked.join(", ")})`,
        ...(python ? [`Missing packages: ${missing.join(", ")}`] : []),
        ...(uv && !python?.uv ? [`uv${uv.version ? ` ${uv.version}` : ""} is available`] : []),
      ],
    },
    steps: {
      title: "Please:",
      items: [
        python?.venv && env.installCommand
          ? `Add ${missing.length > 1 ? "both" : missing[0]} to this project's environment: \`${env.installCommand}\`. Do not install into the system Python.`
          : python
            ? `Create a virtual environment for this workspace (${uv ? "`uv venv`" : "`python3 -m venv .venv`"}) and install jupyter-server and ipykernel into it. Do not install into the system Python.`
            : `Install Python 3 for this workspace${uv ? " (for example `uv venv --python 3.12`)" : ""}, then install jupyter-server and ipykernel into its environment.`,
        python?.venv
          ? `Confirm with \`${python.executable} -c "import jupyter_server, ipykernel"\`.`
          : "Confirm that `import jupyter_server, ipykernel` works in that environment.",
        "Start a server for this workspace with the Jupyter plugin's `start_server` tool.",
      ],
    },
    outro: "The panel connects to the server as soon as it is up.",
  };
}

function messageZh(env: JupyterEnvironment): AgentMessage {
  const { python, uv } = env;
  const missing = missingOf(env);
  return {
    lead: "请为 ZCode 的 Jupyter Notebook 面板配置 Jupyter。",
    facts: {
      title: "面板检查了这个工作区：",
      items: [
        python
          ? python.venv
            ? `项目 Python：${python.executable}（${python.version}）${python.uv ? "，由 uv 管理" : ""}`
            : `Python：${python.executable}（${python.version}，${python.source}）；工作区没有虚拟环境`
          : `没有找到 Python 解释器（检查了 ${env.checked.join("、")}）`,
        ...(python ? [`缺少的包：${missing.join("、")}`] : []),
        ...(uv && !python?.uv ? [`可用：uv${uv.version ? ` ${uv.version}` : ""}`] : []),
      ],
    },
    steps: {
      title: "请：",
      items: [
        python?.venv && env.installCommand
          ? `把${missing.length > 1 ? "这两个包" : ` ${missing[0]} `}装进项目环境：\`${env.installCommand}\`。不要装进系统 Python。`
          : python
            ? `为这个工作区创建虚拟环境（${uv ? "`uv venv`" : "`python3 -m venv .venv`"}），并把 jupyter-server 和 ipykernel 装进去。不要装进系统 Python。`
            : `为这个工作区安装 Python 3${uv ? "（例如 `uv venv --python 3.12`）" : ""}，再把 jupyter-server 和 ipykernel 装进它的环境。`,
        python?.venv ? `用 \`${python.executable} -c "import jupyter_server, ipykernel"\` 确认。` : "确认在该环境中 `import jupyter_server, ipykernel` 可以运行。",
        "用 Jupyter 插件的 `start_server` 工具为这个工作区启动 server。",
      ],
    },
    outro: "server 启动后，面板会自动连接。",
  };
}

const en = {
  locale: "en",
  title: "Jupyter Notebook",
  connecting: "Connecting…",
  loading: "Loading…",
  dismiss: "Dismiss",
  close: "Close",
  cancel: "Cancel",

  // 连接 server
  setupTitle: "Connect a Jupyter server",
  setupBody: "Notebooks run on a Jupyter server. Use one that is already running, or start one for this workspace.",
  discovered: "Running on this machine",
  connect: "Connect",
  connectingServer: "Connecting…",
  serverVersion: (version: string) => `Jupyter Server ${version}`,
  startLabel: "Start one here",
  startLabelOr: "Or start one here",
  startTitle: "Start a server for this workspace",
  startDetail: (python: string | null) =>
    [python ? `Uses ${python}` : null, "only this machine can reach it", "stops when the session ends"]
      .filter(Boolean)
      .join(" · "),
  start: "Start",
  starting: "Starting…",
  byUrl: "Connect by URL",
  urlPlaceholder: "http://127.0.0.1:8888/lab?token=…",
  tokenPlaceholder: "Token, if it is not in the URL",
  askAgent: "You can also just ask the agent: “Analyse data.csv in a new notebook.”",
  serverStopped: "The server stopped.",

  // 缺少 Jupyter
  missingTitle: "Jupyter is not installed in this workspace",
  missingBody: ["Notebooks run on a Jupyter server. Starting one here needs ", "jupyter-server", " and ", "ipykernel", " in the project’s Python."] as [string, string, string, string, string],
  tryAgain: "Try again",
  uvHint: "uv adds the two packages on top of the project's environment for this session only. Your project is not changed.",
  // 设置页
  kit: KIT_EN,
  setupMessage: messageEn,
  setupJupyterTitle: "Set up Jupyter for this workspace",
  workingTitle: "Setting up Jupyter",
  workingLead: "The agent is installing jupyter-server and ipykernel in the chat. This page updates on its own as each requirement is met.",
  reqProjectPython: "Project Python",
  reqPython: "Python",
  noPython: "No Python interpreter found",
  managedByUv: "managed by uv",
  installedIn: (where: string) => `Installed in ${where}`,
  notInstalledIn: (where: string) => `Not installed in ${where}`,
  checkedOncePython: "Checked once Python is found",
  handoffInstall: "Let the agent install them",
  installYourself: "Install them yourself",
  useUvSession: "Use uv for this session only",
  byUrlLong: "Connect to a running server by URL",
  setUp: "Set up",
  agentInstalling: "Agent is installing jupyter-server and ipykernel",

  // 打开 notebook
  openTitle: "Open a notebook",
  find: "Find a notebook",
  newNotebook: "New notebook",
  newPlaceholder: "untitled.ipynb",
  create: "Create",
  emptyDir: "No notebooks here.",
  noMatch: "No notebooks match.",
  openNow: "Open",
  server: "Server",

  // 头部
  openNotebooks: "Open notebooks",
  openNotebook: "Open notebook…",
  closeNotebook: "Close notebook",
  startedHere: "started here",
  runAll: "Run all",
  more: "More",
  save: "Save",
  shortcuts: "Keyboard shortcuts",
  shortcutList: [
    ["Run and go to next", "⇧ ↵"],
    ["Run", "⌘ ↵"],
    ["Edit cell", "↵"],
    ["Stop editing", "Esc"],
    ["Insert above / below", "A / B"],
    ["Delete cell", "D D"],
    ["Text / code cell", "M / Y"],
  ] as [string, string][],
  interrupt: "Interrupt",
  restart: "Restart",
  restartRunAll: "Restart and run all",
  clearOutputs: "Clear all outputs",
  kernel: "Kernel",
  noKernel: "No kernel",
  kernelStatus: {
    none: "Not started",
    starting: "Starting",
    idle: "Idle",
    busy: "Busy",
    restarting: "Restarting",
    dead: "Stopped",
    disconnected: "Disconnected",
  } satisfies Record<KernelStatus, string>,
  saveState: {
    saved: "Saved",
    dirty: "Not saved",
    saving: "Saving…",
    error: "Save failed",
    conflict: "Changed on server",
  } satisfies Record<SaveState, string>,

  // 通知条
  conflictBody: (name: string) => `${name} was changed on the server, for example in JupyterLab.`,
  loadTheirs: "Load theirs",
  keepMine: "Keep mine",
  saveFailed: (error: string) => `Could not save: ${error}`,
  kernelDead: "The kernel stopped unexpectedly. Variables are lost.",
  kernelDisconnected: "Lost the connection to the kernel. Reconnecting…",
  restartKernel: "Restart kernel",
  notebookClosed: "This notebook was closed.",

  // cell
  run: "Run",
  stop: "Stop",
  moveUp: "Move up",
  moveDown: "Move down",
  reference: "Reference in chat",
  cellActions: "More actions",
  toMarkdown: "Change to Markdown",
  toCode: "Change to Code",
  toRaw: "Change to Raw",
  clearOutput: "Clear output",
  deleteCell: "Delete cell",
  addCode: "Code",
  addText: "Text",
  emptyTitle: "This notebook is empty",
  emptyBody: "Add a cell, or ask the agent to start the analysis.",
  codeCell: "Code cell",
  textCell: "Text cell",
  emptyMarkdown: "Double-click to write text",
  agentEdited: "Agent edited",
  agentRunning: "Agent is running this cell",
  next: "Next",
  queuedNth: (n: number) => `Queued · ${n}${n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : n % 10 === 1 && n % 100 !== 11 ? "st" : "th"}`,
  runningOf: (index: number, total: number) => `Running ${index} of ${total}`,
  runningOfShort: (index: number, total: number) => `${index} of ${total}`,
  runningCellN: (n: number) => `Running cell ${n}`,
  running: "Running",
  queued: "Queued",
  cellConflict: "The agent changed this cell while you were typing.",
  compare: "Compare",
  hideCompare: "Hide",
  agentVersion: "Agent's version",
  useAgents: "Use agent's",
  fixWithAgent: "Ask agent to fix",
  fullTraceback: (n: number) => `Full traceback · ${n} lines`,
  shortTraceback: "Show less",
  widgetUnsupported: "Interactive widgets are not supported in this panel.",
  scriptOutput: "This output needs JavaScript, which the panel does not run.",

  // 时间
  justNow: "just now",
  minutesAgo: (n: number) => `${n} min ago`,
  hoursAgo: (n: number) => `${n} h ago`,
  yesterday: "Yesterday",

  // 对话中的卡片
  openPanel: "Open in side panel",
  open: "Open",
  cells: (n: number) => `${n} cell${n === 1 ? "" : "s"}`,
  runningCell: (index: number, total: number) => `Running cell ${index} of ${total}`,

  // 发给 Agent 的文字
  fixMessage: (path: string, index: number, id: string, error: string) =>
    `In the notebook ${path}, cell [${index}] (id ${id}) fails with:\n${error}\nPlease fix it and run it again.`,
  referenceText: (path: string, index: number, id: string) =>
    `The user is referring to cell [${index}] (id ${id}) of the notebook ${path}.`,
};

const zh: typeof en = {
  locale: "zh-CN",
  title: "Jupyter Notebook",
  connecting: "连接中…",
  loading: "加载中…",
  dismiss: "关闭",
  close: "关闭",
  cancel: "取消",

  setupTitle: "连接 Jupyter Server",
  setupBody: "Notebook 在 Jupyter Server 上运行。可以使用已在运行的 server，也可以为当前工作区启动一个。",
  discovered: "本机正在运行",
  connect: "连接",
  connectingServer: "连接中…",
  serverVersion: (version) => `Jupyter Server ${version}`,
  startLabel: "在这里启动",
  startLabelOr: "或在这里启动",
  startTitle: "为当前工作区启动 server",
  startDetail: (python) =>
    [python ? `使用 ${python}` : null, "只有本机可以访问", "会话结束时停止"].filter(Boolean).join(" · "),
  start: "启动",
  starting: "启动中…",
  byUrl: "通过 URL 连接",
  urlPlaceholder: "http://127.0.0.1:8888/lab?token=…",
  tokenPlaceholder: "Token（URL 中没有时填写）",
  askAgent: "也可以直接让 Agent 来做：“新建一个 notebook 分析 data.csv。”",
  serverStopped: "Server 已停止。",

  missingTitle: "当前工作区没有安装 Jupyter",
  missingBody: ["Notebook 在 Jupyter Server 上运行。在这里启动 server 需要项目的 Python 中装有 ", "jupyter-server", " 和 ", "ipykernel", "。"],
  tryAgain: "重试",
  uvHint: "uv 只在本次会话中把这两个包叠加到项目环境上，不会修改你的项目。",
  kit: KIT_ZH,
  setupMessage: messageZh,
  setupJupyterTitle: "为这个工作区配置 Jupyter",
  workingTitle: "正在配置 Jupyter",
  workingLead: "Agent 正在对话中安装 jupyter-server 和 ipykernel。每满足一项要求，这里会自动更新。",
  reqProjectPython: "项目 Python",
  reqPython: "Python",
  noPython: "没有找到 Python 解释器",
  managedByUv: "由 uv 管理",
  installedIn: (where) => `已装在 ${where}`,
  notInstalledIn: (where) => `${where} 中没有安装`,
  checkedOncePython: "找到 Python 后检查",
  handoffInstall: "让 Agent 安装",
  installYourself: "自己安装",
  useUvSession: "只在本次会话中使用 uv",
  byUrlLong: "通过 URL 连接正在运行的 server",
  setUp: "配置",
  agentInstalling: "Agent 正在安装 jupyter-server 和 ipykernel",

  openTitle: "打开 notebook",
  find: "查找 notebook",
  newNotebook: "新建 notebook",
  newPlaceholder: "untitled.ipynb",
  create: "新建",
  emptyDir: "这里没有 notebook。",
  noMatch: "没有匹配的 notebook。",
  openNow: "已打开",
  server: "Server",

  openNotebooks: "已打开的 notebook",
  openNotebook: "打开 notebook…",
  closeNotebook: "关闭 notebook",
  startedHere: "由此启动",
  runAll: "全部运行",
  more: "更多",
  save: "保存",
  shortcuts: "快捷键",
  shortcutList: [
    ["运行并移到下一个", "⇧ ↵"],
    ["运行", "⌘ ↵"],
    ["编辑 cell", "↵"],
    ["结束编辑", "Esc"],
    ["在上方 / 下方插入", "A / B"],
    ["删除 cell", "D D"],
    ["文本 / 代码 cell", "M / Y"],
  ],
  interrupt: "中断",
  restart: "重启",
  restartRunAll: "重启并全部运行",
  clearOutputs: "清除所有输出",
  kernel: "Kernel",
  noKernel: "无 kernel",
  kernelStatus: {
    none: "未启动",
    starting: "启动中",
    idle: "空闲",
    busy: "运行中",
    restarting: "重启中",
    dead: "已停止",
    disconnected: "已断开",
  },
  saveState: {
    saved: "已保存",
    dirty: "未保存",
    saving: "保存中…",
    error: "保存失败",
    conflict: "服务器上已更改",
  },

  conflictBody: (name) => `${name} 在服务器上被修改了，例如在 JupyterLab 中。`,
  loadTheirs: "载入服务器版本",
  keepMine: "保留我的",
  saveFailed: (error) => `保存失败：${error}`,
  kernelDead: "Kernel 意外停止，变量已丢失。",
  kernelDisconnected: "与 kernel 的连接断开，正在重连…",
  restartKernel: "重启 kernel",
  notebookClosed: "这个 notebook 已关闭。",

  run: "运行",
  stop: "停止",
  moveUp: "上移",
  moveDown: "下移",
  reference: "在对话中引用",
  cellActions: "更多操作",
  toMarkdown: "转为 Markdown",
  toCode: "转为代码",
  toRaw: "转为 Raw",
  clearOutput: "清除输出",
  deleteCell: "删除 cell",
  addCode: "代码",
  addText: "文本",
  emptyTitle: "这个 notebook 还是空的",
  emptyBody: "添加一个 cell，或者让 Agent 开始分析。",
  codeCell: "代码 cell",
  textCell: "文本 cell",
  emptyMarkdown: "双击编写文本",
  agentEdited: "Agent 修改过",
  agentRunning: "Agent 正在运行这个 cell",
  next: "下一个",
  queuedNth: (n) => `排队中 · 第 ${n} 个`,
  runningOf: (index, total) => `正在运行 ${index} / ${total}`,
  runningOfShort: (index, total) => `${index} / ${total}`,
  runningCellN: (n) => `正在运行 cell ${n}`,
  running: "运行中",
  queued: "排队中",
  cellConflict: "你输入时 Agent 修改了这个 cell。",
  compare: "对比",
  hideCompare: "收起",
  agentVersion: "Agent 的版本",
  useAgents: "用 Agent 的",
  fixWithAgent: "让 Agent 修复",
  fullTraceback: (n) => `完整 traceback · ${n} 行`,
  shortTraceback: "收起",
  widgetUnsupported: "面板不支持交互式 widget。",
  scriptOutput: "这个输出需要运行 JavaScript，面板不会执行。",

  justNow: "刚刚",
  minutesAgo: (n) => `${n} 分钟前`,
  hoursAgo: (n) => `${n} 小时前`,
  yesterday: "昨天",

  openPanel: "在侧栏打开",
  open: "打开",
  cells: (n) => `${n} 个 cell`,
  runningCell: (index, total) => `正在运行第 ${index} / ${total} 个 cell`,

  fixMessage: (path, index, id, error) =>
    `notebook ${path} 中的 cell [${index}]（id ${id}）运行出错：\n${error}\n请修复后重新运行。`,
  referenceText: (path, index, id) => `用户指的是 notebook ${path} 中的 cell [${index}]（id ${id}）。`,
};

export type Strings = typeof en;
export const strings = (locale: string | undefined): Strings =>
  locale?.toLowerCase().startsWith("zh") ? zh : en;
