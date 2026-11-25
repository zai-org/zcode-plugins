import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, base64ToBytes, call, h, initHost, locale, onHostContext, onToolResult, sendMessage, toast } from "./kit.ts";
import { openPdf, renderPage, type PdfDoc } from "./pdf.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

type FieldType = "text" | "checkbox" | "radio" | "dropdown" | "list" | "signature" | "button";
interface FormField { name: string; label: string; type: FieldType; page: number; rect: [number, number, number, number]; multiline: boolean; maxLength?: number; options?: string[] }
interface FormInfo { pages: { width: number; height: number }[]; fields: FormField[]; hasXfa: boolean }
interface FieldSpec { id: string; kind: "acro" | "box"; name?: string; page?: number; rect?: [number, number, number, number]; source: string; label?: string; required?: boolean; fontSize?: number; minFontSize?: number; multiline?: boolean; align?: "left" | "center" | "right" }
interface Template { version: 1; pdf: string; roster?: string; sheet?: string; fields: FieldSpec[]; output: { dir: string; fileName: string; flatten: boolean; merged: boolean } }
interface Issue { row: number; field: string; kind: string; message: string }
interface Roster { columns: string[]; rowCount: number; sample: Record<string, string>[] }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);

const state: {
  template?: Template;
  templatePath: string;
  info?: FormInfo;
  roster?: Roster | null;
  pdf?: PdfDoc;
  filled?: PdfDoc;
  page: number;
  row: number;
  showFilled: boolean;
  selected?: string;
  drawing: boolean;
  issues: Issue[];
  result?: { files: string[]; merged?: string; report?: string };
  dirty: boolean;
} = { templatePath: "", page: 0, row: 1, showFilled: false, drawing: false, issues: [], dirty: false };

const root = document.getElementById("root")!;

// ---------------------------------------------------------------- 加载

async function openForm(args: Record<string, unknown>) {
  await withBusy(async () => {
    const result = await call<Record<string, unknown>>("form_open", args);
    await load(result);
  });
}

async function load(result: Record<string, unknown>) {
  state.template = result.template as Template;
  state.info = result.info as FormInfo;
  state.roster = result.roster as Roster | null;
  state.templatePath = typeof result.templatePath === "string" ? result.templatePath : state.template.pdf.replace(/\.pdf$/i, "") + ".formfill.json";
  state.page = 0;
  state.row = 1;
  state.issues = [];
  state.result = undefined;
  state.filled = undefined;
  state.showFilled = false;
  state.dirty = false;
  const data = await call<{ pdf: string }>("pdf_data", { path: state.template.pdf });
  state.pdf = await openPdf(base64ToBytes(data.pdf));
  render();
}

async function withBusy<T>(work: () => Promise<T>): Promise<T | undefined> {
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

// ---------------------------------------------------------------- 渲染

function render() {
  applyTheme();
  root.replaceChildren(state.template && state.info ? editor() : picker());
  updateDirty();
  if (state.template) void drawPage();
}

function picker() {
  const pdfSelect = h("select", {}, h("option", { value: "" }, T("选择空白 PDF 表单…", "Choose a blank PDF form…")));
  const rosterSelect = h("select", {}, h("option", { value: "" }, T("选择名单（CSV / XLSX）…", "Choose a roster (CSV / XLSX)…")));
  const templateSelect = h("select", {}, h("option", { value: "" }, T("或打开已保存的模板…", "…or open a saved template")));
  void call<{ files: string[] }>("workspace_files", { exts: [".pdf"] }).then(({ files }) => files.forEach((f) => pdfSelect.append(h("option", { value: f }, f))));
  void call<{ files: string[] }>("workspace_files", { exts: [".csv", ".tsv", ".xlsx"] }).then(({ files }) => files.forEach((f) => rosterSelect.append(h("option", { value: f }, f))));
  void call<{ files: string[] }>("workspace_files", { exts: [".json"] }).then(({ files }) =>
    files.filter((f) => f.endsWith(".formfill.json")).forEach((f) => templateSelect.append(h("option", { value: f }, f))),
  );
  return h(
    "div",
    {},
    h("h1", {}, T("表单批量填写", "PDF Form Batch Fill")),
    h("p", { class: "muted" }, T("放入一份空白 PDF 表单和一张名单，映射一次字段，批量生成每个人的表格，并检查漏填和文字超出。", "Pick a blank PDF form and a roster, map the fields once, then fill one copy per row and check for missing values and overflowing text.")),
    h("div", { class: "card" },
      h("div", { class: "row" }, pdfSelect),
      h("div", { class: "row" }, rosterSelect),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => pdfSelect.value && openForm({ pdf: pdfSelect.value, roster: rosterSelect.value || undefined }) }, T("打开", "Open"))),
    ),
    h("div", { class: "card" }, h("div", { class: "row" }, templateSelect, h("button", { onclick: () => templateSelect.value && openForm({ template: templateSelect.value }) }, T("打开模板", "Open template")))),
  );
}

