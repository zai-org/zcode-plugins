import { z } from "zod";

/** 列名允许中日韩文字（DRYRUN #29：书名/价格 曾被拒）。用显式区段而非 \p{L}，这样不带 u 标志的 JSON Schema 校验器也能用。 */
export const FIELD_NAME = /^[\w\- \u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF10-\uFF19]{1,40}$/;

// 一个"网页任务"：用户描述的重复操作，整理成步骤；生成的扩展按顺序执行。
const base = { note: z.string().max(200).optional().describe("Human description shown in the popup instead of the generated one"), timeoutMs: z.number().int().min(500).max(120_000).optional(), optional: z.boolean().optional().describe("Skip instead of failing when the element is missing") };
const selector = z.string().min(1).max(500).describe("CSS selector");
export const StepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), url: z.string().min(1).describe("http(s) URL; may use {{setting}} placeholders"), newTab: z.boolean().optional(), ...base }),
  z.object({ action: z.literal("click"), selector, text: z.string().max(200).optional().describe("Only elements whose text contains this"), ...base }),
  z.object({ action: z.literal("fill"), selector, value: z.string().max(5000).describe("Text, option value/label for <select>, true/false for checkboxes; {{setting}} / {{today}} placeholders allowed"), submit: z.boolean().optional().describe("Submit the form afterwards"), ...base }),
  z.object({ action: z.literal("wait"), selector: selector.optional(), text: z.string().max(200).optional(), gone: z.boolean().optional().describe("Wait until it disappears"), ms: z.number().int().min(0).max(60_000).optional(), ...base }),
  z.object({ action: z.literal("extract"), selector: selector.describe("One element per record (e.g. table rows)"), fields: z.record(z.string().regex(FIELD_NAME, "Column names: 1–40 letters (incl. Chinese/Japanese/Korean), digits, space, _ or -"), z.string().max(300)).optional().describe('Column → "css" (text), "css@attr" (attribute; href/src are absolute), "@attr" or "." (the record itself). Omit for plain text'), into: z.string().regex(/^[\w-]{1,40}$/).optional().describe('Dataset name (default "rows")'), next: selector.optional().describe("Next-page link/button to follow"), maxPages: z.number().int().min(1).max(50).optional(), limit: z.number().int().min(1).max(100_000).optional(), ...base }),
  z.object({ action: z.literal("download"), from: z.string().regex(/^[\w-]{1,40}$/).optional().describe("Dataset to save (default rows)"), format: z.enum(["csv", "json"]).optional(), selector: selector.optional().describe("Instead of a dataset: download the files these links point to"), filename: z.string().max(200).optional().describe("Path inside the Downloads folder; placeholders allowed"), limit: z.number().int().min(1).max(100).optional(), ...base }),
]);
export const SettingSchema = z.object({ key: z.string().regex(/^[A-Za-z][\w]{0,39}$/), label: z.string().max(80).optional(), type: z.enum(["text", "number", "date", "select"]).optional(), options: z.array(z.string().max(100)).max(100).optional(), default: z.string().max(2000).optional(), required: z.boolean().optional(), placeholder: z.string().max(100).optional(), help: z.string().max(300).optional() });
export type Step = z.infer<typeof StepSchema>;
export type Setting = z.infer<typeof SettingSchema>;

export interface Task { name: string; description: string; version: string; steps: Step[]; settings: Setting[]; sites: string[]; timeoutMs?: number; color?: string }
export interface Permission { name: string; kind: "permission" | "host"; en: string; zh: string }
export interface Problem { level: "error" | "warn"; where: string; message: string }

const PLACE = /\{\{\s*([\w.-]+)\s*\}\}/g;
const BUILTIN = new Set(["today", "now"]);
export const slug = (s: string) => s.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "web-task";

