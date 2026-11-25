import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Check { id: string; ok: boolean; level: "error" | "warn"; message: string }
interface Perm { name: string; kind: string; en: string; zh: string }
interface Saved { out: string; name: string; version: string; zip: string | null; zipBytes: number; generatedAt: string; checks: Check[]; errors: number; warnings: number; permissions: Perm[]; steps: number }
type Step = Record<string, unknown> & { action: string };
interface Task { name: string; description: string; version: string; steps: Step[]; settings: { key: string; label?: string; default?: string; required?: boolean; type?: string; options?: string[] }[]; sites: string[]; timeoutMs?: number; color?: string }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const root = document.getElementById("root")!;
const st: { list: Saved[]; saved?: Saved; task?: Task | null; preview?: { en: string; zh: string } | null; editing: boolean; draft: string } = { list: [], editing: false, draft: "" };

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message.replace(/^\[\w+\]\s*/, "") : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); }
}
function take(v: Record<string, unknown> | undefined) {
  if (!v) return;
  if (v.extensions) st.list = v.extensions as Saved[];
  if (v.saved) { st.saved = v.saved as Saved; st.list = [st.saved, ...st.list.filter((x) => x.out !== st.saved!.out)]; }
  if ("task" in v) st.task = v.task as Task | null;
  if ("preview" in v) st.preview = v.preview as { en: string; zh: string } | null;
  if (st.saved) void updateContext(`Extension “${st.saved.name}” ${st.saved.version} in ${st.saved.out}/: ${st.saved.steps} steps; ${st.saved.errors ? `${st.saved.errors} check error(s)` : `checks passed, zip ${st.saved.zip}`}; permissions ${st.saved.permissions.map((p) => p.name).join(", ")}.`).catch(() => undefined);
}
onToolResult((v) => { if (v?.kind === "ext" || v?.kind === "state") { take(v); st.editing = false; render(); } });

const select = async (out: string) => { const r = await busy(() => call("ext_state", { out })); take(r); st.editing = false; render(); };
const recheck = async () => { const r = await busy(() => call<Record<string, unknown>>("ext_check", { out: st.saved!.out }, 90_000)); if (r) { take(r); render(); toast((r.saved as Saved).errors ? T("校验发现问题", "Checks found problems") : T("校验通过，已重新打包", "Checks passed; zip rebuilt"), (r.saved as Saved).errors ? "error" : "ok"); } };
const apply = async () => {
  let parsed: { steps: Step[]; settings?: unknown[]; sites?: string[] };
  try { parsed = JSON.parse(st.draft); } catch (e) { toast(T("JSON 格式不对：", "Invalid JSON: ") + (e as Error).message, "error"); return; }
  const r = await busy(() => call<Record<string, unknown>>("ext_update", { out: st.saved!.out, steps: parsed.steps, ...(parsed.settings ? { settings: parsed.settings } : {}), ...(parsed.sites ? { sites: parsed.sites } : {}) }, 90_000));
  if (r) { take(r); st.editing = false; render(); toast(T(`已更新为 ${(r.saved as Saved).version}，请在 chrome://extensions 重新加载`, `Updated to ${(r.saved as Saved).version}; reload it on chrome://extensions`)); }
};

