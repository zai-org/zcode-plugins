import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

type Target = "dmg" | "nsis" | "appimage" | "dir";
interface Issue { severity: "error" | "warning" | "info"; field: string; message: string }
interface Config { name: string; appId: string; version: string; description?: string; author?: string; mode: "static" | "server"; webDir?: string; entry?: string; usesPortEnv?: boolean; port?: number; width: number; height: number; icon?: string; iconColor?: string; targets: Target[]; signing?: { macIdentity?: string; winCertificateFile?: string } }
interface Detected { dir: string; kind: string; name: string; version: string; webDir?: string; entry?: string; usesPortEnv?: boolean; port?: number; needsBuild?: string; icons: { path: string; width: number }[]; notes: string[] }
interface Job { id: number; target: Target; state: "running" | "done" | "failed"; step: string; started: number; ended?: number; log: string[]; outputs: { path: string; size: number }[]; error?: string }
interface View { kind: "app"; dir: string; detected: Detected; config: Config | null; issues: Issue[]; generated: string[]; env: { platform: string; wine: boolean; targets: Record<Target, { ok: boolean; why?: string }>; wanted: Target[] }; job: Job | null; outputs: { path: string; size: number }[] }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const root = document.getElementById("root")!;
const TNAME: Record<Target, [string, string]> = { dmg: ["macOS 安装包（dmg）", "macOS (dmg)"], nsis: ["Windows 安装程序（nsis）", "Windows (nsis)"], appimage: ["Linux（AppImage）", "Linux (AppImage)"], dir: ["本机免安装目录（测试用）", "Unpacked app for this OS (test)"] };
const FIELD: Record<string, [string, string]> = { name: ["名称", "Name"], appId: ["应用 ID", "App ID"], version: ["版本", "Version"], webDir: ["网页目录", "Web folder"], entry: ["入口", "Entry"], port: ["端口", "Port"], icon: ["图标", "Icon"], targets: ["目标", "Targets"], window: ["窗口", "Window"], signing: ["签名", "Signing"] };
const state: { v?: View; projects: string[]; icon?: string; form?: Config; file: string; fileText?: string; poll?: number } = { projects: [], file: "electron-builder.yml" };
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message.replace(/^\[\w+\]\s*/, "") : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); }
}
async function setView(v: View, refreshFiles = true) {
  const dirChanged = state.v?.dir !== v.dir;
  state.v = v;
  if (dirChanged || refreshFiles || !state.form) state.form = v.config ? structuredClone(v.config) : undefined;
  if (refreshFiles) {
    state.icon = v.generated.includes("build/icon.png") ? (await call<{ dataUrl: string | null }>("app_icon", { dir: v.dir }).catch(() => ({ dataUrl: null }))).dataUrl ?? undefined : undefined;
    state.fileText = v.generated.includes(state.file) ? (await call<{ text: string }>("app_file", { dir: v.dir, file: state.file }).catch(() => ({ text: "" }))).text : undefined;
  }
  render();
  if (v.job?.state === "running" && !state.poll) state.poll = window.setInterval(poll, 1500);
  if (v.job?.state !== "running" && state.poll) { clearInterval(state.poll); state.poll = undefined; }
  const c = v.config;
  void updateContext(c ? `Desktop app for ${v.dir}: “${c.name}” ${c.version}, ${c.mode}, targets ${c.targets.join("/")}, ${v.issues.filter((i) => i.severity === "error").length} errors.${v.job ? ` Build ${v.job.target}: ${v.job.state}.` : ""}` : `Project ${v.dir} not configured yet.`).catch(() => undefined);
}
async function poll() {
  const r = await call<View>("app_status", { dir: state.v!.dir, wait: false }).catch(() => undefined);
  if (r) await setView(r, r.job?.state !== "running");
}
onToolResult((v) => { if (v?.kind === "app") void setView(v as unknown as View); });