/** "example.com" / "https://x.com/a" / "*.x.com" / match pattern → Chrome match pattern (scheme + host, any path). */
export function toPattern(site: string): string | null {
  const s = site.trim();
  if (!s) return null;
  if (s === "<all_urls>") return s;
  const m = s.match(/^(\*|https?):\/\/([^/]+)(\/.*)?$/i);
  if (m) {
    const host = m[2].replace(/:\d+$/, "").toLowerCase();
    if (!/^(\*|(\*\.)?[a-z0-9.-]+|\[[0-9a-f:]+\])$/i.test(host)) return null;
    return `${m[1].toLowerCase()}://${host}/*`;
  }
  if (/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s) || /^localhost$/i.test(s)) return `https://${s.toLowerCase()}/*`;
  return null;
}
export const MATCH_PATTERN = /^(<all_urls>|(\*|https?|wss?|ftp|file):\/\/(\*|(\*\.)?[^/*:]+|\[[0-9a-fA-F:]+\])?\/.*)$/;
export function patternCovers(pattern: string, url: string): boolean {
  if (pattern === "<all_urls>") return true;
  const m = pattern.match(/^(\*|[a-z]+):\/\/([^/]*)\//);
  if (!m) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const scheme = u.protocol.slice(0, -1);
  if (m[1] === "*" ? !["http", "https"].includes(scheme) : m[1] !== scheme) return false;
  const host = m[2];
  if (host === "*") return true;
  if (host.startsWith("*.")) return u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1));
  return u.hostname === host;
}

/** 校验并规范化任务；返回问题列表（error 会阻止生成）。 */
export function checkTask(task: Task): Problem[] {
  const p: Problem[] = [];
  const keys = new Set(task.settings.map((s) => s.key));
  const dup = task.settings.map((s) => s.key).filter((k, i, a) => a.indexOf(k) !== i);
  for (const k of new Set(dup)) p.push({ level: "error", where: "settings", message: `Setting "${k}" is defined twice.` });
  for (const s of task.settings) if (s.type === "select" && !s.options?.length) p.push({ level: "error", where: `settings.${s.key}`, message: "A select setting needs options." });
  if (!task.steps.length) p.push({ level: "error", where: "steps", message: "Add at least one step." });
  const datasets = new Set<string>();
  task.steps.forEach((s, i) => {
    const at = `step ${i + 1} (${s.action})`;
    for (const v of [("url" in s ? s.url : ""), ("value" in s ? s.value : ""), ("filename" in s ? s.filename : "") ?? "", ("text" in s ? s.text : "") ?? ""]) for (const m of String(v ?? "").matchAll(PLACE)) if (!keys.has(m[1]) && !BUILTIN.has(m[1])) p.push({ level: "error", where: at, message: `Unknown placeholder {{${m[1]}}}; add a setting with key "${m[1]}" (built-ins: today, now).` });
    if (s.action === "open") {
      const probe = s.url.replace(PLACE, "x");
      let u: URL | null = null;
      try { u = new URL(probe); } catch { /* below */ }
      if (!u || !/^https?:$/.test(u.protocol)) p.push({ level: "error", where: at, message: `Open needs an http(s) URL (got ${s.url}).` });
      else if (/\{\{/.test(s.url.replace(/^\w+:\/\//, "").split(/[/?#]/)[0])) p.push({ level: "error", where: at, message: "Placeholders can't change the site (host) of an Open URL; the extension only gets access to fixed sites." });
    }
    if (s.action === "wait" && !s.selector && !s.ms) p.push({ level: "error", where: at, message: "Wait needs a selector or ms." });
    if (s.action === "extract") datasets.add(s.into ?? "rows");
    if (s.action === "download" && !s.selector && !datasets.has(s.from ?? "rows")) p.push({ level: "error", where: at, message: `Nothing extracted into "${s.from ?? "rows"}" before this download.` });
    if (s.action === "download" && s.selector && s.format) p.push({ level: "warn", where: at, message: "format is ignored when downloading linked files." });
    if ("filename" in s && s.filename && (/(^|\/)\.\.(\/|$)/.test(s.filename) || s.filename.startsWith("/"))) p.push({ level: "error", where: at, message: "filename must be a relative path inside Downloads." });
    if (s.action === "fill" && /pass(word)?|pwd|otp|token|secret/i.test(s.selector + " " + s.value)) p.push({ level: "warn", where: at, message: "Looks like a password or code. Logging in is out of scope: sign in yourself before running; don't store secrets in the task." });
  });
  if (task.steps[0] && task.steps[0].action !== "open") p.push({ level: "warn", where: "step 1", message: "The task doesn't start with Open, so it runs on whatever tab is active when you press Run (uses activeTab)." });
  for (const site of task.sites) {
    const pat = toPattern(site);
    if (!pat) p.push({ level: "error", where: "sites", message: `"${site}" isn't a site or match pattern.` });
    else if (pat === "<all_urls>" || /:\/\/\*\//.test(pat)) p.push({ level: "error", where: "sites", message: `"${site}" would grant access to every website; list the specific sites instead.` });
  }
  return p;
}

const tabsOnly = (task: Task) => task.steps[0]?.action !== "open";
/** 最小权限：只列步骤用到的。 */
export function permissions(task: Task): Permission[] {
  const out: Permission[] = [
    { name: "storage", kind: "permission", en: "Keeps your settings and the last run's results in this browser.", zh: "在本浏览器里保存你的设置和上次运行的结果。" },
    { name: "scripting", kind: "permission", en: "Runs the click / fill / wait / extract steps inside the task's pages, only when you press Run.", zh: "只在你点“运行任务”时，在任务网页里执行点击、填写、等待、提取这些步骤。" },
  ];
  if (task.steps.some((s) => s.action === "download")) out.push({ name: "downloads", kind: "permission", en: "Saves the extracted data (CSV/JSON) or the linked files to your Downloads folder.", zh: "把提取的数据（CSV/JSON）或链接的文件保存到“下载”文件夹。" });
  if (tabsOnly(task)) out.push({ name: "activeTab", kind: "permission", en: "Works on the tab you are looking at when you click the extension, and on no other tab.", zh: "只在你点开扩展时正在看的那个标签页上工作，不碰其他标签页。" });
  for (const h of hostPatterns(task)) out.push({ name: h, kind: "host", en: `Lets the steps open and read pages on ${h.replace(/^\w+:\/\/|\/\*$/g, "")}. No other site is accessible.`, zh: `允许步骤打开并读取 ${h.replace(/^\w+:\/\/|\/\*$/g, "")} 上的网页；其他网站都无法访问。` });
  return out;
}
export function hostPatterns(task: Task): string[] {
  const set = new Set<string>();
  for (const s of task.steps) if (s.action === "open") { const pat = toPattern(s.url.replace(PLACE, "x").replace(/\?.*$/, "")); if (pat) set.add(pat); }
  for (const site of task.sites) { const pat = toPattern(site); if (pat && pat !== "<all_urls>" && !/:\/\/\*\//.test(pat)) set.add(pat); }
  return [...set];
}
