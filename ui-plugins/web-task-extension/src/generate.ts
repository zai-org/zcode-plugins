import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Script } from "node:vm";
import { strToU8, zipSync } from "fflate";
import { hexColor, iconPng, pngSize } from "./icons.ts";
import { MATCH_PATTERN, type Task, checkTask, patternCovers, permissions } from "./task.ts";

export type Files = Record<string, string | Uint8Array>;
export interface Check { id: string; ok: boolean; level: "error" | "warn"; message: string }
const ICONS = [16, 32, 48, 128];
const NOT_IN_ZIP = new Set(["README.md", "PERMISSIONS.md"]);

async function walk(dir: string, root = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, root))); else out.push(relative(root, p).split(sep).join("/"));
  }
  return out.sort();
}

export function manifest(task: Task) {
  const perms = permissions(task);
  const icons = Object.fromEntries(ICONS.map((s) => [String(s), `icons/icon${s}.png`]));
  const hosts = perms.filter((p) => p.kind === "host").map((p) => p.name);
  return {
    manifest_version: 3,
    name: task.name,
    version: task.version,
    description: task.description.slice(0, 132) || `Runs “${task.name}” in one click.`.slice(0, 132),
    default_locale: "en",
    minimum_chrome_version: "110",
    icons,
    action: { default_popup: "popup.html", default_title: task.name, default_icon: { "16": icons["16"], "32": icons["32"] } },
    options_page: "options.html",
    background: { service_worker: "background.js" },
    permissions: perms.filter((p) => p.kind === "permission").map((p) => p.name),
    ...(hosts.length ? { host_permissions: hosts } : {}),
  };
}

export async function generate(task: Task, runtimeDir: string): Promise<Files> {
  const files: Files = {};
  for (const f of await walk(join(runtimeDir, "ext"))) files[f] = await readFile(join(runtimeDir, "ext", f), "utf8");
  const perms = permissions(task);
  const rgb = hexColor(task.color, task.name);
  for (const s of ICONS) files[`icons/icon${s}.png`] = iconPng(s, rgb);
  files["manifest.json"] = JSON.stringify(manifest(task), null, 2) + "\n";
  files["task.json"] = JSON.stringify({ name: task.name, description: task.description, version: task.version, timeoutMs: task.timeoutMs ?? 15000, steps: task.steps, settings: task.settings, sites: task.sites, ...(task.color ? { color: task.color } : {}), permissions: perms }, null, 2) + "\n";
  files["PERMISSIONS.md"] = permissionsMd(task);
  files["README.md"] = readme(task);
  return files;
}

