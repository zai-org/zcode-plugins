import { createHash } from "node:crypto";
import { Marked, Renderer } from "marked";
import { parse as parseYaml } from "yaml";

export interface Heading { level: number; id: string; text: string }
export interface Link { href: string; target: string | null; anchor: string; kind: "doc" | "asset" | "external" | "anchor" }
export interface Doc {
  src: string; out: string; hash: string; title: string; titleFromFile: boolean; description: string; excerpt: string;
  folder: string; categoryName?: string; order: number; tags: string[]; related: string[]; updated?: string; draft: boolean;
  html: string; text: string; headings: Heading[]; ids: string[]; links: Link[]; stripped: string[]; isIntro: boolean;
}

export const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const DOC_EXT = /\.(md|markdown|html?)$/i;
export const isDocPath = (p: string) => DOC_EXT.test(p);
export const outPath = (src: string) => src.replace(DOC_EXT, ".html");

/** 标题锚点：保留中日韩文字和字母数字，其余变成连字符。 */
export function slugify(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, "").replace(/[^\p{L}\p{N}\s_-]+/gu, "").trim().replace(/[\s_]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "") || "section";
}
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
export const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m));
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const plain = (html: string) => decode(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<pre\b[\s\S]*?<\/pre>/gi, (m) => ` ${m} `).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** 帮助中心内容不该带脚本：移除 script/iframe/object、内联事件和 javascript: 链接（清理作者内容，不是安全沙箱）。 */
export function sanitize(html: string): { html: string; stripped: string[] } {
  const stripped: string[] = [];
  let out = html.replace(/<(script|iframe|object|embed)\b[\s\S]*?(<\/\1\s*>|$)/gi, (_, t: string) => { stripped.push(`<${t.toLowerCase()}>`); return ""; });
  out = out.replace(/<(script|iframe|object|embed)\b[^>]*\/?>/gi, (_, t: string) => { stripped.push(`<${t.toLowerCase()}>`); return ""; });
  out = out.replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (_, a: string) => { stripped.push(`${a.toLowerCase()}=`); return ""; });
  out = out.replace(/\b(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, (_, a: string) => { stripped.push("javascript:"); return `${a}="#"`; });
  return { html: out, stripped: [...new Set(stripped)] };
}

function frontMatter(raw: string): { data: Record<string, unknown>; body: string } {
  const m = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: raw.replace(/^\uFEFF/, "") };
  let data: Record<string, unknown> = {};
  try { const y = parseYaml(m[1]); if (y && typeof y === "object") data = y as Record<string, unknown>; } catch (e) { data = { __error: (e as Error).message }; }
  return { data, body: raw.slice(m[0].length) };
}
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[,，]/) : []).map((s) => s.trim()).filter(Boolean);

function renderMarkdown(md: string) {
  const used = new Map<string, number>();
  const headings: Heading[] = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = plain(inner);
        let id = slugify(text);
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        headings.push({ level: depth, id, text });
        return `<h${depth} id="${esc(id)}">${inner}</h${depth}>\n`;
      },
      table(token) { return `<div class="table-wrap">${Renderer.prototype.table.call(this, token)}</div>`; },
    },
  });
  return { html: marked.parse(md, { async: false }) as string, headings };
}

