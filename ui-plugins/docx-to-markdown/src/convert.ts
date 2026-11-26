import { strFromU8, unzipSync } from "fflate";
import { find, findAll, kid, kids, parseXml, text, type El } from "./xml.ts";

export interface ConvertOpts { mediaDir: string; headingOffset: number; underline: boolean }
export interface Converted { markdown: string; media: { name: string; data: Uint8Array }[]; stats: { headings: number; tables: number; images: number; lists: number; links: number; comments: number }; title: string; warnings: string[] }

const isOn = (e: El | undefined) => !!e && !["0", "false", "none"].includes(e.attrs["w:val"] ?? "true");
const escMd = (s: string) => s.replace(/([\\`*_[\]<>])/g, "\\$1");
const escStart = (s: string) => s.replace(/^([#>+-])(\s)/, "\\$1$2").replace(/^(\d+)\.(\s)/, "$1\\.$2");

interface StyleInfo { name: string; outline?: number; numId?: string; ilvl?: number; based?: string; mono?: boolean; b?: boolean; i?: boolean }
interface Ctx { styles: Map<string, StyleInfo>; rels: Map<string, { target: string; external: boolean }>; nums: Map<string, Map<number, string>>; files: Record<string, Uint8Array>; media: Converted["media"]; mediaNames: Map<string, string>; o: ConvertOpts; stats: Converted["stats"]; warnings: string[] }

function readStyles(xml?: string) {
  const map = new Map<string, StyleInfo>();
  if (!xml) return map;
  for (const s of findAll(parseXml(xml), "w:style")) {
    const id = s.attrs["w:styleId"]; if (!id) continue;
    const ppr = kid(s, "w:pPr"), rpr = kid(s, "w:rPr");
    const ol = kid(ppr, "w:outlineLvl"), np = kid(ppr, "w:numPr");
    const fonts = kid(rpr, "w:rFonts");
    map.set(id, { name: kid(s, "w:name")?.attrs["w:val"] ?? id, outline: ol ? Number(ol.attrs["w:val"]) : undefined, numId: kid(np, "w:numId")?.attrs["w:val"], ilvl: kid(np, "w:ilvl") ? Number(kid(np, "w:ilvl")!.attrs["w:val"]) : undefined, based: kid(s, "w:basedOn")?.attrs["w:val"], mono: /consolas|courier|mono|menlo/i.test(fonts?.attrs["w:ascii"] ?? ""), b: isOn(kid(rpr, "w:b")) || undefined, i: isOn(kid(rpr, "w:i")) || undefined });
  }
  return map;
}
function style(c: Ctx, id: string | undefined): StyleInfo & { chain: string[] } {
  const chain: string[] = [];
  let out: StyleInfo = { name: "" };
  for (let cur = id, n = 0; cur && n < 10; n++) {
    const s = c.styles.get(cur); if (!s) break;
    chain.push(s.name.toLowerCase());
    out = { ...s, ...Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== "")) } as StyleInfo;
    cur = s.based;
  }
  return { ...out, name: chain[0] ?? "", chain };
}
function readNumbering(xml?: string) {
  const nums = new Map<string, Map<number, string>>();
  if (!xml) return nums;
  const root = parseXml(xml);
  const abs = new Map<string, Map<number, string>>();
  for (const a of findAll(root, "w:abstractNum")) {
    const lv = new Map<number, string>();
    for (const l of kids(a, "w:lvl")) lv.set(Number(l.attrs["w:ilvl"]), kid(l, "w:numFmt")?.attrs["w:val"] ?? "bullet");
    abs.set(a.attrs["w:abstractNumId"], lv);
  }
  for (const n of findAll(root, "w:num")) { const a = kid(n, "w:abstractNumId")?.attrs["w:val"]; if (a && abs.has(a)) nums.set(n.attrs["w:numId"], abs.get(a)!); }
  return nums;
}
function readRels(xml?: string) {
  const map = new Map<string, { target: string; external: boolean }>();
  if (!xml) return map;
  for (const r of findAll(parseXml(xml), "Relationship")) map.set(r.attrs.Id, { target: r.attrs.Target, external: r.attrs.TargetMode === "External" });
  return map;
}

interface Piece { t: string; b: boolean; i: boolean; s: boolean; u: boolean; code: boolean; link?: string; raw?: boolean }

function imageMd(c: Ctx, drawing: El): string {
  const blip = find(drawing, "a:blip") ?? find(drawing, "v:imagedata");
  const id = blip?.attrs["r:embed"] ?? blip?.attrs["r:id"];
  const rel = id ? c.rels.get(id) : undefined;
  const alt = (find(drawing, "wp:docPr")?.attrs.descr || find(drawing, "wp:docPr")?.attrs.title || "").replace(/[[\]\n]/g, " ").trim();
  if (!rel || rel.external) { if (rel?.external) return `![${alt}](${rel.target})`; return ""; }
  const path = rel.target.startsWith("/") ? rel.target.slice(1) : `word/${rel.target}`.replace(/word\/\.\.\//, "");
  const data = c.files[path];
  if (!data) { c.warnings.push(`image ${rel.target} not found in the file`); return ""; }
  let name = c.mediaNames.get(path);
  if (!name) {
    const ext = (path.split(".").pop() ?? "bin").toLowerCase();
    name = `image${c.media.length + 1}.${ext}`;
    if (!["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"].includes(ext)) c.warnings.push(`${name}: ${ext.toUpperCase()} images may not show in Markdown viewers`);
    c.media.push({ name, data });
    c.mediaNames.set(path, name);
    c.stats.images++;
  }
  return `![${alt}](${encodeURI(`${c.o.mediaDir}/${name}`)})`;
}

function pieces(c: Ctx, p: El, paraStyle: StyleInfo): Piece[] {
  const out: Piece[] = [];
  const walk = (e: El, link?: string) => {
    for (const k of kids(e)) {
      if (k.name === "w:hyperlink") {
        const rel = k.attrs["r:id"] ? c.rels.get(k.attrs["r:id"]) : undefined;
        const href = rel?.target ?? (k.attrs["w:anchor"] ? `#${k.attrs["w:anchor"]}` : undefined);
        if (href) c.stats.links++;
        walk(k, href);
      } else if (k.name === "w:r") run(k, link);
      else if (["w:ins", "w:smartTag", "w:sdt", "w:sdtContent", "w:fldSimple", "w:customXml"].includes(k.name)) walk(k, link);
    }
  };
  const run = (r: El, link?: string) => {
    const rpr = kid(r, "w:rPr");
    const rs = style(c, kid(rpr, "w:rStyle")?.attrs["w:val"]);
    const fonts = kid(rpr, "w:rFonts");
    const fmt = {
      b: kid(rpr, "w:b") ? isOn(kid(rpr, "w:b")) : !!(rs.b ?? paraStyle.b),
      i: kid(rpr, "w:i") ? isOn(kid(rpr, "w:i")) : !!(rs.i ?? paraStyle.i),
      s: isOn(kid(rpr, "w:strike")) || isOn(kid(rpr, "w:dstrike")),
      u: c.o.underline && !!kid(rpr, "w:u") && kid(rpr, "w:u")!.attrs["w:val"] !== "none" && !link,
      code: /consolas|courier|mono|menlo|source code/i.test(fonts?.attrs["w:ascii"] ?? "") || !!rs.mono || /code|verbatim/.test(rs.name),
      link,
    };
    if (kid(rpr, "w:vanish")) return;
    for (const k of kids(r)) {
      if (k.name === "w:t") out.push({ ...fmt, t: text(k) });
      else if (k.name === "w:tab") out.push({ ...fmt, t: "\t" });
      else if (k.name === "w:br" || k.name === "w:cr") out.push({ ...fmt, b: false, i: false, s: false, u: false, code: false, t: k.attrs["w:type"] === "page" ? "" : "<br>", raw: true });
      else if (k.name === "w:drawing" || k.name === "w:pict") { const md = imageMd(c, k); if (md) out.push({ ...fmt, b: false, i: false, s: false, u: false, code: false, t: md, raw: true }); }
      else if (k.name === "w:sym") out.push({ ...fmt, t: String.fromCharCode(parseInt(k.attrs["w:char"] ?? "20", 16) & 0xfff) });
      else if (k.name === "w:footnoteReference" || k.name === "w:commentReference") { if (k.name === "w:commentReference") c.stats.comments++; }
    }
  };
  walk(p);
  return out;
}

