// 把报告与资料读成段落：PDF（逐页）、DOCX、HTML、Markdown、TXT。
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { parseHTML } from "linkedom";
import { KitError } from "./kit/workspace.ts";
import { unradical } from "./cjk.ts";
import { isCjk } from "./text.ts";

export type Kind = "pdf" | "docx" | "html" | "md" | "txt";
export const KINDS: Record<string, Kind> = { pdf: "pdf", docx: "docx", html: "html", htm: "html", md: "md", markdown: "md", txt: "txt", text: "txt" };
export const kindOf = (f: string): Kind | undefined => KINDS[f.toLowerCase().split(".").pop() ?? ""];

export interface Block { text: string; loc: string; page?: number; line?: number; heading?: boolean; section?: string }
export interface Doc { file: string; kind: Kind; title: string; blocks: Block[]; pages?: { w: number; h: number }[] }

// ---------- PDF ----------
let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | undefined;
async function lib() {
  if (!pdfjs) {
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjs;
}
async function openPdf(buf: Uint8Array, assetRoot: string) {
  const l = await lib();
  const task = l.getDocument({ data: new Uint8Array(buf), cMapUrl: join(assetRoot, "pdfjs/cmaps") + "/", cMapPacked: true, standardFontDataUrl: join(assetRoot, "pdfjs/standard_fonts") + "/", useSystemFonts: false, verbosity: 0 });
  try {
    return { task, doc: await task.promise };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new KitError(/password/i.test(msg) ? "pdf_password" : "bad_pdf", /password/i.test(msg) ? "This PDF is password-protected; remove the password first." : `Cannot read this PDF: ${msg}`);
  }
}
type Item = { str: string; transform: number[]; width: number; height: number; hasEOL: boolean };

/** 一页文字连成一串：同行直接相连，换行处中文之间不加空格、其余加一个空格；记下每个字符来自哪个文字块，方便算高亮框。 */
function flowOf(items: Item[]) {
  let flow = "";
  const owner: number[] = [], index: number[] = [];
  let eol = false;
  items.forEach((it, i) => {
    if (!("str" in it)) return;
    const str = unradical(it.str);
    if (!str) { if (it.hasEOL) eol = true; return; }
    if (eol) {
      const prev = flow.at(-1) ?? "";
      if (prev && !(isCjk(prev) && isCjk(str[0])) && !/\s/.test(prev) && !(prev === "-" && /[a-z]/.test(str[0]))) { flow += " "; owner.push(-1); index.push(0); }
    }
    eol = false;
    for (let k = 0; k < str.length; k++) { owner.push(i); index.push(k); }
    flow += str;
    if (it.hasEOL) eol = true;
  });
  return { flow, owner, index };
}

export async function readPdf(file: string, buf: Uint8Array, assetRoot: string): Promise<Doc> {
  const { task, doc } = await openPdf(buf, assetRoot);
  const blocks: Block[] = [], pages: { w: number; h: number }[] = [];
  let title = "";
  try {
    title = String(((await doc.getMetadata()).info as { Title?: string })?.Title ?? "");
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const [x0, y0, x1, y1] = page.view;
      pages.push({ w: x1 - x0, h: y1 - y0 });
      const { flow } = flowOf((await page.getTextContent()).items as Item[]);
      blocks.push({ text: flow, loc: `p.${p}`, page: p });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return { file, kind: "pdf", title: title || file.split("/").pop()!, blocks, pages };
}

export interface Rect { x: number; y: number; w: number; h: number }
const weight = (code: number) => (code === 32 ? 0.3 : (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xff00 && code <= 0xff60) ? 1 : 0.55);

/** 页面上第 start–end 个字符（与 readPdf 的页文本同一套下标）所在的矩形（PDF 坐标，左下原点）。 */
export async function pdfRects(buf: Uint8Array, assetRoot: string, pageNo: number, start: number, end: number): Promise<{ rects: Rect[]; w: number; h: number }> {
  const { task, doc } = await openPdf(buf, assetRoot);
  try {
    if (pageNo < 1 || pageNo > doc.numPages) throw new KitError("bad_page", `Page ${pageNo} is outside 1–${doc.numPages}.`);
    const page = await doc.getPage(pageNo);
    const [x0, y0, x1, y1] = page.view;
    const items = (await page.getTextContent()).items as Item[];
    const { owner, index } = flowOf(items);
    const byItem = new Map<number, [number, number]>();
    for (let c = Math.max(0, start); c < Math.min(end, owner.length); c++) {
      const i = owner[c];
      if (i < 0) continue;
      const r = byItem.get(i);
      byItem.set(i, r ? [Math.min(r[0], index[c]), Math.max(r[1], index[c] + 1)] : [index[c], index[c] + 1]);
    }
    const rects: Rect[] = [];
    for (const [i, [a, b]] of byItem) {
      const it = items[i];
      const [, sb, , sd, tx, ty] = it.transform;
      const size = Math.hypot(sb, sd) || it.height || 10;
      const str = unradical(it.str);
      const ws = [...str].map((_, k) => weight(str.charCodeAt(k)));
      const total = ws.reduce((x, y) => x + y, 0) || 1, before = ws.slice(0, a).reduce((x, y) => x + y, 0), span = ws.slice(a, b).reduce((x, y) => x + y, 0);
      rects.push({ x: tx + (it.width * before) / total, y: ty - size * 0.25, w: (it.width * span) / total, h: size * 1.2 });
    }
    return { rects, w: x1 - x0, h: y1 - y0 };
  } finally {
    await task.destroy();
  }
}

// ---------- DOCX ----------
const XML_ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENT[e] ?? m));