function fromHtml(raw: string) {
  const title = decode(raw.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? raw.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");
  const meta = (n: string) => decode(raw.match(new RegExp(`<meta\\s+name=["']${n}["']\\s+content=["']([^"']*)["']`, "i"))?.[1] ?? "");
  let body = raw.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? raw.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? raw;
  body = body.replace(/<(nav|header|footer|style)\b[\s\S]*?<\/\1>/gi, "").replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, "");
  const used = new Map<string, number>();
  const headings: Heading[] = [];
  body = body.replace(/<h([2-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi, (_, lv: string, attrs: string, inner: string) => {
    const text = plain(inner);
    let id = attrs.match(/\bid=["']([^"']+)["']/)?.[1] ?? slugify(text);
    const n = used.get(id) ?? 0; used.set(id, n + 1); if (n) id = `${id}-${n}`;
    headings.push({ level: +lv, id, text });
    return `<h${lv} id="${esc(id)}">${inner}</h${lv}>`;
  });
  return { title, description: meta("description"), tags: list(meta("tags") || meta("keywords")), html: body.trim(), headings };
}

/** 解析一篇文档（Markdown 或 HTML）。links 里的 target 是相对文档根目录的路径。 */
export function parseDoc(src: string, raw: string): Doc {
  const isHtml = /\.html?$/i.test(src);
  const base = src.split("/").pop()!.replace(DOC_EXT, "");
  let title = "", description = "", tags: string[] = [], data: Record<string, unknown> = {}, html: string, headings: Heading[];
  if (isHtml) {
    const r = fromHtml(raw);
    ({ title, description, tags, html, headings } = r);
  } else {
    const fm = frontMatter(raw);
    data = fm.data;
    let body = fm.body;
    // 没写 title 时，用开头第一个块的一/二级标题（# / ## / setext 都算）作标题，并从正文里去掉。
    if (!data.title) {
      const first = new Marked({ gfm: true }).lexer(body).find((t) => t.type !== "space");
      if (first?.type === "heading" && first.depth <= 2) { title = plain(new Marked().parseInline(first.text, { async: false }) as string); body = body.slice(body.indexOf(first.raw) + first.raw.length); }
    }
    ({ html, headings } = renderMarkdown(body));
  }
  title = String(data.title ?? title).trim();
  const titleFromFile = !title;
  if (!title) title = base.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const s = sanitize(html);
  html = s.html;
  const text = plain(html);
  const ids = [...new Set([...html.matchAll(/\s(?:id|name)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]))];
  const dir = src.includes("/") ? src.slice(0, src.lastIndexOf("/") + 1) : "";
  const links: Link[] = [];
  for (const m of html.matchAll(/\s(href|src)\s*=\s*["']([^"']*)["']/gi)) {
    const href = decode(m[2]);
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) { links.push({ href, target: null, anchor: "", kind: "external" }); continue; }
    if (href.startsWith("#")) { links.push({ href, target: src, anchor: decodeURIComponent(href.slice(1)), kind: "anchor" }); continue; }
    const [pathPart, anchor = ""] = href.split("#");
    const clean = decodeURIComponent(pathPart.split("?")[0]);
    const target = normalize(clean.startsWith("/") ? clean.slice(1) : dir + clean);
    links.push({ href, target, anchor: decodeURIComponent(anchor), kind: isDocPath(target ?? "") ? "doc" : "asset" });
  }
  const folder = src.includes("/") ? src.split("/")[0] : "";
  const firstPara = plain(html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "") || text;
  description = String(data.description ?? description).trim();
  return {
    src, out: outPath(src), hash: sha(raw), title, titleFromFile, description,
    excerpt: (description || firstPara).slice(0, 180) + ((description || firstPara).length > 180 ? "…" : ""),
    folder, categoryName: data.category ? String(data.category) : undefined, order: Number.isFinite(Number(data.order)) ? Number(data.order) : 1000,
    tags: tags.length ? tags : list(data.tags), related: list(data.related), updated: data.updated ? (data.updated instanceof Date ? data.updated.toISOString().slice(0, 10) : String(data.updated)) : undefined,
    draft: data.draft === true, html, text: text.slice(0, 30_000), headings, ids, links, stripped: s.stripped, isIntro: /(^|\/)index\.(md|markdown|html?)$/i.test(src),
  };
}

/** 规范化相对路径（处理 ./ 和 ../）；越出根目录返回 null。 */
export function normalize(p: string): string | null {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!out.length) return null; out.pop(); } else out.push(part);
  }
  return out.join("/");
}