function inline(ps: Piece[], code = false): string {
  // 合并格式相同的相邻片段，再加标记
  const merged: Piece[] = [];
  for (const p of ps) {
    const last = merged[merged.length - 1];
    if (last && !p.raw && !last.raw && last.b === p.b && last.i === p.i && last.s === p.s && last.u === p.u && last.code === p.code && last.link === p.link) last.t += p.t;
    else merged.push({ ...p });
  }
  if (code) return merged.map((p) => (p.raw ? (p.t === "<br>" ? "\n" : "") : p.t)).join("");
  let out = "";
  let i = 0;
  while (i < merged.length) {
    const link = merged[i].link;
    let j = i;
    let body = "";
    while (j < merged.length && merged[j].link === link) { body += wrap(merged[j]); j++; }
    out += link && body.trim() ? `[${body}](${link.replace(/ /g, "%20").replace(/\)/g, "%29")})` : body;
    i = j;
  }
  return out.replace(/[ \t]+$/g, "");
}
function wrap(p: Piece): string {
  if (p.raw) return p.t;
  if (!p.t) return "";
  if (p.code) { const tick = p.t.includes("`") ? "``" : "`"; return `${tick}${p.t}${tick}`; }
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(p.t)!;
  if (!m[2]) return p.t;
  let s = escMd(m[2]);
  if (p.u) s = `<u>${s}</u>`;
  if (p.s) s = `~~${s}~~`;
  if (p.i) s = `*${s}*`;
  if (p.b) s = `**${s}**`;
  return m[1] + s + m[3];
}

