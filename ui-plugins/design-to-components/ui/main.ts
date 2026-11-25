import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

type Group = "colors" | "fonts" | "fontSizes" | "radii" | "spacing" | "shadows";
const GROUPS: Group[] = ["colors", "fontSizes", "radii", "spacing", "fonts", "shadows"];
interface Issue { file: string; line?: number; message: string; severity: "error" | "warning"; source: string }
interface View { kind: "kit"; project: { kits: { slug: string; name: string }[] }; kit: { slug: string; name: string; dir: string; design: string[] }; tokens: Record<Group, Record<string, string>>; tokenIssues: { group: string; key: string; message: string }[]; plan: { name: string; description?: string; states: string[]; status: string; examples: number }[]; components: { name: string; examples: string[] }[]; issues: Issue[]; preview: string; files: string[]; catalog: string | null }
const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const GNAME: Record<Group, [string, string]> = { colors: ["颜色", "Colours"], fontSizes: ["字号", "Font sizes"], radii: ["圆角", "Radii"], spacing: ["间距", "Spacing"], fonts: ["字体", "Fonts"], shadows: ["阴影", "Shadows"] };
const root = document.getElementById("root")!;
const state: { v?: View; images: string[]; design: Record<string, string>; edit?: Record<Group, Record<string, string>>; showDesign: boolean; tab: "preview" | "code"; file?: string; code?: string; newName: string; newDesign: Set<string> } = { images: [], design: {}, showDesign: true, tab: "preview", newName: "", newDesign: new Set() };

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message.replace(/^\[\w+\]\s*/, "") : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); }
}
async function setView(v: View) {
  state.v = v; state.edit = structuredClone(v.tokens);
  for (const d of v.kit.design) if (!state.design[d]) { const r = await call<{ dataUrl: string }>("dc_design", { path: d }).catch(() => undefined); if (r) state.design[d] = r.dataUrl; }
  if (state.file && v.files.includes(state.file)) state.code = (await call<{ text: string }>("dc_file", { path: state.file }).catch(() => ({ text: "" }))).text;
  render();
  const e = v.issues.filter((i) => i.severity === "error").length;
  void updateContext(`Component kit ${v.kit.dir}: ${v.components.map((c) => c.name).join(", ") || "no components"}; ${e} errors, ${v.issues.length - e} warnings.`).catch(() => undefined);
}
onToolResult((v) => { if (v?.kind === "kit") void setView(v as unknown as View); });

const create = async () => {
  if (!state.newName.trim()) { toast(T("请填写名称", "Enter a name"), "error"); return; }
  const r = await busy(() => call<View>("dc_new", { name: state.newName.trim(), design: [...state.newDesign] }));
  if (r) await setView(r);
};
const saveTokens = async () => {
  const r = await busy(() => call<View>("dc_tokens", { tokens: state.edit }));
  if (r) { await setView(r); toast(T("设计变量已保存", "Tokens saved")); }
};
const openFile = async (f: string) => { state.file = f; state.tab = "code"; state.code = (await call<{ text: string }>("dc_file", { path: f }).catch(() => ({ text: "" }))).text; render(); };

function tokenEditor(v: View) {
  const e = state.edit!;
  return h("div", { class: "card tokens" }, h("div", { class: "row" }, h("b", {}, T("设计变量", "Tokens")), h("span", { class: "grow" }), h("button", { class: "primary", onclick: () => void saveTokens() }, T("保存", "Save"))),
    ...GROUPS.filter((g) => Object.keys(e[g] ?? {}).length).map((g) => h("div", { class: "tg" }, h("div", { class: "tgn" }, GNAME[g][locale() === "zh" ? 0 : 1]),
      ...Object.entries(e[g]).map(([k, val]) => h("div", { class: "tok" },
        g === "colors" ? h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(val) ? val : "#000000", "data-token": `${g}.${k}`, oninput: (ev: Event) => { e[g][k] = (ev.target as HTMLInputElement).value; const t = (ev.target as HTMLElement).parentElement!.querySelector("input.tv") as HTMLInputElement; t.value = e[g][k]; } }) : null,
        h("span", { class: "tk" }, k),
        h("input", { class: "tv", value: val, oninput: (ev: Event) => { e[g][k] = (ev.target as HTMLInputElement).value; } }))))),
    ...v.tokenIssues.map((t) => h("div", { class: "issue error" }, `${t.group}.${t.key}: ${t.message}`)));
}

