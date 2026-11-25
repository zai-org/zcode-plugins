import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

type Op = "read" | "create" | "update" | "delete";
const OPS: Op[] = ["read", "create", "update", "delete"];
interface Column { name: string; type: string; kind: string; notNull: boolean; default: string | null; pk: number; unique: boolean; auto: boolean; fk?: { table: string; column: string }; options?: string[] }
interface Table { name: string; type: "table" | "view"; pk: string[]; columns: Column[]; rows: number; refs: { table: string; column: string }[] }
interface TablePlan { name: string; label: string; ops: Op[]; list: string[]; search: string[]; hidden: string[]; labelColumn: string }
interface Plan { title: string; lang: "zh" | "en"; db: string; out: string; port: number; pageSize: number; roles: Record<"admin" | "editor" | "viewer", Op[]>; tables: TablePlan[] }
interface Check { name: string; ok: boolean; detail?: string }
interface Test { ok: boolean; passed: number; failed: number; checks: Check[]; ms: number }
interface View { kind: "plan"; plan: Plan; tables: Table[]; saved: { generatedAt?: string; test?: Test } | null; files?: string[] }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const OPN: Record<Op, [string, string]> = { read: ["查", "Read"], create: ["增", "Create"], update: ["改", "Update"], delete: ["删", "Delete"] };
const root = document.getElementById("root")!;
const st: { files: string[]; db: string; v?: View; plan?: Plan } = { files: [], db: "" };

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message.replace(/^\[\w+\]\s*/, "") : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); }
}
function show(v: View) {
  st.v = v; st.plan = structuredClone(v.plan); st.db = v.plan.db;
  if (v.files) st.files = v.files;
  render();
  const t = v.saved?.test;
  void updateContext(`DB admin for ${v.plan.db} → ${v.plan.out}/: ${v.plan.tables.filter((x) => x.ops.length).length} tables${t ? `; self-test ${t.passed}/${t.passed + t.failed} passed` : ""}.`).catch(() => undefined);
}
onToolResult((v) => { if (v?.kind === "plan") show(v as never); if (v?.kind === "test" && st.v) { st.v.saved = { ...(st.v.saved ?? {}), test: (v as { test: Test }).test }; render(); } });

const inspectDb = async () => { if (!st.db) { toast(T("请先选择数据库文件", "Choose a database file first"), "error"); return; } const r = await busy(() => call<View>("db_inspect", { db: st.db })); if (r) show(r); };
const generate = async () => {
  const p = st.plan!;
  const r = await busy(() => call<View>("db_generate", { db: p.db, out: p.out, title: p.title, lang: p.lang, port: p.port, roles: { editor: p.roles.editor, viewer: p.roles.viewer }, tables: p.tables.map((t) => ({ name: t.name, label: t.label, ops: t.ops, labelColumn: t.labelColumn, hidden: t.hidden })) }, 200_000));
  if (r) { show(r); const t = r.saved?.test; toast(t ? (t.ok ? T(`已生成，自测 ${t.passed} 项全部通过`, `Generated; all ${t.passed} checks passed`) : T(`已生成，自测有 ${t.failed} 项失败`, `Generated; ${t.failed} check(s) failed`)) : T("已生成", "Generated"), t && !t.ok ? "error" : "ok"); }
};
const retest = async () => { const r = await busy(() => call<{ test: Test }>("db_selftest", { out: st.plan!.out })); if (r && st.v) { st.v.saved = { ...(st.v.saved ?? {}), test: r.test }; render(); } };