function cellText(c: Ctx, tc: El): string {
  return kids(tc).filter((k) => k.name === "w:p" || k.name === "w:tbl").map((k) => (k.name === "w:p" ? inline(pieces(c, k, style(c, kid(kid(k, "w:pPr"), "w:pStyle")?.attrs["w:val"]))) : "(table)")).filter(Boolean).join("<br>").replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function table(c: Ctx, tbl: El): string {
  c.stats.tables++;
  const grid: string[][] = [];
  const vmerge: (string | null)[] = [];
  for (const tr of kids(tbl, "w:tr")) {
    const row: string[] = [];
    let col = 0;
    for (const tc of kids(tr, "w:tc")) {
      const pr = kid(tc, "w:tcPr");
      const span = Number(kid(pr, "w:gridSpan")?.attrs["w:val"] ?? 1);
      const vm = kid(pr, "w:vMerge");
      let t = cellText(c, tc);
      if (vm && vm.attrs["w:val"] !== "restart") t = "";
      else if (vm) vmerge[col] = t;
      row.push(t);
      for (let k = 1; k < span; k++) row.push("");
      col += span;
    }
    grid.push(row);
  }
  if (!grid.length) return "";
  const w = Math.max(...grid.map((r) => r.length));
  const norm = grid.map((r) => [...r, ...Array(w - r.length).fill("")]);
  norm[0] = norm[0].map((x) => (/^\*\*[^*]+\*\*$/.test(x) ? x.slice(2, -2) : x));
  const line = (r: string[]) => `| ${r.map((x) => x || " ").join(" | ")} |`;
  return [line(norm[0]), `|${Array(w).fill(" --- ").join("|")}|`, ...norm.slice(1).map(line)].join("\n");
}

export function convertDocx(bytes: Uint8Array, opts: ConvertOpts): Converted {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error("Not a .docx file (could not unzip). Old .doc files must be saved as .docx first."); }
  const get = (p: string) => (files[p] ? strFromU8(files[p]) : undefined);
  const docXml = get("word/document.xml");
  if (!docXml) throw new Error("Not a Word document (word/document.xml missing).");
  const c: Ctx = { styles: readStyles(get("word/styles.xml")), rels: readRels(get("word/_rels/document.xml.rels")), nums: readNumbering(get("word/numbering.xml")), files, media: [], mediaNames: new Map(), o: opts, stats: { headings: 0, tables: 0, images: 0, lists: 0, links: 0, comments: 0 }, warnings: [] };
  let o = opts;
  const body = find(parseXml(docXml), "w:body");
  const blocks: string[] = [];
  let title = "";
  let prevList = false;
  let code: string[] | null = null;
  const counters = new Map<string, number[]>();
  const flushCode = () => { if (code) { blocks.push("```\n" + code.join("\n") + "\n```"); code = null; } };
  if (o.headingOffset < 0) o = { ...o, headingOffset: findAll(body, "w:pStyle").some((ps) => style(c, ps.attrs["w:val"]).name === "title") ? 1 : 0 };
  const visit = (els: El[]) => {
    for (const e of els) {
      if (e.name === "w:sdt") { visit(kids(kid(e, "w:sdtContent"))); continue; }
      if (e.name === "w:tbl") { flushCode(); prevList = false; const t = table(c, e); if (t) blocks.push(t); continue; }
      if (e.name !== "w:p") continue;
      const ppr = kid(e, "w:pPr");
      const st = style(c, kid(ppr, "w:pStyle")?.attrs["w:val"]);
      const ps = pieces(c, e, st);
      if (findAll(e, "w:instrText").some((t) => /^\s*TOC\b/.test(text(t)))) continue;
      if (/^toc|table of contents|目录/.test(st.name) || st.chain.some((n) => /^toc \d/.test(n))) continue;
      const isCode = /code|verbatim|source|html preformatted|plain text/.test(st.name) || (ps.length > 0 && ps.every((p) => p.code || p.raw || !p.t.trim()) && ps.some((p) => p.code && p.t.trim()) && ps.filter((p) => p.code).map((p) => p.t).join("").length > 30);
      if (isCode) { if (!code) code = []; code.push(inline(ps, true)); prevList = false; continue; }
      flushCode();
      const txt = inline(ps);
      if (kids(ppr, "w:pageBreakBefore").length && blocks.length) { /* 分页不需要 */ }
      const outline = kid(ppr, "w:outlineLvl") ? Number(kid(ppr, "w:outlineLvl")!.attrs["w:val"]) : st.outline;
      const hm = /^heading (\d)$|^标题 ?(\d)$/.exec(st.name);
      const isTitle = st.name === "title" || st.name === "标题";
      const level = isTitle ? 1 : hm ? Number(hm[1] ?? hm[2]) : outline !== undefined && outline < 6 ? outline + 1 : 0;
      if (level && txt.trim()) {
        const htxt = inline(ps.map((p) => ({ ...p, b: false })));
        const lv = Math.min(6, Math.max(1, level + (isTitle ? 0 : o.headingOffset)));
        if (!title) title = htxt.replace(/[*_~`\\]/g, "");
        blocks.push(`${"#".repeat(lv)} ${htxt.replace(/<br>/g, " ")}`);
        c.stats.headings++;
        prevList = false;
        continue;
      }
      const np = kid(ppr, "w:numPr");
      const numId = kid(np, "w:numId")?.attrs["w:val"] ?? st.numId;
      const ilvl = Number(kid(np, "w:ilvl")?.attrs["w:val"] ?? st.ilvl ?? 0);
      const listStyle = /^list (bullet|number)( (\d))?$/.exec(st.name);
      if ((numId && numId !== "0") || listStyle) {
        let fmt = numId ? c.nums.get(numId)?.get(ilvl) : undefined;
        let lvl = ilvl;
        if (!fmt && listStyle) { fmt = listStyle[1] === "bullet" ? "bullet" : "decimal"; lvl = listStyle[3] ? Number(listStyle[3]) - 1 : ilvl; }
        const key = numId ?? `s-${listStyle![1]}`;
        const cnt = counters.get(key) ?? [];
        cnt[lvl] = (cnt[lvl] ?? 0) + 1;
        cnt.length = lvl + 1;
        counters.set(key, cnt);
        const marker = fmt === "bullet" || fmt === "none" || !fmt ? "-" : `${cnt[lvl]}.`;
        const item = `${"   ".repeat(lvl)}${marker} ${txt.replace(/<br>/g, "<br>")}`;
        if (prevList) blocks[blocks.length - 1] += `\n${item}`; else { blocks.push(item); c.stats.lists++; }
        prevList = true;
        continue;
      }
      prevList = false;
      if (!txt.trim()) continue;
      if (st.name === "caption" && blocks.length && blocks[blocks.length - 1].startsWith(`![${txt.replace(/^\*|\*$/g, "")}]`)) continue;
      if (/quote|引用/.test(st.name)) { blocks.push(txt.split("<br>").map((l) => `> ${l}`).join("\n")); continue; }
      blocks.push(escStart(txt));
    }
  };
  visit(kids(body));
  flushCode();
  return { markdown: blocks.join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n", media: c.media, stats: c.stats, title, warnings: c.warnings };
}