export function readDocx(file: string, buf: Uint8Array): Doc {
  let zip: Record<string, Uint8Array>;
  try { zip = unzipSync(buf, { filter: (f) => f.name === "word/document.xml" || f.name === "docProps/core.xml" }); } catch { throw new KitError("bad_docx", `${file} is not a valid .docx file.`); }
  const xml = zip["word/document.xml"] ? strFromU8(zip["word/document.xml"]) : "";
  if (!xml) throw new KitError("bad_docx", `${file} has no word/document.xml.`);
  const title = unxml(/<dc:title>([^<]*)<\/dc:title>/.exec(zip["docProps/core.xml"] ? strFromU8(zip["docProps/core.xml"]) : "")?.[1] ?? "");
  const blocks: Block[] = [];
  let n = 0, section = "";
  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0];
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? "";
    const text = unxml(p.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<w:delText[\s\S]*?<\/w:delText>/g, "").replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, "").replace(/<(?!w:t[ >])[^>]+>/g, (t) => (t.startsWith("<w:t") ? "" : "")).replace(/<w:t[^>]*>/g, "")).trim();
    n++;
    if (!text) continue;
    const heading = /heading|title|标题|^\d$/i.test(style) && !/subtitle/i.test(style);
    if (heading) section = text;
    blocks.push({ text, loc: `¶${n}`, heading, section: heading ? undefined : section || undefined });
  }
  return { file, kind: "docx", title: title || blocks.find((b) => b.heading)?.text || file.split("/").pop()!, blocks };
}

