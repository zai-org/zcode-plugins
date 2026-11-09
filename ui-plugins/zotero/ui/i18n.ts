import { MIN_ZOTERO, type HostFacts, type ZoteroInstall } from "#z/contract.ts";
import { KIT_EN, KIT_ZH, toolLabel, type AgentMessage } from "#ui/setup-kit.tsx";

/** 交给 Agent 的消息所需的信息。 */
export interface SetupContext {
  app: ZoteroInstall | null;
  facts: HostFacts | null;
  /** 装了但版本低于 MIN_ZOTERO。 */
  tooOld: boolean;
  address: string;
}

export const DOWNLOAD_URL = "https://www.zotero.org/download/";

/** 手动安装：每个系统一条命令。 */
export const MANUAL_COMMANDS = {
  macos: "brew install --cask zotero",
  windows: "winget install --id DigitalScholar.Zotero -e --source winget --accept-source-agreements --accept-package-agreements",
  linux: "flatpak install flathub org.zotero.Zotero",
} as const;

/** 本机最合适的安装命令；没有合适的包管理器时为 null。 */
export function installCommand(facts: HostFacts | null): string | null {
  const has = (name: string) => !!facts?.tools.some((tool) => tool.name === name);
  if (facts?.os === "macos" && has("Homebrew")) return MANUAL_COMMANDS.macos;
  if (facts?.os === "windows" && has("winget")) return MANUAL_COMMANDS.windows;
  if (facts?.os === "linux" && has("Flatpak")) return MANUAL_COMMANDS.linux;
  return null;
}

