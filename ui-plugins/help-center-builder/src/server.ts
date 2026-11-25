import { readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MiniSearch from "minisearch";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { type Doc, isDocPath, parseDoc, sha } from "./docs.ts";
import { type Model, REASONS, type SiteConf, TEMPLATE_VERSION, buildModel, detectLang, plan, searchDocs } from "./site.ts";

export const NAME = "help-center-builder";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const STORE = ".help-center/builds.json";
const CONFIG = "help-center.json";
const FIELDS = ["title", "headings", "tags", "text"];
const RUNTIME_ASSETS = ["style.css", "search.js", "tokenize.js", "minisearch.js"];

export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }
export interface Issue { level: "error" | "warn" | "info"; src: string; message: string }
interface Manifest { docs: string; out: string; builtAt: string; pages: Record<string, Record<string, string>>; files: Record<string, string>; site: SiteConf; summary: Summary }
export interface Rebuilt { out: string; kind: string; reasons: string[]; src?: string }
export interface Summary { pages: number; articles: number; categories: { name: string; out: string; count: number }[]; rebuilt: Rebuilt[]; unchanged: number; removed: string[]; copied: string[]; issues: Issue[]; ms: number; full: boolean; first: boolean; searchRebuilt: boolean; lang: string; bytes: number }

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const assets = join(options.assetRoot, "runtime/assets");
  // 与站点浏览器端完全相同的分词源码（同一个文件），保证索引和查询切词一致。
  const hcTokenize = new Function(`${readFileSync(join(assets, "tokenize.js"), "utf8")}\nreturn hcTokenize;`)() as (s: string) => string[];
  const { server, tool } = createKitServer({ name: NAME, version: VERSION, panelUri: PANEL_URI, surface: "editor", panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"), log: options.log });
  const load = async (): Promise<Record<string, Manifest>> => ((await ws.exists(STORE)) ? JSON.parse(await ws.readText(STORE)).builds ?? {} : {});
  const save = async (all: Record<string, Manifest>) => ws.write(STORE, JSON.stringify({ version: 1, builds: all }, null, 1) + "\n");
  const norm = (p: string, what: string) => { const r = p.replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\.\//, "") || "."; ws.resolve(r); if (r.startsWith("..") || r.startsWith("/")) throw new KitError("bad_path", `${what} must be inside the workspace.`); return r; };

  async function read(docsDir: string, overrides: Partial<SiteConf>, skip: string[] = []) {
    if (!(await ws.exists(docsDir))) throw new KitError("not_found", `Folder ${docsDir}/ not found.`);
    // 输出目录（以及以前建过的站点）可能就在文档目录里面（例如文档在工作区根目录），不能再当成文档扫进来。
    const files = (await ws.list({ dir: docsDir, limit: 5000 })).filter((f) => !skip.some((o) => f.path === o || f.path.startsWith(`${o}/`)));
    const relOf = (p: string) => (docsDir === "." ? p : p.slice(docsDir.length + 1));
    const docs: Doc[] = [];
    const assetsIn: { path: string; rel: string }[] = [];
    let conf: Partial<SiteConf> & { categories?: SiteConf["categories"] } = {};
    const issues: Issue[] = [];
    for (const f of files) {
      const r = relOf(f.path);
      if (r === CONFIG) { try { conf = JSON.parse(await ws.readText(f.path)); } catch (e) { issues.push({ level: "error", src: r, message: `Invalid JSON: ${(e as Error).message}` }); } continue; }
      if (isDocPath(r)) { if (f.size > 5 * 1024 * 1024) { issues.push({ level: "warn", src: r, message: "Skipped: larger than 5 MB." }); continue; } docs.push(parseDoc(r, await ws.readText(f.path))); }
      else assetsIn.push({ path: f.path, rel: r });
    }
    if (!docs.length) throw new KitError("no_docs", `No Markdown or HTML files in ${docsDir}/.`);
    const site: SiteConf = {
      title: overrides.title ?? conf.title ?? "Help Center",
      description: overrides.description ?? conf.description ?? "",
      accent: overrides.accent ?? conf.accent ?? "#2563eb",
      baseUrl: overrides.baseUrl ?? conf.baseUrl,
      footer: conf.footer,
      logo: conf.logo,
      lang: (overrides.lang ?? conf.lang ?? detectLang(docs)) === "zh-CN" ? "zh-CN" : "en",
      categories: Array.isArray(conf.categories) ? conf.categories : [],
    };
    if (!/^#[0-9a-f]{6}$/i.test(site.accent)) { issues.push({ level: "warn", src: CONFIG, message: `accent “${site.accent}” isn't #rrggbb; using #2563eb.` }); site.accent = "#2563eb"; }
    if (site.baseUrl && !/^https?:\/\/[^\s]+$/.test(site.baseUrl)) { issues.push({ level: "warn", src: CONFIG, message: `baseUrl “${site.baseUrl}” isn't an http(s) URL; ignored.` }); site.baseUrl = undefined; }
    const model = buildModel(docs, site);
    issues.push(...check(model, docs, new Set(assetsIn.map((a) => a.rel))));
    return { model, assetsIn, issues, docs };
  }

  function check(m: Model, all: Doc[], assetSet: Set<string>): Issue[] {
    const out: Issue[] = [];
    const docBy = new Map(all.map((d) => [d.src, d]));
    // 文档间链接按“去掉扩展名的路径”匹配：a.md、a.html 都指向同一篇（输出都是 a.html）。
    const stem = (p: string) => p.replace(/\.(md|markdown|html?)$/i, "");
    const byStem = new Map(all.map((d) => [stem(d.src), d]));
    const findDoc = (p: string) => byStem.get(stem(p));
    const byOut = new Map<string, string>();
    for (const d of all) {
      if (byOut.has(d.out)) out.push({ level: "error", src: d.src, message: `Same output page as ${byOut.get(d.out)} (${d.out}); rename one.` });
      byOut.set(d.out, d.src);
      if (d.draft) { out.push({ level: "info", src: d.src, message: "Draft: not published." }); continue; }
      if (d.titleFromFile) out.push({ level: "warn", src: d.src, message: `No title; using “${d.title}” from the file name. Add a # heading or title: in front matter.` });
      if (!d.isIntro && d.text.length < 20) out.push({ level: "warn", src: d.src, message: "Almost empty article." });
      if (d.stripped.length) out.push({ level: "info", src: d.src, message: `Removed ${d.stripped.join(", ")} (help articles don't run scripts).` });
      for (const l of d.links) {
        if (l.kind === "external") continue;
        if (l.target === null) { out.push({ level: "error", src: d.src, message: `Link ${l.href} points outside the docs folder.` }); continue; }
        if (l.kind === "asset") { if (!assetSet.has(l.target)) out.push({ level: "error", src: d.src, message: `Broken link: ${l.href} (file not found).` }); continue; }
        const t = docBy.get(l.target) ?? findDoc(l.target);
        if (!t) { out.push({ level: "error", src: d.src, message: `Broken link: ${l.href} (no such article).` }); continue; }
        if (t.draft) out.push({ level: "warn", src: d.src, message: `Links to draft ${t.src}.` });
        if (l.anchor && !t.ids.includes(l.anchor)) out.push({ level: "warn", src: d.src, message: `Missing anchor: ${l.href} (no #${l.anchor} in ${t.src}).` });
      }
      for (const r of d.related) if (!m.docs.some((x) => x.src === r || x.out === r || x.src.replace(/\.\w+$/, "") === r.replace(/\.\w+$/, ""))) out.push({ level: "warn", src: d.src, message: `related: “${r}” isn't a published article.` });
    }
    const titles = new Map<string, string>();
    for (const d of m.docs) { const k = d.title.toLowerCase(); if (titles.has(k)) out.push({ level: "warn", src: d.src, message: `Same title as ${titles.get(k)}: “${d.title}”.` }); else titles.set(k, d.src); }
    for (const c of m.site.categories) if (!m.categories.some((x) => x.key === (c.key ?? c.folder) || x.name === c.name)) out.push({ level: "info", src: CONFIG, message: `Category “${c.name ?? c.folder}” has no articles.` });
    return out;
  }

  async function build(docsDir: string, outDir: string, overrides: Partial<SiteConf>, full: boolean) {
    const t0 = Date.now();
    const { model, assetsIn, issues } = await read(docsDir, overrides, [outDir, ...Object.keys(await load())]);
    if (issues.some((i) => i.level === "error" && /Same output page/.test(i.message))) throw new KitError("conflict", issues.filter((i) => /Same output page/.test(i.message)).map((i) => `${i.src}: ${i.message}`).join("\n"));
    const all = await load();
    const prev = all[outDir];
    const first = !prev;
    const files: Record<string, string> = {};
    const pagesParts: Record<string, Record<string, string>> = {};
    const rebuilt: Rebuilt[] = [];
    const copied: string[] = [];
    let unchanged = 0, bytes = 0;
    const write = async (p: string, data: string | Uint8Array) => { await ws.write(`${outDir}/${p}`, data); bytes += typeof data === "string" ? Buffer.byteLength(data) : data.length; };
    const exists = (p: string) => ws.exists(`${outDir}/${p}`);
    for (const p of plan(model)) {
      pagesParts[p.out] = p.parts;
      const old = prev?.pages[p.out];
      let reasons: string[] = [];
      if (full) reasons = ["full"];
      else if (!old) reasons = ["new"];
      else {
        reasons = Object.keys(p.parts).filter((k) => old[k] !== p.parts[k]);
        if (!reasons.length && !(await exists(p.out))) reasons = ["missing"];
      }
      files[p.out] = sha(JSON.stringify(p.parts));
      if (!reasons.length) { unchanged++; continue; }
      await write(p.out, p.render());
      rebuilt.push({ out: p.out, kind: p.kind, reasons, ...(p.src ? { src: p.src } : {}) });
    }
    for (const a of RUNTIME_ASSETS) {
      const data = await readFile(join(assets, a));
      const h = sha(data);
      files[`assets/${a}`] = h;
      if (full || prev?.files[`assets/${a}`] !== h || !(await exists(`assets/${a}`))) { await write(`assets/${a}`, data); copied.push(`assets/${a}`); }
    }
    for (const a of assetsIn) {
      const data = await ws.read(a.path);
      const h = sha(data);
      files[a.rel] = h;
      if (full || prev?.files[a.rel] !== h || !(await exists(a.rel))) { await write(a.rel, data); copied.push(a.rel); }
    }
    const sd = searchDocs(model);
    const ms = new MiniSearch({ fields: FIELDS, storeFields: [], tokenize: hcTokenize, processTerm: (t: string) => t });
    ms.addAll(sd.map(({ show: _s, ...d }) => d));
    const searchH = sha(JSON.stringify(sd) + TEMPLATE_VERSION);
    files["search-index.js"] = searchH;
    const searchRebuilt = full || prev?.files["search-index.js"] !== searchH || !(await exists("search-index.js"));
    if (searchRebuilt) await write("search-index.js", `window.HC_SEARCH=${JSON.stringify({ fields: FIELDS, index: ms.toJSON(), docs: Object.fromEntries(sd.map((d) => [d.id, d.show])) }).replace(/</g, "\\u003c")};\n`);
    if (model.site.baseUrl) {
      const base = model.site.baseUrl.replace(/\/+$/, "");
      const urls = plan(model).filter((p) => p.kind !== "404" && p.kind !== "search").map((p) => `  <url><loc>${base}/${p.out.split("/").map(encodeURIComponent).join("/").replace(/&/g, "&amp;")}</loc>${p.src && model.bySrc.get(p.src)?.updated ? `<lastmod>${model.bySrc.get(p.src)!.updated}</lastmod>` : ""}</url>`);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
      const h = sha(xml);
      files["sitemap.xml"] = h;
      if (full || prev?.files["sitemap.xml"] !== h || !(await exists("sitemap.xml"))) { await write("sitemap.xml", xml); copied.push("sitemap.xml"); }
    }
    const removed: string[] = [];
    for (const old of Object.keys(prev?.files ?? {})) if (!(old in files)) { await rm(ws.resolve(`${outDir}/${old}`), { force: true }); removed.push(old); }
    const summary: Summary = { pages: Object.keys(pagesParts).length, articles: model.docs.length, categories: model.categories.map((c) => ({ name: c.name, out: c.out, count: c.docs.length })), rebuilt, unchanged, removed, copied, issues, ms: Date.now() - t0, full, first, searchRebuilt, lang: model.site.lang, bytes };
    all[outDir] = { docs: docsDir, out: outDir, builtAt: new Date().toISOString(), pages: pagesParts, files, site: model.site, summary };
    await save(all);
    return { summary, model };
  }

  const describe = (docs: string, out: string, s: Summary) => {
    const errs = s.issues.filter((i) => i.level === "error"), warns = s.issues.filter((i) => i.level === "warn");
    return [
      `${s.first ? "Built" : s.full ? "Fully rebuilt" : "Updated"} ${out}/ from ${docs}/: ${s.articles} articles in ${s.categories.length} categories, ${s.pages} pages (${s.ms} ms).`,
      s.first || s.full ? `Wrote all ${s.rebuilt.length} pages${s.copied.length ? ` and ${s.copied.length} assets` : ""}.` : `Rebuilt ${s.rebuilt.length} page(s), ${s.unchanged} unchanged${s.removed.length ? `, removed ${s.removed.length}` : ""}${s.copied.length ? `, copied ${s.copied.length} asset(s)` : ""}; search index ${s.searchRebuilt ? "rebuilt" : "unchanged"}.`,
      ...(!s.first && !s.full ? s.rebuilt.slice(0, 40).map((r) => `  ↻ ${r.out} — ${r.reasons.map((k) => REASONS[k]?.en ?? k).join(", ")}`) : []),
      ...s.removed.map((r) => `  ✕ ${r}`),
      errs.length || warns.length ? `Problems: ${errs.length} error(s), ${warns.length} warning(s):` : "No broken links or other problems.",
      ...[...errs, ...warns].slice(0, 30).map((i) => `  ${i.level === "error" ? "✗" : "!"} ${i.src}: ${i.message}`),
      `Open ${out}/index.html in a browser, or upload the ${out}/ folder to any static host (Cloudflare Pages, Netlify, GitHub Pages, S3).`,
    ].join("\n");
  };
  const siteArgs = {
    title: z.string().max(80).optional().describe(`Site title (else ${CONFIG} → "Help Center")`),
    description: z.string().max(200).optional(),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Brand colour"),
    baseUrl: z.string().url().optional().describe("Public URL, for canonical links, sitemap.xml and 404.html"),
    lang: z.enum(["en", "zh-CN"]).optional().describe("Site UI language (auto-detected)"),
  };

  tool("hc_scan", {
    description: `Look at a docs folder (Markdown / HTML, optional ${CONFIG}) without writing anything: categories, articles, language, and problems such as broken links, missing anchors, missing titles and duplicate titles.`,
    input: { docs: z.string().describe("Docs folder"), ...siteArgs }, readOnly: true,
  }, async (i) => {
    const docs = norm(i.docs, "docs");
    const { model, issues, assetsIn } = await read(docs, i, Object.keys(await load()));
    const cats = model.categories.map((c) => ({ name: c.name, out: c.out, articles: c.docs.map((d) => ({ src: d.src, title: d.title, tags: d.tags })) }));
    return {
      text: [`${docs}/: ${model.docs.length} articles in ${cats.length} categories (${model.site.lang}), ${assetsIn.length} other files.`, ...cats.map((c) => `  ${c.name}: ${c.articles.map((a) => a.title).join(" · ")}`), issues.length ? `Problems:\n${issues.map((x) => `  ${x.level === "error" ? "✗" : x.level === "warn" ? "!" : "·"} ${x.src}: ${x.message}`).join("\n")}` : "No problems found."].join("\n"),
      structured: { kind: "scan", docs, site: model.site, categories: cats, issues },
    };
  });

  tool("hc_build", {
    description: "Build (or update) a static help center from a docs folder: home page with category cards, category pages, article pages with breadcrumbs, sidebar, table of contents, related articles and previous/next, full-text search (works offline, Chinese too), 404 and sitemap. Incremental: only pages whose content or dependencies changed are rewritten, and they are listed with the reason.",
    input: { docs: z.string().describe("Docs folder with .md / .html files (sub-folders = categories)"), out: z.string().optional().describe("Output folder (default help-center)"), full: z.boolean().optional().describe("Rewrite every page"), ...siteArgs },
    openPanel: true, timeoutMs: 180_000,
  }, async (i) => {
    const docs = norm(i.docs, "docs");
    const out = norm(i.out ?? "help-center", "out");
    if (out === "." || out === docs || docs.startsWith(`${out}/`)) throw new KitError("bad_out", "Choose an output folder that is separate from the docs folder.");
    const known = await load();
    if (!known[out] && (await ws.exists(`${out}/index.html`))) throw new KitError("exists", `${out}/ already has a site that this plugin didn't build; choose another out.`);
    const { summary } = await build(docs, out, { title: i.title, description: i.description, accent: i.accent, baseUrl: i.baseUrl, lang: i.lang }, !!i.full);
    return { text: describe(docs, out, summary), structured: { kind: "build", docs, out, summary } };
  });

  tool("hc_preview", {
    description: "Static preview of a built page for the panel (styles inlined, scripts removed).",
    input: { out: z.string(), page: z.string().optional() }, readOnly: true, visibility: ["app"],
  }, async (i) => {
    const out = norm(i.out, "out");
    const page = (i.page ?? "index.html").replace(/^\/+/, "");
    if (!page.endsWith(".html") || page.includes("..")) throw new KitError("bad_page", "Choose an .html page of the site.");
    let html = await ws.readText(`${out}/${page}`);
    const css = await ws.readText(`${out}/assets/style.css`).catch(() => "");
    const dir = page.includes("/") ? page.slice(0, page.lastIndexOf("/") + 1) : "";
    html = html.replace(/<link rel="stylesheet"[^>]*>/, `<style>${css}</style>`).replace(/<script\b[\s\S]*?<\/script>/gi, "");
    const imgs = [...html.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^(data:|https?:)/.test(s));
    for (const src of new Set(imgs)) {
      const parts = (dir + decodeURIComponent(src)).split("/"), stack: string[] = [];
      for (const p of parts) { if (p === "..") stack.pop(); else if (p && p !== ".") stack.push(p); }
      const b = await ws.read(`${out}/${stack.join("/")}`, 2 * 1024 * 1024).catch(() => null);
      if (b) html = html.split(`src="${src}"`).join(`src="data:${/\.svg$/i.test(src) ? "image/svg+xml" : /\.png$/i.test(src) ? "image/png" : /\.gif$/i.test(src) ? "image/gif" : /\.webp$/i.test(src) ? "image/webp" : "image/jpeg"};base64,${b.toString("base64")}"`);
    }
    return { text: `${out}/${page}`, structured: { kind: "preview", page, html } };
  });

  tool("hc_state", {
    description: "Panel state: previous builds and candidate docs folders.", input: {}, readOnly: true, visibility: ["app"],
  }, async () => {
    const all = await load();
    const md = await ws.list({ exts: [".md", ".markdown", ".html", ".htm"], limit: 3000 });
    const builtOut = Object.keys(all);
    const folders = new Map<string, number>();
    for (const f of md) {
      if (builtOut.some((o) => f.path.startsWith(`${o}/`))) continue;
      const top = f.path.includes("/") ? f.path.split("/")[0] : ".";
      folders.set(top, (folders.get(top) ?? 0) + 1);
    }
    const builds = Object.values(all).sort((a, b) => b.builtAt.localeCompare(a.builtAt)).map((b) => ({ docs: b.docs, out: b.out, builtAt: b.builtAt, summary: b.summary, title: b.site.title }));
    return { text: builds.length ? `Last build: ${builds[0].out}/` : "No builds yet.", structured: { kind: "state", builds, folders: [...folders.entries()].filter(([, n]) => n > 0).map(([path, count]) => ({ path, count })) } };
  });

  return server;
}