const choose = async (dir: string) => {
  const r = await busy(() => call<View>("app_state", { dir }));
  if (r?.kind === "app") await setView(r);
};
const setup = async () => {
  const f = state.form, v = state.v!;
  const r = await busy(() => call<View>("app_setup", f ? { dir: v.dir, ...f, icon: f.icon ?? "", signing: { macIdentity: f.signing?.macIdentity ?? "", winCertificateFile: f.signing?.winCertificateFile ?? "" } } : { dir: v.dir }));
  if (r) { await setView(r); toast(r.issues.some((i) => i.severity === "error") ? T("配置有错误，未生成文件", "Config has errors; files not generated") : T("已生成 desktop/ 目录", "Generated desktop/")); }
};
const build = async (t: Target) => { const r = await busy(() => call<View>("app_build", { dir: state.v!.dir, target: t }, 120_000)); if (r) await setView(r); };
const showFile = async (f: string) => { state.file = f; state.fileText = (await call<{ text: string }>("app_file", { dir: state.v!.dir, file: f }).catch(() => ({ text: "" }))).text; render(); };

function field(label: string, input: HTMLElement, hint?: string) { return h("label", { class: "fld" }, h("span", { class: "lb" }, label), input, hint ? h("span", { class: "hint" }, hint) : null); }
function text(get: () => string | undefined, set: (s: string) => void, attrs: Record<string, unknown> = {}) { return h("input", { value: get() ?? "", oninput: (e: Event) => set((e.target as HTMLInputElement).value), ...attrs }); }

