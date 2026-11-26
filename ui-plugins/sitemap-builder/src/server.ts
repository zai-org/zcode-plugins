import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { pageUrl, parsePage, resolveLink, xmlEsc } from "./html.ts";

export const NAME = "sitemap-builder";
export const VERSION = "0.1.0";

const FREQ = ["", "always", "hourly", "daily", "weekly", "monthly", "yearly", "never"];
const baseOf = (p: Project) => String(p.settings.baseUrl ?? "").trim().replace(/\/+$/, "");
const clean = (p: Project) => p.settings.cleanUrls !== false;
interface Broken { page: string; link: string; target: string; kind: string }
const brokenOf = (p: Project) => (p.meta.broken as Broken[]) ?? [];
const sel = (p: Project) => p.rows.filter((r) => r.include !== false);
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function sitemap(p: Project) {
  const b = baseOf(p);
  const urls = sel(p).map((r) => `  <url>\n    <loc>${xmlEsc(pageUrl(String(r.path), b, clean(p)))}</loc>${r.lastmod ? `\n    <lastmod>${xmlEsc(String(r.lastmod))}</lastmod>` : ""}${r.changefreq ? `\n    <changefreq>${r.changefreq}</changefreq>` : ""}${r.priority !== "" && r.priority !== undefined && r.priority !== null ? `\n    <priority>${Number(r.priority).toFixed(1)}</priority>` : ""}\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
function robots(p: Project) {
  const dis = String(p.settings.disallow ?? "").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  return `User-agent: *\n${dis.length ? dis.map((d) => `Disallow: ${d.startsWith("/") ? d : `/${d}`}`).join("\n") : "Allow: /"}\n\nSitemap: ${baseOf(p)}/sitemap.xml\n`;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "sitemap",
  title: ["站点地图生成", "Sitemap Builder"],
  openDescription:
    "For a static website folder (HTML files), build sitemap.xml and robots.txt and check internal links. Every .html page becomes a row with its URL (base URL + path; clean URLs drop index.html and .html), title, lastmod (from <meta name=date>/article:modified_time, else the file date), changefreq and priority (home 1.0, depth-based defaults). Pages with <meta name=robots content=noindex> or a canonical pointing elsewhere are left out by default. Every <a href>, <img src>, <script src> and stylesheet link to the same site is resolved (relative, root-relative, absolute same-domain URLs; folder → index.html; extensionless → .html) and missing targets are reported per page. Exports sitemap.xml, robots.txt (with Disallow paths) and link-report.csv.",
  inputs: { exts: [".html", ".htm"], min: 1, max: 1, folders: true, label: ["选择网站文件夹（含 index.html 的那一层）", "Pick the site folder (the one with index.html)"] },
  settings: [
    { key: "baseUrl", label: ["网站地址（如 https://example.com）", "Site URL (e.g. https://example.com)"], type: "text", default: "", reload: true },
    { key: "cleanUrls", label: ["简洁网址（去掉 .html 和 index.html）", "Clean URLs (no .html / index.html)"], type: "bool", default: true },
    { key: "lastmod", label: ["没有日期时用文件修改时间", "Use file date when the page has none"], type: "bool", default: true, reload: true },
    { key: "disallow", label: ["robots.txt 禁止抓取的路径（逗号分隔）", "Disallow in robots.txt (comma-separated)"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "include", label: ["收录", "Include"], type: "bool" },
    { key: "path", label: ["文件", "File"], readOnly: true },
    { key: "_url", label: ["网址", "URL"], readOnly: true, wide: true },
    { key: "title", label: ["标题", "Title"], readOnly: true },
    { key: "lastmod", label: ["最后修改", "Last modified"], type: "date" },
    { key: "changefreq", label: ["更新频率", "Change freq"], type: "select", options: FREQ },
    { key: "priority", label: ["优先级 0–1", "Priority 0–1"], type: "number" },
    { key: "_broken", label: ["坏链接", "Broken links"], readOnly: true },
  ],
  async load({ ws, files, settings }) {
    const folder = files[0].replace(/\/+$/, "");
    const root = folder === "." ? "" : `${folder}/`;
    const list = await ws.list({ dir: folder, exts: [], limit: 20000 });
    const all = new Set(list.map((f) => f.path.slice(root.length)));
    const pages = list.filter((f) => /\.html?$/i.test(f.path));
    if (!pages.length) throw new KitError("no_pages", "No .html files in this folder.");
    const rows: Row[] = [];
    const broken: Broken[] = [];
    const base = String(settings.baseUrl ?? "").trim();
    const exists = (t: string) => all.has(t) || all.has(`${t}.html`) || all.has(`${t}/index.html`) || (t.endsWith("/index.html") && all.has(t.replace(/\/index\.html$/, ".html")));
    for (const f of pages) {
      const rel = f.path.slice(root.length);
      const info = parsePage((await ws.read(f.path, 20 * 1024 * 1024)).toString("utf8"));
      let n = 0;
      for (const l of info.links) {
        const t = resolveLink(rel, l.url, base);
        if (t === undefined) continue;
        if (t === "\u0000outside" || !exists(t)) { broken.push({ page: rel, link: l.url, target: t === "\u0000outside" ? "(outside the site folder)" : t, kind: l.kind }); n++; }
      }
      const isHome = /^index\.html?$/i.test(rel);
      const segs = rel.replace(/(^|\/)index\.html?$/i, "").split("/").filter(Boolean).length;
      const norm = (u: string) => u.replace(/^http:/, "https:").replace(/\/+$/, "");
      const canonicalElsewhere = !!info.canonical && !!base && /^https?:/i.test(info.canonical) && ![pageUrl(rel, base, true), pageUrl(rel, base, false)].map(norm).includes(norm(info.canonical));
      const lastmod = info.date || (settings.lastmod !== false ? (await ws.mtime(f.path)).toISOString().slice(0, 10) : "");
      rows.push({ include: !info.noindex && !/^404\.html?$/i.test(rel) && !canonicalElsewhere, path: rel, title: info.title, lastmod, changefreq: "", priority: isHome ? 1 : Math.max(0.3, 1 - 0.2 * segs), noindex: info.noindex, canonical: info.canonical, brokenCount: n });
    }
    rows.sort((a, b) => (a.path === "index.html" ? -1 : b.path === "index.html" ? 1 : String(a.path).localeCompare(String(b.path), "en")));
    for (const r of rows) r.priority = Math.round(Number(r.priority) * 10) / 10;
    return { rows, meta: { broken, folder } };
  },
  compute(p) {
    const issues: Issue[] = [];
    const b = baseOf(p);
    if (!b) issues.push({ level: "error", key: "baseUrl", message: "Set the site URL (e.g. https://example.com) — sitemaps need absolute URLs." });
    else if (!/^https?:\/\/[^/\s]+/i.test(b)) issues.push({ level: "error", key: "baseUrl", message: `“${b}” is not a full URL; start with https://.` });
    const rows = p.rows.map((r, i) => {
      const pr = r.priority === "" || r.priority === undefined || r.priority === null ? undefined : Number(r.priority);
      if (pr !== undefined && (!(pr >= 0) || pr > 1)) issues.push({ level: "error", row: i, key: "priority", message: `${r.path}: priority must be between 0 and 1.` });
      if (r.lastmod && !/^\d{4}-\d{2}-\d{2}$/.test(String(r.lastmod))) issues.push({ level: "error", row: i, key: "lastmod", message: `${r.path}: last modified must be YYYY-MM-DD.` });
      if (r.include !== false && r.noindex) issues.push({ level: "warn", row: i, message: `${r.path} has noindex but is included in the sitemap.` });
      if (r.include === false && r.canonical && !r.noindex) issues.push({ level: "info", row: i, message: `${r.path}: left out — canonical points to ${r.canonical}.` });
      if (r.include !== false && !r.title) issues.push({ level: "warn", row: i, message: `${r.path} has no <title>.` });
      return { ...r, _url: b ? pageUrl(String(r.path), b, clean(p)) : `/${r.path}`, _broken: r.brokenCount || "" };
    });
    const broken = brokenOf(p);
    for (const x of broken.slice(0, 50)) issues.push({ level: "warn", row: p.rows.findIndex((r) => r.path === x.page), message: `${x.page}: broken ${x.kind === "page" ? "link" : "asset"} “${x.link}” → ${x.target} not found.` });
    if (broken.length > 50) issues.push({ level: "warn", message: `…and ${broken.length - 50} more broken links (see link-report.csv).` });
    const preview = `<p><b>${sel(p).length}</b> of ${p.rows.length} pages in the sitemap · <b style="color:${broken.length ? "#dc2626" : "#16a34a"}">${broken.length}</b> broken links</p><pre style="white-space:pre-wrap;font-size:12px;max-height:520px;overflow:auto">${esc(b ? sitemap(p).slice(0, 4000) : "(set the site URL)")}</pre>`;
    return { rows, issues, preview, summary: `${sel(p).length} pages · ${broken.length} broken links`, stats: { pages: sel(p).length, broken: broken.length } };
  },
  exports: [
    {
      id: "sitemap", label: ["sitemap.xml + robots.txt", "sitemap.xml + robots.txt"], description: "sitemap.xml (sitemaps.org 0.9) and robots.txt pointing to it",
      async run({ project, write, computed }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        return [await write("sitemap.xml", sitemap(project)), await write("robots.txt", robots(project))];
      },
    },
    {
      id: "links", label: ["链接检查报告", "Link report"], description: "link-report.csv — every broken internal link or asset: page, link as written, resolved file",
      async run({ project, write }: ExportCtx) {
        const lines = brokenOf(project).map((b) => [b.page, b.link, b.target, b.kind].map(csvCell).join(","));
        return [await write("link-report.csv", "\uFEFF" + ["page,link,resolved,kind", ...lines].join("\r\n") + "\r\n")];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
