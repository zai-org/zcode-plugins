// 编辑器主模块：Vditor 即时渲染（类 Typora）+ Agent 协作的核心数据流。
// - 工具结果（open_document/new_document/…）携带 {document, content} → 打开或刷新
// - 人工编辑 → 防抖自动保存 commit_draft(expectedRevision)
// - Agent 写入/外部修改 → document/{id} 资源订阅通知 + 工具结果 双通道刷新
// - revision 冲突 → 保留草稿，横幅选择 重新加载 / 用草稿覆盖
// vditor-shim 必须最先 import：它安装 Vditor 懒加载路径的离线拦截。
import { waitForEditorStyles } from "./vditor-shim.ts";
import { applyHostTheme, showBootError } from "./boot.ts";
import Vditor from "vditor";
import { DocumentSession } from "./document-session.ts";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/core";
import {
  $,
  client,
  editorHooks,
  isDark,
  lang,
  safeGetValue,
  setStateEditor,
  showConflict,
  state,
  setStatus,
  text,
  type DocumentPayload,
} from "./context.ts";
import { setupDocsMenu, setupDropZone } from "./docs-menu.ts";
import { setupReferenceButton } from "./reference.ts";
import { setupWritingControls, refreshWritingControls } from "./writing-controls.ts";

const applyLocale = () => {
  const labels: Array<[string, string, string]> = [
    ["switch", "打开文件", "Open file"],
    ["save", "重试保存", "Retry save"],
    ["empty-open", "打开文件", "Open file"],
    ["empty-new", "新建文件", "New file"],
    ["empty-title", "从一个想法开始", "Start with an idea"],
    ["import-doc", "导入文件…", "Import file…"],
    ["recent-label", "最近打开", "Recent"],
    ["all-label", "工作区文件", "Workspace files"],
    ["format", "格式", "Format"],
    ["outline", "大纲", "Outline"],
    ["outline-title", "大纲", "Outline"],
    ["outline-empty", "添加标题后，大纲会出现在这里。", "Add headings to see an outline here."],
    ["source", "源码", "Source"],
    ["show-new", "新建文件…", "New file…"],
    ["reference", "添加到对话", "Add to chat"],
    ["reload", "重新加载", "Reload"],
    ["overwrite", "用草稿覆盖", "Overwrite"],
    ["new-doc", "创建", "Create"],
  ];
  for (const [id, zh, en] of labels) $(id).textContent = text(zh, en);
  $("doc-filter").setAttribute("placeholder", text("搜索文件名或路径…", "Search workspace docs…"));
  $("doc-filter").setAttribute("aria-label", text("搜索工作区文件", "Search workspace docs"));
  $("doc-name").setAttribute("aria-label", text("新文件路径", "New document path"));
  $("doc-name").setAttribute("placeholder", text("文件名称.md", "Document name.md"));
  $("drop").textContent = text("松开以导入 Markdown 副本", "Drop to import a Markdown copy");
  document.documentElement.lang = lang() === "en_US" ? "en" : "zh-CN";
  $("docs-empty").textContent = text("没有匹配的文档", "No matching documents");
  $("conflict-message").textContent = text(
    "文件在别处被修改，当前草稿未保存。",
    "The file changed elsewhere; the draft is unsaved.",
  );
  $("empty-description").textContent = text(
    "打开工作区 Markdown，或拖入文件创建副本。",
    "Open a workspace document, or drop a Markdown file to import a copy.",
  );
};

let previousTheme: string | undefined;
const applyTheme = () => {
  applyHostTheme();
  const editor = state.editor as Vditor | null;
  const theme = isDark() ? "dark" : "classic";
  if (editor && previousTheme !== theme) {
    editor.setTheme(theme, isDark() ? "dark" : "light");
    previousTheme = theme;
  }
};

