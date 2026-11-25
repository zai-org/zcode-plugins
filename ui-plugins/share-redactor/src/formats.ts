import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { KitError } from "./kit/workspace.ts";
import { detect, type DetectOptions, type Hit } from "./detect.ts";

/** 一处命中：所在位置（行号 / 段落 / 单元格）与上下文。 */
export interface Found extends Hit { loc: string; context: string }
/** 决定每处命中替换成什么；返回 null 表示保留原文。 */
export type Decide = (hit: Found) => string | null;

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e] ?? m)));
export const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ctx = (text: string, h: Hit) => `${text.slice(Math.max(0, h.start - 18), h.start)}【${text.slice(h.start, h.end)}】${text.slice(h.end, h.end + 18)}`.replace(/\s+/g, " ");

// ---------- 纯文本 / Markdown / CSV ----------
export function textFind(src: string, o: DetectOptions): Found[] {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const line = (pos: number) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
  return detect(src, o).map((h) => ({ ...h, loc: `L${line(h.start)}`, context: ctx(src, h) }));
}
export function textApply(src: string, found: Found[], decide: Decide) {
  let out = src;
  for (const f of [...found].sort((a, b) => b.start - a.start)) {
    const m = decide(f);
    if (m !== null) out = out.slice(0, f.start) + m + out.slice(f.end);
  }
  return out;
}

// ---------- OOXML（DOCX / XLSX）共用：一组文字节点拼成一段，按字符映射回节点 ----------
interface Node { start: number; end: number; text: string } // start/end：节点内文字在 XML 中的位置
const TEXT_NODE = /<(w:t|w:delText|w:instrText|t)(\s[^>]*)?>([\s\S]*?)<\/\1>/g;

function nodesIn(xmlText: string, from: number, to: number): Node[] {
  const out: Node[] = [];
  TEXT_NODE.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = TEXT_NODE.exec(xmlText)) && m.index < to) {
    const inner = m[3];
    const start = m.index + m[0].length - inner.length - m[1].length - 3;
    out.push({ start, end: start + inner.length, text: unxml(inner) });
  }
  return out;
}

