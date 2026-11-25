import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Issue { severity: "error" | "warning" | "info"; check: string; message: string; line?: number }
interface Email { slug: string; name: string; dir: string; design: string[] }
interface View { project: { emails: Email[]; current: string }; email: Email; source: string; data: Record<string, unknown>; vars: string[]; issues: Issue[]; bytes: number; limit: number; width: number; preheader?: string; title?: string; html: string }
const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const CHECK: Record<string, [string, string]> = { mjml: ["MJML", "MJML"], width: ["宽度", "Width"], preheader: ["预览行", "Preheader"], "dark-mode": ["深色模式", "Dark mode"], alt: ["替代文字", "Alt text"], image: ["图片", "Image"], link: ["链接", "Link"], contrast: ["对比度", "Contrast"], unsubscribe: ["退订", "Unsubscribe"], size: ["体积", "Size"], variables: ["变量", "Variables"], data: ["样例数据", "Sample data"] };
const root = document.getElementById("root")!;
const state: { v?: View; images: string[]; device: "desktop" | "mobile"; dark: boolean; compare: boolean; tab: "preview" | "text" | "source"; text?: string; design: Record<string, string>; edits: Record<string, string>; newName: string; newDesign: Set<string> } = {
  images: [], device: "desktop", dark: false, compare: true, tab: "preview", design: {}, edits: {}, newName: "", newDesign: new Set(),
};

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); }
}
async function setView(v: View) {
  state.v = v;
  state.edits = Object.fromEntries(v.vars.map((k) => [k, v.data[k] === undefined ? "" : String(v.data[k])]));
  for (const d of v.email.design) if (!state.design[d]) { const r = await call<{ dataUrl: string }>("email_design", { path: d }).catch(() => undefined); if (r) state.design[d] = r.dataUrl; }
  if (state.tab === "text") state.text = (await call<{ text: string }>("email_text", { email: v.email.slug }).catch(() => ({ text: "" }))).text;
  render();
  const e = v.issues.filter((i) => i.severity === "error").length;
  void updateContext(`Email template ${v.email.slug}: ${(v.bytes / 1024).toFixed(1)} KB, ${v.vars.length} variables, ${e} errors, ${v.issues.length - e} warnings/notes.`).catch(() => undefined);
}
onToolResult((v) => { if (v?.kind === "email") void setView(v as unknown as View); if (v?.kind === "exported") toast(T(`已导出 ${(v.files as string[]).length} 个文件`, `Exported ${(v.files as string[]).length} files`)); });

const create = async () => {
  if (!state.newName.trim()) { toast(T("请填写模板名称", "Enter a name"), "error"); return; }
  const r = await busy(() => call<View>("email_new", { name: state.newName.trim(), design: [...state.newDesign] }));
  if (r) await setView(r);
};
const saveData = async () => {
  const v = state.v!;
  const data: Record<string, unknown> = { ...v.data };
  for (const [k, val] of Object.entries(state.edits)) data[k] = val;
  const r = await busy(() => call<View>("email_write", { email: v.email.slug, data }));
  if (r) { await setView(r); toast(T("样例数据已保存", "Sample data saved")); }
};
const exportAll = async () => { const v = state.v!; const r = await busy(() => call<{ files: string[] }>("email_export", { email: v.email.slug })); if (r) toast(T(`已导出：${r.files.map((f) => f.split("/").pop()).join("、")}`, `Exported: ${r.files.map((f) => f.split("/").pop()).join(", ")}`)); };
const switchTo = async (slug: string) => { const r = await busy(() => call<View>("email_state", { email: slug })); if (r) await setView(r); };