function fieldInfo(spec: FieldSpec) {
  return spec.kind === "acro" ? state.info!.fields.find((f) => f.name === spec.name) : undefined;
}

function specRect(spec: FieldSpec): { page: number; rect: [number, number, number, number] } | undefined {
  if (spec.kind === "box") return spec.rect && spec.page !== undefined ? { page: spec.page, rect: spec.rect } : undefined;
  const info = fieldInfo(spec);
  return info ? { page: info.page, rect: info.rect } : undefined;
}

function touch() {
  state.dirty = true;
  state.filled = undefined;
  if (state.showFilled) void refreshFilled();
  updateDirty();
}

function updateDirty() {
  const badge = document.getElementById("dirty");
  if (badge) badge.textContent = state.dirty ? T("未保存", "Unsaved") : T("已保存", "Saved");
  badge?.classList.toggle("ok", !state.dirty);
}

function editor() {
  const t = state.template!;
  const columns = state.roster?.columns ?? [];
  const pages = state.info!.pages.length;
  const rows = state.roster?.rowCount ?? 0;

  const toolbar = h("div", { class: "toolbar" },
    h("strong", {}, t.pdf),
    h("span", { class: "muted" }, state.roster ? T(`名单 ${t.roster}：${rows} 行`, `Roster ${t.roster}: ${rows} rows`) : T("还没有名单", "No roster yet")),
    h("span", { class: "spacer" }),
    h("span", { id: "dirty", class: "badge" }),
    h("input", { value: state.templatePath, size: 28, title: T("模板文件路径", "Template file path"), oninput: (e: Event) => (state.templatePath = (e.target as HTMLInputElement).value) }),
    h("button", { onclick: saveTemplate }, T("保存模板", "Save template")),
    h("button", { onclick: () => { state.template = undefined; render(); } }, T("换文件", "Other files")),
  );

  const pageNav = h("div", { class: "row" },
    h("button", { disabled: state.page <= 0, onclick: () => { state.page--; render(); } }, "◀"),
    h("span", {}, T(`第 ${state.page + 1} / ${pages} 页`, `Page ${state.page + 1} / ${pages}`)),
    h("button", { disabled: state.page >= pages - 1, onclick: () => { state.page++; render(); } }, "▶"),
    h("span", { class: "spacer" }),
    h("label", {}, h("input", { type: "checkbox", checked: state.showFilled, disabled: !rows, onchange: (e: Event) => { state.showFilled = (e.target as HTMLInputElement).checked; void refreshFilled(); } }), T("预览填写效果", "Preview filled")),
    h("button", { disabled: state.row <= 1 || !rows, onclick: () => { state.row--; render(); if (state.showFilled) void refreshFilled(); } }, "◀"),
    h("span", {}, T(`第 ${state.row} 行`, `Row ${state.row}`)),
    h("button", { disabled: state.row >= rows, onclick: () => { state.row++; render(); if (state.showFilled) void refreshFilled(); } }, "▶"),
  );

  const stage = h("div", { class: "stage", id: "stage" }, h("canvas", { id: "page" }), h("div", { class: "overlay", id: "overlay" }));
  const drawButton = h("button", { class: state.drawing ? "primary" : "", onclick: () => { state.drawing = !state.drawing; render(); } },
    state.drawing ? T("在页面上拖出文字框…", "Drag on the page…") : T("+ 自由位置文字框", "+ Free text box"));

  const datalist = h("datalist", { id: "columns" }, columns.map((c) => h("option", { value: `{${c}}` })));
  const table = h("table", { class: "data fields" },
    h("tr", {}, h("th", {}, T("字段", "Field")), h("th", {}, T("填入内容", "Value")), h("th", { title: T("必填", "Required") }, T("必填", "Req.")), h("th", {}, T("字号", "Size")), h("th", {})),
    t.fields.map((spec) => fieldRow(spec)),
  );

  const output = h("div", { class: "card" },
    h("h2", {}, T("输出", "Output")),
    h("div", { class: "row" },
      h("label", {}, T("文件夹", "Folder"), h("input", { value: t.output.dir, size: 18, oninput: (e: Event) => { t.output.dir = (e.target as HTMLInputElement).value; touch(); } })),
      h("label", {}, T("文件名", "File name"), h("input", { value: t.output.fileName, size: 24, list: "columns-name", oninput: (e: Event) => { t.output.fileName = (e.target as HTMLInputElement).value; touch(); } })),
    ),
    h("div", { class: "row" },
      h("label", {}, h("input", { type: "checkbox", checked: t.output.flatten, onchange: (e: Event) => { t.output.flatten = (e.target as HTMLInputElement).checked; touch(); } }), T("拼平（不可再改）", "Flatten (not editable)")),
      h("label", {}, h("input", { type: "checkbox", checked: t.output.merged, onchange: (e: Event) => { t.output.merged = (e.target as HTMLInputElement).checked; touch(); } }), T("另存一份合并 PDF", "Also save one merged PDF")),
    ),
    h("div", { class: "row" },
      h("button", { onclick: checkAll, disabled: !rows }, T("检查全部", "Check all rows")),
      h("button", { class: "primary", onclick: generate, disabled: !rows }, T(`生成 ${rows} 份`, `Generate ${rows} files`)),
    ),
  );

  return h("div", {},
    toolbar,
    state.info!.hasXfa ? h("p", { class: "badge" }, T("这是 XFA 表单：生成的文件使用其中的普通表单字段。", "XFA form: the filled copies use its AcroForm fields.")) : null,
    h("div", { class: "split" },
      h("div", {}, pageNav, stage),
      h("div", {},
        h("div", { class: "row" }, h("h2", {}, T(`字段（${t.fields.length}）`, `Fields (${t.fields.length})`)), h("span", { class: "spacer" }), drawButton),
        !state.info!.fields.length ? h("p", { class: "muted" }, T("这份 PDF 没有可填写的表单域：用“自由位置文字框”在页面上拖出要填的位置。", "This PDF has no fillable fields: drag free text boxes onto the page.")) : null,
        datalist,
        h("datalist", { id: "columns-name" }, columns.map((c) => h("option", { value: `{${c}}.pdf` }))),
        h("div", { class: "scroll" }, table),
        output,
        issuesView(),
        resultView(),
      ),
    ),
  );
}