interface Block { loc: string; nodes: Node[]; text: string }
/** 把命中替换写回：命中所在第一个节点放替换文字，其余节点删掉命中部分。返回新 XML。 */
function applyBlocks(src: string, blocks: Block[], found: Map<Block, Found[]>, decide: Decide) {
  const edits: { start: number; end: number; text: string }[] = [];
  for (const b of blocks) {
    const hits = found.get(b);
    if (!hits?.length) continue;
    const chars = b.nodes.map((n) => [...n.text]);
    // 段内字符位置 → (节点, 节点内序号)，按 UTF-16 下标
    const map: [number, number][] = [];
    b.nodes.forEach((n, i) => { let k = 0; for (const ch of chars[i]) { for (let u = 0; u < ch.length; u++) map.push([i, k]); k++; } });
    const replaced = chars.map((c) => c.map((ch) => ch as string | null));
    let changed = false;
    for (const f of hits) {
      const m = decide(f);
      if (m === null) continue;
      changed = true;
      let first = true;
      for (let p = f.start; p < f.end; p++) {
        const [ni, ci] = map[p];
        if (first) { replaced[ni][ci] = m; first = false; } else replaced[ni][ci] = "";
      }
    }
    if (!changed) continue;
    b.nodes.forEach((n, i) => {
      const text = replaced[i].map((c) => c ?? "").join("");
      if (text !== n.text) edits.push({ start: n.start, end: n.end, text: xml(text) });
    });
  }
  let out = src;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function zip(buf: Uint8Array, what: string) {
  try {
    return unzipSync(buf);
  } catch {
    throw new KitError("bad_file", `This is not a readable ${what} file.`);
  }
}

// ---------- DOCX ----------
const DOCX_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
function docxBlocks(files: Record<string, Uint8Array>) {
  const parts: { name: string; xml: string; blocks: Block[] }[] = [];
  for (const name of Object.keys(files).filter((n) => DOCX_PARTS.test(n)).sort((a, b) => (a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b)))) {
    const src = strFromU8(files[name]);
    const label = name.replace(/^word\/|\.xml$/g, "");
    const blocks: Block[] = [];
    let n = 0;
    for (const m of src.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
      n++;
      const nodes = nodesIn(src, m.index!, m.index! + m[0].length);
      if (nodes.length) blocks.push({ loc: label === "document" ? `¶${n}` : `${label} ¶${n}`, nodes, text: nodes.map((x) => x.text).join("") });
    }
    parts.push({ name, xml: src, blocks });
  }
  return parts;
}
export function docxFind(buf: Uint8Array, o: DetectOptions): Found[] {
  const out: Found[] = [];
  for (const p of docxBlocks(zip(buf, ".docx"))) for (const b of p.blocks) for (const h of detect(b.text, o)) out.push({ ...h, loc: b.loc, context: ctx(b.text, h) });
  return out.concat(rawFind(zip(buf, ".docx"), o, (n) => /\.rels$|^docProps\//.test(n)));
}

/** 文档关系（超链接 mailto:）和文档属性里的原值：按原文替换。 */
function rawFind(files: Record<string, Uint8Array>, o: DetectOptions, which: (name: string) => boolean): Found[] {
  const out: Found[] = [];
  for (const name of Object.keys(files).filter(which)) {
    const text = unxml(strFromU8(files[name]));
    for (const h of detect(text, o)) out.push({ ...h, loc: name.startsWith("docProps/") ? "properties" : "link", context: ctx(text, h) });
  }
  return out;
}
function rawApply(src: string, found: Found[], decide: Decide) {
  let out = src;
  for (const f of found) {
    const m = decide(f);
    if (m === null) continue;
    for (const v of new Set([f.value, xml(f.value), encodeURIComponent(f.value)])) out = out.split(v).join(xml(m));
  }
  return out;
}
const CORE_PEOPLE = /<(dc:creator|cp:lastModifiedBy|cp:lastPrinted|dc:title|dc:subject|dc:description|cp:keywords)>[\s\S]*?<\/\1>/g;
function scrubProps(files: Zippable) {
  const core = files["docProps/core.xml"] as Uint8Array | undefined;
  if (core) files["docProps/core.xml"] = strToU8(strFromU8(core).replace(CORE_PEOPLE, (_m, tag) => `<${tag}></${tag}>`));
  const app = files["docProps/app.xml"] as Uint8Array | undefined;
  if (app) files["docProps/app.xml"] = strToU8(strFromU8(app).replace(/<(Company|Manager)>[\s\S]*?<\/\1>/g, (_m, tag) => `<${tag}></${tag}>`));
}

export function docxApply(buf: Uint8Array, o: DetectOptions, decide: Decide, scrub: boolean) {
  const files = zip(buf, ".docx");
  const found = new Map<Block, Found[]>();
  const out: Zippable = { ...files };
  for (const p of docxBlocks(files)) {
    for (const b of p.blocks) found.set(b, detect(b.text, o).map((h) => ({ ...h, loc: b.loc, context: "" })));
    out[p.name] = strToU8(applyBlocks(p.xml, p.blocks, found, decide));
  }
  for (const name of Object.keys(files).filter((n) => /\.rels$|^docProps\//.test(n))) {
    const f = rawFind({ [name]: files[name] }, o, () => true);
    if (f.length) out[name] = strToU8(rawApply(strFromU8(files[name]), f, decide));
  }
  if (scrub) scrubProps(out);
  return zipSync(out, { level: 6 });
}

// ---------- XLSX ----------
function sheetNames(files: Record<string, Uint8Array>) {
  const wb = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const rels = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target")]));
  const names = new Map<string, string>();
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const t = target.get(attr(m[0], "r:id"));
    const name = attr(m[0], "name");
    if (t && name) names.set(`xl/${t.replace(/^\/?xl\//, "")}`, unxml(name));
  }
  return names;
}
interface Cell { ref: string; vStart: number; vEnd: number; value: string; tagStart: number; tagEnd: number; open: string }
function xlsxParts(files: Record<string, Uint8Array>) {
  const names = sheetNames(files);
  const sst = files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : "";
  const sstBlocks: Block[] = [];
  for (const m of sst.matchAll(/<si>[\s\S]*?<\/si>|<si\/>/g)) {
    const nodes = nodesIn(sst, m.index!, m.index! + m[0].length);
    sstBlocks.push({ loc: "", nodes, text: nodes.map((x) => x.text).join("") });
  }
  const sheets: { name: string; label: string; xml: string; inline: Block[]; cells: Cell[] }[] = [];
  for (const name of Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))) {
    const src = strFromU8(files[name]);
    const label = names.get(name) ?? name.replace(/^xl\/worksheets\/|\.xml$/g, "");
    const inline: Block[] = [];
    const cells: Cell[] = [];
    for (const m of src.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1];
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1] ?? "?";
      const t = attrs.match(/\bt="(\w+)"/)?.[1];
      const body = m[2] ?? "";
      const bodyStart = m.index! + m[0].indexOf(">") + 1;
      if (t === "s") {
        const idx = Number(body.match(/<v>(\d+)<\/v>/)?.[1]);
        if (sstBlocks[idx] && !sstBlocks[idx].loc) sstBlocks[idx].loc = `${label}!${ref}`;
      } else if (t === "inlineStr") {
        const nodes = nodesIn(src, bodyStart, bodyStart + body.length);
        inline.push({ loc: `${label}!${ref}`, nodes, text: nodes.map((x) => x.text).join("") });
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        if (v) {
          const vStart = bodyStart + body.indexOf(v[0]) + 3;
          cells.push({ ref: `${label}!${ref}`, vStart, vEnd: vStart + v[1].length, value: unxml(v[1]), tagStart: m.index!, tagEnd: m.index! + m[0].length, open: `<c${attrs}>` });
        }
      }
    }
    sheets.push({ name, label, xml: src, inline, cells });
  }
  sstBlocks.forEach((b, i) => { if (!b.loc) b.loc = `shared string ${i + 1}`; });
  return { sst, sstBlocks, sheets };
}
/** 数字单元格：Excel 把 13812345678 存成数字，科学计数法也还原成整数再识别。 */
const numText = (v: string) => (/^\d+(\.\d+)?E\+\d+$/i.test(v) ? BigInt(Math.round(Number(v))).toString() : v);