const desc = (s: Step): string => {
  const q = (x: unknown) => `“${String(x)}”`;
  switch (s.action) {
    case "open": return T(`打开 ${s.url}`, `Open ${s.url}`);
    case "click": return T(`点击 ${s.text ? q(s.text) : s.selector}`, `Click ${s.text ? q(s.text) : s.selector}`) + (s.optional ? T("（可选）", " (optional)") : "");
    case "fill": return T(`在 ${s.selector} 填入 ${q(s.value)}`, `Fill ${s.selector} with ${q(s.value)}`) + (s.submit ? T("并提交", " and submit") : "");
    case "wait": return s.selector ? T(`等待 ${s.selector}${s.gone ? " 消失" : " 出现"}`, `Wait for ${s.selector}${s.gone ? " to disappear" : ""}`) : T(`等待 ${Number(s.ms ?? 1000) / 1000} 秒`, `Wait ${Number(s.ms ?? 1000) / 1000} s`);
    case "extract": { const f = Object.entries((s.fields as Record<string, string>) ?? { text: "." }).map(([k, v]) => `${k} ← ${v}`).join(", "); return T(`从每个 ${s.selector} 提取 ${f}${s.next ? `；翻页 ${s.next}，最多 ${s.maxPages ?? 5} 页` : ""} → “${s.into ?? "rows"}”`, `Extract ${f} from each ${s.selector}${s.next ? `; follow ${s.next} up to ${s.maxPages ?? 5} pages` : ""} → “${s.into ?? "rows"}”`); }
    case "download": return s.selector ? T(`下载 ${s.selector} 链接的文件${s.limit ? `（最多 ${s.limit} 个）` : ""}`, `Download files linked by ${s.selector}${s.limit ? ` (up to ${s.limit})` : ""}`) : T(`把“${s.from ?? "rows"}”保存为 ${String(s.format ?? "csv").toUpperCase()}${s.filename ? `：${s.filename}` : ""}`, `Save “${s.from ?? "rows"}” as ${String(s.format ?? "csv").toUpperCase()}${s.filename ? `: ${s.filename}` : ""}`);
    default: return s.action;
  }
};

