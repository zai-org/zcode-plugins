import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface Article {
  title: string;
  byline: string;
  siteName: string;
  published: string;
  lang: string;
  excerpt: string;
  /** 清理后的正文 HTML，链接和图片已改成绝对地址 */
  html: string;
  /** 段落文字（用于对比） */
  paragraphs: string[];
  images: { src: string; alt: string }[];
}

const DROP = "script,style,noscript,iframe,object,embed,form,input,button,select,textarea,template,link,meta,svg[aria-hidden=true],.mw-editsection,#siteSub,#contentSub,#jump-to-nav,.mw-jump-link,.navbox,.reflist .mw-cite-backlink";

function abs(value: string | null | undefined, base: string) {
  if (!value) return "";
  try {
    return new URL(value.trim(), base).href;
  } catch {
    return "";
  }
}
/** srcset 里取最大的一张 */
function bestFromSrcset(srcset: string, base: string) {
  let best = "", score = -1;
  for (const part of srcset.split(/,\s+/)) {
    const [u, d] = part.trim().split(/\s+/);
    const n = d ? parseFloat(d) * (d.endsWith("x") ? 1000 : 1) : 0;
    if (u && n > score) { score = n; best = u; }
  }
  return abs(best, base);
}

function metaContent(doc: Document, names: string[]) {
  for (const n of names) {
    const el = doc.querySelector(`meta[property="${n}"],meta[name="${n}"],meta[itemprop="${n}"]`);
    const v = el?.getAttribute("content")?.trim();
    if (v) return v;
  }
  return "";
}
function jsonLdDate(doc: Document) {
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent ?? "");
      const list = Array.isArray(data) ? data : data["@graph"] ?? [data];
      for (const d of list) if (d?.datePublished) return String(d.datePublished);
    } catch {
      // 忽略坏的 JSON-LD
    }
  }
  return "";
}

/** 懒加载图片（data-src 等）换成 src；srcset 取最大的一张。 */
function fixImages(doc: Document, url: string) {
  for (const img of doc.querySelectorAll("img")) {
    const lazy = img.getAttribute("data-src") || img.getAttribute("data-original") || img.getAttribute("data-lazy-src") || img.getAttribute("data-actualsrc");
    if (lazy && (!img.getAttribute("src") || /^data:|placeholder|blank|spacer/i.test(img.getAttribute("src")!))) img.setAttribute("src", lazy);
    const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset");
    if (srcset) img.setAttribute("src", bestFromSrcset(srcset, url) || abs(img.getAttribute("src"), url));
  }
  for (const pic of doc.querySelectorAll("picture source")) pic.remove();
}

/** 用 Readability 取正文，失败时退回 <main>/<article>/<body>。 */
export function extract(html: string, url: string): Article {
  const { document } = parseHTML(html);
  const doc = document as unknown as Document;
  fixImages(doc, url);
  const base = abs(doc.querySelector("base")?.getAttribute("href"), url) || url;
  const lang = doc.documentElement?.getAttribute("lang") ?? "";
  const published = metaContent(doc, ["article:published_time", "og:published_time", "datePublished", "pubdate", "publishdate", "date", "DC.date.issued", "dcterms.issued"]) || jsonLdDate(doc) || doc.querySelector("time[datetime]")?.getAttribute("datetime") || "";
  const siteName = metaContent(doc, ["og:site_name", "application-name"]);
  const titleTag = doc.querySelector("title")?.textContent?.trim() ?? "";

  let content: Element | null = null;
  let parsed: ReturnType<Readability<string>["parse"]> = null;
  try {
    const clone = parseHTML(html).document as unknown as Document;
    fixImages(clone, url);
    clone.querySelectorAll("#siteSub,#contentSub,#jump-to-nav,.mw-jump-link,.mw-editsection,.navbox,.noprint").forEach((n) => n.remove());
    parsed = new Readability(clone, { charThreshold: 300, keepClasses: false }).parse();
  } catch {
    parsed = null;
  }
  if (parsed?.content) content = (parseHTML(`<div id="__a">${parsed.content}</div>`).document as unknown as Document).getElementById("__a");
  if (!content || (content.textContent ?? "").trim().length < 200) {
    const pick = doc.querySelector("article") ?? doc.querySelector("main") ?? doc.querySelector('[role="main"]') ?? doc.body;
    content = pick ?? doc.documentElement;
    parsed = null;
  }
  content.querySelectorAll(DROP).forEach((n) => n.remove());
  const images: Article["images"] = [];
  for (const el of content.querySelectorAll("*")) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || a.name === "style" || a.name === "class" || a.name === "id" && !/^(cite_note|cite_ref)/.test(a.value) || a.name.startsWith("data-")) el.removeAttribute(a.name);
    }
    if (el.tagName === "A") {
      const href = el.getAttribute("href") ?? "";
      if (/^\s*javascript:/i.test(href)) el.removeAttribute("href");
      else if (href && !href.startsWith("#")) el.setAttribute("href", abs(href, base));
    }
    if (el.tagName === "IMG") {
      const src = abs(el.getAttribute("src"), base);
      if (!src || src.startsWith("data:") && src.length < 200) { el.remove(); continue; }
      el.setAttribute("src", src);
      el.removeAttribute("srcset");
      el.removeAttribute("sizes");
      el.removeAttribute("loading");
      images.push({ src, alt: el.getAttribute("alt") ?? "" });
    }
  }
  // 段落文字：块级元素逐个取
  const paragraphs: string[] = [];
  const BLOCK = new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "TD", "TH", "DT", "DD", "FIGCAPTION"]);
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      if (BLOCK.has(child.tagName) && !child.querySelector("p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table")) {
        const t = (child.textContent ?? "").replace(/\s+/g, " ").trim();
        if (t) paragraphs.push(t);
      } else walk(child);
    }
  };
  walk(content);
  let title = parsed?.title?.trim() || metaContent(doc, ["og:title", "twitter:title"]) || titleTag || url;
  // “文章名 - 站点名” 这类标题：页面里唯一的 <h1> 是其中一部分时用 <h1>
  const h1s = [...doc.querySelectorAll("h1")].map((x) => (x.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (h1s.length === 1 && h1s[0] !== title && title.includes(h1s[0]) && h1s[0].length >= 2) title = h1s[0];
  return {
    title,
    byline: (parsed?.byline || metaContent(doc, ["author", "article:author", "byl"])).trim().replace(/^(作者|文|by)\s*[:：]?\s*/i, ""),
    siteName: siteName || parsed?.siteName || new URL(url).hostname,
    published,
    lang: parsed?.lang || lang,
    excerpt: (parsed?.excerpt ?? metaContent(doc, ["description", "og:description"])).trim().slice(0, 300),
    html: content.innerHTML,
    paragraphs,
    images: [...new Map(images.map((i) => [i.src, i])).values()],
  };
}