export function xlsxFind(buf: Uint8Array, o: DetectOptions): Found[] {
  const files = zip(buf, ".xlsx");
  const { sstBlocks, sheets } = xlsxParts(files);
  const out: Found[] = [];
  for (const b of sstBlocks) for (const h of detect(b.text, o)) out.push({ ...h, loc: b.loc, context: ctx(b.text, h) });
  for (const s of sheets) {
    for (const b of s.inline) for (const h of detect(b.text, o)) out.push({ ...h, loc: b.loc, context: ctx(b.text, h) });
    for (const c of s.cells) { const t = numText(c.value); for (const h of detect(t, o)) out.push({ ...h, loc: c.ref, context: ctx(t, h) }); }
  }
  return out.concat(rawFind(files, o, (n) => /^xl\/comments\d*\.xml$|^xl\/threadedComments\/|\.rels$|^docProps\//.test(n)));
}

export function xlsxApply(buf: Uint8Array, o: DetectOptions, decide: Decide, scrub: boolean) {
  const files = zip(buf, ".xlsx");
  const { sst, sstBlocks, sheets } = xlsxParts(files);
  const out: Zippable = { ...files };
  if (sst) {
    const found = new Map<Block, Found[]>();
    for (const b of sstBlocks) found.set(b, detect(b.text, o).map((h) => ({ ...h, loc: b.loc, context: "" })));
    out["xl/sharedStrings.xml"] = strToU8(applyBlocks(sst, sstBlocks, found, decide));
  }
  for (const s of sheets) {
    const found = new Map<Block, Found[]>();
    for (const b of s.inline) found.set(b, detect(b.text, o).map((h) => ({ ...h, loc: b.loc, context: "" })));
    let x = applyBlocks(s.xml, s.inline, found, decide);
    // 数字 / 公式缓存值：改成内联文本单元格（去掉公式，防止重算出原值）。内联编辑后位置可能偏移，按单元格引用重新定位。
    for (const c of [...s.cells].reverse()) {
      const t = numText(c.value);
      const hits = detect(t, o);
      if (!hits.length) continue;
      let text = t, changed = false;
      for (const h of [...hits].reverse()) { const m = decide({ ...h, loc: c.ref, context: "" }); if (m !== null) { text = text.slice(0, h.start) + m + text.slice(h.end); changed = true; } }
      if (!changed) continue;
      const ref = c.ref.split("!").pop()!;
      const re = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
      const cur = x.match(re);
      if (!cur) continue;
      const open = cur[0].match(/^<c\b[^>]*?(?=\/?>)/)![0].replace(/\s+t="\w+"/, "");
      x = x.replace(re, `${open} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`);
    }
    out[s.name] = strToU8(x);
  }
  for (const name of Object.keys(files).filter((n) => /^xl\/comments\d*\.xml$|^xl\/threadedComments\/|\.rels$|^docProps\//.test(n))) {
    const f = rawFind({ [name]: files[name] }, o, () => true);
    if (f.length) out[name] = strToU8(rawApply(strFromU8(files[name]), f, decide));
  }
  // 计算链缓存可能保留旧值：删掉，让 Excel 重新计算
  if (out["xl/calcChain.xml"]) {
    delete out["xl/calcChain.xml"];
    const ct = out["[Content_Types].xml"] as Uint8Array | undefined;
    if (ct) out["[Content_Types].xml"] = strToU8(strFromU8(ct).replace(/<Override\b[^>]*calcChain\.xml"[^>]*\/>/g, ""));
    const rel = out["xl/_rels/workbook.xml.rels"] as Uint8Array | undefined;
    if (rel) out["xl/_rels/workbook.xml.rels"] = strToU8(strFromU8(rel).replace(/<Relationship\b[^>]*calcChain\.xml"[^>]*\/>/g, ""));
  }
  if (scrub) scrubProps(out);
  return zipSync(out, { level: 6 });
}

/** 自检：解压后所有部件的文字（含属性），供查找原值。 */
export function zipAllText(buf: Uint8Array) {
  const files = unzipSync(buf);
  return Object.entries(files).filter(([n]) => /\.(xml|rels|txt|vml)$/i.test(n)).map(([, b]) => unxml(strFromU8(b))).join("\n");
}