function createEditor(initial: string, onInput: (value: string) => void, onReady?: () => void) {
  const editor = new Vditor("editor", {
    mode: "ir",
    cdn: "/__vditor__",
    lang: lang(),
    icon: "ant",
    height: "100%",
    placeholder: text("开始书写…", "Start writing…"),
    cache: { enable: false },
    counter: { enable: false },
    // 窄面板（手机远控/窄侧栏）不启用大纲，避免固定宽面板挤压正文。
    outline: { enable: false, position: "left" },
    toolbar: [
      "undo",
      "redo",
      "|",
      "headings",
      "bold",
      "italic",
      "strike",
      "|",
      "line",
      "quote",
      "list",
      "ordered-list",
      "check",
      "outdent",
      "indent",
      "|",
      "code",
      "inline-code",
      "link",
      "table",
      "|",
      "edit-mode",
    ],
    preview: {
      mode: "editor",
      math: { engine: "KaTeX" },
      hljs: { style: isDark() ? "github-dark" : "github", lineNumber: true },
    },
    theme: isDark() ? "dark" : "classic",
    value: initial,
    input: onInput,
    after: () => onReady?.(),
  });
  setStateEditor(editor);
}

async function callDocument(name: string, args: Record<string, unknown>): Promise<DocumentPayload> {
  const result = await client.callTool(name, args);
  const payload = result.structuredContent as DocumentPayload | undefined;
  if (result.isError || payload?.error)
    throw payload?.error ?? new Error(text("操作失败，请重试", "Operation failed; retry"));
  return payload ?? {};
}

const session = new DocumentSession(state, {
  call: callDocument,
  read: async (id) => {
    const result = await readDocumentPayload(id);
    if (!result) throw new Error(text("读取失败，草稿已保留", "Read failed; draft kept"));
    return result;
  },
  getText: safeGetValue,
  setText: (content, resetHistory) =>
    (state.editor as Vditor | null)?.setValue(content, resetHistory),
  changed: (phase, message) => {
    showConflict(state.conflict);
    const labels = {
      idle: text("有未保存的更改", "Unsaved changes"),
      saving: text("正在保存…", "Saving…"),
      saved: text("所有更改已保存", "All changes saved"),
      conflict: text("存在冲突 · 草稿已保留", "Conflict · draft kept"),
      error: text("保存失败，草稿已保留", "Save failed; draft kept"),
    };
    setStatus(phase, message ?? labels[phase]);
    $("status").title = message ?? labels[phase];
    $("save").hidden = phase !== "error";
    refreshWritingControls();
    $<HTMLButtonElement>("save").disabled = !state.id || phase === "saving";
    $<HTMLButtonElement>("reload").disabled = phase === "saving";
    $<HTMLButtonElement>("overwrite").disabled = phase === "saving";
  },
  opened: () => {
    $("path").textContent = state.path.split(/[\\/]/).pop() ?? state.path;
    $("path").title = state.path;
    document.title = state.path;
    document.dispatchEvent(new Event("markdown:opened"));
    refreshWritingControls();
    $("empty").hidden = true;
    document.querySelector(".stage")?.classList.remove("no-doc");
    void subscribeDocument(state.id);
    void client.setWidgetState({ docId: state.id, path: state.path }).catch(() => {});
  },
});

async function subscribeDocument(id: string) {
  if (
    state.subscribedFor === id ||
    !client.app.getHostCapabilities()?.experimental?.["zcode/resourceSubscribe"]
  )
    return;
  if (state.subscribedFor && state.subscribedFor !== id) {
    await client
      .request("resources/unsubscribe", { uri: `ui://markdown/document/${state.subscribedFor}` })
      .catch(() => undefined);
  }
  if (state.id !== id) return;
  state.subscribedFor = id;
  client.app.setNotificationHandler(
    ResourceUpdatedNotificationSchema,
    (notification: { params: { uri?: string } }) => {
      if (notification.params?.uri === `ui://markdown/document/${id}`) void session.refresh();
    },
  );
  await client
    .request("resources/subscribe", { uri: `ui://markdown/document/${id}` })
    .catch(() => undefined);
}

async function readDocumentPayload(id: string): Promise<DocumentPayload | null> {
  try {
    const response = await client.readResource(`ui://markdown/document/${id}`);
    const entry = (response.contents ?? [])[0];
    const raw = entry && "text" in entry ? entry.text : undefined;
    return raw ? (JSON.parse(raw) as DocumentPayload) : null;
  } catch {
    return null;
  }
}

