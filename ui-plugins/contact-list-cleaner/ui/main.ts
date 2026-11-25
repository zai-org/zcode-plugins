import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

const FIELDS = ["name", "phone", "phone2", "email", "email2", "company", "title", "city", "wechat", "notes"] as const;
type Field = (typeof FIELDS)[number];
const FL: Record<Field | "first" | "last" | "", [string, string]> = { name: ["姓名", "Name"], phone: ["电话", "Phone"], phone2: ["电话2", "Phone 2"], email: ["邮箱", "Email"], email2: ["邮箱2", "Email 2"], company: ["公司", "Company"], title: ["职位", "Title"], city: ["城市", "City"], wechat: ["微信", "WeChat"], notes: ["备注", "Notes"], first: ["名", "First name"], last: ["姓", "Last name"], "": ["（忽略）", "(skip)"] };
interface Issue { field: Field; value: string; problem: string }
interface Contact { id: string; file: string; row: number; values: Record<Field, string>; issues: Issue[] }
interface Result { id: string; auto: boolean; manual: string[]; values: Record<Field, string>; sources: string[]; conflicts: string[]; issues: Issue[] }
interface Pair { id: string; a: string; b: string; reason: string; score: number; decision: "merge" | "keep" | null }
interface Table { file: string; columns: string[]; mapping: Record<string, string>; rows: number; sample: Record<string, string>[] }
interface View { project: { files: { file: string }[]; region: string; output: string }; tables: Table[]; contacts: Contact[]; result: Result[]; pairs: Pair[]; summary: { rows: number; contacts: number; merged: number; removed: number; pending: number; issues: number } }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const L = (x: [string, string]) => (locale() === "zh" ? x[0] : x[1]);
const PROBLEM: Record<string, string> = { "invalid phone": "电话无效", "invalid email": "邮箱无效", "missing name": "缺姓名", "no phone, email or WeChat": "没有电话/邮箱/微信" };
const prob = (p: string) => (locale() === "zh" ? PROBLEM[p] ?? p.replace("country code assumed", "按国家码推断") : p);
const state: { v?: View; files: string[]; picked: Set<string>; tab: "result" | "pairs" | "map" | "log"; q: string } = { files: [], picked: new Set(), tab: "result", q: "" };
const root = document.getElementById("root")!;

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); }
}
function setView(v: View) {
  const first = !state.v;
  state.v = v;
  state.picked = new Set(v.project.files.map((f) => f.file));
  if (first && v.summary.pending) state.tab = "pairs";
  render();
  void updateContext(`Contact cleaner: ${v.summary.rows} rows → ${v.summary.contacts} contacts, ${v.summary.merged} merged, ${v.summary.pending} pairs pending, ${v.summary.issues} problems.`).catch(() => undefined);
}
onToolResult((v) => { if (v?.kind === "contacts") setView(v as unknown as View); if (v?.kind === "exported") toast(T(`已导出 ${(v.files as string[]).join("、")}`, `Exported ${(v.files as string[]).join(", ")}`)); });

const load = async () => { const r = await busy(() => call<View>("contacts_load", { files: [...state.picked] })); if (r) setView(r); };
const decide = async (pair: string, merge: boolean) => { const r = await busy(() => call<View>("contacts_decide", { decisions: [{ pair, merge }] })); if (r) setView(r); };
const remap = async (file: string, col: string, field: string) => { const r = await busy(() => call<View>("contacts_map", { file, mapping: { [col]: field } })); if (r) setView(r); };
const exportAs = async (format: "xlsx" | "csv" | "vcf") => { const r = await busy(() => call<{ files: string[] }>("contacts_export", { format })); if (r) toast(T(`已导出 ${r.files.join("、")}`, `Exported ${r.files.join(", ")}`)); };

