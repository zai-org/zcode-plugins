import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { KitError } from "./kit/workspace.ts";

const PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const PH = /\{\{\s*([^{}]+?)\s*\}\}/g;
const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function openDocx(bytes: Uint8Array) {
  try {
    const files = unzipSync(bytes);
    if (!files["word/document.xml"]) throw new Error("no word/document.xml");
    return files;
  } catch (e) {
    throw new KitError("bad_docx", `Not a readable .docx file (${(e as Error).message}). Save it from Word as .docx.`);
  }
}

/** 段落里所有 <w:t> 文本节点（Word 常把一个占位符拆进几个 run）。 */
function textNodes(para: string) {
  const nodes: { start: number; end: number; open: string; text: string; at: number }[] = [];
  const re = /(<w:t(?:\s[^>]*)?>)([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  let at = 0;
  while ((m = re.exec(para))) {
    const text = unescapeXml(m[2]);
    nodes.push({ start: m.index, end: m.index + m[0].length, open: m[1], text, at });
    at += text.length;
  }
  return nodes;
}

export function placeholders(files: Record<string, Uint8Array>) {
  const found = new Set<string>();
  for (const [path, data] of Object.entries(files)) {
    if (!PARTS.test(path)) continue;
    for (const para of strFromU8(data).match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
      const text = textNodes(para).map((n) => n.text).join("");
      for (const m of text.matchAll(PH)) found.add(m[1]);
    }
  }
  return [...found];
}

function fillParagraph(para: string, values: Record<string, string>, missing: Set<string>) {
  const nodes = textNodes(para);
  const full = nodes.map((n) => n.text).join("");
  const matches = [...full.matchAll(PH)];
  if (!matches.length) return para;
  const texts = nodes.map((n) => n.text);
  for (const m of matches.reverse()) {
    const s = m.index!, e = s + m[0].length;
    const key = m[1];
    const value = key in values ? values[key] : (missing.add(key), "");
    const first = nodes.findIndex((n, i) => s >= n.at && s < n.at + nodes[i].text.length);
    const last = nodes.findIndex((n, i) => e - 1 >= n.at && e - 1 < n.at + nodes[i].text.length);
    for (let i = first; i <= last; i++) {
      const n = nodes[i];
      const from = Math.max(s, n.at) - n.at, to = Math.min(e, n.at + n.text.length) - n.at;
      const cur = texts[i];
      // texts[i] 可能已被右侧的替换改过，但只改了 to 之后的部分，位置 from..to 仍有效
      texts[i] = cur.slice(0, from) + (i === first ? value : "") + cur.slice(to);
    }
  }
  let out = "";
  let pos = 0;
  nodes.forEach((n, i) => {
    const open = /xml:space=/.test(n.open) ? n.open : n.open.replace("<w:t", '<w:t xml:space="preserve"');
    // 多行值：换行转成 <w:br/>
    const body = texts[i].split("\n").map(escapeXml).join(`</w:t><w:br/>${open}`);
    out += para.slice(pos, n.start) + `${open}${body}</w:t>`;
    pos = n.end;
  });
  return out + para.slice(pos);
}

export function fillDocx(files: Record<string, Uint8Array>, values: Record<string, string>) {
  const missing = new Set<string>();
  const out: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) {
    if (!PARTS.test(path)) { out[path] = data; continue; }
    const xml = strFromU8(data).replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => fillParagraph(p, values, missing));
    out[path] = strToU8(xml);
  }
  return { bytes: zipSync(out, { level: 6 }), missing: [...missing] };
}

/** 预览用：每段纯文本。 */
export function paragraphs(files: Record<string, Uint8Array>) {
  const out: string[] = [];
  for (const path of ["word/header1.xml", "word/document.xml", "word/footer1.xml"]) {
    if (!files[path]) continue;
    for (const para of strFromU8(files[path]).match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
      const t = textNodes(para).map((n) => n.text).join("");
      if (t.trim()) out.push(t);
    }
  }
  return out;
}

export function fileNameFor(pattern: string, row: Record<string, string>, index: number) {
  const name = pattern.replace(/\{n\}/g, String(index + 1)).replace(/\{\{?\s*([^{}]+?)\s*\}?\}/g, (_, k: string) => row[k.trim()] ?? "");
  return name.trim() || `document-${index + 1}`;
}