function fieldRow(spec: FieldSpec) {
  const t = state.template!;
  const info = fieldInfo(spec);
  const issues = state.issues.filter((i) => i.field === (spec.label || spec.name || spec.id));
  const type = info?.type ?? "box";
  const hint = info?.options?.length && type !== "checkbox" ? T(`可选：${info.options.join(" / ")}`, `Options: ${info.options.join(" / ")}`) : type === "checkbox" ? T("填 {列} 或 {列}=值；值为 是/√/1/yes 时勾选", "Use {column} or {column}=value; 是/√/1/yes checks it") : "";
  const row = h("tr", { class: state.selected === spec.id ? "selected" : "", onclick: () => select(spec.id) },
    h("td", {},
      h("div", { class: "fname" }, spec.label || info?.label || spec.name || spec.id),
      h("div", { class: "muted small" }, `${type}${spec.kind === "box" ? ` · p${(spec.page ?? 0) + 1}` : ""}`),
      issues.length ? h("span", { class: "badge bad" }, `${issues.length}`) : null,
    ),
    h("td", {},
      h("input", { value: spec.source, list: "columns", placeholder: T("{列名} 或固定文字", "{column} or fixed text"), title: hint, oninput: (e: Event) => { spec.source = (e.target as HTMLInputElement).value; touch(); } }),
      hint ? h("div", { class: "muted small" }, hint) : null,
    ),
    h("td", {}, h("input", { type: "checkbox", checked: !!spec.required, onchange: (e: Event) => { spec.required = (e.target as HTMLInputElement).checked; touch(); } })),
    h("td", {}, type === "checkbox" || type === "radio" ? "" : h("input", { type: "number", min: 4, max: 72, step: 0.5, value: spec.fontSize ?? "", placeholder: T("自动", "auto"), class: "num", oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); spec.fontSize = v > 0 ? v : undefined; touch(); } })),
    h("td", {}, spec.kind === "box" ? h("button", { title: T("删除", "Delete"), onclick: (e: Event) => { e.stopPropagation(); t.fields = t.fields.filter((f) => f !== spec); touch(); render(); } }, "✕") : null),
  );
  row.dataset.id = spec.id;
  return row;
}