function card(c: Contact, other?: Contact) {
  const diff = (f: Field) => other && c.values[f] && other.values[f] && c.values[f] !== other.values[f];
  return h("div", { class: "pcard" }, h("div", { class: "src" }, `${c.file} · ${T("第", "row ")}${c.row}${T(" 行", "")}`),
    ...FIELDS.filter((f) => c.values[f]).map((f) => h("div", { class: `kv${diff(f) ? " diff" : ""}` }, h("span", { class: "k" }, L(FL[f])), h("span", {}, c.values[f]))));
}

function render() {
  applyTheme();
  const v = state.v;
  const picker = h("div", { class: "card files" }, h("b", {}, T("名单文件", "Contact lists")),
    h("div", { class: "flist" }, ...state.files.map((f) => h("label", {}, h("input", { type: "checkbox", checked: state.picked.has(f), onchange: (e: Event) => { (e.target as HTMLInputElement).checked ? state.picked.add(f) : state.picked.delete(f); } }), f))),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: () => void load() }, v ? T("重新整理", "Re-run") : T("开始整理", "Clean up")), v ? h("button", { onclick: () => void exportAs("xlsx") }, T("导出 Excel", "Export Excel")) : null, v ? h("button", { onclick: () => void exportAs("csv") }, "CSV") : null, v ? h("button", { onclick: () => void exportAs("vcf") }, "vCard") : null));
  if (!v) { put(root, picker, h("div", { class: "empty" }, T("勾选要合并的客户名单（Excel / CSV），点“开始整理”。", "Tick the contact lists (Excel / CSV) and press Clean up."))); return; }
  const s = v.summary;
  const stats = h("div", { class: "stats" },
    h("div", {}, h("b", {}, String(s.rows)), T("原始行", "rows")), h("div", {}, h("b", {}, String(s.contacts)), T("整理后联系人", "contacts")),
    h("div", {}, h("b", {}, String(s.merged)), T("组已合并", "merged groups")), h("div", { class: s.pending ? "warn" : "" }, h("b", {}, String(s.pending)), T("对待确认", "pairs to confirm")), h("div", { class: s.issues ? "bad" : "" }, h("b", {}, String(s.issues)), T("个问题值", "problems")));
  const tab = (id: typeof state.tab, text: string) => h("button", { class: `tab${state.tab === id ? " on" : ""}`, onclick: () => { state.tab = id; render(); } }, text);
  const tabs = h("div", { class: "tabs" }, tab("result", T("整理结果", "Result")), tab("pairs", T(`待确认 ${s.pending}`, `To confirm ${s.pending}`)), tab("map", T("字段映射", "Mapping")), tab("log", T("合并日志", "Merge log")));
  const byId = new Map(v.contacts.map((c) => [c.id, c]));
  let body: HTMLElement;
  if (state.tab === "pairs") {
    const pend = v.pairs.filter((p) => !p.decision), done = v.pairs.filter((p) => p.decision);
    body = h("div", {}, pend.length ? null : h("div", { class: "empty" }, T("没有待确认的可能重复。", "No possible duplicates left to confirm.")),
      ...[...pend, ...done].map((p) => h("div", { class: `pair${p.decision ? " decided" : ""}`, "data-pair": p.id },
        h("div", { class: "why" }, h("span", { class: "badge" }, T("可能重复", "Possible duplicate")), " ", reasonText(p.reason), p.decision ? h("span", { class: `badge ${p.decision === "merge" ? "ok" : ""}` }, p.decision === "merge" ? T("已合并", "merged") : T("保留两条", "kept apart")) : null),
        h("div", { class: "two" }, card(byId.get(p.a)!, byId.get(p.b)), card(byId.get(p.b)!, byId.get(p.a))),
        h("div", { class: "row" }, h("button", { class: p.decision === "merge" ? "primary" : "", onclick: () => void decide(p.id, true) }, T("是同一人，合并", "Same person — merge")), h("button", { class: p.decision === "keep" ? "primary" : "", onclick: () => void decide(p.id, false) }, T("不是，保留两条", "Different — keep both"))))));
  } else if (state.tab === "map") {
    body = h("div", {}, ...v.tables.map((t) => h("div", { class: "card" }, h("b", {}, `${t.file} · ${t.rows} ${T("行", "rows")}`),
      h("table", { class: "data" }, h("tr", {}, h("th", {}, T("原列名", "Column")), h("th", {}, T("示例", "Sample")), h("th", {}, T("映射到", "Maps to"))),
        ...t.columns.map((col) => h("tr", {}, h("td", {}, col), h("td", { class: "muted" }, t.sample.map((r) => r[col]).filter(Boolean).slice(0, 2).join(" / ")),
          h("td", {}, h("select", { "data-col": col, onchange: (e: Event) => void remap(t.file, col, (e.target as HTMLSelectElement).value) }, ...(["", ...FIELDS, "first", "last"] as const).map((f) => h("option", { value: f, selected: (t.mapping[col] ?? "") === f }, L(FL[f])))))))))));
  } else if (state.tab === "log") {
    const merged = v.result.filter((r) => r.sources.length > 1);
    body = h("table", { class: "data" }, h("tr", {}, h("th", {}, T("联系人", "Contact")), h("th", {}, T("方式", "How")), h("th", {}, T("来源行", "Rows")), h("th", {}, T("冲突与处理", "Conflicts"))),
      ...merged.map((r) => h("tr", {}, h("td", {}, r.values.name), h("td", {}, r.auto ? T("自动", "auto") : T("用户确认", "confirmed")), h("td", { class: "small" }, r.sources.join("\n")), h("td", { class: "small" }, r.conflicts.join("\n") || "—"))));
  } else {
    const q = state.q.trim().toLowerCase();
    const list = v.result.filter((r) => !q || FIELDS.some((f) => r.values[f].toLowerCase().includes(q)));
    body = h("div", {}, h("input", { class: "search", placeholder: T("搜索", "Search"), value: state.q, oninput: (e: Event) => { state.q = (e.target as HTMLInputElement).value; render(); (document.querySelector(".search") as HTMLInputElement)?.focus(); } }),
      h("div", { class: "scroll" }, h("table", { class: "data result" }, h("tr", {}, ...["name", "phone", "phone2", "email", "email2", "company", "title", "city", "notes"].map((f) => h("th", {}, L(FL[f as Field]))), h("th", {}, T("来源", "Rows"))),
        ...list.map((r) => {
          const bad = new Set(r.issues.map((i) => i.field));
          return h("tr", { class: r.sources.length > 1 ? "merged" : "" }, ...(["name", "phone", "phone2", "email", "email2", "company", "title", "city", "notes"] as Field[]).map((f) => h("td", { class: bad.has(f) ? "bad" : "", title: r.issues.filter((i) => i.field === f).map((i) => prob(i.problem)).join("; ") }, r.values[f])), h("td", { class: "small muted" }, r.sources.length > 1 ? T(`${r.sources.length} 行合并`, `${r.sources.length} rows`) : ""));
        }))));
  }
  put(root, picker, stats, tabs, body);
}
function reasonText(r: string) {
  if (locale() !== "zh") return r;
  return r.replace("same phone, different name", "电话相同但姓名不同").replace("same email, different name", "邮箱相同但姓名不同").replace("same name", "姓名相同").replace("similar name", "姓名相近").replace("same company", "公司相同").replace("same last 8 phone digits", "电话后 8 位相同").replace("same email name", "邮箱用户名相同").replace(/, /g, "，");
}

onHostContext(() => render());
render();
void initHost("contact-list-cleaner", "0.1.0").then(async () => {
  state.files = (await call<{ files: string[] }>("workspace_files").catch(() => ({ files: [] }))).files;
  const st = await call<Record<string, unknown>>("contacts_state").catch(() => undefined);
  if (st?.kind === "contacts") setView(st as unknown as View); else render();
});
