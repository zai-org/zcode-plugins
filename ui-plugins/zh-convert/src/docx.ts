import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/** Word 里可能有正文文字的部分 */
const PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
const dec = (s: string) => s.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-f]+));/gi, (_, n: string, d?: string, h?: string) => (d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" } as Record<string, string>)[n.toLowerCase()]));
const enc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type Para = { part: string; nodes: { start: number; end: number; text: string }[]; text: string };

/** 按段落收集 <w:t> 文字：两个 <w:t> 之间出现 <w:p 或 </w:p> 就算新段落 */
export function readDocx(buf: Uint8Array): { files: Record<string, Uint8Array>; paras: Para[] } {
  const files = unzipSync(buf);
  if (!files["word/document.xml"]) throw new Error("not a Word .docx file (word/document.xml missing)");
  const paras: Para[] = [];
  const names = Object.keys(files).filter((n) => PARTS.test(n)).sort((a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b)));
  for (const part of names) {
    const xml = strFromU8(files[part]);
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\s*\/>|<w:p[\s>/]|<\/w:p>/g;
    let cur: Para | null = null;
    for (const m of xml.matchAll(re)) {
      if (!m[0].startsWith("<w:t")) { if (cur?.nodes.length) paras.push(cur); cur = null; continue; }
      if (m[1] === undefined) continue;
      cur ??= { part, nodes: [], text: "" };
      const start = m.index! + m[0].indexOf(">") + 1;
      const text = dec(m[1]);
      cur.nodes.push({ start, end: start + m[1].length, text });
      cur.text += text;
    }
    if (cur?.nodes.length) paras.push(cur);
  }
  return { files, paras };
}

/** 把每段的新文字写回去。长度不变时按原来的分段切开（保留每段文字格式），否则整段放进第一个 run */
export function writeDocx(files: Record<string, Uint8Array>, paras: Para[], next: Map<Para, string[] | string>): Uint8Array {
  const byPart = new Map<string, { start: number; end: number; text: string }[]>();
  for (const p of paras) {
    const v = next.get(p);
    if (v === undefined) continue;
    let pieces: string[];
    if (Array.isArray(v)) pieces = v;
    else if ([...v].length === [...p.text].length) {
      const cps = [...v]; let k = 0;
      pieces = p.nodes.map((n) => { const len = [...n.text].length; const s = cps.slice(k, k + len).join(""); k += len; return s; });
    } else pieces = p.nodes.map((_, i) => (i === 0 ? v : ""));
    const list = byPart.get(p.part) ?? [];
    p.nodes.forEach((n, i) => { if (pieces[i] !== n.text) list.push({ start: n.start, end: n.end, text: pieces[i] }); });
    byPart.set(p.part, list);
  }
  const out: Record<string, Uint8Array> = { ...files };
  for (const [part, edits] of byPart) {
    if (!edits.length) continue;
    let xml = strFromU8(files[part]);
    for (const e of edits.sort((a, b) => b.start - a.start)) {
      xml = xml.slice(0, e.start) + enc(e.text) + xml.slice(e.end);
      // 首尾有空格时需要 xml:space="preserve"
      if (/^\s|\s$/.test(e.text)) {
        const open = xml.lastIndexOf("<w:t", e.start);
        const tag = xml.slice(open, e.start);
        if (!/xml:space=/.test(tag)) xml = xml.slice(0, open) + `<w:t xml:space="preserve"` + xml.slice(open + 4);
      }
    }
    out[part] = strToU8(xml);
  }
  return zipSync(out, { level: 6 });
}