function render() {
  applyTheme();
  const s = st.saved, t = st.task;
  const picker = st.list.length > 1 ? h("select", { class: "pick", onchange: (e: Event) => void select((e.target as HTMLSelectElement).value) }, ...st.list.map((x) => h("option", { value: x.out, selected: x.out === s?.out }, `${x.name} (${x.out})`))) : null;
  if (!s || !t) {
    put(root, h("div", { class: "top" }, h("h1", {}, T("网页操作转浏览器扩展", "Web Task Extension")), picker),
      h("div", { class: "empty" }, T("在对话里描述你每天在网页上重复做的事（打开哪个页面、点什么、填什么、要提取哪些数据、存成什么文件），我会把它整理成步骤，生成一个 Chrome / Edge 扩展：点一下扩展图标就自动跑完。生成的扩展只申请需要的权限，并附权限说明；不做自动登录。", "Describe a chore you repeat in the browser (which page to open, what to click and fill, which data to pull, what file to save). It becomes a step list and a Chrome / Edge extension that does it in one click, with minimal, explained permissions. Logging in is not automated.")));
    return;
  }
  const head = h("div", { class: "top" }, h("h1", {}, `${s.name} `, h("span", { class: "muted" }, `v${s.version}`)), picker,
    h("button", { class: "recheck", onclick: () => void recheck() }, T("重新校验", "Re-check")),
    h("button", { class: "editbtn", onclick: () => { st.editing = !st.editing; st.draft = JSON.stringify({ steps: t.steps, settings: t.settings, sites: t.sites }, null, 2); render(); } }, st.editing ? T("取消编辑", "Cancel") : T("编辑步骤", "Edit steps")));
  const sum = h("div", { class: `sum ${s.errors ? "bad" : "ok"}` }, s.errors
    ? T(`有 ${s.errors} 项校验没通过，未打包。`, `${s.errors} check(s) failed; not zipped.`)
    : T(`已生成 ${s.out}/ 并打包为 ${s.zip}（${Math.round(s.zipBytes / 1024)} KB）。校验 ${s.checks.filter((c) => c.ok).length}/${s.checks.length} 通过${s.warnings ? `，${s.warnings} 条提醒` : ""}。`, `Generated ${s.out}/ and zipped to ${s.zip} (${Math.round(s.zipBytes / 1024)} KB). ${s.checks.filter((c) => c.ok).length}/${s.checks.length} checks passed${s.warnings ? `, ${s.warnings} warning(s)` : ""}.`));
  const steps = h("div", { class: "card" }, h("b", {}, T(`步骤（${t.steps.length}）`, `Steps (${t.steps.length})`)), t.description ? h("div", { class: "muted" }, t.description) : null,
    h("ol", { class: "steps" }, ...t.steps.map((x) => h("li", {}, h("span", { class: `act ${x.action}` }, x.action), desc(x), x.note ? h("div", { class: "kv" }, String(x.note)) : null))),
    t.settings.length ? h("div", {}, h("b", {}, T("设置项（用户在扩展设置页填写）", "Settings (filled in on the options page)")), ...t.settings.map((x) => h("div", { class: "kv" }, h("code", {}, `{{${x.key}}}`), ` ${x.label ?? ""}${x.required ? " *" : ""}${x.type === "select" ? ` [${x.options?.join(" / ")}]` : ""}${x.default ? ` = ${x.default}` : ""}`))) : null);
  const perms = h("div", { class: "card" }, h("b", {}, T("权限（最小化）", "Permissions (minimal)")),
    h("table", { class: "data perm" }, ...s.permissions.map((p) => h("tr", {}, h("td", {}, h("code", {}, p.name)), h("td", {}, locale() === "zh" ? p.zh : p.en)))),
    h("div", { class: "kv", style: "margin-top:6px" }, T("未申请 tabs、<all_urls>、cookies、history、webRequest，也没有在所有网页常驻的内容脚本。", "Not requested: tabs, <all_urls>, cookies, history, webRequest, or content scripts on every page.")));
  const checks = h("div", { class: "card checks" }, h("b", {}, T("校验", "Checks")), ...s.checks.map((c) => h("div", { "data-check": c.id, class: c.ok ? "ok" : c.level === "error" ? "bad" : "warn" }, `${c.ok ? "✓" : c.level === "error" ? "✗" : "!"} ${c.message}`)));
  const load = h("div", { class: "card load" }, h("b", {}, T("在 Chrome 里试用", "Try it in Chrome")), h("ol", {},
    h("li", {}, T("打开 ", "Open "), h("code", {}, "chrome://extensions"), T("，右上角打开“开发者模式”", " and turn on Developer mode")),
    h("li", {}, T("点“加载已解压的扩展程序”，选择 ", "Click Load unpacked and choose "), h("code", {}, `${s.out}/`)),
    h("li", {}, T("固定扩展图标，点它 →“运行任务”。改了步骤后在扩展页点刷新。", "Pin it, click it → Run task. After changes, press reload on the extensions page."))),
    s.zip ? h("div", { class: "kv" }, T(`商店上传包：${s.zip}（发布需你自己决定）`, `Store-ready zip: ${s.zip} (publishing is up to you)`)) : null);
  const preview = st.preview ? h("div", { class: "card" }, h("b", {}, T("弹窗预览", "Popup preview")), h("iframe", { class: "pop", srcdoc: locale() === "zh" ? st.preview.zh : st.preview.en, sandbox: "" })) : null;
  const edit = st.editing ? h("div", { class: "card" }, h("b", {}, T("编辑步骤 / 设置 / 额外网站（JSON）", "Edit steps / settings / extra sites (JSON)")), h("textarea", { class: "edit", oninput: (e: Event) => { st.draft = (e.target as HTMLTextAreaElement).value; } }, st.draft), h("div", { class: "row" }, h("span", { style: "flex:1" }), h("button", { class: "primary apply", onclick: () => void apply() }, T("应用并重新生成", "Apply & regenerate")))) : null;
  put(root, head, sum, edit, h("div", { class: "split" }, h("div", {}, steps, perms), h("div", {}, preview, checks, load)));
}

onHostContext(() => render());
render();
void initHost("web-task-extension", "0.1.0").then(async () => {
  const r = await call<Record<string, unknown>>("ext_state").catch(() => undefined);
  take(r);
  render();
});
