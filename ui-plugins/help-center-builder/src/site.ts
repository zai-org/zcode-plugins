import { type Doc, esc, sha } from "./docs.ts";

export const TEMPLATE_VERSION = "1";
export interface CategoryConf { folder?: string; key?: string; name?: string; description?: string }
export interface SiteConf { title: string; description: string; accent: string; baseUrl?: string; footer?: string; lang: "en" | "zh-CN"; logo?: string; categories: CategoryConf[] }
export interface Category { key: string; name: string; description: string; out: string; docs: Doc[]; intro?: Doc }
export interface Model { site: SiteConf; categories: Category[]; docs: Doc[]; bySrc: Map<string, Doc>; catOf: Map<string, Category>; related: Map<string, Doc[]>; prev: Map<string, Doc | undefined>; next: Map<string, Doc | undefined>; home?: Doc }

const STR = {
  en: { home: "Home", search: "Search help articles…", searchTitle: "Search", onPage: "On this page", related: "Related articles", prev: "Previous", next: "Next", updated: "Updated %s", articles: "%n articles", article: "1 article", all: "All results", none: "No results for “%s”", count: "%n results for “%s”", categories: "Categories", viewAll: "View all %n →", notFound: "Page not found", notFoundText: "The page you were looking for doesn't exist. Try searching:", inCat: "In this category", general: "General", heroQ: "How can we help?" },
  "zh-CN": { home: "首页", search: "搜索帮助文章…", searchTitle: "搜索", onPage: "本页内容", related: "相关文章", prev: "上一篇", next: "下一篇", updated: "更新于 %s", articles: "%n 篇文章", article: "1 篇文章", all: "全部结果", none: "没有找到“%s”的结果", count: "“%s”共 %n 条结果", categories: "分类", viewAll: "查看全部 %n 篇 →", notFound: "页面不存在", notFoundText: "你要找的页面不存在，试试搜索：", inCat: "本分类文章", general: "常规", heroQ: "有什么可以帮你？" },
};
export const strings = (lang: SiteConf["lang"]) => STR[lang];
const pretty = (folder: string) => (/[\p{Script=Han}]/u.test(folder) ? folder : folder.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
const catKey = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "general";

export function detectLang(docs: Doc[]): SiteConf["lang"] {
  const sample = docs.map((d) => d.title + d.text.slice(0, 400)).join(" ");
  const han = (sample.match(/\p{Script=Han}/gu) ?? []).length;
  return han > sample.length * 0.15 ? "zh-CN" : "en";
}

/** 分类、排序、相关文章、上一篇/下一篇。 */
export function buildModel(all: Doc[], site: SiteConf): Model {
  const docs = all.filter((d) => !d.draft && !d.isIntro);
  const intros = all.filter((d) => d.isIntro && !d.draft);
  const S = strings(site.lang);
  const cats = new Map<string, Category>();
  const confFor = (key: string) => site.categories.find((c) => (c.key ?? c.folder) === key || (c.name && catKey(c.name) === key));
  const get = (key: string, name?: string) => {
    let c = cats.get(key);
    if (!c) {
      const conf = confFor(key);
      c = { key, name: conf?.name ?? name ?? (key === "general" ? S.general : pretty(key)), description: conf?.description ?? "", out: `${key}/index.html`, docs: [] };
      cats.set(key, c);
    }
    return c;
  };
  const catOf = new Map<string, Category>();
  for (const d of docs) {
    let key = d.folder || "general";
    if (d.categoryName) { const conf = site.categories.find((c) => c.name === d.categoryName); key = conf ? (conf.key ?? conf.folder ?? catKey(d.categoryName)) : catKey(d.categoryName); }
    const c = get(key, d.categoryName);
    c.docs.push(d);
    catOf.set(d.src, c);
  }
  for (const i of intros) { const key = i.folder || ""; if (key && cats.has(key)) { const c = cats.get(key)!; c.intro = i; if (!c.description) c.description = i.description; } }
  const home = intros.find((i) => !i.folder);
  const confOrder = (c: Category) => { const i = site.categories.findIndex((x) => x === confFor(c.key)); return i < 0 ? 1e6 : i; };
  const categories = [...cats.values()].sort((a, b) => confOrder(a) - confOrder(b) || a.name.localeCompare(b.name, site.lang));
  for (const c of categories) c.docs.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, site.lang));
  const ordered = categories.flatMap((c) => c.docs);
  const bySrc = new Map(all.map((d) => [d.src, d]));
  const prev = new Map<string, Doc | undefined>(), next = new Map<string, Doc | undefined>();
  for (const c of categories) c.docs.forEach((d, i) => { prev.set(d.src, c.docs[i - 1]); next.set(d.src, c.docs[i + 1]); });
  // 相关文章：先用 front matter 里的 related，再按共同标签（×3）、同分类（×1）、标题与小标题词重合度补足到 5 篇。
  const words = new Map(ordered.map((d) => [d.src, new Set(`${d.title} ${d.headings.map((h) => h.text).join(" ")}`.toLowerCase().match(/[\p{L}\p{N}]{3,}|\p{Script=Han}{2}/gu) ?? [])]));
  const related = new Map<string, Doc[]>();
  for (const d of ordered) {
    const picked: Doc[] = [];
    for (const r of d.related) { const t = bySrc.get(r) ?? bySrc.get(r.replace(/\.html$/, ".md")) ?? ordered.find((x) => x.out === r || x.src.replace(/\.\w+$/, "") === r.replace(/\.\w+$/, "")); if (t && t !== d && !t.draft && !t.isIntro && !picked.includes(t)) picked.push(t); }
    const wd = words.get(d.src)!;
    const scored = ordered.filter((o) => o !== d && !picked.includes(o)).map((o) => {
      const shared = o.tags.filter((t) => d.tags.map((x) => x.toLowerCase()).includes(t.toLowerCase())).length;
      const wo = words.get(o.src)!;
      const overlap = [...wd].filter((w) => wo.has(w)).length;
      return { o, s: shared * 3 + (catOf.get(o.src) === catOf.get(d.src) ? 1 : 0) + overlap * 0.5 };
    }).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s || a.o.title.localeCompare(b.o.title));
    for (const x of scored) { if (picked.length >= 5) break; picked.push(x.o); }
    related.set(d.src, picked.slice(0, 5));
  }
  return { site, categories, docs: ordered, bySrc, catOf, related, prev, next, home };
}

