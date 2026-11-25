import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface OpS { id: string; method: string; path: string; tag?: string; summary?: string; params: string[]; body: string | null; success: string | null; errors: string[]; auth: string; derivedId: boolean }
interface ApiS { title: string; version: string; openapi: string; server?: string; schemes: { name: string; type: string }[]; schemas: string[]; warnings: string[]; ops: OpS[] }
interface OpResult { op: string; method: string; path: string; ok: boolean; checks: string[]; problems: string[] }
interface Verify { compiled: boolean; diagnostics: { file: string; line?: number; message: string }[]; exampleWarnings: { file: string; line?: number; message: string }[]; ops: OpResult[]; passed: number; failed: number; ms: number }
interface Saved { spec: string; out: string; packageName: string; className: string; title: string; version: string; ops: number; generatedAt: string; verify?: Verify; warnings: string[] }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const root = document.getElementById("root")!;
const st: { files: string[]; spec: string; api?: ApiS; saved?: Saved | null; preview?: string; out: string; pkg: string; cls: string } = { files: [], spec: "", out: "", pkg: "", cls: "" };

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message.replace(/^\[\w+\]\s*/, "") : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); }
}
function setSaved(s: Saved | null | undefined) {
  st.saved = s; if (s) { st.out = s.out; st.pkg = s.packageName; st.cls = s.className; st.spec = s.spec; }
  if (s?.verify) void updateContext(`SDK ${s.packageName} (${s.className}) in ${s.out}/ from ${s.spec}: ${s.ops} operations; compile ${s.verify.compiled ? "ok" : "failed"}; mock calls ${s.verify.passed}/${s.verify.ops.length}.`).catch(() => undefined);
}
onToolResult((v) => {
  if (v?.kind === "api") { st.api = v.api as ApiS; st.spec = v.spec as string; setSaved(v.saved as Saved | null); render(); }
  if (v?.kind === "sdk") { setSaved(v.saved as Saved); if (v.preview) st.preview = v.preview as string; render(); }
});
const inspect = async () => { if (!st.spec) { toast(T("请先选择 OpenAPI 文件", "Choose an OpenAPI file first"), "error"); return; } const r = await busy(() => call<{ api: ApiS; saved: Saved | null }>("sdk_inspect", { spec: st.spec })); if (r) { st.api = r.api; st.preview = undefined; setSaved(r.saved); render(); } };
const gen = async () => {
  const r = await busy(() => call<{ saved: Saved; preview: string }>("sdk_generate", { spec: st.spec, ...(st.out ? { out: st.out } : {}), ...(st.pkg ? { packageName: st.pkg } : {}), ...(st.cls ? { className: st.cls } : {}) }, 200_000));
  if (r) { setSaved(r.saved); st.preview = r.preview; render(); const v = r.saved.verify!; toast(v.compiled && !v.failed ? T(`已生成，${v.passed} 个接口全部调用通过`, `Generated; all ${v.passed} operations passed`) : T("已生成，但验证有失败项", "Generated, but some checks failed"), v.compiled && !v.failed ? "ok" : "error"); }
};

