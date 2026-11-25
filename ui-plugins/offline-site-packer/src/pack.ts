import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import MiniSearch from "minisearch";
import { zipSync } from "fflate";
import { SEARCH_CSS, SEARCH_JS } from "./widget.ts";

export interface PackOptions {
  /** 网站上线地址，例如 https://docs.example.com/ —— 指向它的绝对链接按站内链接处理 */
  baseUrl?: string;
  search?: boolean;
  /** 把没被链接到的文件也放进离线包 */
  includeUnlinked?: boolean;
  /** UMD 版 MiniSearch 源码（写入 _offline/minisearch.js） */
  minisearchUmd: string;
  /** 只检查，不写文件 */
  dryRun?: boolean;
}
export interface LinkIssue { from: string; href: string; kind: "page" | "asset" }
export interface Report {
  source: string; output: string; zip?: string;
  pages: { path: string; title: string; words: number }[];
  assets: number; files: number; bytes: number; rewritten: number;
  broken: LinkIssue[];
  external: { href: string; from: string[] }[];
  orphans: string[];
  unused: string[];
  warnings: string[];
  search: boolean;
}

const MARKER = "_offline/.packed-by-offline-site-packer";
const SKIP_SCHEMES = /^(mailto|tel|javascript|data|blob|sms|about):/i;
type Ref = { type: "skip" } | { type: "external"; href: string } | { type: "internal"; target: string; hash: string } | { type: "broken"; path: string };

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const go = async (abs: string, rel: string) => {
    for (const e of await readdir(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await go(join(abs, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  await go(root, "");
  return out.sort();
}

export const isHtml = (p: string) => /\.html?$/i.test(p);
const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
export function htmlText(s: string) {
  return s.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ").trim();
}

export function resolveRef(files: Set<string>, from: string, raw: string, base?: URL): Ref {
  let ref = raw.trim().replace(/&amp;/g, "&");
  if (!ref || ref.startsWith("#") || SKIP_SCHEMES.test(ref) || ref.includes("{{")) return { type: "skip" };
  let path: string;
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(ref)) {
    let u: URL;
    try { u = new URL(ref, base ?? "https://unknown.invalid/"); } catch { return { type: "skip" }; }
    if (!/^https?:$/.test(u.protocol)) return { type: "skip" };
    if (!base || u.host !== base.host || !u.pathname.startsWith(base.pathname)) return { type: "external", href: u.href };
    ref = "/" + u.pathname.slice(base.pathname.length) + u.search + u.hash;
  }
  const hashAt = ref.indexOf("#");
  const hash = hashAt >= 0 ? ref.slice(hashAt) : "";
  path = decode(ref.slice(0, hashAt >= 0 ? hashAt : undefined).replace(/\?.*$/, ""));
  if (base && path.startsWith(base.pathname) && base.pathname !== "/") path = "/" + path.slice(base.pathname.length);
  let p = path.startsWith("/") ? posix.normalize(path.slice(1) || ".") : posix.normalize(posix.join(posix.dirname(from), path || posix.basename(from)));
  if (p === "." ) p = "";
  if (p.startsWith("..")) return { type: "broken", path };
  const dirLike = path.endsWith("/") || p === "";
  const stem = p.replace(/\/$/, "");
  const candidates = dirLike ? [posix.join(stem, "index.html")] : [stem, `${stem}.html`, posix.join(stem, "index.html")];
  const hit = candidates.find((c) => files.has(c.replace(/^\.\//, "")));
  return hit ? { type: "internal", target: hit, hash } : { type: "broken", path };
}

const relLink = (from: string, target: string) => {
  const r = posix.relative(posix.dirname(from), target);
  return r || posix.basename(target);
};

/** 打包：从 index.html 出发爬所有站内页面，把链接改成相对路径（file:// 可用），收集资源，生成离线搜索。 */
export async function pack(srcAbs: string, outAbs: string, names: { source: string; output: string }, opts: PackOptions): Promise<Report> {
  const all = await walk(srcAbs);
  const files = new Set(all);
  if (!files.has("index.html")) throw new Error(`${names.source}/index.html not found — choose the folder that contains the site's home page (for example dist/ or public/).`);
  const base = opts.baseUrl ? new URL(opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`) : undefined;
  const report: Report = { source: names.source, output: names.output, pages: [], assets: 0, files: 0, bytes: 0, rewritten: 0, broken: [], external: [], orphans: [], unused: [], warnings: [], search: opts.search !== false };
  const ext = new Map<string, Set<string>>();
  const used = new Set<string>(["index.html"]);
  const queue = ["index.html"];
  const outputs = new Map<string, string | Buffer>();
  const brokenSeen = new Set<string>();
  const docs: { id: number; url: string; title: string; text: string }[] = [];

  const handle = (from: string, raw: string, kind: "page" | "asset"): string | undefined => {
    const r = resolveRef(files, from, raw, base);
    if (r.type === "skip") return undefined;
    if (r.type === "external") { if (!ext.has(r.href)) ext.set(r.href, new Set()); ext.get(r.href)!.add(from); return undefined; }
    if (r.type === "broken") { const k = `${from}|${raw}`; if (!brokenSeen.has(k)) { brokenSeen.add(k); report.broken.push({ from, href: raw.trim(), kind }); } return undefined; }
    if (!used.has(r.target)) { used.add(r.target); queue.push(r.target); }
    const link = relLink(from, r.target) + r.hash;
    if (link !== raw.trim()) report.rewritten++;
    return link;
  };
  const css = (from: string, text: string) => text
    .replace(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?/gi, (m, q, u) => { const n = handle(from, u, "asset"); return n ? `@import url("${n}")` : m; })
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, q, u) => { if (/^data:/i.test(u)) return m; const n = handle(from, u, "asset"); return n ? `url("${n}")` : m; });
  const attrRe = /(\s)(href|src|srcset|poster|action|data-src|data-srcset)(\s*=\s*)("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  const tag = (from: string, t: string) => {
    const name = /^<([\w-]+)/.exec(t)?.[1].toLowerCase() ?? "";
    if (name === "base") { report.warnings.push(`${from}: <base href> removed (links are rewritten relative to each page).`); return ""; }
    let out = t.replace(attrRe, (m, sp, attr, eq, _q, dq, sq, bare) => {
      const val: string = dq ?? sq ?? bare ?? "";
      const a = attr.toLowerCase();
      if (a === "action" || (name === "link" && /rel\s*=\s*["']?(canonical|alternate|preconnect|dns-prefetch|manifest)/i.test(t) && a === "href")) return m;
      const kind = (name === "a" || name === "area" || name === "iframe") ? "page" : "asset";
      let next: string | undefined;
      if (a.endsWith("srcset")) {
        let changed = false;
        next = val.split(",").map((part) => { const [u, ...d] = part.trim().split(/\s+/); const n = u ? handle(from, u, "asset") : undefined; if (n) changed = true; return [n ?? u, ...d].join(" "); }).join(", ");
        if (!changed) next = undefined;
      } else next = handle(from, val, kind);
      return next === undefined ? m : `${sp}${attr}${eq}"${next.replace(/"/g, "&quot;")}"`;
    });
    out = out.replace(/(\sstyle\s*=\s*)"([^"]*)"/i, (m, p, s) => `${p}"${css(from, s)}"`);
    return out;
  };
  const html = (from: string, src: string) => src.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->|<[a-zA-Z][^<>]*>/g, (m) => {
    if (m.startsWith("<!--")) return m;
    if (/^<script/i.test(m)) { const open = /^<script\b[^>]*>/i.exec(m)![0]; return tag(from, open) + m.slice(open.length); }
    if (/^<style/i.test(m)) { const open = /^<style\b[^>]*>/i.exec(m)![0]; return tag(from, open) + css(from, m.slice(open.length)); }
    return tag(from, m);
  });

  if (opts.includeUnlinked) for (const f of all) if (!used.has(f)) { used.add(f); queue.push(f); }
  while (queue.length) {
    const f = queue.shift()!;
    const buf = await readFile(join(srcAbs, f));
    if (isHtml(f)) {
      const src = buf.toString("utf8");
      let out = html(f, src);
      const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(src)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(src)?.[1] ?? f).replace(/<[^>]+>/g, "").trim();
      const main = /<main\b[\s\S]*?<\/main>/i.exec(src)?.[0] ?? /<body\b[\s\S]*<\/body>/i.exec(src)?.[0] ?? src;
      const text = htmlText(main);
      report.pages.push({ path: f, title: htmlText(title), words: text ? text.split(" ").length : 0 });
      docs.push({ id: docs.length, url: f, title: htmlText(title), text: text.slice(0, 5000) });
      if (report.search) {
        const up = "../".repeat(f.split("/").length - 1);
        const inject = `<link rel="stylesheet" href="${up}_offline/search.css"><script src="${up}_offline/minisearch.js"></script><script src="${up}_offline/search-index.js"></script><script src="${up}_offline/search.js" data-root="${up}"></script>`;
        out = /<\/body>/i.test(out) ? out.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${inject}</body>`) : out + inject;
      }
      outputs.set(f, out);
    } else if (/\.css$/i.test(f)) outputs.set(f, css(f, buf.toString("utf8")));
    else {
      if (/\.m?js$/i.test(f) && /\bfetch\s*\(|XMLHttpRequest/.test(buf.toString("utf8"))) report.warnings.push(`${f} loads data with fetch()/XHR; browsers block that for file:// pages, so that feature may not work offline.`);
      outputs.set(f, buf);
    }
  }
  report.orphans = all.filter((f) => isHtml(f) && !report.pages.some((p) => p.path === f));
  report.unused = all.filter((f) => !used.has(f) && !isHtml(f));
  report.external = [...ext].map(([href, from]) => ({ href, from: [...from].sort() })).sort((a, b) => a.href.localeCompare(b.href));
  if (!docs.some((d) => d.url === "index.html")) report.warnings.push("index.html is not an HTML page.");

  if (report.search) {
    const ms = new MiniSearch({ fields: ["title", "text"], storeFields: ["title", "url", "text"], searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.2 } });
    ms.addAll(docs);
    outputs.set("_offline/search-index.js", `window.__OFFLINE_SEARCH=${JSON.stringify(JSON.stringify(ms))};\n`);
    outputs.set("_offline/minisearch.js", opts.minisearchUmd);
    outputs.set("_offline/search.js", SEARCH_JS);
    outputs.set("_offline/search.css", SEARCH_CSS);
  }
  outputs.set(MARKER, `${names.source} → ${names.output}\n`);

  if (opts.dryRun) { report.files = outputs.size - 1; report.assets = report.files - report.pages.length - (report.search ? 4 : 0); return report; }
  // 写出：输出目录若已存在，只在它是本插件之前生成的才清空
  if (await stat(outAbs).then(() => true, () => false)) {
    const entries = await readdir(outAbs);
    if (entries.length && !(await stat(join(outAbs, MARKER)).then(() => true, () => false))) throw new Error(`${names.output} already exists and was not created by this plugin; choose another output folder.`);
    await rm(outAbs, { recursive: true, force: true });
  }
  const zipFiles: Record<string, Uint8Array> = {};
  const top = posix.basename(names.output);
  for (const [p, data] of outputs) {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    await mkdir(dirname(join(outAbs, p)), { recursive: true });
    await writeFile(join(outAbs, p), bytes);
    report.bytes += bytes.length; report.files++;
    if (p !== MARKER) zipFiles[`${top}/${p}`] = bytes;
  }
  report.assets = report.files - report.pages.length - 1;
  (report as Report & { zipData?: Uint8Array }).zipData = zipSync(zipFiles, { level: 6 });
  return report;
}
