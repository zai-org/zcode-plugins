// 试卷与答案册：PDF（pdf-lib，公式为矢量路径）和 HTML（内联 SVG）。
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { choiceLetters, tfValue, type QType, type Question } from "./bank.ts";
import { drawMath, tex2svg, type MathBox } from "./math.ts";
import type { Paper } from "./paper.ts";

export type Tok = { k: "text"; s: string } | { k: "math"; tex: string; display: boolean } | { k: "img"; src: string; alt: string } | { k: "br" };
export function rich(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\$\$([\s\S]+?)\$\$|(?<!\\)\$((?:\\\$|[^$])+?)\$|!\[([^\]]*)\]\(([^)\s]+)\)|\n/g;
  let last = 0;
  const text = (s: string) => { const t = s.replace(/\\\$/g, "$").replace(/\*\*(.+?)\*\*/g, "$1"); if (t) out.push({ k: "text", s: t }); };
  for (const m of src.matchAll(re)) {
    text(src.slice(last, m.index));
    if (m[1] !== undefined) out.push({ k: "math", tex: m[1].trim(), display: true });
    else if (m[2] !== undefined) out.push({ k: "math", tex: m[2], display: false });
    else if (m[4] !== undefined) out.push({ k: "img", src: m[4], alt: m[3] });
    else out.push({ k: "br" });
    last = m.index! + m[0].length;
  }
  text(src.slice(last));
  return out;
}

export interface L10n { sec: Record<QType, string>; answer: string; expl: string; name: string; klass: string; score: string; page: (a: number, b: number) => string; setName: (s: string) => string; key: string; secHead: (n: string, count: number, each: number[], total: number) => string; tf: [string, string]; none: string; time: string; full: string }
export const L10N: Record<"zh" | "en", L10n> = {
  zh: {
    sec: { single: "单项选择题", multi: "多项选择题", tf: "判断题", fill: "填空题", short: "解答题" }, answer: "答案", expl: "解析", name: "姓名", klass: "班级", score: "得分",
    page: (a, b) => `第 ${a} 页（共 ${b} 页）`, setName: (s) => `${s} 卷`, key: "参考答案与解析", tf: ["对", "错"], none: "（无）", time: "考试时间", full: "满分",
    secHead: (_n, c, each, t) => `（本题共 ${c} 小题，${each.every((x) => x === each[0]) ? `每小题 ${each[0]} 分，` : ""}共 ${t} 分）`,
  },
  en: {
    sec: { single: "Multiple choice", multi: "Multiple choice (more than one answer)", tf: "True or false", fill: "Fill in the blanks", short: "Problems" }, answer: "Answer", expl: "Explanation", name: "Name", klass: "Class", score: "Score",
    page: (a, b) => `Page ${a} of ${b}`, setName: (s) => `Paper ${s}`, key: "Answer key", tf: ["True", "False"], none: "(none)", time: "Time", full: "Total",
    secHead: (_n, c, each, t) => ` (${c} question${c > 1 ? "s" : ""}, ${each.every((x) => x === each[0]) ? `${each[0]} points each, ` : ""}${t} points)`,
  },
};
const NUMS = "一二三四五六七八九十";
export const answerText = (q: Question, l: L10n) => (q.type === "single" || q.type === "multi" ? choiceLetters(q.answer) || q.answer : q.type === "tf" ? (tfValue(q.answer) === undefined ? q.answer : l.tf[tfValue(q.answer) ? 0 : 1]) : q.answer);

// ---------------- PDF ----------------
type Atom = { k: "text"; s: string; w: number; font: PDFFont } | { k: "math"; box: MathBox; w: number } | { k: "space"; w: number };
interface Line { atoms: { a: Atom; x: number }[]; asc: number; desc: number; w: number }
interface Row { h: number; draw: (page: PDFPage, x: number, top: number) => void }
const NO_START = /^[，。、；：？！）」』》”’,.;:?!)\]%]/;

export interface PdfOpts { fonts?: { regular: Uint8Array; bold?: Uint8Array }; fontkit?: unknown; readImage: (q: Question, src: string) => Promise<Uint8Array | undefined>; lang: "zh" | "en"; title: string; subtitle?: string; duration?: string }

