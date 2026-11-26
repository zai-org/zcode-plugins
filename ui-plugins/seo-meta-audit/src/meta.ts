export interface Meta { title: string; description: string; h1: string[]; lang: string; viewport: boolean; canonical: string; og: Record<string, string>; images: number; noAlt: string[]; emptyAlt: number; hasHead: boolean }

const dec = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
export const enc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (tag: string, name: string) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag); return m ? dec(m[2] ?? m[3] ?? m[4] ?? "") : undefined; };
const strip = (s: string) => dec(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

export function readMeta(html: string): Meta {
  const h = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[\s\S]*?<\/script>/gi, "");
  const og: Record<string, string> = {};
  let description = "", viewport = false, canonical = "";
  for (const m of h.matchAll(/<meta\b[^>]*>/gi)) {
    const n = (attr(m[0], "name") ?? "").toLowerCase(), pr = (attr(m[0], "property") ?? "").toLowerCase(), c = attr(m[0], "content") ?? "";
    if (n === "description") description = c;
    if (n === "viewport") viewport = true;
    if (pr.startsWith("og:")) og[pr.slice(3)] = c;
  }
  for (const m of h.matchAll(/<link\b[^>]*>/gi)) if ((attr(m[0], "rel") ?? "").toLowerCase() === "canonical") canonical = attr(m[0], "href") ?? "";
  const noAlt: string[] = [];
  let images = 0, emptyAlt = 0;
  for (const m of h.matchAll(/<img\b[^>]*>/gi)) { images++; const a = attr(m[0], "alt"); if (a === undefined) noAlt.push(attr(m[0], "src") ?? "(no src)"); else if (!a.trim()) emptyAlt++; }
  return {
    title: strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] ?? ""),
    description, viewport, canonical, og, images, noAlt, emptyAlt,
    h1: [...h.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1])),
    lang: attr(/<html\b[^>]*>/i.exec(h)?.[0] ?? "", "lang") ?? "",
    hasHead: /<head\b/i.test(h),
  };
}

/** 显示宽度：中日韩字符算 2，其他算 1（接近搜索结果里的像素宽度）。 */
export const width = (s: string) => [...s].reduce((n, ch) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1), 0);

/** 只改 title / description / og 标签，其他内容原样保留。 */
export function applyMeta(html: string, m: { title?: string; description?: string; og?: boolean; lang?: string }): string {
  let out = html;
  const indent = /\n([ \t]*)<(title|meta)\b/i.exec(out)?.[1] ?? "  ";
  const addToHead = (tag: string) => {
    if (/<\/title>/i.test(out)) out = out.replace(/(<\/title>)/i, `$1\n${indent}${tag}`);
    else if (/<head\b[^>]*>/i.test(out)) out = out.replace(/(<head\b[^>]*>)/i, `$1\n${indent}${tag}`);
    else if (/<html\b[^>]*>/i.test(out)) out = out.replace(/(<html\b[^>]*>)/i, `$1\n<head>\n${indent}${tag}\n</head>`);
    else out = `<head>\n${indent}${tag}\n</head>\n${out}`;
  };
  const setMeta = (sel: RegExp, tag: string) => {
    const re = new RegExp(`<meta\\b(?=[^>]*${sel.source})[^>]*>`, "i");
    if (re.test(out)) out = out.replace(re, tag); else addToHead(tag);
  };
  if (m.title !== undefined) {
    if (/<title[^>]*>[\s\S]*?<\/title>/i.test(out)) out = out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${enc(m.title)}</title>`);
    else if (m.title) { if (/<head\b[^>]*>/i.test(out)) out = out.replace(/(<head\b[^>]*>)/i, `$1\n${indent}<title>${enc(m.title)}</title>`); else addToHead(`<title>${enc(m.title)}</title>`); }
  }
  if (m.description !== undefined && m.description !== "") setMeta(/name\s*=\s*["']?description["']?/, `<meta name="description" content="${enc(m.description)}">`);
  if (m.og) {
    if (m.title) setMeta(/property\s*=\s*["']?og:title["']?/, `<meta property="og:title" content="${enc(m.title)}">`);
    if (m.description) setMeta(/property\s*=\s*["']?og:description["']?/, `<meta property="og:description" content="${enc(m.description)}">`);
  }
  if (m.lang && !/<html\b[^>]*\slang\s*=/i.test(out)) out = out.replace(/<html\b/i, `<html lang="${enc(m.lang)}"`);
  return out;
}