function render() {
  applyTheme();
  const v = state.v;
  if (!v) {
    put(root, h("h1", {}, T("把项目做成桌面安装包", "Package a project as a desktop app")),
      h("div", { class: "muted" }, T("选择工作区里的网站或 Node 项目：", "Choose a website or Node project in the workspace:")),
      h("div", { class: "plist" }, ...state.projects.map((d) => h("button", { class: "proj", onclick: () => void choose(d) }, d === "." ? T("（工作区根目录）", "(workspace root)") : d))),
      state.projects.length ? null : h("div", { class: "empty" }, T("没有找到含 package.json 或 index.html 的文件夹。", "No folder with package.json or index.html found.")));
    return;
  }
  const d = v.detected, f = state.form;
  const head = h("div", { class: "head" },
    state.icon ? h("img", { class: "icon", src: state.icon, alt: "icon" }) : h("div", { class: "icon none" }),
    h("div", {}, h("div", { class: "title" }, f?.name ?? d.name, h("span", { class: "muted" }, ` ${f?.version ?? d.version}`)),
      h("div", { class: "muted" }, `${v.dir} · ${d.kind === "static" ? T(`静态网站（${d.webDir}）`, `static site (${d.webDir})`) : d.kind === "server" ? T(`Node 服务（${d.entry}）`, `Node server (${d.entry})`) : T("未识别", "not recognised")}`)),
    h("span", { class: "grow" }),
    h("button", { onclick: () => { state.v = undefined; render(); } }, T("换项目", "Other project")));
  const notes = [...d.notes, ...(d.needsBuild ? [T(`还没有构建好的网站，请先运行 ${d.needsBuild}`, `No built site yet — run ${d.needsBuild} first`)] : [])];
  if (!f) {
    put(root, head, ...notes.map((n) => h("div", { class: "note" }, n)),
      h("div", { class: "card" }, T("将在项目里生成 desktop/ 目录：Electron 外壳、electron-builder.yml、图标和说明。默认目标是 macOS（dmg）和 Windows（nsis），不签名。", "Creates desktop/ in the project: Electron shell, electron-builder.yml, icon and README. Default targets: macOS (dmg) and Windows (nsis), unsigned."),
        h("div", { class: "row" }, h("button", { class: "primary", onclick: () => void setup() }, T("生成桌面配置", "Generate desktop config")))));
    return;
  }
  const errors = v.issues.filter((i) => i.severity === "error");
  const form = h("div", { class: "card form" },
    h("div", { class: "cols" },
      field(T("名称", "Name"), text(() => f.name, (s) => (f.name = s))),
      field(T("应用 ID", "App ID"), text(() => f.appId, (s) => (f.appId = s), { class: "appid" })),
      field(T("版本", "Version"), text(() => f.version, (s) => (f.version = s), { class: "short" })),
      field(T("窗口", "Window"), h("span", { class: "row tight" }, text(() => String(f.width), (s) => (f.width = Number(s) || 0), { class: "num" }), "×", text(() => String(f.height), (s) => (f.height = Number(s) || 0), { class: "num" }))),
      f.mode === "static" ? field(T("网页目录", "Web folder"), text(() => f.webDir, (s) => (f.webDir = s), { class: "short" }), T("里面要有 index.html", "must contain index.html"))
        : field(T("服务入口", "Server entry"), text(() => f.entry, (s) => (f.entry = s), { class: "short" }), f.usesPortEnv ? T("读取 PORT，自动选空闲端口", "reads PORT; a free port is used") : T(`固定端口 ${f.port ?? "?"}`, `fixed port ${f.port ?? "?"}`)),
      field(T("图标", "Icon"), h("select", { class: "iconsel", onchange: (e: Event) => { f.icon = (e.target as HTMLSelectElement).value || undefined; } },
        h("option", { value: "", selected: !f.icon }, T("自动生成", "Generated")), ...d.icons.map((i) => h("option", { value: i.path, selected: f.icon === i.path }, `${i.path} (${i.width}px)`))))),
    h("div", { class: "row" }, h("b", {}, T("目标：", "Targets: ")), ...(["dmg", "nsis", "appimage", "dir"] as Target[]).map((t) => h("label", { class: "chk" }, h("input", { type: "checkbox", "data-target": t, checked: f.targets.includes(t), onchange: (e: Event) => { f.targets = (e.target as HTMLInputElement).checked ? [...f.targets, t] : f.targets.filter((x) => x !== t); } }), TNAME[t][locale() === "zh" ? 0 : 1]))),
    h("details", { class: "sign", open: !!(f.signing?.macIdentity || f.signing?.winCertificateFile) }, h("summary", {}, T("签名（可选，只用你自己的证书）", "Signing (optional, your own certificate only)")),
      h("div", { class: "cols" },
        field(T("macOS 证书名称", "macOS identity"), text(() => f.signing?.macIdentity, (s) => (f.signing = { ...f.signing, macIdentity: s }), { placeholder: "Developer ID Application: Name (TEAMID)" })),
        field(T("Windows 证书文件", "Windows certificate"), text(() => f.signing?.winCertificateFile, (s) => (f.signing = { ...f.signing, winCertificateFile: s }), { placeholder: "certs/code-signing.pfx" }))),
      h("div", { class: "hint" }, T("不填就不签名。Windows 证书密码请放在环境变量 WIN_CSC_KEY_PASSWORD，插件不会保存密码。不做 Apple 公证。", "Leave empty to build unsigned. Put the Windows certificate password in the WIN_CSC_KEY_PASSWORD environment variable; it is never stored. No Apple notarization."))),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: () => void setup() }, T("保存并重新生成", "Save and regenerate")),
      v.generated.length ? h("span", { class: "muted" }, T(`已生成：desktop/${v.generated.join("、desktop/")}`, `Generated: desktop/${v.generated.join(", desktop/")}`)) : null));
  const issues = v.issues.length ? h("div", { class: "issues" }, ...v.issues.map((i) => h("div", { class: `issue ${i.severity}` }, h("b", {}, FIELD[i.field] ? FIELD[i.field][locale() === "zh" ? 0 : 1] : i.field), " ", i.message))) : null;
  const running = v.job?.state === "running";
  const matrix = h("div", { class: "card" }, h("b", {}, T(`在这台电脑上打包（${v.env.platform === "darwin" ? "macOS" : v.env.platform === "win32" ? "Windows" : "Linux"}${v.env.wine ? " + Wine" : ""}）`, `Build on this computer (${v.env.platform}${v.env.wine ? " + Wine" : ""})`)),
    h("table", { class: "data matrix" }, ...(["dmg", "nsis", "appimage", "dir"] as Target[]).map((t) => {
      const b = v.env.targets[t];
      return h("tr", { class: f.targets.includes(t) ? "want" : "" }, h("td", {}, TNAME[t][locale() === "zh" ? 0 : 1], f.targets.includes(t) ? h("span", { class: "badge ok" }, T("已选", "selected")) : null),
        h("td", { class: b.ok ? "okc" : "noc" }, b.ok ? T("✓ 可以在本机打包", "✓ can build here") : `✗ ${t === "dmg" ? T("需要在 Mac 上打包", "needs a Mac") : t === "nsis" ? T("需要 Windows，或安装 Wine", "needs Windows or Wine") : T("需要 Linux", "needs Linux")}`),
        h("td", {}, h("button", { "data-build": t, disabled: !b.ok || running || errors.length > 0 || !v.generated.length, onclick: () => void build(t) }, T("打包", "Build"))));
    })),
    h("div", { class: "hint" }, T("首次打包会在 desktop/ 里 npm install（下载 Electron 约 150 MB）。不能在本机打的目标：把项目带到对应电脑，在 desktop/ 里运行 README 里的命令。", "The first build runs npm install in desktop/ (downloads Electron, ~150 MB). For targets this computer can't build, run the README command in desktop/ on that computer.")));
  const job = v.job ? h("div", { class: "card job" },
    h("div", { class: "row" }, h("b", {}, T(`打包 ${v.job.target}`, `Build ${v.job.target}`)),
      h("span", { class: `badge ${v.job.state === "done" ? "ok" : v.job.state === "failed" ? "bad" : ""}` }, v.job.state === "running" ? T(v.job.step === "install" ? "安装依赖中…" : "打包中…", v.job.step === "install" ? "installing…" : "building…") : v.job.state === "done" ? T("完成", "done") : T("失败", "failed")),
      h("span", { class: "muted" }, `${Math.round(((v.job.ended ?? Date.now()) - v.job.started) / 1000)} s`)),
    h("pre", { class: "log" }, v.job.log.slice(-60).join("\n"))) : null;
  const outs = v.outputs.length ? h("div", { class: "card" }, h("b", {}, T("产物（desktop/release）", "Output (desktop/release)")),
    ...v.outputs.map((o) => h("div", { class: "out" }, h("code", {}, `desktop/${o.path}`), h("span", { class: "muted" }, mb(o.size))))) : null;
  const files = v.generated.length ? h("div", { class: "card" }, h("div", { class: "tbar" }, ...["electron-builder.yml", "main.cjs", "package.json", "README.md"].map((x) => h("button", { class: `tab${state.file === x ? " on" : ""}`, onclick: () => void showFile(x) }, x))),
    h("pre", { class: "code" }, state.fileText ?? "")) : null;
  put(root, head, ...notes.map((n) => h("div", { class: "note" }, n)), form, issues, h("div", { class: "split" }, h("div", {}, matrix, job, outs), files));
  const log = root.querySelector("pre.log");
  if (log) log.scrollTop = log.scrollHeight;
}

onHostContext(() => render());
render();
void initHost("app-installer-builder", "0.1.0").then(async () => {
  state.projects = (await call<{ dirs: string[] }>("app_projects").catch(() => ({ dirs: [] }))).dirs;
  const st = await call<Record<string, unknown>>("app_state", {}).catch(() => undefined);
  if (st?.kind === "app") await setView(st as unknown as View); else render();
});