export async function buildPdf(bank: Map<string, Question>, paper: Paper, mode: "paper" | "key", o: PdfOpts): Promise<{ pdf: Uint8Array; pages: number; warnings: string[] }> {
  const l = L10N[o.lang];
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${o.title} ${l.setName(paper.set)}${mode === "key" ? ` ${l.key}` : ""}`);
  pdf.setCreator("Exam Builder");
  pdf.setProducer("Exam Builder");
  const warnings: string[] = [];
  let reg: PDFFont, bold: PDFFont, std = false;
  if (o.fonts && o.fontkit) {
    pdf.registerFontkit(o.fontkit as never);
    reg = await pdf.embedFont(o.fonts.regular, { subset: true });
    bold = o.fonts.bold ? await pdf.embedFont(o.fonts.bold, { subset: true }) : reg;
  } else {
    reg = await pdf.embedFont(StandardFonts.TimesRoman); bold = await pdf.embedFont(StandardFonts.TimesRomanBold); std = true;
    warnings.push("No font with Chinese glyphs found; non-Latin characters are replaced with ?");
  }
  const clean = (s: string) => (std ? s.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, "?") : s);
  const PW = 595.28, PH = 841.89, ML = 56, MR = 56, MT = 56, MB = 60, W = PW - ML - MR;
  const SIZE = 10.5;
  const wcache = new Map<string, number>();
  const width = (f: PDFFont, s: string, size: number) => { const k = `${f === bold ? "b" : "r"}${size}${s}`; let w = wcache.get(k); if (w === undefined) { w = f.widthOfTextAtSize(clean(s), size); wcache.set(k, w); } return w; };
  const imgCache = new Map<string, PDFImage | null>();

  const atomsOf = (toks: Tok[], size: number, font: PDFFont): (Atom | "br")[] => {
    const out: (Atom | "br")[] = [];
    for (const t of toks) {
      if (t.k === "br") out.push("br");
      else if (t.k === "math" && !t.display) { const box = tex2svg(t.tex); out.push({ k: "math", box, w: box.width * size }); }
      else if (t.k === "text") for (const m of t.s.matchAll(/[\u3000-\u9fff\uff00-\uffef]|[^\s\u3000-\u9fff\uff00-\uffef]+|\s+/g)) {
        const s = m[0];
        if (/^\s+$/.test(s)) out.push({ k: "space", w: width(font, " ", size) });
        else out.push({ k: "text", s, w: width(font, s, size), font });
      }
    }
    return out;
  };
  const wrap = (atoms: (Atom | "br")[], maxW: number, size: number, indent = 0): Line[] => {
    const lines: Line[] = [];
    let cur: Line = { atoms: [], asc: size * 0.88, desc: size * 0.25, w: indent };
    const push = () => { while (cur.atoms.length && cur.atoms[cur.atoms.length - 1].a.k === "space") { cur.w -= cur.atoms.pop()!.a.w; } lines.push(cur); cur = { atoms: [], asc: size * 0.88, desc: size * 0.25, w: indent }; };
    for (const a of atoms) {
      if (a === "br") { push(); continue; }
      if (a.k === "space" && !cur.atoms.length) continue;
      if (cur.w + a.w > maxW && cur.atoms.length && !(a.k === "text" && NO_START.test(a.s))) { push(); if (a.k === "space") continue; }
      cur.atoms.push({ a, x: cur.w });
      cur.w += a.w;
      if (a.k === "math") { cur.asc = Math.max(cur.asc, a.box.ascent * size); cur.desc = Math.max(cur.desc, a.box.descent * size); }
    }
    if (cur.atoms.length || !lines.length) push();
    return lines;
  };
  const drawLine = (page: PDFPage, line: Line, x: number, baseline: number, size: number) => {
    for (const { a, x: dx } of line.atoms) {
      if (a.k === "text") page.drawText(clean(a.s), { x: x + dx, y: baseline, size, font: a.font, color: rgb(0, 0, 0) });
      else if (a.k === "math") drawMath(page, a.box, x + dx, baseline, size, reg);
    }
  };
  const lineGap = (size: number) => size * (o.lang === "zh" ? 0.75 : 0.5);
  /** 富文本 → 行（含块级公式、图片）。prefix：题号等放在第一行前面的原子。 */
  const flow = async (q: Question | undefined, src: string, x0: number, maxW: number, size: number, font: PDFFont, prefix?: { atoms: Atom[]; hang: number }): Promise<Row[]> => {
    const rows: Row[] = [];
    const toks = rich(src);
    let inline: Tok[] = [];
    let first = true;
    const flush = () => {
      if (!inline.length && !(first && prefix)) { inline = []; return; }
      const atoms = atomsOf(inline, size, font);
      const hang = prefix?.hang ?? 0;
      const all: (Atom | "br")[] = first && prefix ? [...prefix.atoms, ...atoms] : atoms;
      for (const line of wrap(all, maxW - hang + (first && prefix ? hang : 0), size)) {
        const ox = first && prefix ? x0 : x0 + hang;
        rows.push({ h: line.asc + line.desc + lineGap(size), draw: (page, _x, top) => drawLine(page, line, ox, top - line.asc - lineGap(size) / 2, size) });
        first = false;
      }
      inline = [];
    };
    for (const t of toks) {
      if (t.k === "math" && t.display) {
        flush();
        const box = tex2svg(t.tex, true);
        const w = box.width * size, asc = box.ascent * size, desc = box.descent * size;
        rows.push({ h: asc + desc + size, draw: (page, _x, top) => drawMath(page, box, x0 + (prefix?.hang ?? 0) + Math.max(0, (maxW - (prefix?.hang ?? 0) - w) / 2), top - asc - size / 2, size, reg) });
      } else if (t.k === "img") {
        flush();
        const key = `${q?.dir}/${t.src}`;
        if (!imgCache.has(key)) {
          const bytes = q ? await o.readImage(q, t.src) : undefined;
          let img: PDFImage | null = null;
          try { if (bytes) img = bytes[0] === 0x89 ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes); } catch { img = null; }
          imgCache.set(key, img);
          if (!img) warnings.push(`${q?.id}: image ${t.src} missing or not PNG/JPEG`);
        }
        const img = imgCache.get(key);
        if (img) {
          const sc = Math.min((maxW * 0.5) / img.width, 170 / img.height, 0.75);
          const w = img.width * sc, h = img.height * sc;
          rows.push({ h: h + 8, draw: (page, _x, top) => page.drawImage(img, { x: x0 + (prefix?.hang ?? 0) + 8, y: top - h - 4, width: w, height: h }) });
        } else {
          const msg = `[${o.lang === "zh" ? "图片缺失" : "missing image"}: ${t.src}]`;
          rows.push({ h: size * 1.8, draw: (page, _x, top) => page.drawText(clean(msg), { x: x0 + (prefix?.hang ?? 0), y: top - size * 1.3, size, font: reg, color: rgb(0.7, 0, 0) }) });
        }
      } else inline.push(t);
    }
    flush();
    return rows;
  };

  // ---- 排版：先生成所有“行”，再分页 ----
  type Item = { rows: Row[]; keep: boolean; gapBefore: number };
  const items: Item[] = [];
  const titleText = `${o.title}${mode === "key" ? ` · ${l.key}` : ""}`;
  const headRows: Row[] = [
    { h: 30, draw: (page, _x, top) => { const t = clean(titleText); page.drawText(t, { x: ML + (W - width(bold, titleText, 17)) / 2, y: top - 20, size: 17, font: bold }); } },
    { h: 20, draw: (page, _x, top) => { const t = [l.setName(paper.set), o.subtitle, o.duration ? `${l.time}：${o.duration}` : "", `${l.full}：${paper.total}`].filter(Boolean).join("　"); page.drawText(clean(t), { x: ML + (W - width(reg, t, 10.5)) / 2, y: top - 14, size: 10.5, font: reg, color: rgb(0.25, 0.25, 0.25) }); } },
  ];
  if (mode === "paper") headRows.push({ h: 30, draw: (page, _x, top) => { const t = `${l.name}：____________　　${l.klass}：____________　　${l.score}：________`; page.drawText(clean(t), { x: ML + (W - width(reg, t, 11)) / 2, y: top - 20, size: 11, font: reg }); } });
  items.push({ rows: headRows, keep: true, gapBefore: 0 });
  let n = 0;
  for (const [si, sec] of paper.sections.entries()) {
    if (!sec.ids.length) continue;
    const name = sec.title ?? l.sec[sec.type];
    const head = (o.lang === "zh" ? `${NUMS[si] ?? si + 1}、${name}` : `${si + 1}. ${name}`) + l.secHead(NUMS[si], sec.ids.length, sec.scores, sec.scores.reduce((a, b) => a + b, 0));
    items.push({ rows: await flow(undefined, head, ML, W, 11.5, bold), keep: true, gapBefore: 10 });
    for (const [qi, id] of sec.ids.entries()) {
      const q = bank.get(id)!;
      n++;
      const num = `${n}. `;
      const numAtom: Atom = { k: "text", s: num, w: width(reg, num, SIZE), font: reg };
      const hang = Math.max(18, numAtom.w);
      const pts = !sec.scores.every((x) => x === sec.scores[0]) || sec.type === "short" ? `（${sec.scores[qi]}${o.lang === "zh" ? " 分" : " pts"}）` : "";
      const rows: Row[] = [];
      if (mode === "paper") {
        rows.push(...(await flow(q, (pts && o.lang === "en" ? pts.replace(/（(.+)）/, "($1) ") : pts) + q.stem, ML, W, SIZE, reg, { atoms: [numAtom], hang })));
        if (q.options.length) {
          const opt = q.options.map((op) => atomsOf(rich(`${op.label}. ${op.text}`), SIZE, reg).filter((a): a is Atom => a !== "br"));
          const ow = opt.map((as) => as.reduce((s, a) => s + a.w, 0));
          const avail = W - hang;
          const cols = ow.every((w) => w < avail / 4 - 10) ? 4 : ow.every((w) => w < avail / 2 - 10) ? 2 : 1;
          for (let i = 0; i < opt.length; i += cols) {
            const group = opt.slice(i, i + cols).map((as) => wrap(as, cols === 1 ? avail - 12 : avail / cols, SIZE));
            for (let li = 0; li < Math.max(...group.map((g) => g.length)); li++) {
              const ls = group.map((g) => g[li]);
              const asc = Math.max(...ls.filter(Boolean).map((x) => x.asc)), desc = Math.max(...ls.filter(Boolean).map((x) => x.desc));
              rows.push({ h: asc + desc + lineGap(SIZE), draw: (page, _x, top) => ls.forEach((ln, c) => ln && drawLine(page, ln, ML + hang + (avail / cols) * c + (li && cols === 1 ? 12 : 0), top - asc - lineGap(SIZE) / 2, SIZE)) });
            }
          }
        }
        if (sec.type === "short") { const h = Math.min(300, 70 + sec.scores[qi] * 12); rows.push({ h, draw: () => undefined }); }
      } else {
        const ans = `${l.answer}：${answerText(q, l) || l.none}`;
        rows.push(...(await flow(q, ans, ML, W, SIZE, reg, { atoms: [numAtom], hang })));
        if (q.explanation) rows.push(...(await flow(q, `${l.expl}：${q.explanation}`, ML + hang, W - hang, SIZE, reg)));
      }
      items.push({ rows, keep: true, gapBefore: mode === "paper" ? 6 : 4 });
    }
  }

  // ---- 分页 ----
  const pages: PDFPage[] = [];
  let page!: PDFPage, y = 0;
  const newPage = () => { page = pdf.addPage([PW, PH]); pages.push(page); y = PH - MT; };
  newPage();
  for (const it of items) {
    const total = it.rows.reduce((s, r) => s + r.h, 0) + it.gapBefore;
    if (it.keep && y - total < MB && total < (PH - MT - MB) * 0.7 && y < PH - MT) newPage();
    else y -= 0;
    if (y < PH - MT) y -= it.gapBefore;
    for (const r of it.rows) {
      if (y - r.h < MB) newPage();
      r.draw(page, ML, y);
      y -= r.h;
    }
  }
  pages.forEach((p, i) => { const t = l.page(i + 1, pages.length); p.drawText(clean(t), { x: (PW - width(reg, t, 9)) / 2, y: 30, size: 9, font: reg, color: rgb(0.4, 0.4, 0.4) }); });
  return { pdf: await pdf.save(), pages: pages.length, warnings };
}

// ---------------- HTML ----------------
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);
export function richHtml(src: string, img: (src: string) => string | undefined): string {
  return rich(src).map((t) => {
    if (t.k === "text") return esc(t.s);
    if (t.k === "br") return "<br>";
    if (t.k === "math") { const b = tex2svg(t.tex, t.display); return t.display ? `<div class="dm">${b.svg}</div>` : `<span class="im">${b.svg}</span>`; }
    const data = img(t.src);
    return data ? `<img class="fig" src="${data}" alt="${esc(t.alt)}">` : `<span class="missing">[${esc(t.src)}]</span>`;
  }).join("");
}
export const HTML_CSS = `body{font:15px/1.8 "Songti SC","SimSun","Noto Serif CJK SC",serif;max-width:800px;margin:24px auto;padding:0 24px;color:#111}
h1{text-align:center;font-size:22px;margin:0}.sub{text-align:center;color:#555;margin:4px 0 8px}.info{text-align:center;margin:8px 0 16px}
h2{font-size:16px;margin:18px 0 8px}.q{margin:8px 0 10px;padding-left:2em;text-indent:-2em}.q *{text-indent:0}
.opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:2px 16px;padding-left:2em}.opts.wide{grid-template-columns:1fr 1fr}.opts.long{grid-template-columns:1fr}
.fig{display:block;max-width:45%;max-height:200px;margin:6px 0 6px 2em}.dm{text-align:center;margin:6px 0}.im svg{vertical-align:middle}
.space{height:var(--h)}.expl{color:#333;padding-left:2em}.missing{color:#b00}
@media print{body{margin:0;max-width:none}.q{break-inside:avoid}}`;

export function buildHtml(bank: Map<string, Question>, paper: Paper, mode: "paper" | "key", o: { lang: "zh" | "en"; title: string; subtitle?: string; duration?: string; img: (q: Question, src: string) => string | undefined; css?: boolean }) {
  const l = L10N[o.lang];
  const parts: string[] = [];
  parts.push(`<h1>${esc(o.title)}${mode === "key" ? ` · ${l.key}` : ""}</h1><div class="sub">${esc([l.setName(paper.set), o.subtitle, o.duration ? `${l.time}：${o.duration}` : "", `${l.full}：${paper.total}`].filter(Boolean).join("　"))}</div>`);
  if (mode === "paper") parts.push(`<div class="info">${l.name}：____________　${l.klass}：____________　${l.score}：________</div>`);
  let n = 0;
  paper.sections.forEach((sec, si) => {
    if (!sec.ids.length) return;
    const name = sec.title ?? l.sec[sec.type];
    parts.push(`<h2>${esc((o.lang === "zh" ? `${NUMS[si] ?? si + 1}、${name}` : `${si + 1}. ${name}`) + l.secHead(NUMS[si], sec.ids.length, sec.scores, sec.scores.reduce((a, b) => a + b, 0)))}</h2>`);
    sec.ids.forEach((id, qi) => {
      const q = bank.get(id)!;
      n++;
      const img = (src: string) => o.img(q, src);
      if (mode === "paper") {
        const pts = sec.type === "short" || !sec.scores.every((x) => x === sec.scores[0]) ? (o.lang === "zh" ? `（${sec.scores[qi]} 分）` : `(${sec.scores[qi]} pts) `) : "";
        const longest = Math.max(0, ...q.options.map((op) => op.text.replace(/\$[^$]*\$/g, "xxxx").length));
        parts.push(`<div class="q" data-id="${esc(q.id)}">${n}. ${pts}${richHtml(q.stem, img)}</div>`);
        if (q.options.length) parts.push(`<div class="opts${longest > 24 ? " long" : longest > 10 ? " wide" : ""}">${q.options.map((op) => `<div>${op.label}. ${richHtml(op.text, img)}</div>`).join("")}</div>`);
        if (sec.type === "short") parts.push(`<div class="space" style="--h:${Math.min(300, 70 + sec.scores[qi] * 12)}px"></div>`);
      } else {
        parts.push(`<div class="q" data-id="${esc(q.id)}">${n}. ${l.answer}：${richHtml(answerText(q, l) || l.none, img)}</div>`);
        if (q.explanation) parts.push(`<div class="expl">${l.expl}：${richHtml(q.explanation, img)}</div>`);
      }
    });
  });
  const body = parts.join("\n");
  return o.css === false ? body : `<!doctype html><html lang="${o.lang === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><title>${esc(o.title)} ${esc(l.setName(paper.set))}${mode === "key" ? ` ${l.key}` : ""}</title><style>${HTML_CSS}</style></head><body>\n${body}\n</body></html>\n`;
}