function permissionsMd(task: Task) {
  const perms = permissions(task);
  return [`# ${task.name}: permissions`, "", "Only what the steps need. 只申请步骤用到的权限。", "", "| Permission | Why | 用途 |", "|---|---|---|", ...perms.map((p) => `| \`${p.name}\` | ${p.en} | ${p.zh} |`), "", "Not requested: `tabs`, `<all_urls>`, `cookies`, `history`, `webRequest`, content scripts that run on every page, remote code. The extension makes no network requests of its own; it only drives the pages listed above when you press Run.", "", "未申请：`tabs`、`<all_urls>`、`cookies`、`history`、`webRequest`、在所有网页常驻的内容脚本、远程代码。扩展自己不发任何网络请求，只在你点“运行任务”时操作上面列出的网页。", ""].join("\n");
}
function readme(task: Task) {
  return [`# ${task.name}`, "", task.description, "", "## Load it in Chrome / 在 Chrome 里加载", "", "1. Open `chrome://extensions` and turn on **Developer mode** (top right). 打开 `chrome://extensions`，右上角打开“开发者模式”。", "2. Click **Load unpacked** and choose this folder (the one with `manifest.json`). 点“加载已解压的扩展程序”，选择这个文件夹。", "3. Pin the extension, open its **Settings** if it has any, then click it and press **Run task**. 固定扩展图标；如有设置项先填写，再点图标 →“运行任务”。", "", "Edge: `edge://extensions` works the same. The zip next to this folder is ready for the Chrome Web Store if you decide to publish (not done for you). Edge 同理。旁边的 zip 可直接上传 Chrome 应用商店（需你自己决定并发布）。", "", "## Steps / 步骤", "", ...task.steps.map((s, i) => `${i + 1}. \`${s.action}\` ${JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => k !== "action")))}`), "", ...(task.settings.length ? ["## Settings / 设置", "", ...task.settings.map((s) => `- \`${s.key}\`${s.required ? " (required)" : ""}: ${s.label ?? ""}${s.default ? ` — default \`${s.default}\`` : ""}`), ""] : []), "See PERMISSIONS.md for what each permission is for. 每项权限的用途见 PERMISSIONS.md。", "", "Logging in is not automated: sign in to the site yourself before running. 不自动登录：运行前请自己先登录网站。", ""].join("\n");
}

const KNOWN = new Set(["activeTab", "alarms", "bookmarks", "clipboardRead", "clipboardWrite", "contextMenus", "cookies", "debugger", "declarativeNetRequest", "downloads", "history", "identity", "idle", "management", "nativeMessaging", "notifications", "offscreen", "scripting", "sidePanel", "storage", "tabs", "unlimitedStorage", "webNavigation", "webRequest"]);
const BROAD = new Set(["tabs", "cookies", "history", "webRequest", "debugger", "management", "nativeMessaging", "webNavigation", "bookmarks", "clipboardRead"]);

/** 静态校验：manifest 结构、引用文件、图标尺寸、权限最小化、MV3 CSP（无内联脚本/远程代码）、JS 语法、i18n。 */
export function validate(files: Files, task?: Task): Check[] {
  const checks: Check[] = [];
  const add = (id: string, ok: boolean, message: string, level: "error" | "warn" = "error") => checks.push({ id, ok, level, message });
  const text = (p: string) => { const v = files[p]; return v == null ? null : typeof v === "string" ? v : Buffer.from(v).toString("utf8"); };
  let m: any;
  try { m = JSON.parse(text("manifest.json") ?? ""); add("manifest_json", true, "manifest.json is valid JSON"); } catch (e) { add("manifest_json", false, `manifest.json: ${(e as Error).message}`); return checks; }
  add("mv3", m.manifest_version === 3, m.manifest_version === 3 ? "Manifest V3" : `manifest_version is ${m.manifest_version}; Chrome needs 3`);
  const resolveMsg = (v: unknown) => { const k = String(v ?? "").match(/^__MSG_(\w+)__$/)?.[1]; if (!k) return String(v ?? ""); try { return JSON.parse(text(`_locales/${m.default_locale}/messages.json`) ?? "{}")[k]?.message ?? ""; } catch { return ""; } };
  const name = resolveMsg(m.name);
  add("name", name.length >= 1 && name.length <= 75, name.length <= 75 && name ? `name “${name}” (${name.length}/75)` : `name must be 1–75 characters (has ${name.length})`);
  const desc = resolveMsg(m.description);
  add("description", desc.length <= 132, `description ${desc.length}/132 characters`);
  const vok = typeof m.version === "string" && /^\d{1,5}(\.\d{1,5}){0,3}$/.test(m.version) && m.version.split(".").every((n: string) => +n <= 65535) && !/^0+(\.0+)*$/.test(m.version);
  add("version", vok, vok ? `version ${m.version}` : `version “${m.version}” must be 1–4 dot-separated integers (0–65535), not all zero`);
  const refs: [string, string][] = [];
  if (m.background?.service_worker) refs.push(["background.service_worker", m.background.service_worker]); else add("background", false, "background.service_worker is missing");
  if (m.background?.scripts || m.background?.page) add("background_mv2", false, "background.scripts / page are Manifest V2 only");
  if (m.action?.default_popup) refs.push(["action.default_popup", m.action.default_popup]);
  if (m.options_page) refs.push(["options_page", m.options_page]);
  if (m.options_ui?.page) refs.push(["options_ui.page", m.options_ui.page]);
  for (const [s, p] of Object.entries({ ...(m.icons ?? {}), ...Object.fromEntries(Object.entries(m.action?.default_icon ?? {}).map(([k, v]) => [`a${k}`, v])) })) refs.push([`icon ${s}`, String(p)]);
  const missing = refs.filter(([, p]) => !(p in files));
  add("files", !missing.length, missing.length ? `Missing files: ${missing.map(([w, p]) => `${p} (${w})`).join(", ")}` : `All ${refs.length} referenced files exist`);
  const badIcons = Object.entries(m.icons ?? {}).filter(([s, p]) => { const f = files[String(p)]; const d = f && typeof f !== "string" ? pngSize(f) : null; return !d || d[0] !== +s || d[1] !== +s; });
  add("icons", !badIcons.length && !!m.icons?.["128"], badIcons.length ? `Icons that aren't PNGs of the declared size: ${badIcons.map(([s]) => s).join(", ")}` : m.icons?.["128"] ? `Icons ${Object.keys(m.icons).join("/")} px are PNGs of the right size` : "A 128 px icon is required for the Web Store");
  const perms: string[] = m.permissions ?? [];
  const unknown = perms.filter((p) => !KNOWN.has(p));
  add("permissions_known", !unknown.length, unknown.length ? `Unknown permissions: ${unknown.join(", ")}` : `Permissions: ${perms.join(", ") || "none"}`);
  const broad = perms.filter((p) => BROAD.has(p));
  const hosts: string[] = m.host_permissions ?? [];
  const badHost = hosts.filter((h) => !MATCH_PATTERN.test(h));
  add("host_patterns", !badHost.length, badHost.length ? `Invalid match patterns: ${badHost.join(", ")}` : hosts.length ? `Host access: ${hosts.join(", ")}` : "No host access (activeTab only)");
  const allSites = hosts.filter((h) => h === "<all_urls>" || /^[^:]+:\/\/\*\//.test(h));
  add("minimal", !broad.length && !allSites.length && !m.content_scripts, !broad.length && !allSites.length && !m.content_scripts ? "Minimal: no tabs/cookies/history/webRequest, no all-sites access, no always-on content scripts" : `Broader than needed: ${[...broad, ...allSites, ...(m.content_scripts ? ["content_scripts"] : [])].join(", ")}`, "warn");
  if (task) {
    const want = permissions(task).map((p) => p.name).sort();
    const have = [...perms, ...hosts].sort();
    const extra = have.filter((p) => !want.includes(p)), lack = want.filter((p) => !have.includes(p));
    add("permissions_match", !extra.length && !lack.length, !extra.length && !lack.length ? "Each permission is used by a step and explained in PERMISSIONS.md" : `${extra.length ? `Not needed by any step: ${extra.join(", ")}. ` : ""}${lack.length ? `Needed but missing: ${lack.join(", ")}` : ""}`);
    const opens = task.steps.filter((s) => s.action === "open").map((s) => (s as { url: string }).url.replace(/\{\{[^}]*\}\}/g, "x"));
    const uncovered = opens.filter((u) => !hosts.some((h) => patternCovers(h, u)));
    add("hosts_cover", !uncovered.length, uncovered.length ? `Open URLs not covered by host_permissions: ${uncovered.join(", ")}` : opens.length ? "Every Open URL is covered by host_permissions" : "No Open step");
    if (task.steps.some((s) => s.action === "download") !== perms.includes("downloads")) add("downloads_perm", false, "downloads permission doesn't match the download steps");
  }
  const html = Object.keys(files).filter((p) => p.endsWith(".html"));
  const inline: string[] = [];
  for (const p of html) {
    const h = text(p)!;
    for (const s of h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const src = s[1].match(/\bsrc\s*=\s*["']?([^"'\s>]+)/i)?.[1];
      if (!src && s[2].trim()) inline.push(`${p}: inline <script>`);
      else if (src && /^(https?:)?\/\//i.test(src)) inline.push(`${p}: remote script ${src}`);
      else if (src && !(src.replace(/^\.\//, "") in files)) inline.push(`${p}: missing ${src}`);
    }
    for (const a of h.matchAll(/\s(on[a-z]+)\s*=/gi)) inline.push(`${p}: inline ${a[1]} handler`);
    if (/javascript:/i.test(h)) inline.push(`${p}: javascript: URL`);
  }
  add("csp", !inline.length, inline.length ? `MV3 blocks these: ${inline.join("; ")}` : `${html.length} HTML page(s): no inline or remote scripts (MV3 CSP)`);
  if (m.content_security_policy) add("csp_custom", !/unsafe-eval|https?:/.test(JSON.stringify(m.content_security_policy)), "custom content_security_policy must not allow eval or remote sources");
  const js = Object.keys(files).filter((p) => p.endsWith(".js"));
  const jsBad: string[] = [];
  for (const p of js) {
    const src = text(p)!;
    try { new Script(src, { filename: p }); } catch (e) { jsBad.push(`${p}: ${(e as Error).message}`); }
    if (/\beval\s*\(|new\s+Function\s*\(/.test(src)) jsBad.push(`${p}: eval/new Function isn't allowed in MV3`);
    if (/import\s*\(\s*["'`]https?:|importScripts\s*\(\s*["'`]https?:/.test(src)) jsBad.push(`${p}: loads remote code`);
    for (const s of src.matchAll(/importScripts\(\s*["']([^"']+)["']/g)) if (!(s[1] in files)) jsBad.push(`${p}: importScripts(${s[1]}) not found`);
  }
  add("js", !jsBad.length, jsBad.length ? jsBad.join("; ") : `${js.length} script(s) parse; no eval or remote code`);
  if (m.default_locale) {
    const locs = [...new Set(Object.keys(files).filter((p) => /^_locales\/[^/]+\/messages\.json$/.test(p)).map((p) => p.split("/")[1]))];
    const parsed: Record<string, Record<string, unknown>> = {};
    const lbad: string[] = [];
    for (const l of locs) try { parsed[l] = JSON.parse(text(`_locales/${l}/messages.json`)!); } catch (e) { lbad.push(`${l}: ${(e as Error).message}`); }
    if (!parsed[m.default_locale]) lbad.push(`default_locale ${m.default_locale} has no messages.json`);
    const keys = Object.keys(parsed[m.default_locale] ?? {});
    for (const l of locs) { const miss = keys.filter((k) => !(k in (parsed[l] ?? {}))); if (miss.length) lbad.push(`${l} lacks ${miss.slice(0, 5).join(", ")}`); }
    const used = new Set<string>();
    for (const p of [...html, ...js]) for (const u of text(p)!.matchAll(/(?:data-i18n="|getMessage\(\s*"|\bt\(\s*"|\bmsg\(\s*")(\w+)"/g)) used.add(u[1]);
    const undef = [...used].filter((k) => !keys.includes(k));
    if (undef.length) lbad.push(`messages used but not defined: ${undef.join(", ")}`);
    add("i18n", !lbad.length, lbad.length ? lbad.join("; ") : `Locales ${locs.join(", ")} define all ${keys.length} messages used`);
  }
  const size = Object.entries(files).reduce((n, [, v]) => n + (typeof v === "string" ? Buffer.byteLength(v) : v.length), 0);
  add("size", size < 10 * 1024 * 1024, `${Math.round(size / 1024)} KiB in ${Object.keys(files).length} files`, "warn");
  if (task) {
    const tp = checkTask(task);
    add("task", !tp.length, tp.length ? tp.map((p) => `${p.level === "error" ? "✗" : "!"} ${p.where}: ${p.message}`).join("; ") : `${task.steps.length} step(s), ${task.settings.length} setting(s): consistent`, tp.some((p) => p.level === "error") ? "error" : "warn");
  }
  return checks;
}

export function zip(files: Files): Uint8Array {
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const [p, v] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) if (!NOT_IN_ZIP.has(p)) entries[p] = [typeof v === "string" ? strToU8(v) : v, { mtime: new Date("2026-01-01T00:00:00Z") }];
  return zipSync(entries, { level: 9 });
}
export const zipExcluded = NOT_IN_ZIP;

/** 面板里的弹窗静态预览（无脚本）：用扩展自己的 CSS、图标和文案。 */
export function popupPreview(files: Files, lang: "en" | "zh"): string {
  const txt = (p: string) => { const v = files[p]; return typeof v === "string" ? v : v ? Buffer.from(v).toString("utf8") : ""; };
  const msgs = JSON.parse(txt(`_locales/${lang === "zh" ? "zh_CN" : "en"}/messages.json`) || "{}");
  const t = (k: string, subs: string[] = []) => String(msgs[k]?.message ?? k).replace(/\$p(\d)\$/g, (_, n) => subs[+n - 1] ?? "");
  const task = JSON.parse(txt("task.json"));
  const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const q = (x: string) => `“${x}”`;
  const d = (s: any) => s.note || (s.action === "open" ? t("dOpen", [s.url]) : s.action === "click" ? t("dClick", [s.text ? q(s.text) : s.selector]) : s.action === "fill" ? t("dFill", [s.selector, q(s.value)]) : s.action === "wait" ? (s.selector ? t(s.gone ? "dWaitGone" : "dWait", [s.selector]) : t("dWaitMs", [String((s.ms || 1000) / 1000)])) : s.action === "extract" ? t(s.next ? "dExtractPages" : "dExtract", [s.selector, Object.keys(s.fields || { text: 1 }).join(", "), String(s.maxPages || 5)]) : s.selector ? t("dDownloadLinks", [s.selector]) : t("dDownload", [s.from || "rows", (s.format || "csv").toUpperCase()]));
  const icon = files["icons/icon32.png"] ? `data:image/png;base64,${Buffer.from(files["icons/icon32.png"] as Uint8Array).toString("base64")}` : "";
  const need = (task.settings || []).filter((x: any) => x.required && !x.default);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${txt("ui.css")} body.popup{margin:0 auto}</style></head><body class="popup"><header><img src="${icon}" width="20" height="20" alt=""><h1>${esc(task.name)}</h1></header><p class="muted">${esc(task.description || "")}</p>${need.length ? `<div class="warn">${esc(t("needSettings", [need.map((x: any) => x.label || x.key).join(", ")]))}</div>` : ""}<button class="primary" id="run">${esc(t("run"))}</button><ol>${task.steps.map((s: any) => `<li>${esc(d(s))}</li>`).join("")}</ol><footer><a href="#">${esc(t("settings"))}</a><span class="muted"></span></footer></body></html>`;
}