/** 面板不联网：远程/相对图片换成占位块（像邮件客户端“图片未加载”），去掉远程字体样式表。 */
function offline(html: string) {
  const ph = (label: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300"><rect width="600" height="300" fill="#e5e7eb"/><path d="M0 0L600 300M600 0L0 300" stroke="#cbd5e1" stroke-width="2"/><text x="300" y="158" font-family="sans-serif" font-size="22" fill="#475569" text-anchor="middle">${label.replace(/[<&"]/g, "").slice(0, 48)}</text></svg>`);
  return html
    .replace(/<link[^>]+href="https?:[^"]*"[^>]*>/gi, "")
    .replace(/@import\s+url\([^)]*\);?/gi, "")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = /\ssrc="([^"]*)"/i.exec(tag)?.[1] ?? "";
      if (src.startsWith("data:")) return tag;
      const alt = /\salt="([^"]*)"/i.exec(tag)?.[1] || src.split("/").pop() || "image";
      return tag.replace(/\ssrc="[^"]*"/i, ` src="${ph("🖼 " + alt)}"`);
    })
    .replace(/url\((['"]?)(?!data:)[^)'"]+\1\)/gi, "none")
    .replace(/\sbackground="(?!data:)[^"]*"/gi, "");
}

/** 深色模式预览：有 prefers-color-scheme 样式就直接启用；没有就模拟客户端强制反色。 */
function darkHtml(html: string) {
  if (/prefers-color-scheme\s*:\s*dark/.test(html)) return html.replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/g, "@media all");
  return html.replace(/<\/head>/i, "<style>html{filter:invert(1) hue-rotate(180deg);background:#fff}img{filter:invert(1) hue-rotate(180deg)}</style></head>");
}

function render() {
  applyTheme();
  const v = state.v;
  if (!v) {
    put(root, h("div", { class: "card" }, h("b", {}, T("新建邮件模板", "New email template")),
      h("div", { class: "row" }, h("label", {}, T("名称 ", "Name "), h("input", { class: "name", value: state.newName, placeholder: T("如：发货通知", "e.g. Order shipped"), oninput: (e: Event) => { state.newName = (e.target as HTMLInputElement).value; } }))),
      h("div", {}, T("设计稿 / 截图：", "Design / screenshot:")),
      h("div", { class: "flist" }, ...state.images.map((f) => h("label", {}, h("input", { type: "checkbox", checked: state.newDesign.has(f), onchange: (e: Event) => { (e.target as HTMLInputElement).checked ? state.newDesign.add(f) : state.newDesign.delete(f); } }), f))),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => void create() }, T("创建模板", "Create template")))),
      h("div", { class: "empty" }, T("也可以把截图发给 Agent：“照这张截图做一个邮件模板”。", "Or give the agent a screenshot: “make an email template like this”.")));
    return;
  }
  const errors = v.issues.filter((i) => i.severity === "error").length, warns = v.issues.filter((i) => i.severity === "warning").length;
  const pct = Math.min(100, (v.bytes / v.limit) * 100);
  const top = h("div", { class: "top" },
    v.project.emails.length > 1 ? h("select", { class: "pick", onchange: (e: Event) => void switchTo((e.target as HTMLSelectElement).value) }, ...v.project.emails.map((x) => h("option", { value: x.slug, selected: x.slug === v.email.slug }, x.name))) : h("b", {}, v.email.name),
    h("span", { class: "muted" }, `${v.email.dir}/${v.email.slug}.mjml`), h("span", { class: "grow" }),
    h("span", { class: "meter", title: T("Gmail 超过 102 KB 会截断邮件", "Gmail clips emails over 102 KB") }, h("span", { class: `fill${pct > 100 * (80 / 102) ? " hot" : ""}`, style: `width:${pct}%` }), h("span", { class: "lbl" }, `${(v.bytes / 1024).toFixed(1)} / 102 KB`)),
    h("span", { class: `badge ${errors ? "bad" : "ok"}` }, errors ? T(`${errors} 个错误`, `${errors} errors`) : T("无错误", "No errors")),
    warns ? h("span", { class: "badge warn" }, T(`${warns} 个提醒`, `${warns} warnings`)) : null,
    h("button", { class: "primary", onclick: () => void exportAll() }, T("导出 HTML + 纯文本", "Export HTML + text")));
  const tab = (id: typeof state.tab, label: string) => h("button", { class: `tab${state.tab === id ? " on" : ""}`, onclick: async () => { state.tab = id; if (id === "text") state.text = (await call<{ text: string }>("email_text", { email: v.email.slug }).catch(() => ({ text: "" }))).text; render(); } }, label);
  const tbar = h("div", { class: "tbar" }, tab("preview", T("预览", "Preview")), tab("text", T("纯文本", "Plain text")), tab("source", "MJML"), h("span", { class: "sep" }),
    ...(state.tab === "preview" ? [
      h("button", { class: `tab${state.device === "desktop" ? " on" : ""}`, onclick: () => { state.device = "desktop"; render(); } }, T("桌面", "Desktop")),
      h("button", { class: `tab${state.device === "mobile" ? " on" : ""}`, onclick: () => { state.device = "mobile"; render(); } }, T("手机", "Mobile")),
      h("label", { class: "chk" }, h("input", { type: "checkbox", checked: state.dark, onchange: (e: Event) => { state.dark = (e.target as HTMLInputElement).checked; render(); } }), T("深色模式", "Dark mode")),
      v.email.design.length ? h("label", { class: "chk" }, h("input", { type: "checkbox", checked: state.compare, onchange: (e: Event) => { state.compare = (e.target as HTMLInputElement).checked; render(); } }), T("对照设计稿", "Show design")) : null,
    ] : []));
  let mainEl: HTMLElement;
  if (state.tab === "preview") {
    const inbox = h("div", { class: "inbox" }, h("b", {}, v.title ?? v.email.name), h("span", { class: "muted" }, ` — ${v.preheader ?? T("（没有预览行）", "(no preheader)")}`));
    const note = h("div", { class: "small muted" }, T("预览不联网：远程图片显示为占位块，导出的 HTML 保留原地址。", "Preview is offline: remote images show as placeholders; the exported HTML keeps the real URLs."));
    const frame = h("iframe", { sandbox: "", title: "email", srcdoc: offline(state.dark ? darkHtml(v.html) : v.html), class: state.device }) as HTMLIFrameElement;
    const design = state.compare && v.email.design.length ? h("div", { class: "design" }, ...v.email.design.map((d) => state.design[d] ? h("img", { src: state.design[d], alt: d }) : h("div", {}, d))) : null;
    mainEl = h("div", { class: `main${design ? " withdesign" : ""}` }, design, h("div", { class: "pv" }, inbox, note, h("div", { class: `frame ${state.device}` }, frame)));
  } else if (state.tab === "text") mainEl = h("pre", { class: "code text" }, state.text ?? "");
  else mainEl = h("pre", { class: "code" }, v.source);
  const issues = h("div", { class: "issues" }, h("b", {}, T("检查结果", "Checks")), v.issues.length ? null : h("div", { class: "ok" }, T("全部通过。", "All checks pass.")),
    ...v.issues.map((i) => h("div", { class: `issue ${i.severity}` }, h("span", { class: "chk" }, CHECK[i.check] ? (locale() === "zh" ? CHECK[i.check][0] : CHECK[i.check][1]) : i.check), i.line ? h("span", { class: "muted" }, T(`第 ${i.line} 行`, `line ${i.line}`)) : null, h("span", {}, i.message))));
  const vars = h("div", { class: "vars" }, h("b", {}, T(`变量（${v.vars.length}）`, `Variables (${v.vars.length})`)),
    v.vars.length ? h("table", { class: "data" }, ...v.vars.map((k) => h("tr", {}, h("td", { class: "k" }, `{{${k}}}`), h("td", {}, h("input", { "data-var": k, value: state.edits[k] ?? "", oninput: (e: Event) => { state.edits[k] = (e.target as HTMLInputElement).value; } }))))) : h("div", { class: "muted" }, T("模板里没有 {{变量}}。", "No {{variables}} in the template.")),
    v.vars.length ? h("button", { onclick: () => void saveData() }, T("保存样例数据", "Save sample data")) : null);
  put(root, top, tbar, mainEl, h("div", { class: "split" }, issues, vars));
}

onHostContext(() => render());
render();
void initHost("email-template-builder", "0.1.0").then(async () => {
  state.images = (await call<{ files: string[] }>("workspace_images").catch(() => ({ files: [] }))).files;
  const st = await call<Record<string, unknown>>("email_state", {}).catch(() => undefined);
  if (st?.kind === "email") await setView(st as unknown as View); else render();
});