// ---------- 模板 ----------
const rootOf = (out: string) => "../".repeat(out.split("/").length - 1);
const rel = (from: string, to: string) => rootOf(from) + to.split("/").map(encodeURIComponent).join("/");
function layout(m: Model, out: string, title: string, body: string, opts: { hero?: boolean; desc?: string } = {}) {
  const S = strings(m.site.lang), R = rootOf(out);
  const ui = JSON.stringify({ all: S.all, none: S.none, count: S.count });
  const search = (cls = "") => `<form class="search${cls}" action="${R}search.html" role="search"><input type="search" name="q" placeholder="${esc(S.search)}" aria-label="${esc(S.searchTitle)}" autocomplete="off"><div class="results" hidden></div></form>`;
  const brand = `<a class="brand" href="${R}index.html">${m.site.logo ? `<img src="${R}${esc(m.site.logo)}" alt="">` : `<span class="dot"></span>`}${esc(m.site.title)}</a>`;
  return `<!doctype html>
<html lang="${m.site.lang}" data-root="${R}" data-strings="${esc(ui)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title === m.site.title ? title : `${title} · ${m.site.title}`)}</title>
${opts.desc ? `<meta name="description" content="${esc(opts.desc)}">\n` : ""}${m.site.baseUrl ? `<link rel="canonical" href="${esc(m.site.baseUrl.replace(/\/+$/, ""))}/${out.split("/").map(encodeURIComponent).join("/")}">\n` : ""}<link rel="stylesheet" href="${R}assets/style.css">
<style>:root{--accent:${esc(m.site.accent)}}</style>
</head>
<body>
<header class="top"><div class="inner">${brand}${opts.hero ? "" : search()}</div></header>
${body}
<footer class="foot">${esc(m.site.footer ?? m.site.title)}</footer>
<script src="${R}assets/minisearch.js" defer></script>
<script src="${R}assets/tokenize.js" defer></script>
<script src="${R}search-index.js" defer></script>
<script src="${R}assets/search.js" defer></script>
</body>
</html>
`.replace("__HERO_SEARCH__", search());
}
/** 正文里的相对链接：.md → .html（输出目录与源目录结构一致，其余相对路径不变）。 */
function fixLinks(html: string) {
  return html.replace(/(\shref\s*=\s*["'])([^"']*)(["'])/gi, (all, a: string, href: string, b: string) => (/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(href) ? all : a + href.replace(/\.(md|markdown|htm)(?=$|[#?])/i, ".html") + b));
}
const cnt = (S: ReturnType<typeof strings>, n: number) => (n === 1 ? S.article : S.articles.replace("%n", String(n)));

function sidebar(m: Model, out: string, cur?: Category, curDoc?: Doc) {
  const S = strings(m.site.lang);
  const docs = cur ? `<h3>${esc(cur.name)}</h3><ul>${cur.docs.map((d) => `<li><a href="${rel(out, d.out)}"${d === curDoc ? ' class="on" aria-current="page"' : ""}>${esc(d.title)}</a></li>`).join("")}</ul>` : "";
  return `<nav class="side">${docs}<h3>${esc(S.categories)}</h3><ul>${m.categories.map((c) => `<li><a href="${rel(out, c.out)}"${c === cur && !curDoc ? ' class="on"' : ""}>${esc(c.name)}</a></li>`).join("")}</ul></nav>`;
}

export function renderArticle(m: Model, d: Doc) {
  const S = strings(m.site.lang), c = m.catOf.get(d.src)!, out = d.out;
  const crumbs = `<div class="crumbs"><a href="${rel(out, "index.html")}">${esc(S.home)}</a><span>›</span><a href="${rel(out, c.out)}">${esc(c.name)}</a><span>›</span>${esc(d.title)}</div>`;
  const toc = d.headings.filter((h) => h.level === 2 || h.level === 3);
  const rl = m.related.get(d.src) ?? [];
  const p = m.prev.get(d.src), n = m.next.get(d.src);
  const body = `<div class="layout">${sidebar(m, out, c, d)}<main><article>${crumbs}<h1>${esc(d.title)}</h1>${d.updated ? `<div class="meta">${esc(S.updated.replace("%s", d.updated))}</div>` : ""}${d.description ? `<p class="lead">${esc(d.description)}</p>` : ""}
${fixLinks(d.html)}
</article>${rl.length ? `<section class="related"><h2>${esc(S.related)}</h2><ul>${rl.map((r) => `<li><a href="${rel(out, r.out)}">${esc(r.title)}</a></li>`).join("")}</ul></section>` : ""}${p || n ? `<nav class="pn">${p ? `<a class="prev" href="${rel(out, p.out)}"><small>‹ ${esc(S.prev)}</small>${esc(p.title)}</a>` : "<span></span>"}${n ? `<a class="next" href="${rel(out, n.out)}"><small>${esc(S.next)} ›</small>${esc(n.title)}</a>` : "<span></span>"}</nav>` : ""}</main>${toc.length >= 2 ? `<aside class="toc"><h3>${esc(S.onPage)}</h3>${toc.map((h) => `<a class="l${h.level}" href="#${encodeURIComponent(h.id)}">${esc(h.text)}</a>`).join("")}</aside>` : "<aside></aside>"}</div>`;
  return layout(m, out, d.title, body, { desc: d.excerpt });
}
export function renderCategory(m: Model, c: Category) {
  const S = strings(m.site.lang), out = c.out;
  const body = `<div class="layout two">${sidebar(m, out, c)}<main><div class="crumbs"><a href="${rel(out, "index.html")}">${esc(S.home)}</a><span>›</span>${esc(c.name)}</div><h1>${esc(c.name)} <span class="count">${esc(cnt(S, c.docs.length))}</span></h1>${c.description ? `<p class="lead">${esc(c.description)}</p>` : ""}${c.intro ? `<div class="intro">${fixLinks(c.intro.html)}</div>` : ""}<ul class="list">${c.docs.map((d) => `<li><a href="${rel(out, d.out)}">${esc(d.title)}</a><p>${esc(d.excerpt)}</p></li>`).join("")}</ul></main></div>`;
  return layout(m, out, c.name, body, { desc: c.description });
}
export function renderHome(m: Model) {
  const S = strings(m.site.lang), out = "index.html";
  const cards = m.categories.map((c) => `<section class="cat"><h2><a href="${rel(out, c.out)}">${esc(c.name)}</a> <span class="count">${esc(cnt(S, c.docs.length))}</span></h2>${c.description ? `<p>${esc(c.description)}</p>` : ""}<ul>${c.docs.slice(0, 5).map((d) => `<li><a href="${rel(out, d.out)}">${esc(d.title)}</a></li>`).join("")}</ul>${c.docs.length > 5 ? `<a class="more" href="${rel(out, c.out)}">${esc(S.viewAll.replace("%n", String(c.docs.length)))}</a>` : ""}</section>`).join("");
  const body = `<section class="hero"><h1>${esc(m.home?.title && !m.home.titleFromFile ? m.home.title : S.heroQ)}</h1><p>${esc(m.site.description)}</p>__HERO_SEARCH__</section><div class="wrap">${m.home ? `<div class="intro">${fixLinks(m.home.html)}</div>` : ""}<div class="cats">${cards}</div></div>`;
  return layout(m, out, m.site.title, body, { hero: true, desc: m.site.description });
}
export function renderSearch(m: Model) {
  const S = strings(m.site.lang), out = "search.html";
  return layout(m, out, S.searchTitle, `<div class="layout two">${sidebar(m, out)}<main><h1>${esc(S.searchTitle)}</h1><p class="meta" id="search-count"></p><div id="search-page" class="results-page"></div></main></div>`);
}
export function render404(m: Model) {
  const S = strings(m.site.lang), out = "404.html";
  // 静态托管（Cloudflare Pages、Netlify 等）会在任意路径返回 404.html，相对路径会失效：有 baseUrl 用它，否则用站点根 "/"。
  const html = layout(m, out, S.notFound, `<div class="wrap"><h1>${esc(S.notFound)}</h1><p>${esc(S.notFoundText)}</p><p><a href="index.html">${esc(S.home)}</a></p></div>`);
  const base = m.site.baseUrl ? m.site.baseUrl.replace(/\/+$/, "") + "/" : "/";
  return html.replace(/(href|src)="(?!https?:|#|data:)([^"]+)"/g, (_, a: string, u: string) => `${a}="${base}${u}"`).replace('data-root=""', `data-root="${base}"`);
}

/** 搜索文档（minisearch 输入）与展示数据。 */
export function searchDocs(m: Model) {
  return m.docs.map((d, i) => ({ id: i, title: d.title, headings: d.headings.map((h) => h.text).join(" · "), tags: d.tags.join(" "), text: `${d.description} ${d.text}`, show: { t: d.title, c: m.catOf.get(d.src)!.name, u: d.out.split("/").map(encodeURIComponent).join("/"), d: d.excerpt } }));
}

// ---------- 依赖指纹（增量构建） ----------
export type Parts = Record<string, string>;
export interface PagePlan { out: string; kind: "article" | "category" | "home" | "search" | "404"; parts: Parts; render: () => string; src?: string }
export function plan(m: Model): PagePlan[] {
  const siteH = sha(JSON.stringify({ ...m.site, categories: undefined }));
  const catsH = sha(JSON.stringify(m.categories.map((c) => [c.key, c.name, c.out])));
  const navH = (c: Category) => sha(JSON.stringify(c.docs.map((d) => [d.title, d.out])));
  const pages: PagePlan[] = [];
  for (const d of m.docs) {
    const c = m.catOf.get(d.src)!;
    const p = m.prev.get(d.src), n = m.next.get(d.src);
    pages.push({ out: d.out, kind: "article", src: d.src, render: () => renderArticle(m, d), parts: { content: d.hash, nav: navH(c), category: sha(JSON.stringify([c.name, c.out])), cats: catsH, related: sha(JSON.stringify((m.related.get(d.src) ?? []).map((r) => [r.title, r.out]))), prevnext: sha(JSON.stringify([p?.title, p?.out, n?.title, n?.out])), site: siteH, tpl: TEMPLATE_VERSION } });
  }
  for (const c of m.categories) pages.push({ out: c.out, kind: "category", render: () => renderCategory(m, c), parts: { list: sha(JSON.stringify(c.docs.map((d) => [d.title, d.out, d.excerpt]))), intro: c.intro?.hash ?? "", category: sha(JSON.stringify([c.name, c.description])), cats: catsH, site: siteH, tpl: TEMPLATE_VERSION } });
  pages.push({ out: "index.html", kind: "home", render: () => renderHome(m), parts: { list: sha(JSON.stringify(m.categories.map((c) => [c.name, c.description, c.docs.length, c.docs.slice(0, 5).map((d) => [d.title, d.out])]))), intro: m.home?.hash ?? "", cats: catsH, site: siteH, tpl: TEMPLATE_VERSION } });
  pages.push({ out: "search.html", kind: "search", render: () => renderSearch(m), parts: { cats: catsH, site: siteH, tpl: TEMPLATE_VERSION } });
  pages.push({ out: "404.html", kind: "404", render: () => render404(m), parts: { site: siteH, tpl: TEMPLATE_VERSION } });
  return pages;
}
export const REASONS: Record<string, { en: string; zh: string }> = {
  new: { en: "new page", zh: "新页面" }, missing: { en: "output file was missing", zh: "输出文件缺失" }, full: { en: "full rebuild", zh: "全量重建" },
  content: { en: "content changed", zh: "内容改了" }, nav: { en: "category's article list changed", zh: "同分类文章列表变了" }, category: { en: "category renamed or moved", zh: "所属分类改了" },
  cats: { en: "category list changed", zh: "分类列表变了" }, related: { en: "related articles changed", zh: "相关文章变了" }, prevnext: { en: "previous/next article changed", zh: "上一篇/下一篇变了" },
  site: { en: "site settings changed", zh: "站点设置改了" }, tpl: { en: "template updated", zh: "模板更新" }, list: { en: "article list changed", zh: "文章列表变了" }, intro: { en: "intro text changed", zh: "介绍文字改了" },
};
