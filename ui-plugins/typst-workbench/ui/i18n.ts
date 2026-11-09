import type { HostFacts, Toolchain } from "#t/contract.ts";
import { KIT_EN, KIT_ZH, toolLabel, type AgentMessage } from "#ui/setup-kit.tsx";

/** 交给 Agent 的消息所需的信息。 */
export interface SetupContext {
  toolchain: Toolchain;
  facts: HostFacts | null;
  searched: string[];
  /** 如 "0.12"。 */
  min: string;
}

/** 本机最合适的安装命令；没有合适的包管理器时为 null。 */
export function installCommand(facts: HostFacts | null): string | null {
  const has = (name: string) => !!facts?.tools.some((tool) => tool.name === name);
  if (facts?.os === "windows" && has("winget")) return "winget install --id Typst.Typst";
  if (facts?.os !== "windows" && has("Homebrew")) return "brew install typst";
  if (facts?.os === "windows" && has("Scoop")) return "scoop install typst";
  if (has("cargo")) return "cargo install --locked typst-cli";
  return null;
}

/** 手动安装：每个系统一条命令。 */
export const MANUAL_COMMANDS = {
  macos: "brew install typst",
  windows: "winget install --id Typst.Typst",
  linux: "cargo install --locked typst-cli",
} as const;

export const RELEASES_URL = "https://github.com/typst/typst/releases";

