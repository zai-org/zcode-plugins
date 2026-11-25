import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

const TYPES = ["text", "longtext", "number", "money", "date", "email", "phone", "url", "select", "boolean"] as const;
const TYPE_ZH: Record<string, string> = { text: "文本", longtext: "长文本", number: "数字", money: "金额", date: "日期", email: "邮箱", phone: "电话", url: "链接", select: "选项", boolean: "是/否" };
interface Field { column: string; key: string; label: string; type: string; required: boolean; options?: string[]; list: boolean; filter: boolean; search: boolean; hidden?: boolean }
interface Settings { title: string; lang: "zh" | "en"; accent: string; pageSize: number; highlight?: { key: string; op: string; value?: string | number; label: string } }
interface Project { id: string; source: string; out: string; rows?: number; mapping: { fields: Field[]; keyField?: string; titleField?: string }; settings: Settings; builtAt?: string }
interface Issue { row: number; column: string; value: string; message: string }
interface AppView { kind: "app"; project: Project; issues: Issue[]; preview: string; apps: { id: string; title: string; out: string; rows?: number }[]; missing?: boolean }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const root = document.getElementById("root")!;
const st: { files: string[]; source: string; view?: AppView; draft?: Field[]; s?: Settings; hl: { column: string; op: string; value: string; label: string }; fresh?: boolean } = { files: [], source: "", hl: { column: "", op: "<=", value: "", label: "" } };

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message.replace(/^\[\w+\]\s*/, "") : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); }
}
function show(v: AppView, fresh = false) {
  st.view = v; st.fresh = fresh;
  st.draft = v.project.mapping.fields.map((f) => ({ ...f, options: f.options ? [...f.options] : undefined }));
  st.s = { ...v.project.settings };
  const hl = v.project.settings.highlight, hf = hl && v.project.mapping.fields.find((f) => f.key === hl.key);
  st.hl = hl && hf ? { column: hf.column, op: hl.op, value: String(hl.value ?? ""), label: hl.label } : { column: "", op: "<=", value: "", label: "" };
  render();
  void updateContext(`Sheet app “${v.project.settings.title}” (${v.project.id}) from ${v.project.source} → ${v.project.out}: ${v.project.rows} rows, ${v.issues.length} data issues.`).catch(() => undefined);
}
onToolResult((v) => { if (v?.kind === "app") show(v as never, true); });

const create = async () => {
  if (!st.source) { toast(T("请先选择表格", "Choose a spreadsheet first"), "error"); return; }
  const r = await busy(() => call<AppView>("app_new", { source: st.source }));
  if (r) { show(r, true); toast(T(`已生成 ${r.project.out}`, `Wrote ${r.project.out}`)); }
};
const apply = async () => {
  const v = st.view!, p = v.project, s = st.s!;
  const fields = st.draft!.map((f) => ({ column: f.column, label: f.label, type: f.type, required: f.required, list: f.list, filter: f.filter, hidden: !!f.hidden, ...(f.type === "select" ? { options: f.options ?? [] } : {}) }));
  const highlight = st.hl.column ? { column: st.hl.column, op: st.hl.op, label: st.hl.label || T("注意", "Check"), ...(st.hl.op === "empty" ? {} : { value: /^-?\d+(\.\d+)?$/.test(st.hl.value) ? Number(st.hl.value) : st.hl.value }) } : null;
  const r = await busy(() => call<AppView>("app_update", { id: p.id, fields, title: s.title, lang: s.lang, accent: s.accent, pageSize: s.pageSize, highlight }));
  if (r) { show(r, true); toast(T("已更新应用", "App updated")); }
};
const refresh = async () => {
  const r = await busy(() => call<AppView>("app_refresh", { id: st.view!.project.id }));
  if (r) { show(r, true); toast(T("已按最新表格重新生成", "Rebuilt from the latest sheet")); }
};
const open = async (id: string) => { const r = await busy(() => call<AppView>("app_state", { id })); if (r?.kind === "app") show(r); };

