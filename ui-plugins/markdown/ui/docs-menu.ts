// 文档菜单与导入共用 openPath；切换前保存由 DocumentSession 统一仲裁。
import { $, client, openPath, state, text, setStatus } from "./context.ts";
const docsState = {
  all: [] as string[],
  recent: [] as string[],
  loaded: false,
  busy: false,
  request: 0,
};
function hideMenu() {
  $("docs").hidden = true;
  $("switch").setAttribute("aria-expanded", "false");
}
function showMenu(create = false) {
  document.dispatchEvent(new Event("markdown:dismiss"));
  $("new-form").hidden = !create;
  $("show-new").setAttribute("aria-expanded", String(create));
  $("docs").hidden = false;
  $("switch").setAttribute("aria-expanded", "true");
  $<HTMLInputElement>("doc-filter").value = "";
  renderDocsMenu();
  $(create ? "doc-name" : "doc-filter").focus();
  void refreshDocsData();
}
export function setupDocsMenu() {
  const menu = $("docs");
  $("switch").addEventListener("click", () => (menu.hidden ? showMenu() : hideMenu()));
  $("empty-open").addEventListener("click", () => showMenu());
  $("empty-new").addEventListener("click", () => showMenu(true));
  $("show-new").addEventListener("click", () => {
    const expanded = $("new-form").hidden;
    $("new-form").hidden = !expanded;
    $("show-new").setAttribute("aria-expanded", String(expanded));
    if (expanded) $("doc-name").focus();
  });
  document.addEventListener("markdown:opened", hideMenu);
  $("doc-filter").addEventListener("input", renderDocsMenu);
  $("new-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void createDocument();
  });
  $("import-doc").addEventListener("click", () => $<HTMLInputElement>("import-files").click());
  $("import-files").addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    void acceptFiles([...(input.files ?? [])]);
    input.value = "";
  });
  document.addEventListener("pointerdown", (event) => {
    if (
      !menu.hidden &&
      !menu.contains(event.target as Node) &&
      !$("switch").contains(event.target as Node)
    )
      hideMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (menu.hidden) return;
    if (event.key === "Escape") {
      hideMenu();
      $("switch").focus();
    }
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    const items = [...menu.querySelectorAll<HTMLButtonElement>(".section:not([hidden]) button")];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const filtering = document.activeElement === $("doc-filter");
    if (!filtering && index < 0) return;
    if (event.key === "Enter" && filtering && items[0]) {
      event.preventDefault();
      items[0].click();
    } else if (event.key !== "Enter" && items.length) {
      event.preventDefault();
      const next = filtering
        ? event.key === "ArrowDown"
          ? 0
          : items.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  });
}
async function refreshDocsData() {
  const request = ++docsState.request;
  docsState.loaded = false;
  $("docs-feedback").textContent = text("正在读取文件…", "Loading documents…");
  try {
    const [status, list] = await Promise.all([
      client.callTool("get_status", {}),
      client.callTool("list_documents", {}),
    ]);
    if (request !== docsState.request) return false;
    if (status.isError || list.isError) throw new Error("list failed");
    docsState.recent = (
      (status.structuredContent as { recent?: { path: string }[] })?.recent ?? []
    ).map((x) => x.path);
    docsState.all = ((list.structuredContent as { files?: { path: string }[] })?.files ?? []).map(
      (x) => x.path,
    );
    docsState.loaded = true;
    $("docs-feedback").textContent = "";
    renderDocsMenu();
    return true;
  } catch {
    $("docs-feedback").textContent = text(
      "文件列表读取失败，请重新打开菜单重试。",
      "Could not load documents. Reopen this menu to retry.",
    );
    return false;
  }
}
function renderDocsMenu() {
  const query = $<HTMLInputElement>("doc-filter").value.trim().toLowerCase();
  const matches = (path: string) => !query || path.toLowerCase().includes(query);
  const render = (paths: string[]) =>
    paths.map((path) => {
      const item = document.createElement("button");
      item.type = "button";
      item.dataset.path = path;
      item.title = path;
      if (path === state.path) {
        item.classList.add("current");
        item.setAttribute("aria-current", "page");
      }
      item.textContent = path;
      item.addEventListener(
        "click",
        () =>
          void openPath(path).then((ok) => {
            if (ok) hideMenu();
          }),
      );
      return item;
    });
  const recent = docsState.recent.filter(matches).slice(0, 6);
  const all = docsState.all.filter((path) => !recent.includes(path) && matches(path));
  $("recent-list").replaceChildren(...render(recent));
  $("all-list").replaceChildren(...render(all));
  $("recent-section").hidden = !recent.length;
  $("all-section").hidden = !all.length;
  $("docs-empty").hidden = !docsState.loaded || Boolean(recent.length + all.length);
  $("docs-empty").textContent = query
    ? text("没有匹配的文件", "No matching documents")
    : text(
        "还没有文档，新建或导入一份开始写作。",
        "No documents yet. Create or import one to start.",
      );
}
function availableName(path: string, existing: Set<string>) {
  if (!existing.has(path)) return path;
  const dot = path.lastIndexOf(".");
  const stem = path.slice(0, dot);
  const ext = path.slice(dot);
  for (let i = 1; ; i++) {
    const name = `${stem}-${i}${ext}`;
    if (!existing.has(name)) return name;
  }
}
async function createDocument() {
  if (docsState.busy) return;
  docsState.busy = true;
  $<HTMLButtonElement>("new-doc").disabled = true;
  try {
    const entered = $<HTMLInputElement>("doc-name").value.trim();
    let name = entered || `${text("未命名", "untitled")}.md`;
    if (!/\.(md|markdown)$/i.test(name)) name += ".md";
    if (!entered && (await refreshDocsData())) name = availableName(name, new Set(docsState.all));
    if (await openPath(name, { content: "" })) {
      hideMenu();
      $<HTMLInputElement>("doc-name").value = "";
    }
  } finally {
    docsState.busy = false;
    $<HTMLButtonElement>("new-doc").disabled = false;
  }
}
export function setupDropZone() {
  const overlay = $("drop");
  let depth = 0;
  document.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    depth += 1;
    overlay.hidden = false;
  });
  document.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  document.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  document.addEventListener(
    "drop",
    (event) => {
      depth = 0;
      overlay.hidden = true;
      const files = [...(event.dataTransfer?.files ?? [])];
      if (!files.length) return;
      event.preventDefault();
      // 在编辑器之前接管文件拖入，避免 Vditor 同时把文件插进旧文档。
      event.stopPropagation();
      void acceptFiles(files);
    },
    { capture: true },
  );
}
async function acceptFiles(files: File[]) {
  if (docsState.busy) return;
  docsState.busy = true;
  try {
    if (files.some((file) => !/\.(md|markdown)$/i.test(file.name)))
      throw new Error(
        text("仅支持 .md / .markdown 文件", "Only .md / .markdown files are supported"),
      );
    if (!(await refreshDocsData()))
      throw new Error(
        text("无法检查重名文件，请稍后重试", "Could not check existing files; retry later"),
      );
    const existing = new Set(docsState.all);
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024)
        throw new Error(text("文件超过 5 MiB 限制", "File exceeds the 5 MiB limit"));
      // 导入明确创建副本；同名时编号，不能忽略拖入内容而打开无关的工作区文件。
      const name = availableName(file.name.split(/[\\/]/).pop() ?? file.name, existing);
      if (!(await openPath(name, { content: await file.text() }))) break;
      existing.add(name);
      hideMenu();
    }
  } catch (error) {
    setStatus("error", (error as Error).message);
  } finally {
    docsState.busy = false;
  }
}