function select(id: string) {
  state.selected = id;
  const spec = state.template!.fields.find((f) => f.id === id);
  const where = spec && specRect(spec);
  if (where && where.page !== state.page) {
    state.page = where.page;
    render();
    return;
  }
  document.querySelectorAll(".fields tr.selected, .overlay .box.selected").forEach((el) => el.classList.remove("selected"));
  document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach((el) => el.classList.add("selected"));
  document.querySelector(`.fields tr[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
}

function issuesView() {
  if (!state.issues.length) return null;
  return h("div", { class: "card" },
    h("h2", {}, T(`发现 ${state.issues.length} 个问题`, `${state.issues.length} problem(s)`)),
    h("table", { class: "data" },
      h("tr", {}, h("th", {}, T("行", "Row")), h("th", {}, T("字段", "Field")), h("th", {}, T("问题", "Problem"))),
      state.issues.slice(0, 200).map((issue) =>
        h("tr", { class: "clickable", onclick: () => { if (issue.row) { state.row = issue.row; state.showFilled = true; render(); void refreshFilled(); } } },
          h("td", {}, issue.row || "—"),
          h("td", {}, issue.field),
          h("td", {}, h("span", { class: `badge ${issue.kind === "overflow" || issue.kind === "missing" ? "bad" : ""}` }, kindLabel(issue.kind)), " ", issue.message),
        ),
      ),
    ),
    h("div", { class: "row" }, h("button", { onclick: () => sendMessage(T(`请帮我处理表单批量填写检查出的 ${state.issues.length} 个问题（模板 ${state.templatePath}）：先看 form_check 的结果，再决定改名单、改字号还是改字段映射。`, `Please help me fix the ${state.issues.length} problems found by the form check (template ${state.templatePath}): run form_check, then decide whether to fix the roster, font sizes or the mapping.`)) }, T("交给 Agent 处理", "Ask the agent"))),
  );
}

function kindLabel(kind: string) {
  return ({ missing: T("漏填", "missing"), overflow: T("超出", "overflow"), bad_option: T("选项不符", "bad option"), unknown_field: T("字段不存在", "unknown field"), unknown_column: T("没有这一列", "unknown column") } as Record<string, string>)[kind] ?? kind;
}

function resultView() {
  if (!state.result) return null;
  return h("div", { class: "card" },
    h("h2", {}, T(`已生成 ${state.result.files.length} 份`, `Generated ${state.result.files.length} files`)),
    h("div", { class: "muted" }, `${state.template!.output.dir}/`),
    state.result.merged ? h("div", {}, T("合并文件：", "Merged: "), state.result.merged) : null,
    state.result.report ? h("div", {}, T("检查报告：", "Report: "), state.result.report) : null,
  );
}

// ---------------------------------------------------------------- 页面与覆盖层

let drawToken = 0;
async function drawPage() {
  const token = ++drawToken;
  const canvas = document.getElementById("page") as HTMLCanvasElement | null;
  const stage = document.getElementById("stage");
  const doc = state.showFilled && state.filled ? state.filled : state.pdf;
  if (!canvas || !stage || !doc || !state.info) return;
  const size = state.info.pages[state.page];
  const scale = Math.min(2, Math.max(0.3, (stage.clientWidth || 360) / size.width));
  await renderPage(doc, state.page, canvas, scale);
  if (token !== drawToken) return;
  drawOverlay(scale);
}

function drawOverlay(scale: number) {
  const overlay = document.getElementById("overlay");
  if (!overlay || !state.template) return;
  const size = state.info!.pages[state.page];
  overlay.style.width = `${size.width * scale}px`;
  overlay.style.height = `${size.height * scale}px`;
  overlay.replaceChildren();
  overlay.classList.toggle("drawing", state.drawing);
  for (const spec of state.template.fields) {
    const where = specRect(spec);
    if (!where || where.page !== state.page) continue;
    const [x, y, w, hgt] = where.rect;
    const bad = state.issues.some((i) => i.field === (spec.label || spec.name || spec.id) && (!state.showFilled || i.row === state.row));
    const box = h("div", {
      class: `box ${spec.kind} ${spec.source ? "mapped" : ""} ${bad ? "bad" : ""} ${state.selected === spec.id ? "selected" : ""}`,
      style: { left: `${x * scale}px`, top: `${y * scale}px`, width: `${w * scale}px`, height: `${hgt * scale}px` },
      title: `${spec.label || spec.name}: ${spec.source || "—"}`,
    });
    box.dataset.id = spec.id;
    box.addEventListener("pointerdown", (event) => {
      if (state.drawing) return;
      event.stopPropagation();
      select(spec.id);
      if (spec.kind === "box") startMove(event, spec, box, scale);
    });
    overlay.append(box);
  }
  overlay.onpointerdown = (event) => {
    if (!state.drawing) return;
    startDraw(event, overlay, scale);
  };
}

function startDraw(event: PointerEvent, overlay: HTMLElement, scale: number) {
  const origin = overlay.getBoundingClientRect();
  const x0 = event.clientX - origin.left;
  const y0 = event.clientY - origin.top;
  const ghost = h("div", { class: "box box ghost", style: { left: `${x0}px`, top: `${y0}px` } });
  overlay.append(ghost);
  const move = (e: PointerEvent) => {
    const x1 = e.clientX - origin.left;
    const y1 = e.clientY - origin.top;
    Object.assign(ghost.style, { left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px` });
  };
  const up = (e: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    const x1 = e.clientX - origin.left;
    const y1 = e.clientY - origin.top;
    const w = Math.abs(x1 - x0) / scale;
    const hgt = Math.abs(y1 - y0) / scale;
    ghost.remove();
    if (w < 8 || hgt < 6) return;
    const t = state.template!;
    let n = t.fields.length + 1;
    while (t.fields.some((f) => f.id === `box${n}`)) n++;
    const round = (v: number) => Math.round(v * 10) / 10;
    t.fields.push({ id: `box${n}`, kind: "box", label: T(`文字框 ${n}`, `Box ${n}`), page: state.page, rect: [round(Math.min(x0, x1) / scale), round(Math.min(y0, y1) / scale), round(w), round(hgt)], source: "", multiline: hgt > 30 });
    state.drawing = false;
    state.selected = `box${n}`;
    touch();
    render();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function startMove(event: PointerEvent, spec: FieldSpec, box: HTMLElement, scale: number) {
  const start = { x: event.clientX, y: event.clientY, rect: [...spec.rect!] as [number, number, number, number] };
  const move = (e: PointerEvent) => {
    const dx = (e.clientX - start.x) / scale;
    const dy = (e.clientY - start.y) / scale;
    spec.rect = [Math.round((start.rect[0] + dx) * 10) / 10, Math.round((start.rect[1] + dy) * 10) / 10, start.rect[2], start.rect[3]];
    box.style.left = `${spec.rect[0] * scale}px`;
    box.style.top = `${spec.rect[1] * scale}px`;
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (spec.rect!.some((v, i) => v !== start.rect[i])) touch();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

async function refreshFilled() {
  if (!state.showFilled) {
    void drawPage();
    return;
  }
  const result = await withBusy(() => call<{ pdf: string; issues: Issue[] }>("form_preview", { template: state.template, row: state.row }));
  if (!result) return;
  state.filled = await openPdf(base64ToBytes(result.pdf));
  const others = state.issues.filter((i) => i.row !== state.row);
  state.issues = [...others, ...result.issues].sort((a, b) => a.row - b.row);
  render();
}

// ---------------------------------------------------------------- 操作

async function saveTemplate() {
  const result = await withBusy(() => call<{ path: string; template: Template }>("template_save", { path: state.templatePath, template: state.template }));
  if (!result) return;
  state.templatePath = result.path;
  state.dirty = false;
  updateDirty();
  toast(T(`模板已保存：${result.path}`, `Template saved: ${result.path}`));
}

async function checkAll() {
  const result = await withBusy(() => call<{ issues: Issue[]; total: number }>("form_check", { template: state.template }));
  if (!result) return;
  state.issues = result.issues;
  render();
  toast(result.issues.length ? T(`发现 ${result.issues.length} 个问题`, `${result.issues.length} problem(s)`) : T(`${result.total} 行全部通过`, `All ${result.total} rows passed`), result.issues.length ? "error" : "ok");
}

async function generate() {
  const result = await withBusy(() => call<{ files: string[]; merged?: string; report?: string; issues: Issue[] }>("form_generate", { template: state.template }));
  if (!result) return;
  state.result = result;
  state.issues = result.issues;
  render();
  toast(T(`已生成 ${result.files.length} 份`, `Generated ${result.files.length} files`));
}

// ---------------------------------------------------------------- 启动

onToolResult((value) => {
  if (!value || value.error) return;
  if (value.kind === "form") void withBusy(() => load(value));
  else if (value.kind === "saved" && state.template) {
    state.template = value.template as Template;
    state.templatePath = value.path as string;
    state.dirty = false;
    render();
  } else if (value.kind === "check" && state.template) {
    state.issues = value.issues as Issue[];
    render();
  } else if (value.kind === "generated" && state.template) {
    state.result = value as never;
    state.issues = value.issues as Issue[];
    render();
  }
});
onHostContext(() => applyTheme());
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => void drawPage(), 150);
});
render();
void initHost("pdf-form-batch-fill", "0.1.0").then(() => render());