function render() {
  applyTheme();
  const pick = h("div", { class: "card" },
    h("div", { class: "row" },
      h("label", { class: "fld grow" }, h("span", { class: "lb" }, T("表格（.xlsx / .csv）", "Spreadsheet (.xlsx / .csv)")),
        h("select", { class: "src", onchange: (e: Event) => { st.source = (e.target as HTMLSelectElement).value; } }, h("option", { value: "" }, T("— 选择 —", "— choose —")), ...st.files.map((f) => h("option", { value: f, selected: f === st.source }, f)))),
      h("button", { class: "primary make", onclick: () => void create() }, T("生成应用", "Make app")),
      st.view && st.view.apps.length > 1 ? h("label", { class: "fld" }, h("span", { class: "lb" }, T("已有应用", "Apps")), h("select", { class: "apps", onchange: (e: Event) => void open((e.target as HTMLSelectElement).value) }, ...st.view.apps.map((a) => h("option", { value: a.id, selected: a.id === st.view!.project.id }, `${a.title} (${a.rows ?? 0})`)))) : null));
  const v = st.view;
  if (!v) { put(root, h("h1", {}, T("表格变应用", "Sheet To App")), pick, h("div", { class: "empty" }, T("选一个 Excel 或 CSV 表格（第一行是表头），生成一个可以搜索、筛选、增删改、导入导出的网页应用。一个 HTML 文件，双击就能用，数据存在本机浏览器里。", "Pick an Excel or CSV sheet (first row = headers) to get a web app with search, filters, add/edit/delete and CSV import/export — one HTML file that opens by double-click; data stays in the browser."))); return; }
  const p = v.project, s = st.s!, d = st.draft!;
  const cb = (f: Field, k: "required" | "list" | "filter" | "hidden") => h("td", { class: "c" }, h("input", { type: "checkbox", "data-k": k, checked: !!f[k], onchange: (e: Event) => { f[k] = (e.target as HTMLInputElement).checked; if (k === "hidden") render(); } }));
  const map = h("div", { class: "card" }, h("b", {}, T(`字段（${d.length}）`, `Fields (${d.length})`)),
    h("table", { class: "map" }, h("tr", {}, h("th", {}, T("列", "Column")), h("th", {}, T("显示名", "Label")), h("th", {}, T("类型", "Type")), h("th", {}, T("必填", "Req.")), h("th", {}, T("列表", "List")), h("th", {}, T("筛选", "Filter")), h("th", {}, T("隐藏", "Hide"))),
      ...d.map((f) => h("tr", { class: f.hidden ? "hid" : "", "data-col": f.column },
        h("td", { class: "col" }, f.column, f.key === p.mapping.keyField ? h("span", { class: "hint" }, T(" · 唯一", " · key")) : null),
        h("td", {}, h("input", { type: "text", value: f.label, oninput: (e: Event) => { f.label = (e.target as HTMLInputElement).value; } }),
          f.type === "select" ? h("div", { class: "opts", title: (f.options ?? []).join(", ") }, h("input", { type: "text", class: "optin", value: (f.options ?? []).join(", "), placeholder: T("选项，用逗号分隔", "options, comma-separated"), oninput: (e: Event) => { f.options = (e.target as HTMLInputElement).value.split(/[,，]/).map((x) => x.trim()).filter(Boolean); } })) : null),
        h("td", {}, h("select", { class: "ty", onchange: (e: Event) => { f.type = (e.target as HTMLSelectElement).value; if (f.type === "select" && !f.options) f.options = []; render(); } }, ...TYPES.map((t) => h("option", { value: t, selected: t === f.type }, locale() === "zh" ? TYPE_ZH[t] : t)))),
        cb(f, "required"), cb(f, "list"), cb(f, "filter"), cb(f, "hidden")))));
  const nums = d.filter((f) => !f.hidden);
  const settings = h("div", { class: "card" }, h("b", {}, T("应用设置", "App settings")),
    h("div", { class: "cols" },
      h("label", { class: "fld" }, h("span", { class: "lb" }, T("标题", "Title")), h("input", { class: "title", value: s.title, oninput: (e: Event) => { s.title = (e.target as HTMLInputElement).value; } })),
      h("label", { class: "fld" }, h("span", { class: "lb" }, T("界面语言", "Language")), h("select", { onchange: (e: Event) => { s.lang = (e.target as HTMLSelectElement).value as "zh" | "en"; } }, h("option", { value: "zh", selected: s.lang === "zh" }, "中文"), h("option", { value: "en", selected: s.lang === "en" }, "English"))),
      h("label", { class: "fld" }, h("span", { class: "lb" }, T("主题色", "Accent")), h("input", { type: "color", value: s.accent, oninput: (e: Event) => { s.accent = (e.target as HTMLInputElement).value; } })),
      h("label", { class: "fld" }, h("span", { class: "lb" }, T("每页行数", "Rows per page")), h("input", { type: "number", min: "5", max: "200", value: String(s.pageSize), oninput: (e: Event) => { s.pageSize = Number((e.target as HTMLInputElement).value) || 20; } }))),
    h("div", { class: "hl", style: "margin-top:8px" }, h("span", { class: "lb" }, T("高亮规则：", "Highlight rows: ")),
      h("select", { class: "hlcol", onchange: (e: Event) => { st.hl.column = (e.target as HTMLSelectElement).value; } }, h("option", { value: "" }, T("（不高亮）", "(none)")), ...nums.map((f) => h("option", { value: f.column, selected: f.column === st.hl.column }, f.label))),
      h("select", { class: "hlop", onchange: (e: Event) => { st.hl.op = (e.target as HTMLSelectElement).value; } }, ...[["<=", "≤"], [">=", "≥"], ["=", "="], ["empty", T("为空", "is empty")]].map(([o, l]) => h("option", { value: o, selected: o === st.hl.op }, l))),
      h("input", { class: "hlval", style: "width:80px", value: st.hl.value, placeholder: "5", oninput: (e: Event) => { st.hl.value = (e.target as HTMLInputElement).value; } }),
      h("input", { class: "hllab", style: "width:120px", value: st.hl.label, placeholder: T("标签，如 库存不足", "label, e.g. Low stock"), oninput: (e: Event) => { st.hl.label = (e.target as HTMLInputElement).value; } })),
    h("div", { class: "row", style: "margin-top:10px" }, h("button", { class: "refresh", onclick: () => void refresh() }, T("表格改了，重新读取", "Sheet changed — refresh")), h("span", { class: "grow" }), h("button", { class: "primary apply", onclick: () => void apply() }, T("应用修改并重新生成", "Apply & rebuild"))));
  const issues = h("div", { class: "card" }, h("b", {}, T(`表格里的数据问题（${v.issues.length}）`, `Data issues in the sheet (${v.issues.length})`)),
    v.issues.length ? h("div", { class: "issues" }, ...v.issues.map((i) => h("div", { class: "issue" }, T(`第 ${i.row} 行 · `, `Row ${i.row} · `), h("b", {}, i.column), ` “${i.value}” — ${msg(i.message)}`))) : h("div", { class: "ok" }, T("没有发现问题。", "No problems found.")),
    h("div", { class: "hint" }, T("这些行仍会导入应用，并在表格里标红，打开记录可直接改正。", "These rows are still imported and shown in red in the app; open a record to fix it.")));
  const done = h("div", { class: "done" }, T(`${st.fresh ? "已生成" : "应用文件"} ${p.out}（${p.rows} 行，来自 ${p.source}）。用浏览器打开这个文件即可使用；修改保存在打开它的浏览器里。以后需要可以把 ${p.out.replace(/index\.html$/, "")} 文件夹上传到 Cloudflare Pages 等静态托管。`, `${st.fresh ? "Wrote" : "App file"} ${p.out} (${p.rows} rows from ${p.source}). Open it in a browser to use it; edits are saved in that browser. Later you can upload the ${p.out.replace(/index\.html$/, "")} folder to a static host such as Cloudflare Pages.`));
  const preview = h("div", { class: "card" }, h("b", {}, T("预览（静态，前 15 行）", "Preview (static, first 15 rows)")), h("iframe", { class: "pv", sandbox: "", srcdoc: v.preview, title: "preview" }));
  put(root, pick, done, h("div", { class: "split" }, h("div", {}, map, settings, issues), preview));
}
function msg(m: string) {
  if (locale() !== "zh") return m;
  return m.replace("required", "必填但为空").replace("not a number", "不是数字").replace(/not a date.*/, "不是日期（应为 年-月-日）").replace("not an email address", "邮箱格式不对").replace("not a phone number", "不是电话号码").replace("not a http(s) URL", "不是 http(s) 链接").replace("not yes/no", "不是 是/否").replace(/not one of the options \((.*)\)/, "不在选项里（$1）").replace(/duplicate key \(also row (\d+)\)/, "重复（第 $1 行也是）").replace("missing key", "缺少唯一编号");
}

onHostContext(() => render());
render();
void initHost("sheet-to-app", "0.1.0").then(async () => {
  st.files = (await call<{ files: string[] }>("app_sheets").catch(() => ({ files: [] }))).files;
  if (st.files.length === 1) st.source = st.files[0];
  const s = await call<Record<string, unknown>>("app_state").catch(() => undefined);
  if (s?.kind === "app") { st.source = (s as unknown as AppView).project.source; show(s as never); } else render();
});
