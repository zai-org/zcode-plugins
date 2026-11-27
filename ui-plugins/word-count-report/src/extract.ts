// 从 DOCX / Markdown / TXT / PDF 取出段落和章节
import { strFromU8, unzipSync } from "fflate";
import { findAll, kid, kids, parseXml, type El } from "./xml.ts";

export type Kind = "text" | "heading" | "code" | "table" | "quote" | "list";
export interface Para { t: string; k: Kind; level?: number }
export interface Section { file: string; title: string; level: number; paras: Para[] }

export const CHAPTER = /^\s*(第\s*[0-9０-９一二三四五六七八九十百千零〇两]+\s*[章节回卷部篇幕].{0,40}|(chapter|part)\s+[0-9ivxlc]+\b.{0,40}|序章|序言|前言|引言|楔子|尾声|后记|附录.{0,20}|prologue|epilogue|introduction)\s*$/i;

function stripMd(t: string): string {
  return t
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*([-*+]|\d+[.)])\s+/, "")
    .replace(/\s+$/, "");
}

export function fromMarkdown(md: string): Para[] {
  const out: Para[] = [];
  let lines = md.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() === "---") { const end = lines.indexOf("---", 1); if (end > 0) lines = lines.slice(end + 1); }
  let fence = false;
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) { out.push({ t: raw, k: "code" }); continue; }
    if (!raw.trim() || /^\s*([-*_]\s*){3,}$/.test(raw)) continue;
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) { out.push({ t: stripMd(h[2]), k: "heading", level: h[1].length }); continue; }
    if (/^\s*\|.*\|\s*$/.test(raw)) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(raw)) out.push({ t: raw.split("|").map((c) => stripMd(c.trim())).filter(Boolean).join(" "), k: "table" }); continue; }
    if (/^( {4}|\t)/.test(raw) && (out[out.length - 1]?.k === "code" || !out.length || !raw.trim().length)) { out.push({ t: raw, k: "code" }); continue; }
    const k: Kind = /^\s*>/.test(raw) ? "quote" : /^\s*([-*+]|\d+[.)])\s+/.test(raw) ? "list" : "text";
    out.push({ t: stripMd(raw), k });
  }
  return out;
}

export function fromText(txt: string): Para[] {
  return txt.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim()).map((l) => (CHAPTER.test(l) ? { t: l.trim(), k: "heading" as const, level: 1 } : { t: l, k: "text" as const }));
}

function docxText(e: El): string {
  let s = "";
  for (const c of e.children) {
    if (typeof c === "string") continue;
    if (c.name === "w:t") s += c.children.filter((x) => typeof x === "string").join("");
    else if (c.name === "w:tab") s += " ";
    else if (c.name === "w:br" || c.name === "w:cr") s += "\n";
    else if (c.name === "w:delText" || c.name === "w:instrText") continue;
    else s += docxText(c);
  }
  return s;
}

export function fromDocx(bytes: Uint8Array): Para[] {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error("Not a .docx file (could not unzip). Save old .doc files as .docx first."); }
  if (!files["word/document.xml"]) throw new Error("Not a Word document (word/document.xml missing).");
  const styles = new Map<string, number>();
  if (files["word/styles.xml"]) {
    for (const st of findAll(parseXml(strFromU8(files["word/styles.xml"])), "w:style")) {
      const id = st.attrs["w:styleId"], name = kid(st, "w:name")?.attrs["w:val"] ?? "";
      const lvl = kid(kid(st, "w:pPr"), "w:outlineLvl")?.attrs["w:val"];
      const m = /^(heading|标题)\s*(\d)$/i.exec(name) ?? /^(Heading)(\d)$/i.exec(id ?? "");
      if (m) styles.set(id, Number(m[2])); else if (lvl !== undefined && Number(lvl) < 9) styles.set(id, Number(lvl) + 1);
      if (/^title$/i.test(name)) styles.set(id, 1);
    }
  }
  const body = kid(kid(parseXml(strFromU8(files["word/document.xml"])), "w:document"), "w:body");
  const out: Para[] = [];
  const walk = (e: El, inTable: boolean) => {
    for (const c of kids(e)) {
      if (c.name === "w:p") {
        const t = docxText(c).replace(/\s+$/, "");
        if (!t.trim()) continue;
        const ppr = kid(c, "w:pPr"), sid = kid(ppr, "w:pStyle")?.attrs["w:val"] ?? "";
        const ol = kid(ppr, "w:outlineLvl")?.attrs["w:val"];
        const level = styles.get(sid) ?? (/^heading(\d)$/i.test(sid) ? Number(sid.slice(7)) : ol !== undefined && Number(ol) < 9 ? Number(ol) + 1 : undefined);
        out.push(inTable ? { t, k: "table" } : level ? { t, k: "heading", level } : { t, k: kid(ppr, "w:numPr") ? "list" : "text" });
      } else if (c.name === "w:tbl") walk(c, true);
      else walk(c, inTable);
    }
  };
  walk(body, false);
  return out;
}

export async function fromPdf(bytes: Uint8Array): Promise<Para[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  const out: Para[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let line = "";
      const flush = () => { const l = line.replace(/\s+$/, ""); if (l.trim()) out.push(CHAPTER.test(l) ? { t: l.trim(), k: "heading", level: 1 } : { t: l, k: "text" }); line = ""; };
      for (const it of tc.items as { str?: string; hasEOL?: boolean }[]) { line += it.str ?? ""; if (it.hasEOL) flush(); }
      flush();
      page.cleanup();
    }
  } finally { await doc.destroy(); }
  return out;
}

/** 按标题切章节：level ≤ maxLevel 的标题开始新章节；标题前的内容归入“（开头）”。 */
export function sections(file: string, paras: Para[], maxLevel: number): Section[] {
  const out: Section[] = [];
  let cur: Section = { file, title: "", level: 0, paras: [] };
  for (const p of paras) {
    if (p.k === "heading" && (p.level ?? 1) <= maxLevel) {
      if (cur.paras.length || cur.title) out.push(cur);
      cur = { file, title: p.t.trim(), level: p.level ?? 1, paras: [p] };
    } else cur.paras.push(p);
  }
  if (cur.paras.length || cur.title) out.push(cur);
  return out;
}