const listEn = (items: string[]) => (items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const PREF_EN = "“Allow other applications on this computer to communicate with Zotero”";
const PREF_ZH = "“允许此计算机上的其他应用程序与 Zotero 通信”";

function messageEn({ app, facts, tooOld, address }: SetupContext): AgentMessage {
  const tools = facts?.tools.map(toolLabel) ?? [];
  const command = installCommand(facts);
  const ask = "Ask me before using sudo.";
  return {
    lead: tooOld ? "Update Zotero for the Zotero panel in ZCode." : "Set up Zotero for the Zotero panel in ZCode.",
    facts: {
      title: "The panel checked this computer:",
      items: [
        ...(facts ? [`${facts.osName}, ${facts.arch}`] : []),
        tooOld
          ? `Zotero ${app?.version} is installed at ${app?.path}, but the panel needs ${MIN_ZOTERO} or later`
          : `Zotero is not installed${app?.searched.length ? ` (looked in ${listEn(app.searched)})` : ""}`,
        tools.length ? `${listEn(tools)} ${tools.length === 1 ? "is" : "are"} available` : "No package manager was found",
      ],
    },
    steps: {
      title: "Please:",
      items: [
        tooOld
          ? `Update Zotero to ${MIN_ZOTERO} or later (Help → Check for Updates in Zotero, or the installer from zotero.org/download). ${ask}`
          : command
            ? `Install Zotero ${MIN_ZOTERO} or later: \`${command}\`, or the official installer from zotero.org/download. ${ask}`
            : `Install Zotero ${MIN_ZOTERO} or later with the official installer from ${DOWNLOAD_URL}. ${ask}`,
        "Open Zotero once so it creates its profile.",
        `Walk me through Settings → Advanced → ${PREF_EN}. I will tick it myself.`,
      ],
    },
    outro: `The panel connects on its own once Zotero answers on ${address}.`,
  };
}

function messageZh({ app, facts, tooOld, address }: SetupContext): AgentMessage {
  const tools = facts?.tools.map(toolLabel) ?? [];
  const command = installCommand(facts);
  const ask = "使用 sudo 之前先问我。";
  return {
    lead: tooOld ? "请为 ZCode 的 Zotero 面板更新 Zotero。" : "请为 ZCode 的 Zotero 面板安装 Zotero。",
    facts: {
      title: "面板检查了这台电脑：",
      items: [
        ...(facts ? [`${facts.osName}，${facts.arch}`] : []),
        tooOld
          ? `${app?.path} 是 Zotero ${app?.version}，面板需要 ${MIN_ZOTERO} 或更高版本`
          : `没有安装 Zotero${app?.searched.length ? `（查找了 ${app.searched.join("、")}）` : ""}`,
        tools.length ? `可用：${tools.join("、")}` : "没有找到包管理器",
      ],
    },
    steps: {
      title: "请：",
      items: [
        tooOld
          ? `把 Zotero 更新到 ${MIN_ZOTERO} 或更高版本（Zotero 的“帮助 → 检查更新”，或 zotero.org/download 的安装包）。${ask}`
          : command
            ? `安装 Zotero ${MIN_ZOTERO} 或更高版本：\`${command}\`，或使用 zotero.org/download 的官方安装包。${ask}`
            : `用 ${DOWNLOAD_URL} 的官方安装包安装 Zotero ${MIN_ZOTERO} 或更高版本。${ask}`,
        "打开一次 Zotero，让它创建自己的配置。",
        `一步步告诉我怎样在“设置 → 高级”中勾选${PREF_ZH}，我自己来勾选。`,
      ],
    },
    outro: `Zotero 在 ${address} 上应答后，面板会自动连接。`,
  };
}

const en = {
  title: "Zotero",
  connecting: "Connecting…",
  loading: "Loading…",
  retry: "Try again",
  back: "Back",
  close: "Close",
  cancel: "Cancel",
  send: "Send",
  openPanel: "Open in side panel",
  open: "Open",
  // 连接状态
  notRunningTitle: "Zotero is not running",
  notRunningBody: "Start the Zotero desktop app (version 7 or later). This panel connects to it automatically.",
  apiDisabledTitle: "Turn on Zotero's local API",
  apiDisabledBody:
    'In Zotero, open Settings → Advanced and check "Allow other applications on this computer to communicate with Zotero".',
  errorTitle: "Cannot talk to Zotero",
  checkAgain: "Check again",
  // 设置页
  kit: KIT_EN,
  setupMessage: messageEn,
  setupTitle: "Set up Zotero",
  updateTitle: "Update Zotero",
  workingTitle: "Setting up Zotero",
  openTitle: "Open Zotero",
  setupLead: `This panel reads your library from the Zotero desktop app on this computer. It needs Zotero ${MIN_ZOTERO} or later, open, with its local API turned on.`,
  updateLead: (version: string) => `This panel needs Zotero ${MIN_ZOTERO} or later for its local API; this computer has ${version}.`,
  openLead: "Zotero is installed but not running. This panel connects as soon as it starts.",
  apiLead: "Zotero is open, but it does not let other apps read the library yet. It is one checkbox in Zotero’s own settings.",
  workingLead: "The agent is installing Zotero in the chat. This page updates on its own as each requirement is met.",
  errorLead: "Zotero answered in a way this panel did not expect.",
  reqApp: "Zotero app",
  reqOpen: "Zotero is open",
  reqApi: "Local API is on",
  notIn: (dirs: string[]) => `Not in ${dirs.join(" or ")}`,
  needsVersion: (version: string) => `${version} · needs ${MIN_ZOTERO} or later`,
  nothingAnswers: (address: string) => `Nothing answers on ${address}`,
  checkedOnceOpen: "Checked once Zotero is open",
  refused: "Zotero refused the request",
  off: "Off",
  tooOld: "Too old",
  failed: "Failed",
  openZotero: "Open Zotero",
  opening: "Opening…",
  slowStart: "Zotero can take a few seconds to start. This page waits for it.",
  handoffInstall: "Let the agent install it",
  handoffUpdate: "Let the agent update it",
  installYourself: "Install it yourself",
  manualHint: ["Or download the installer from ", ". This page notices on its own once Zotero starts."] as [string, string],
  inZotero: "In Zotero",
  stepOpen: "Open",
  stepPane: ["Go to the ", "Advanced", " pane."] as [string, string, string],
  stepTick: "Tick this box:",
  prefLabel: "Allow other applications on this computer to communicate with Zotero",
  menuApp: "Zotero",
  menuEdit: "Edit",
  menuSettings: "Settings…",
  apiHint: "This page turns green on its own once Zotero answers.",
  setUp: "Set up",
  notInstalledTitle: "Zotero is not installed",
  closedTitle: "Zotero is installed but not open",
  agentSettingUp: "Agent is setting up Zotero",
  // 库
  myLibrary: "My Library",
  allItems: "All items",
  collections: "Collections",
  savedSearches: "Saved searches",
  libraries: "Libraries",
  search: "Search",
  searchPlaceholder: "Title, author, year",
  searchEverything: "Also search full text and notes",
  everythingPlaceholder: "Search all fields and full text",
  sort: "Sort",
  sortNames: {
    dateModified: "Date modified",
    dateAdded: "Date added",
    title: "Title",
    creator: "Creator",
    date: "Year",
  } as Record<string, string>,
  items: (n: number) => `${n} item${n === 1 ? "" : "s"}`,
  noItems: "No items",
  noResults: "Nothing matches",
  loadMore: "Load more",
  selected: (n: number) => `${n} selected`,
  clearSelection: "Clear selection",
  addToContext: "Add to chat",
  addedToContext: (n: number) => `Added ${n} item${n === 1 ? "" : "s"} to the chat context.`,
  quoteAdded: "Added the passage to the chat context.",
  ask: "Ask",
  askPlaceholder: "Ask about this…",
  askItemsPlaceholder: (n: number) => `Ask about ${n === 1 ? "this item" : `these ${n} items`}…`,
  fromAgent: "From the agent",
  dismiss: "Dismiss",
  // 条目
  pdf: "PDF",
  openPdf: "Open PDF",
  showInZotero: "Show in Zotero",
  abstract: "Abstract",
  info: "Info",
  tags: "Tags",
  attachments: "Attachments",
  notes: "Notes",
  annotations: "Annotations",
  yourAnnotations: "Your annotations",
  agentHighlights: "Agent highlights",
  noAnnotations: "No annotations yet",
  showMore: "Show more",
  showLess: "Show less",
  itemTypes: {
    journalArticle: "Journal article",
    conferencePaper: "Conference paper",
    preprint: "Preprint",
    book: "Book",
    bookSection: "Book chapter",
    thesis: "Thesis",
    report: "Report",
    webpage: "Web page",
    attachment: "Attachment",
    note: "Note",
    manuscript: "Manuscript",
    presentation: "Presentation",
    dataset: "Dataset",
    computerProgram: "Software",
  } as Record<string, string>,
  // 阅读器
  page: "Page",
  pageOf: (page: number, total: number) => `${page} / ${total}`,
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  fitWidth: "Fit width",
  sidebar: "Annotations",
  loadingPdf: (done: number, total: number) => (total > 1 ? `Loading PDF… ${Math.round((done / total) * 100)}%` : "Loading PDF…"),
  pdfError: "The PDF could not be opened",
  quote: "Quote in chat",
  saveToZotero: "Save to Zotero",
  saving: "Saving…",
  saved: "Saved in Zotero",
  remove: "Remove",
  agent: "Agent",
  you: "You",
  waitingApproval: "Approve the request in Zotero to continue…",
  // 对话卡片
  inlineReady: (n: number) => `Connected · ${n} highlight${n === 1 ? "" : "s"} this session`,
  inlineReading: (title: string) => `Reading “${title}”`,
};

export type Strings = typeof en;

const zh: Strings = {
  title: "Zotero",
  connecting: "正在连接…",
  loading: "加载中…",
  retry: "重试",
  back: "返回",
  close: "关闭",
  cancel: "取消",
  send: "发送",
  openPanel: "在侧栏打开",
  open: "打开",
  notRunningTitle: "Zotero 未运行",
  notRunningBody: "请启动 Zotero 桌面应用（7 或更高版本），面板会自动连接。",
  apiDisabledTitle: "请开启 Zotero 本地 API",
  apiDisabledBody: "在 Zotero 中打开“设置 → 高级”，勾选“允许此计算机上的其他应用程序与 Zotero 通信”。",
  errorTitle: "无法与 Zotero 通信",
  checkAgain: "重新检查",
  kit: KIT_ZH,
  setupMessage: messageZh,
  setupTitle: "安装 Zotero",
  updateTitle: "更新 Zotero",
  workingTitle: "正在安装 Zotero",
  openTitle: "打开 Zotero",
  setupLead: `这个面板从本机的 Zotero 桌面程序读取文献库，需要 Zotero ${MIN_ZOTERO} 或更高版本、处于打开状态，并开启本地 API。`,
  updateLead: (version) => `本地 API 需要 Zotero ${MIN_ZOTERO} 或更高版本；这台电脑上是 ${version}。`,
  openLead: "Zotero 已安装但没有运行。它一启动，面板就会连接。",
  apiLead: "Zotero 已打开，但还不允许其他程序读取文献库。只需在 Zotero 自己的设置里勾选一项。",
  workingLead: "Agent 正在对话中安装 Zotero。每满足一项要求，这里会自动更新。",
  errorLead: "Zotero 的应答与预期不符。",
  reqApp: "Zotero 程序",
  reqOpen: "Zotero 已打开",
  reqApi: "本地 API 已开启",
  notIn: (dirs) => `${dirs.join("、")} 中都没有`,
  needsVersion: (version) => `${version} · 需要 ${MIN_ZOTERO} 或更高版本`,
  nothingAnswers: (address) => `${address} 没有应答`,
  checkedOnceOpen: "Zotero 打开后检查",
  refused: "Zotero 拒绝了请求",
  off: "未开启",
  tooOld: "版本过旧",
  failed: "失败",
  openZotero: "打开 Zotero",
  opening: "正在打开…",
  slowStart: "Zotero 启动可能需要几秒钟，这里会等它。",
  handoffInstall: "让 Agent 安装",
  handoffUpdate: "让 Agent 更新",
  installYourself: "自己安装",
  manualHint: ["也可以从 ", " 下载安装包。Zotero 启动后，这里会自动发现。"],
  inZotero: "在 Zotero 中",
  stepOpen: "打开",
  stepPane: ["进入", "高级", "面板。"],
  stepTick: "勾选这一项：",
  prefLabel: "允许此计算机上的其他应用程序与 Zotero 通信",
  menuApp: "Zotero",
  menuEdit: "编辑",
  menuSettings: "设置…",
  apiHint: "Zotero 应答后，这里会自动变绿。",
  setUp: "安装",
  notInstalledTitle: "未安装 Zotero",
  closedTitle: "Zotero 已安装但未打开",
  agentSettingUp: "Agent 正在安装 Zotero",
  myLibrary: "我的文库",
  allItems: "全部条目",
  collections: "分类",
  savedSearches: "已保存的搜索",
  libraries: "文库",
  search: "搜索",
  searchPlaceholder: "标题、作者、年份",
  searchEverything: "同时搜索全文与笔记",
  everythingPlaceholder: "搜索所有字段与全文",
  sort: "排序",
  sortNames: {
    dateModified: "修改日期",
    dateAdded: "添加日期",
    title: "标题",
    creator: "作者",
    date: "年份",
  },
  items: (n) => `${n} 个条目`,
  noItems: "没有条目",
  noResults: "没有匹配的条目",
  loadMore: "加载更多",
  selected: (n) => `已选 ${n} 项`,
  clearSelection: "取消选择",
  addToContext: "加入对话",
  addedToContext: (n) => `已把 ${n} 个条目加入对话上下文。`,
  quoteAdded: "已把这段文字加入对话上下文。",
  ask: "提问",
  askPlaceholder: "就这段内容提问…",
  askItemsPlaceholder: (n) => (n === 1 ? "就这个条目提问…" : `就这 ${n} 个条目提问…`),
  fromAgent: "来自 Agent",
  dismiss: "关闭",
  pdf: "PDF",
  openPdf: "打开 PDF",
  showInZotero: "在 Zotero 中显示",
  abstract: "摘要",
  info: "信息",
  tags: "标签",
  attachments: "附件",
  notes: "笔记",
  annotations: "注释",
  yourAnnotations: "你的注释",
  agentHighlights: "Agent 高亮",
  noAnnotations: "还没有注释",
  showMore: "展开",
  showLess: "收起",
  itemTypes: {
    journalArticle: "期刊文章",
    conferencePaper: "会议论文",
    preprint: "预印本",
    book: "图书",
    bookSection: "图书章节",
    thesis: "学位论文",
    report: "报告",
    webpage: "网页",
    attachment: "附件",
    note: "笔记",
    manuscript: "手稿",
    presentation: "演示文稿",
    dataset: "数据集",
    computerProgram: "软件",
  },
  page: "页",
  pageOf: (page, total) => `${page} / ${total}`,
  zoomIn: "放大",
  zoomOut: "缩小",
  fitWidth: "适应宽度",
  sidebar: "注释",
  loadingPdf: (done, total) => (total > 1 ? `正在加载 PDF… ${Math.round((done / total) * 100)}%` : "正在加载 PDF…"),
  pdfError: "无法打开 PDF",
  quote: "引用到对话",
  saveToZotero: "保存到 Zotero",
  saving: "正在保存…",
  saved: "已保存到 Zotero",
  remove: "移除",
  agent: "Agent",
  you: "你",
  waitingApproval: "请在 Zotero 中批准请求…",
  inlineReady: (n) => `已连接 · 本会话 ${n} 处高亮`,
  inlineReading: (title) => `正在阅读《${title}》`,
};

export function strings(locale: string): Strings {
  return locale.toLowerCase().startsWith("zh") ? zh : en;
}