function render() {
  applyTheme();
  const pick = h("div", { class: "card" }, h("div", { class: "row" },
    h("label", { class: "fld grow" }, h("span", { class: "lb" }, T("OpenAPI 3 文件（YAML / JSON）", "OpenAPI 3 file (YAML / JSON)")),
      h("select", { class: "spec", onchange: (e: Event) => { st.spec = (e.target as HTMLSelectElement).value; } }, h("option", { value: "" }, T("— 选择 —", "— choose —")), ...st.files.map((f) => h("option", { value: f, selected: f === st.spec }, f)))),
    h("button", { class: "inspect", onclick: () => void inspect() }, T("读取接口", "Read spec"))));
  const a = st.api;
  if (!a) { put(root, h("h1", {}, T("接口转 SDK", "API To SDK")), pick, h("div", { class: "empty" }, T("选择一个 OpenAPI 3.0 / 3.1 文件，生成带完整类型的 TypeScript SDK 包，并自动验证：TypeScript 严格模式编译，再用规范里的示例起一个本地模拟服务器，逐个调用每个接口。", "Choose an OpenAPI 3.0 / 3.1 file to generate a fully typed TypeScript SDK package. It is verified automatically: strict TypeScript compile, then every operation is called against a local mock server built from the spec's examples."))); return; }
  const v = st.saved?.verify;
  const res = new Map((v?.ops ?? []).map((o) => [o.op, o]));
  const settings = h("div", { class: "card" }, h("b", {}, `${a.title} ${a.version}`), h("span", { class: "hint" }, ` · OpenAPI ${a.openapi}${a.server ? ` · ${a.server}` : ""} · ${a.ops.length} ${T("个接口", "operations")} · ${a.schemas.length} ${T("个类型", "types")} · ${T("认证", "auth")}: ${a.schemes.map((s) => `${s.name} (${s.type})`).join(", ") || T("无", "none")}`),
    ...a.warnings.map((w) => h("div", { class: "warn" }, `! ${w}`)),
    h("div", { class: "cols", style: "margin-top:8px" },
      h("label", { class: "fld" }, h("span", { class: "lb" }, T("输出目录", "Output folder")), h("input", { class: "out", value: st.out, placeholder: "sdk/…", oninput: (e: Event) => { st.out = (e.target as HTMLInputElement).value; } })),
      h("label", { class: "fld" }, h("span", { class: "lb" }, T("npm 包名", "npm package name")), h("input", { class: "pkg", value: st.pkg, placeholder: T("自动", "auto"), oninput: (e: Event) => { st.pkg = (e.target as HTMLInputElement).value; } })),
      h("label", { class: "fld" }, h("span", { class: "lb" }, T("客户端类名", "Client class")), h("input", { class: "cls", value: st.cls, placeholder: T("自动", "auto"), oninput: (e: Event) => { st.cls = (e.target as HTMLInputElement).value; } }))),
    h("div", { class: "row", style: "margin-top:8px" }, h("span", { class: "grow" }), h("button", { class: "primary gen", onclick: () => void gen() }, T("生成 SDK 并验证", "Generate & verify"))));
  const summary = v ? h("div", { class: v.compiled && !v.failed ? "done" : "fail" },
    v.compiled ? T(`已生成 ${st.saved!.out}/（${st.saved!.packageName}，类 ${st.saved!.className}）。TypeScript 严格模式编译通过；模拟服务器调用 ${v.passed}/${v.ops.length} 个接口通过（${(v.ms / 1000).toFixed(1)} 秒）。`, `Generated ${st.saved!.out}/ (${st.saved!.packageName}, class ${st.saved!.className}). Strict TypeScript compile passed; mock calls: ${v.passed}/${v.ops.length} operations passed (${(v.ms / 1000).toFixed(1)} s).`)
      : T(`TypeScript 编译失败（${v.diagnostics.length} 个错误）`, `TypeScript compile failed (${v.diagnostics.length} errors)`)) : null;
  const diags = v && (v.diagnostics.length || v.exampleWarnings.length) ? h("div", { class: "card" }, ...v.diagnostics.map((d) => h("div", { class: "bad" }, `✗ ${d.file}:${d.line ?? ""} ${d.message}`)), ...v.exampleWarnings.map((d) => h("div", { class: "warn" }, `! ${T("规范示例与类型不符", "spec example doesn't match its type")}: ${d.file}:${d.line ?? ""} ${d.message.split("\n")[0]}`))) : null;
  const ops = h("div", { class: "card" }, h("b", {}, T("接口", "Operations")),
    h("table", { class: "ops" }, h("tr", {}, h("th", {}, T("方法名", "Method")), h("th", {}, "HTTP"), h("th", {}, T("参数 / 请求体", "Params / body")), h("th", {}, T("验证", "Check"))),
      ...a.ops.map((o) => { const r = res.get(o.id); return h("tr", { "data-op": o.id },
        h("td", {}, h("code", {}, o.id), o.derivedId ? h("div", { class: "hint" }, T("（没有 operationId，自动命名）", "(no operationId; derived)")) : null, o.summary ? h("div", { class: "hint" }, o.summary) : null),
        h("td", {}, h("span", { class: `m ${o.method}` }, o.method), " ", h("code", {}, o.path)),
        h("td", { class: "hint" }, [...o.params, ...(o.body ? [`body: ${o.body}`] : [])].join(", ") || "—", h("div", {}, `→ ${o.success ?? "—"}${o.errors.length ? ` / ${o.errors.join(", ")}` : ""} · ${T("认证", "auth")}: ${o.auth}`)),
        h("td", { class: "res" }, r ? h("span", { class: r.ok ? "ok" : "bad" }, r.ok ? "✓" : "✗") : "", r ? h("div", {}, ...r.problems.map((p) => h("div", { class: "prob" }, p)), ...r.checks.map((c) => h("div", { class: "chk" }, c))) : null)); })));
  const code = st.preview ? h("div", { class: "card" }, h("b", {}, "src/client.ts"), h("pre", { class: "code" }, st.preview)) : null;
  put(root, pick, settings, summary, diags, h("div", { class: "split" }, ops, code ?? h("div", {})));
}

onHostContext(() => render());
render();
void initHost("api-to-sdk", "0.1.0").then(async () => {
  const s = await call<{ kind: string; saved: Saved | null; files: string[] }>("sdk_state").catch(() => undefined);
  st.files = s?.files ?? [];
  if (st.files.length === 1) st.spec = st.files[0];
  if (s?.saved) { setSaved(s.saved); const r = await call<{ api: ApiS }>("sdk_inspect", { spec: s.saved.spec }).catch(() => undefined); if (r) st.api = r.api; }
  render();
});
