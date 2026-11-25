import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, base64ToBytes, call, h, initHost, locale, onHostContext, onToolResult, sendMessage, toast } from "./kit.ts";
import { openPdf, renderPage, type PdfDoc } from "./pdf.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Style { title: string; subtitle: string; logo?: string; primary: string; grid: string; currency: string; footer: string; cover: boolean; showSku: boolean; categoryOrder: string }
interface Project { version: 1; table: string; sheet?: string; imageDir: string; mapping: Record<string, string>; style: Style; outputDir: string }
const FIELDS: [string, string, string][] = [["sku", "编号", "SKU"], ["name", "名称", "Name"], ["spec", "规格", "Spec"], ["desc", "描述", "Description"], ["price", "价格", "Price"], ["originalPrice", "原价", "Original price"], ["image", "图片文件", "Image file"], ["category", "分类", "Category"], ["unit", "单位", "Unit"]];

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const state: { project?: Project; projectPath: string; columns: string[]; problems: string[]; pages: number; files?: { tables: string[]; images: string[]; dirs: string[] }; doc?: PdfDoc; built?: { files: string[]; changes: any; problems: string[] } } = { projectPath: "catalog.catalogmaker.json", columns: [], problems: [], pages: 0 };
const root = document.getElementById("root")!;

async function busy<T>(work: () => Promise<T>): Promise<T | undefined> {
  root.classList.add("busy");
  try {
    return await work();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
    return undefined;
  } finally {
    root.classList.remove("busy");
  }
}

async function loadFiles() {
  if (state.files) return;
  state.files = await call<{ tables: string[]; images: string[]; dirs: string[] }>("workspace_files").catch(() => ({ tables: [], images: [], dirs: [] }));
  render();
}

function load(value: Record<string, unknown>) {
  state.project = value.project as Project;
  state.columns = (value.columns as string[]) ?? [];
  state.problems = (value.problems as string[]) ?? [];
  state.pages = Number(value.pages ?? 0);
  if (typeof value.projectPath === "string") state.projectPath = value.projectPath;
  state.built = undefined;
  render();
  void refresh();
}

let generation = 0;
async function refresh() {
  const token = ++generation;
  const project = state.project;
  if (!project) return;
  const box = document.getElementById("pages");
  box?.classList.add("busy");
  try {
    const result = await call<{ pdf: string; pages: number; problems: string[] }>("catalog_preview", { project }, 300_000);
    if (token !== generation) return;
    state.problems = result.problems;
    state.pages = result.pages;
    state.doc = await openPdf(base64ToBytes(result.pdf));
    renderProblems();
    const target = document.getElementById("pages");
    if (!target) return;
    target.replaceChildren();
    for (let i = 0; i < state.doc.numPages; i++) {
      if (token !== generation) return;
      const canvas = document.createElement("canvas");
      target.append(h("div", {}, canvas, h("div", { class: "pg" }, `${i + 1} / ${state.doc.numPages}`)));
      await renderPage(state.doc, i, canvas, 0.38);
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  } finally {
    document.getElementById("pages")?.classList.remove("busy");
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
const changed = () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => void refresh(), 600);
};

function render() {
  applyTheme();
  root.replaceChildren(state.project ? editor() : start());
}

function select(options: string[], value: string | undefined, onChange: (v: string) => void, empty?: string) {
  return h("select", { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
    ...(empty !== undefined ? [h("option", { value: "" }, empty)] : []),
    ...[...new Set([...(value ? [value] : []), ...options])].map((o) => h("option", { value: o, selected: o === value }, o)));
}

function start() {
  void loadFiles();
  const draft: Record<string, string> = {};
  return h("div", {},
    h("h1", {}, T("商品目录制作", "Product Catalog Maker")),
    h("p", { class: "muted" }, T("用商品表格和图片一键生成 A4 产品目录 PDF（文字可搜索）和可编辑的网页版；改价后重新生成会列出变更清单。", "Turn a product spreadsheet and photos into an A4 catalog PDF (searchable text) and an editable web version; rebuilds list what changed.")),
    h("div", { class: "card controls" },
      h("label", {}, T("商品表格", "Product table"), select(state.files?.tables ?? [], undefined, (v) => (draft.table = v), "…")),
      h("label", {}, T("图片文件夹", "Image folder"), select(state.files?.dirs ?? [], undefined, (v) => (draft.imageDir = v), T("（与表格同目录）", "(table's folder)"))),
      h("label", {}, T("目录标题", "Title"), h("input", { type: "text", oninput: (e: Event) => (draft.title = (e.target as HTMLInputElement).value) })),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => draft.table && open({ table: draft.table, ...(draft.imageDir ? { imageDir: draft.imageDir } : {}), ...(draft.title ? { style: { title: draft.title } } : {}) }) }, T("开始", "Start"))),
    ),
  );
}

async function open(args: Record<string, unknown>) {
  const result = await busy(() => call<Record<string, unknown>>("catalog_open", args, 300_000));
  if (result) load(result);
}

function renderProblems() {
  const box = document.getElementById("problems");
  if (!box) return;
  box.replaceChildren(...(state.problems.length ? state.problems.map((p) => h("div", {}, "⚠ ", p)) : [h("span", { class: "badge ok" }, T("没有发现问题", "No problems found"))]));
  const count = document.getElementById("pagecount");
  if (count) count.textContent = T(`共 ${state.pages} 页`, `${state.pages} pages`);
}