const listEn = (items: string[]) => (items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

function messageEn({ toolchain, facts, searched, min }: SetupContext): AgentMessage {
  const tools = facts?.tools.map(toolLabel) ?? [];
  const items = [
    ...(facts ? [`${facts.osName}, ${facts.arch}`] : []),
    toolchain.state === "missing"
      ? `\`typst\` is not on PATH${searched.length ? `, in ${searched.slice(0, 2).join(" or in ")}` : ""}`
      : toolchain.state === "too_old"
        ? `Typst ${toolchain.version} is installed at ${toolchain.path}, but the panel needs ${min} or later`
        : (toolchain.error ?? "Typst does not run"),
    tools.length ? `${listEn(tools)} ${tools.length === 1 ? "is" : "are"} available` : "No package manager was found",
  ];
  const command = installCommand(facts);
  const ask = "Ask me before using sudo or editing my shell profile.";
  const first =
    toolchain.state === "missing"
      ? command
        ? `Install Typst ${min} or later. Prefer \`${command}\`. ${ask}`
        : `Install Typst ${min} or later, for example a release from ${RELEASES_URL}. ${ask}`
      : toolchain.state === "too_old"
        ? `Update the Typst at ${toolchain.path} to ${min} or later, with the tool that installed it. ${ask}`
        : `Find out why it fails, then fix or reinstall Typst ${min} or later. ${ask}`;
  return {
    lead: toolchain.state === "too_old" ? "Update Typst for the Typst panel in ZCode." : toolchain.state === "error" ? "Fix Typst for the Typst panel in ZCode." : "Set up Typst for the Typst panel in ZCode.",
    facts: { title: "The panel checked this computer:", items },
    steps: {
      title: "Please:",
      items: [
        first,
        "Run `typst --version` to confirm it works.",
        "If it ends up somewhere that is not on PATH, tell me the full path so I can set “Typst path” in the plugin settings.",
      ],
    },
    outro: "The panel picks Typst up on its own once `typst` runs.",
  };
}

function messageZh({ toolchain, facts, searched, min }: SetupContext): AgentMessage {
  const tools = facts?.tools.map(toolLabel) ?? [];
  const items = [
    ...(facts ? [`${facts.osName}，${facts.arch}`] : []),
    toolchain.state === "missing"
      ? `PATH${searched.length ? `、${searched.slice(0, 2).join("、")}` : ""} 中都没有 \`typst\``
      : toolchain.state === "too_old"
        ? `${toolchain.path} 是 Typst ${toolchain.version}，面板需要 ${min} 或更高版本`
        : (toolchain.error ?? "Typst 无法运行"),
    tools.length ? `可用：${tools.join("、")}` : "没有找到包管理器",
  ];
  const command = installCommand(facts);
  const ask = "使用 sudo 或修改 shell 配置之前先问我。";
  const first =
    toolchain.state === "missing"
      ? command
        ? `安装 Typst ${min} 或更高版本，优先用 \`${command}\`。${ask}`
        : `安装 Typst ${min} 或更高版本，例如从 ${RELEASES_URL} 下载发行版。${ask}`
      : toolchain.state === "too_old"
        ? `用当初安装它的方式，把 ${toolchain.path} 的 Typst 更新到 ${min} 或更高版本。${ask}`
        : `找出它无法运行的原因，修复或重新安装 Typst ${min} 或更高版本。${ask}`;
  return {
    lead: toolchain.state === "too_old" ? "请为 ZCode 的 Typst 面板更新 Typst。" : toolchain.state === "error" ? "请为 ZCode 的 Typst 面板修复 Typst。" : "请为 ZCode 的 Typst 面板安装 Typst。",
    facts: { title: "面板检查了这台电脑：", items },
    steps: {
      title: "请：",
      items: [first, "运行 `typst --version` 确认可以使用。", "如果装到了不在 PATH 中的位置，告诉我完整路径，我会填到插件设置的“Typst 路径”里。"],
    },
    outro: "`typst` 能运行后，面板会自动发现它。",
  };
}

const en = {
  title: "Typst",
  connecting: "Connecting…",
  close: "Close",
  send: "Send",
  open: "Open",
  openPanel: "Open in side panel",
  // 工具链
  findingTypst: "Looking for Typst…",
  missingTitle: "Typst is not installed",
  tooOldTitle: (version: string) => `Typst ${version} is too old`,
  tooOldBody: (min: string, path: string) => `The preview needs Typst ${min} or later. Update the Typst at ${path}.`,
  errorTitle: "Typst cannot run",
  checkAgain: "Check again",
  // 设置页
  kit: KIT_EN,
  setupMessage: messageEn,
  setupTitle: "Set up Typst",
  updateTitle: "Update Typst",
  workingTitle: "Setting up Typst",
  setupLead: "The preview runs the Typst installed on this computer, so your own fonts, packages and version apply.",
  updateLead: (min: string, version: string) => `The preview needs Typst ${min} or later; this computer has ${version}.`,
  errorLead: "Typst was found, but it does not run.",
  workingLead: "The agent is installing Typst in the chat. This page updates on its own as each requirement is met.",
  reqCli: "Typst CLI",
  reqVersion: (min: string) => `Version ${min} or later`,
  notFoundIn: (dirs: string[]) => `Not on PATH${dirs.length ? `, ${dirs.slice(0, 2).join(" or ")}` : ""}`,
  checkedOnceFound: "Checked once Typst is found",
  tooOld: "Too old",
  failed: "Failed",
  handoffInstall: "Let the agent install it",
  handoffUpdate: "Let the agent update it",
  handoffFix: "Let the agent fix it",
  installYourself: "Install it yourself",
  manualHint: (os: "macos" | "windows" | "linux") =>
    [os === "macos" ? "No Homebrew? Download a release from " : os === "windows" ? "Or download a release from " : "Or use your distribution’s package, or download a release from ", " and put typst on your PATH. This page notices on its own once Typst runs."] as [string, string],
  settingHint: ["Installed somewhere else? Set ", "Typst path", " in the plugin settings."] as [string, string, string],
  readyTitle: "Typst is ready",
  readyLead: (version: string) => `Found Typst ${version} at `,
  openPreview: "Open preview",
  continuesSoon: "Continues on its own in a moment.",
  setUp: "Set up",
  agentSettingUp: "Agent is setting up Typst",
  // 主文件
  noFilesTitle: "No Typst files yet",
  noFilesBody: "Ask the agent to start a document, or create a .typ file in the workspace.",
  chooseTitle: "Choose the main file",
  chooseBody: "This workspace has several .typ files. Pick the one you would compile.",
  mainFile: "Main file",
  // 编译状态
  starting: "Starting Typst…",
  compiling: "Compiling…",
  compiledIn: (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`,
  errors: (n: number) => `${n} error${n === 1 ? "" : "s"}`,
  warnings: (n: number) => `${n} warning${n === 1 ? "" : "s"}`,
  crashed: "Typst stopped",
  restart: "Restart",
  firstCompile: "Compiling the document…",
  noPreviewErrors: "The document does not compile yet. The preview appears once it does.",
  outdated: "Showing the last version that compiled.",
  loadingPreview: "Loading preview…",
  previewError: "Cannot show the preview",
  // 工具栏
  page: "Page",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  fitWidth: "Fit width",
  fitPage: "Fit page",
  outline: "Outline",
  noOutline: "No headings",
  problems: "Problems",
  // 诊断
  noProblems: "No problems.",
  fixWithAgent: "Fix with agent",
  addToChat: "Add to chat",
  problemsAdded: "Added the problems to the chat context.",
  fixRequest: (main: string) => `Fix the Typst problems in ${main}:`,
  calledFrom: "from",
  // 选择与源码
  ask: "Ask",
  askPlaceholder: "Ask about this…",
  selectionAdded: "Added the selection to the chat context.",
  findingSource: "Finding source…",
  noSource: "Source not found",
  source: "Source",
  clickHint: (mac: boolean) => `${mac ? "⌘" : "Ctrl"}-click text to find its source`,
  // Agent 高亮
  agent: "Agent",
  remove: "Remove",
  // 对话中的卡片
  inlineReady: (pages: number) => `Previewing · ${pages} page${pages === 1 ? "" : "s"}`,
};

export type Strings = typeof en;

const zh: Strings = {
  title: "Typst",
  connecting: "正在连接…",
  close: "关闭",
  send: "发送",
  open: "打开",
  openPanel: "在侧栏打开",
  findingTypst: "正在查找 Typst…",
  missingTitle: "未安装 Typst",
  tooOldTitle: (version) => `Typst ${version} 版本过旧`,
  tooOldBody: (min, path) => `预览需要 Typst ${min} 或更高版本。请更新 ${path}。`,
  errorTitle: "无法运行 Typst",
  checkAgain: "重新检查",
  kit: KIT_ZH,
  setupMessage: messageZh,
  setupTitle: "安装 Typst",
  updateTitle: "更新 Typst",
  workingTitle: "正在安装 Typst",
  setupLead: "预览使用本机安装的 Typst，因此沿用你自己的字体、包和版本。",
  updateLead: (min, version) => `预览需要 Typst ${min} 或更高版本；这台电脑上是 ${version}。`,
  errorLead: "找到了 Typst，但它无法运行。",
  workingLead: "Agent 正在对话中安装 Typst。每满足一项要求，这里会自动更新。",
  reqCli: "Typst 命令行",
  reqVersion: (min) => `${min} 或更高版本`,
  notFoundIn: (dirs) => `PATH${dirs.length ? `、${dirs.slice(0, 2).join("、")}` : ""} 中都没有`,
  checkedOnceFound: "找到 Typst 后检查",
  tooOld: "版本过旧",
  failed: "失败",
  handoffInstall: "让 Agent 安装",
  handoffUpdate: "让 Agent 更新",
  handoffFix: "让 Agent 修复",
  installYourself: "自己安装",
  manualHint: (os) =>
    [os === "macos" ? "没有 Homebrew？从 " : os === "windows" ? "也可以从 " : "也可以用发行版自带的软件包，或从 ", " 下载发行版，并把 typst 放进 PATH。Typst 能运行后，这里会自动发现。"],
  settingHint: ["装在其他位置？在插件设置中填写", "“Typst 路径”", "。"],
  readyTitle: "Typst 已就绪",
  readyLead: (version) => `找到了 Typst ${version}：`,
  openPreview: "打开预览",
  continuesSoon: "稍后自动继续。",
  setUp: "安装",
  agentSettingUp: "Agent 正在安装 Typst",
  noFilesTitle: "还没有 Typst 文件",
  noFilesBody: "让 Agent 新建一个文档，或在工作区中创建 .typ 文件。",
  chooseTitle: "选择主文件",
  chooseBody: "工作区中有多个 .typ 文件。请选择要编译的那个。",
  mainFile: "主文件",
  starting: "正在启动 Typst…",
  compiling: "正在编译…",
  compiledIn: (ms) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} 毫秒`,
  errors: (n) => `${n} 个错误`,
  warnings: (n) => `${n} 个警告`,
  crashed: "Typst 已停止",
  restart: "重新启动",
  firstCompile: "正在编译文档…",
  noPreviewErrors: "文档还不能编译。编译成功后显示预览。",
  outdated: "显示的是最后一次编译成功的版本。",
  loadingPreview: "正在加载预览…",
  previewError: "无法显示预览",
  page: "页",
  zoomIn: "放大",
  zoomOut: "缩小",
  fitWidth: "适应宽度",
  fitPage: "适应页面",
  outline: "大纲",
  noOutline: "没有标题",
  problems: "问题",
  noProblems: "没有问题。",
  fixWithAgent: "让 Agent 修复",
  addToChat: "加入对话",
  problemsAdded: "已将问题加入对话上下文。",
  fixRequest: (main) => `请修复 ${main} 中的 Typst 问题：`,
  calledFrom: "调用自",
  ask: "提问",
  askPlaceholder: "就此提问…",
  selectionAdded: "已将选中内容加入对话上下文。",
  findingSource: "正在查找源码…",
  noSource: "未找到源码",
  source: "源码",
  clickHint: (mac) => `${mac ? "⌘" : "Ctrl"}+点击文字可查找源码`,
  agent: "Agent",
  remove: "移除",
  inlineReady: (pages) => `正在预览 · 共 ${pages} 页`,
};

export function strings(locale: string): Strings {
  return locale.toLowerCase().startsWith("zh") ? zh : en;
}
