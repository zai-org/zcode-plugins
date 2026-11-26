export interface PageInfo { title: string; noindex: boolean; canonical: string; date: string; links: { url: string; kind: string }[] }

/** 页面链接还是文件：<a href> 指向图片、PDF、压缩包等带扩展名的文件时算作资源。 */
const PAGE_EXT = /^(html?|xhtml|php|aspx?|jsp|cfm|shtml)$/i;
export function linkKind(tag: string, url: string): "page" | "asset" {
  if (tag !== "a") return "asset";
  const path = url.split("#")[0].split("?")[0];
  const last = path.split("/").pop() ?? "";
  const m = /\.([a-z0-9]{1,8})$/i.exec(last);
  return !m || PAGE_EXT.test(m[1]) ? "page" : "asset";
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const attr = (tag: string, name: string) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag); return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : undefined; };

export function parsePage(html: string): PageInfo {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[\s\S]*?<\/script>/gi, (s) => s.replace(/<a\b[^>]*>/gi, ""));
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(noComments)?.[1] ?? "").replace(/\s+/g, " ").trim());
  let noindex = false, canonical = "", date = "";
  const links: PageInfo["links"] = [];
  for (const m of noComments.matchAll(/<(a|link|img|script|source|iframe|meta)\b[^>]*>/gi)) {
    const tag = m[0], name = m[1].toLowerCase();
    if (name === "meta") {
      const n = (attr(tag, "name") ?? attr(tag, "property") ?? "").toLowerCase();
      const c = attr(tag, "content") ?? "";
      if (n === "robots" && /noindex/i.test(c)) noindex = true;
      if (["date", "last-modified", "article:modified_time", "article:published_time", "dc.date"].includes(n) && /^\d{4}-\d{2}-\d{2}/.test(c) && (!date || n.includes("modified"))) date = c.slice(0, 10);
      continue;
    }
    if (name === "link") {
      const rel = (attr(tag, "rel") ?? "").toLowerCase();
      const href = attr(tag, "href");
      if (rel === "canonical" && href) { canonical = href; continue; }
      if (href && /stylesheet|icon|preload|manifest/.test(rel)) links.push({ url: href, kind: "asset" });
      continue;
    }
    const url = name === "a" ? attr(tag, "href") : attr(tag, "src");
    if (url !== undefined) links.push({ url, kind: linkKind(name, url) });
  }
  return { title, noindex, canonical, date, links };
}

/** 站内链接 → 相对站点根的文件路径；外部或特殊链接返回 undefined。 */
export function resolveLink(fromPage: string, url: string, base: string): string | undefined {
  let u = url.trim();
  if (!u || u.startsWith("#") || /^(mailto|tel|javascript|data|sms):/i.test(u)) return undefined;
  if (/^(https?:)?\/\//i.test(u)) {
    if (!base) return undefined;
    const b = base.replace(/\/+$/, "");
    const abs = u.startsWith("//") ? `https:${u}` : u;
    if (!abs.replace(/^http:/, "https:").startsWith(b.replace(/^http:/, "https:"))) return undefined;
    u = abs.slice(b.length) || "/";
  }
  u = u.split("#")[0].split("?")[0];
  try { u = decodeURIComponent(u); } catch { /* keep */ }
  const dir = fromPage.includes("/") ? fromPage.slice(0, fromPage.lastIndexOf("/")) : "";
  const parts = (u.startsWith("/") ? [] : dir ? dir.split("/") : []).concat(u.split("/"));
  const out: string[] = [];
  for (const p of parts) { if (p === "..") { if (!out.length) return "\u0000outside"; out.pop(); } else if (p && p !== ".") out.push(p); }
  let path = out.join("/");
  if (u.endsWith("/") || !path) path = path ? `${path}/index.html` : "index.html";
  return path;
}

export function pageUrl(path: string, base: string, clean: boolean): string {
  const b = base.replace(/\/+$/, "");
  let p = path;
  if (clean) p = p.replace(/(^|\/)index\.html?$/i, "$1").replace(/\.html?$/i, "");
  return `${b}/${p.split("/").map(encodeURIComponent).join("/")}`;
}
export const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