function editor() {
  const project = state.project!;
  const s = project.style;
  void loadFiles();
  const set = (patch: Partial<Style>) => { Object.assign(s, patch); changed(); };
  const text = (label: string, key: "title" | "subtitle" | "footer" | "currency") => h("label", {}, label, h("input", { type: "text", value: s[key], oninput: (e: Event) => set({ [key]: (e.target as HTMLInputElement).value }) }));
  return h("div", {},
    h("div", { class: "toolbar" },
      h("strong", {}, project.table), h("span", { id: "pagecount", class: "muted" }, T(`共 ${state.pages} 页`, `${state.pages} pages`)),
      h("span", { class: "spacer" }),
      h("label", {}, T("输出到", "Output"), h("input", { value: project.outputDir, size: 12, oninput: (e: Event) => (project.outputDir = (e.target as HTMLInputElement).value) })),
      h("input", { value: state.projectPath, size: 24, oninput: (e: Event) => (state.projectPath = (e.target as HTMLInputElement).value) }),
      h("button", { onclick: save }, T("保存项目", "Save project")),
      h("button", { class: "primary", onclick: build }, T("生成目录", "Build catalog")),
    ),
    h("div", { class: "layout" },
      h("div", { class: "side" },
        h("div", { class: "card controls" }, h("h2", {}, T("样式", "Style")),
          text(T("标题", "Title"), "title"), text(T("副标题", "Subtitle"), "subtitle"), text(T("页脚", "Footer"), "footer"), text(T("货币符号", "Currency"), "currency"),
          h("label", {}, "Logo", select(state.files?.images ?? [], s.logo, (v) => set({ logo: v || undefined }), T("（无）", "(none)"))),
          h("label", {}, h("input", { type: "color", value: s.primary, oninput: (e: Event) => set({ primary: (e.target as HTMLInputElement).value }) }), T("主色", "Colour")),
          h("label", {}, T("每页", "Per page"), select(["2x2", "2x3", "3x3", "3x4"], s.grid, (v) => set({ grid: v }))),
          h("label", {}, h("input", { type: "checkbox", checked: s.cover, onchange: (e: Event) => set({ cover: (e.target as HTMLInputElement).checked }) }), T("封面和目录页", "Cover with contents")),
          h("label", {}, h("input", { type: "checkbox", checked: s.showSku, onchange: (e: Event) => set({ showSku: (e.target as HTMLInputElement).checked }) }), T("显示编号", "Show SKU")),
          h("label", {}, h("input", { type: "checkbox", checked: s.categoryOrder === "name", onchange: (e: Event) => set({ categoryOrder: (e.target as HTMLInputElement).checked ? "name" : "table" }) }), T("分类按名称排序", "Sort categories by name")),
        ),
        h("div", { class: "card controls" }, h("h2", {}, T("表格列", "Columns")),
          ...FIELDS.map(([field, zh, en]) => h("label", {}, locale() === "zh" ? zh : en, select(state.columns, project.mapping[field], (v) => { if (v) project.mapping[field] = v; else delete project.mapping[field]; changed(); }, "—"))),
          h("label", {}, T("图片文件夹", "Images"), select(state.files?.dirs ?? [], project.imageDir, (v) => { project.imageDir = v || project.imageDir; changed(); })),
        ),
      ),
      h("div", { class: "main" },
        h("div", { class: "card" }, h("h2", {}, T("需要检查", "Check")), h("div", { id: "problems", class: "problems" }),
          h("div", { class: "row" }, h("button", { onclick: () => sendMessage(T(`商品目录有这些问题，请帮我看看怎么处理：\n${state.problems.join("\n")}`, `The catalog has these problems, please help:\n${state.problems.join("\n")}`)) }, T("交给 Agent", "Ask the agent")))),
        state.built ? h("div", { class: "card" },
          h("h2", {}, T("已生成", "Built")), ...state.built.files.map((f) => h("div", { class: "small" }, f)),
          state.built.changes ? h("div", {}, T(`变更：新增 ${state.built.changes.added.length}，下架 ${state.built.changes.removed.length}，修改 ${state.built.changes.changed.length}`, `Changes: ${state.built.changes.added.length} added, ${state.built.changes.removed.length} removed, ${state.built.changes.changed.length} changed`)) : null) : null,
        h("div", { id: "pages", class: "pages" }),
      ),
    ),
  );
}

async function save() {
  const result = await busy(() => call<{ path: string }>("project_save", { path: state.projectPath, project: state.project }));
  if (result) {
    state.projectPath = result.path;
    toast(T(`已保存 ${result.path}`, `Saved ${result.path}`));
  }
}

async function build() {
  const result = await busy(() => call<{ files: string[]; changes: unknown; problems: string[] }>("catalog_build", { project: state.project }, 900_000));
  if (result) {
    state.built = result;
    render();
    renderProblems();
    void refresh();
    toast(T("目录已生成", "Catalog built"));
  }
}

onToolResult((value) => {
  if (!value || value.error) return;
  if (value.kind === "project") load(value);
  else if (value.kind === "built" && state.project) {
    state.built = value as never;
    render();
    void refresh();
  } else if (value.kind === "saved" && state.project) state.projectPath = value.path as string;
});
onHostContext(() => applyTheme());
render();
void initHost("product-catalog-maker", "0.1.0").then(() => render());