/** 冷恢复第一步：按 widgetState 拉取文档 payload（不触碰编辑器）。
 * 内容必须在 Vditor 构造时传入：空初始值不会触发 Lute 预载，
 * 构造后再 setValue 会在 Lute 就绪前调用而静默失败。 */
async function fetchViewStateDocument(): Promise<DocumentPayload | null> {
  const saved = client.widgetState as { docId?: string; path?: string } | null;
  if (saved?.path) {
    try {
      return await callDocument("open_document", { path: saved.path });
    } catch {
      return null;
    }
  }
  return saved?.docId ? readDocumentPayload(saved.docId) : null;
}

let lastOutput: unknown;
function render(payload: unknown) {
  // 主题、输入和 widget-state 通知共享订阅；只有新结果才进入文档流程。
  if (payload === lastOutput) return;
  lastOutput = payload;
  const data = payload as DocumentPayload | null;
  if (data?.document && !data.error) void session.receive(data);
}

// e2e 调试钩子：只读状态快照，生产无副作用。
declare global {
  interface Window {
    __mdDebug?: {
      getState: () => { id: string; revision: number; dirty: boolean };
      getValue: () => string;
    };
  }
}
window.__mdDebug = {
  getState: () => ({ id: state.id, revision: state.revision, dirty: state.dirty }),
  getValue: safeGetValue,
};

async function init() {
  applyTheme();
  applyLocale();
  // 等 shim 的同步资源（图标/第三方语言）预载完成后再实例化 Vditor。
  await window.__mdVditorReady;
  let initialPayload = client.toolOutput as DocumentPayload | null;
  if (!initialPayload?.document) initialPayload = (await fetchViewStateDocument()) ?? null;
  const hasInitial = Boolean(initialPayload?.document);
  $("empty").hidden = hasInitial;
  document.querySelector(".stage")?.classList.toggle("no-doc", !hasInitial);
  let markReady!: () => void;
  state.ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  createEditor(initialPayload?.content ?? "", () => session.edited(), markReady);
  await state.ready;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".vditor-toolbar button")) {
    const label =
      button.getAttribute("aria-label") || button.getAttribute("data-type") || button.title;
    if (label) button.setAttribute("aria-label", label);
  }
  // Vditor 默认在标题中点击 H 会直接取消标题；这里统一打开级别菜单，
  // 保证从 H1 改为 H3 与普通段落使用同一个可预期的入口。
  const headings = document.querySelector<HTMLButtonElement>('[data-type="headings"]');
  for (const event of ["click", "touchstart"])
    headings?.addEventListener(event, () => headings.classList.remove("vditor-menu--current"), {
      capture: true,
    });
  editorHooks.openDocument = (payload) => session.open(async () => payload);
  editorHooks.openPath = (path, create) =>
    session.open(() =>
      callDocument(
        create ? "new_document" : "open_document",
        create ? { path, content: create.content } : { path },
      ),
    );
  setupWritingControls();
  setupReferenceButton();
  setupDropZone();
  setupDocsMenu();
  $("reload").addEventListener("click", () => void session.resolve("reload"));
  $("overwrite").addEventListener("click", () => void session.resolve("overwrite"));
  $("save").addEventListener("click", () => void session.flush());
  $("editor").addEventListener("input", () => session.edited());
  $("editor").addEventListener("compositionstart", () => session.composition(true));
  $("editor").addEventListener("compositionend", () => session.composition(false));
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void session.flush();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty || state.saving) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  if (initialPayload) {
    lastOutput = initialPayload;
    await session.open(async () => initialPayload!);
  }
  client.subscribe(() => {
    applyTheme();
    applyLocale();
    render(client.toolOutput);
  });
  render(client.toolOutput);
  const resize = new ResizeObserver(() => {
    if (client.app.getHostVersion())
      client.notifyIntrinsicHeight(Math.ceil(document.body.getBoundingClientRect().height));
  });
  resize.observe(document.body);
  await waitForEditorStyles();
  document.body.removeAttribute("data-boot");
  $("boot").hidden = true;
}

void init().catch(showBootError);