// ---------- HTML ----------
export function decodeHtml(buf: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(buf.subarray(0, 4096));
  const cs = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  try { return new TextDecoder(cs && cs !== "utf8" ? cs : "utf-8").decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
}
const BLOCK_SEL = "p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,dd,dt,figcaption,pre,caption";
export function readHtml(file: string, html: string): Doc {
  const { document } = parseHTML(html);
  const title = (document.querySelector('meta[property="og:title"]')?.getAttribute("content") || document.querySelector("title")?.textContent || "").trim();
  document.querySelectorAll("script,style,noscript,template,nav,header,footer,aside,form,svg,iframe,button,[hidden],[aria-hidden=true]").forEach((e: Element) => e.remove());
  const blocks: Block[] = [];
  let section = "";
  const els = [...document.querySelectorAll(BLOCK_SEL)] as Element[];
  const sel = new Set(els);
  for (const el of els) {
    // 只取最内层的块（li 里套 p 时取 p）
    if ([...el.querySelectorAll(BLOCK_SEL)].some((c) => sel.has(c as Element))) continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const heading = /^H\d$/.test(el.tagName);
    if (heading) section = text;
    blocks.push({ text, loc: `¶${blocks.length + 1}`, heading, section: heading ? undefined : section || undefined });
  }
  if (!blocks.length) {
    const body = (document.body?.textContent ?? "").split(/\n\s*\n/).map((t: string) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
    body.forEach((text: string, i: number) => blocks.push({ text, loc: `¶${i + 1}` }));
  }
  return { file, kind: "html", title: title || file.split("/").pop()!, blocks };
}

// ---------- Markdown / TXT ----------
const joinLines = (lines: string[]) => lines.reduce((acc, l) => (!acc ? l : isCjk(acc.at(-1)!) && isCjk(l[0] ?? "") ? acc + l : `${acc} ${l}`), "");
const unmd = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, "$1").replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2").replace(/`([^`]+)`/g, "$1").replace(/<[^>]+>/g, "");

export function readText(file: string, src: string, kind: "md" | "txt"): Doc {
  const lines = src.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let buf: { text: string; line: number }[] = [], section = "", fence = false;
  const flush = () => {
    if (!buf.length) return;
    // 每行都像列表项或参考文献条目时，一行一块
    const each = buf.length > 1 && buf.every((l) => /^\s*(?:[-*+]\s|\d+[.)、]\s*|\[\^?\w+\][:：]?\s|【\d+】)/.test(l.text));
    const groups = each ? buf.map((l) => [l]) : [buf];
    for (const g of groups) {
      const text = joinLines(g.map((l) => (kind === "md" ? unmd(l.text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^>\s?/, "")) : l.text).trim()));
      if (text) blocks.push({ text, loc: `L${g[0].line}`, line: g[0].line, section: section || undefined });
    }
    buf = [];
  };
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (kind === "md" && /^\s*(```|~~~)/.test(raw)) { flush(); fence = !fence; return; }
    if (fence) return;
    if (!raw.trim()) { flush(); return; }
    const hm = kind === "md" ? /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw) : null;
    if (hm) { flush(); section = unmd(hm[2]); blocks.push({ text: section, loc: `L${line}`, line, heading: true }); return; }
    if (kind === "md" && /^\s*\|/.test(raw)) {
      flush();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(raw)) return;
      blocks.push({ text: unmd(raw.split("|").map((c) => c.trim()).filter(Boolean).join("  ")), loc: `L${line}`, line, section: section || undefined });
      return;
    }
    if (kind === "md" && /^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) { flush(); return; }
    buf.push({ text: raw, line });
  });
  flush();
  const title = blocks.find((b) => b.heading)?.text ?? file.split("/").pop()!;
  return { file, kind, title, blocks };
}

/** 二进制或编码不对的“文本”：有 NUL，或替换字符 / 控制字符超过 5%（TEST-FINDINGS #7）。 */
export function looksLikeText(buf: Uint8Array, text: string): boolean {
  if (!buf.length) return true;
  if (buf.subarray(0, 8192).includes(0)) return false;
  let bad = 0, n = 0;
  for (const ch of text) { n++; if (ch === "\uFFFD" || /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(ch)) bad++; }
  return bad / Math.max(1, n) <= 0.05;
}

export async function readDoc(file: string, buf: Uint8Array, assetRoot: string): Promise<Doc> {
  const kind = kindOf(file);
  if (kind === "pdf") return readPdf(file, buf, assetRoot);
  if (kind === "docx") return readDocx(file, buf);
  if (kind === "html") return readHtml(file, decodeHtml(buf));
  if (kind === "md" || kind === "txt") {
    const text = new TextDecoder("utf-8").decode(buf);
    if (!looksLikeText(buf, text)) throw new KitError("bad_text", `${file} does not look like a UTF-8 text file (binary, damaged, or a GBK file). Re-save it as UTF-8 text, or pass the original PDF/DOCX.`);
    return readText(file, text, kind);
  }
  throw new KitError("unsupported", `${file}: supported formats are PDF, DOCX, HTML, Markdown and TXT (save .doc as .docx first).`);
}