function render() {
  applyTheme();
  const v = state.v;
  if (!v) {
    put(root, h("div", { class: "card" }, h("b", {}, T("新建组件库", "New component kit")),
      h("div", { class: "row" }, h("label", {}, T("名称 ", "Name "), h("input", { class: "name", value: state.newName, oninput: (e: Event) => { state.newName = (e.target as HTMLInputElement).value; } }))),
      h("div", {}, T("设计稿：", "Design images:")),
      h("div", { class: "flist" }, ...state.images.map((f) => h("label", {}, h("input", { type: "checkbox", checked: state.newDesign.has(f), onchange: (e: Event) => { (e.target as HTMLInputElement).checked ? state.newDesign.add(f) : state.newDesign.delete(f); } }), f))),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => void create() }, T("创建", "Create")))),
      h("div", { class: "empty" }, T("也可以对 Agent 说：“按这张设计稿做一套 React 组件”。", "Or ask the agent: “build React components from this design”.")));
    return;
  }
  const errors = v.issues.filter((i) => i.severity === "error").length, warns = v.issues.length - errors;
  const top = h("div", { class: "top" }, h("b", {}, v.kit.name), h("span", { class: "muted" }, v.kit.dir), h("span", { class: "grow" }),
    h("span", { class: `badge ${errors ? "bad" : "ok"}` }, errors ? T(`${errors} 个错误`, `${errors} errors`) : T("编译通过", "Compiles")), warns ? h("span", { class: "badge" }, T(`${warns} 个提醒`, `${warns} warnings`)) : null,
    v.kit.design.length ? h("label", { class: "chk" }, h("input", { type: "checkbox", checked: state.showDesign, onchange: (e: Event) => { state.showDesign = (e.target as HTMLInputElement).checked; render(); } }), T("对照设计稿", "Show design")) : null,
    h("button", { onclick: async () => { const r = await busy(() => call<View>("dc_build", {})); if (r) await setView(r); } }, T("重新构建", "Rebuild")));
  const plan = h("div", { class: "card" }, h("b", {}, T("组件清单", "Components")),
    v.plan.length || v.components.length ? h("table", { class: "data plan" }, ...[...v.plan, ...v.components.filter((c) => !v.plan.some((p) => p.name === c.name)).map((c) => ({ name: c.name, states: [] as string[], status: "done", examples: c.examples.length, description: "" }))].map((p) =>
      h("tr", {}, h("td", {}, h("span", { class: `st ${p.status}` }, p.status === "done" ? "✓" : p.status === "error" ? "✗" : "○"), " ", v.files.includes(`src/${p.name}.tsx`) ? h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); void openFile(`src/${p.name}.tsx`); } }, p.name) : p.name),
        h("td", { class: "muted" }, p.states.join(" · ") || "—"), h("td", { class: "num" }, T(`${p.examples} 个示例`, `${p.examples} examples`))))) : h("div", { class: "muted" }, T("还没有组件。", "No components yet.")));
  const issues = v.issues.length ? h("div", { class: "card" }, h("b", {}, T("问题", "Problems")), ...v.issues.map((i) => h("div", { class: `issue ${i.severity}` },
    h("span", { class: "src" }, i.source), i.file ? h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); void openFile(i.file); } }, `${i.file}${i.line ? `:${i.line}` : ""}`) : null, " ", i.message))) : null;
  const tabs = h("div", { class: "tbar" }, h("button", { class: `tab${state.tab === "preview" ? " on" : ""}`, onclick: () => { state.tab = "preview"; render(); } }, T("组件预览", "Preview")),
    ...v.files.map((f) => h("button", { class: `tab${state.tab === "code" && state.file === f ? " on" : ""}`, onclick: () => void openFile(f) }, f.replace(/^src\//, ""))));
  const main = state.tab === "preview" ? h("iframe", { class: "pv", sandbox: "", title: "preview", srcdoc: v.preview }) : h("pre", { class: "code" }, state.code ?? "");
  const design = state.showDesign && v.kit.design.length ? h("div", { class: "design" }, ...v.kit.design.map((d) => state.design[d] ? h("img", { src: state.design[d], alt: d }) : h("div", {}, d))) : null;
  put(root, top, h("div", { class: `layout${design ? " wd" : ""}` }, design, h("div", { class: "center" }, tabs, main,
    v.catalog ? h("div", { class: "small muted" }, T(`可交互的组件目录：${v.catalog}（在浏览器中打开）`, `Interactive catalog: ${v.catalog} (open in a browser)`)) : null),
    h("div", { class: "side" }, plan, issues, tokenEditor(v))));
}

onHostContext(() => render());
render();
void initHost("design-to-components", "0.1.0").then(async () => {
  state.images = (await call<{ files: string[] }>("workspace_images").catch(() => ({ files: [] }))).files;
  const st = await call<Record<string, unknown>>("dc_state", {}).catch(() => undefined);
  if (st?.kind === "kit") await setView(st as unknown as View); else render();
});