function render() {
  applyTheme();
  const pick = h("div", { class: "card" }, h("div", { class: "row" },
    h("label", { class: "fld grow" }, h("span", { class: "lb" }, T("SQLite 数据库文件", "SQLite database file")),
      h("select", { class: "db", onchange: (e: Event) => { st.db = (e.target as HTMLSelectElement).value; } }, h("option", { value: "" }, T("— 选择 —", "— choose —")), ...st.files.map((f) => h("option", { value: f, selected: f === st.db }, f)))),
    h("button", { class: "inspect", onclick: () => void inspectDb() }, T("读取结构", "Read schema"))));
  const v = st.v, p = st.plan;
  if (!v || !p) { put(root, h("h1", {}, T("数据库转管理后台", "DB Admin Generator")), pick, h("div", { class: "empty" }, T("选择一个 SQLite 数据库（建议用测试库），读取表结构后，勾选要管理的表和操作，生成带登录、角色、搜索、筛选和表单校验的管理后台，并自动启动自测。原数据库不会被修改。", "Choose a SQLite database (a test copy is best), pick tables and operations, and generate an admin panel with sign-in, roles, search, filters and validated forms. It is started and self-tested automatically; your database is never modified."))); return; }
  const settings = h("div", { class: "card" }, h("div", { class: "cols" },
    h("label", { class: "fld" }, h("span", { class: "lb" }, T("后台标题", "Title")), h("input", { class: "title", value: p.title, oninput: (e: Event) => { p.title = (e.target as HTMLInputElement).value; } })),
    h("label", { class: "fld" }, h("span", { class: "lb" }, T("界面语言", "Language")), h("select", { class: "lang", onchange: (e: Event) => { p.lang = (e.target as HTMLSelectElement).value as "zh" | "en"; } }, h("option", { value: "en", selected: p.lang === "en" }, "English"), h("option", { value: "zh", selected: p.lang === "zh" }, "中文"))),
    h("label", { class: "fld" }, h("span", { class: "lb" }, T("输出目录", "Output folder")), h("input", { class: "out", value: p.out, oninput: (e: Event) => { p.out = (e.target as HTMLInputElement).value; } })),
    h("label", { class: "fld" }, h("span", { class: "lb" }, T("端口", "Port")), h("input", { type: "number", value: String(p.port), oninput: (e: Event) => { p.port = Number((e.target as HTMLInputElement).value) || 8787; } }))));
  const tbl = (name: string) => v.tables.find((t) => t.name === name)!;
  const plan = h("div", { class: "card" }, h("b", {}, T("表与操作", "Tables and operations")),
    h("table", { class: "plan" }, h("tr", {}, h("th", {}, T("表", "Table")), h("th", {}, T("显示名", "Label")), ...OPS.map((o) => h("th", {}, T(...OPN[o]))), h("th", {}, T("引用时显示", "Shown as")), h("th", {}, T("隐藏的列", "Hidden"))),
      ...p.tables.map((tp) => {
        const t = tbl(tp.name);
        return h("tr", { class: tp.ops.length ? "" : "off", "data-t": tp.name },
          h("td", { class: "nm" }, tp.name, t.type === "view" ? h("span", { class: "tag" }, T("视图", "view")) : null, h("div", { class: "hint" }, T(`${t.rows} 行`, `${t.rows} rows`))),
          h("td", {}, h("input", { type: "text", value: tp.label, oninput: (e: Event) => { tp.label = (e.target as HTMLInputElement).value; } })),
          ...OPS.map((o) => h("td", { class: "c" }, h("input", { type: "checkbox", "data-op": o, checked: tp.ops.includes(o), disabled: t.type === "view" && o !== "read", onchange: (e: Event) => {
            const on = (e.target as HTMLInputElement).checked;
            tp.ops = on ? OPS.filter((x) => x === o || tp.ops.includes(x) || x === "read") : o === "read" ? [] : tp.ops.filter((x) => x !== o);
            render();
          } }))),
          h("td", {}, h("select", { onchange: (e: Event) => { tp.labelColumn = (e.target as HTMLSelectElement).value; } }, ...t.columns.map((c) => h("option", { value: c.name, selected: c.name === tp.labelColumn }, c.name)))),
          h("td", { class: "hint" }, tp.hidden.join(", ") || "—"));
      })),
    h("div", { class: "roles" }, ...(["editor", "viewer"] as const).map((r) => h("span", {}, h("b", {}, `${r}: `), ...OPS.map((o) => h("label", {}, h("input", { type: "checkbox", "data-role": r, "data-op": o, checked: p.roles[r].includes(o), onchange: (e: Event) => { const on = (e.target as HTMLInputElement).checked; p.roles[r] = OPS.filter((x) => (x === o ? on : p.roles[r].includes(x))); } }), T(...OPN[o]))))), h("span", { class: "hint" }, T("admin 拥有全部权限", "admin can do everything"))),
    h("div", { class: "row", style: "margin-top:10px" }, h("span", { class: "grow" }), v.saved?.generatedAt ? h("button", { class: "retest", onclick: () => void retest() }, T("重新自测", "Run self-test")) : null, h("button", { class: "primary gen", onclick: () => void generate() }, T("生成管理后台并自测", "Generate & self-test"))));
  const test = v.saved?.test;
  const result = v.saved?.generatedAt ? h("div", { class: "card" },
    test ? h("div", { class: test.ok ? "done" : "fail" }, test.ok ? T(`已生成 ${p.out}/，用数据库的临时副本启动并自测：${test.passed} 项全部通过（${(test.ms / 1000).toFixed(1)} 秒）。`, `Generated ${p.out}/ and self-tested against a temporary copy of the database: all ${test.passed} checks passed (${(test.ms / 1000).toFixed(1)} s).`) : T(`自测：${test.failed} 项失败，${test.passed} 项通过。`, `Self-test: ${test.failed} failed, ${test.passed} passed.`)) : h("div", {}, T(`已生成 ${p.out}/`, `Generated ${p.out}/`)),
    h("pre", { class: "run" }, `cd ${p.out}\nnode server.mjs        # Node ≥ 22.13 → http://127.0.0.1:${p.port}\nnode server.mjs user add alice editor`),
    h("div", { class: "hint" }, T("第一次启动会创建 admin 用户并在终端打印密码。默认只允许本机访问。", "The first start creates user admin and prints its password in the terminal. Listens on this computer only by default.")),
    test ? h("div", { class: "checks" }, ...test.checks.map((c) => h("div", { class: `ck ${c.ok ? "ok" : "bad"}` }, c.name, c.detail ? h("span", { class: "det" }, c.detail) : null))) : null) : null;
  const schema = h("div", { class: "card" }, h("b", {}, T("数据库结构", "Schema")), ...v.tables.map((t) => h("details", { class: "sch" }, h("summary", {}, `${t.name}${t.type === "view" ? " (view)" : ""} — ${t.columns.length} ${T("列", "columns")}, ${t.rows} ${T("行", "rows")}${t.refs.length ? ` · ← ${t.refs.map((r) => r.table).join(", ")}` : ""}`),
    h("div", {}, ...t.columns.map((c) => h("div", {}, h("code", {}, c.name), ` ${c.kind}${c.pk ? " · PK" : ""}${c.notNull && c.default === null && !c.auto ? T(" · 必填", " · required") : ""}${c.unique && !c.pk ? T(" · 唯一", " · unique") : ""}${c.fk ? ` → ${c.fk.table}.${c.fk.column}` : ""}${c.options ? ` [${c.options.join(" | ")}]` : ""}`))))));
  put(root, pick, settings, plan, result, schema);
}

onHostContext(() => render());
render();
void initHost("db-admin-generator", "0.1.0").then(async () => {
  const s = await call<Record<string, unknown>>("db_state").catch(() => undefined);
  st.files = (s?.files as string[]) ?? [];
  if (st.files.length === 1) st.db = st.files[0];
  if (s?.kind === "plan") show(s as never); else render();
});
