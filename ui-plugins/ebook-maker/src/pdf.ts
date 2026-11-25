import { posix } from "node:path";
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFString, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage, type PDFRef, type RGB } from "pdf-lib";
import { decode, isExternal, resolveLink, runsText, safeDecode, type Block, type Chapter, type Run } from "./book.ts";
import { L10N } from "./epub.ts";
import { extOf, type Book } from "./project.ts";

export const PAGE_SIZES: Record<string, [number, number]> = { A5: [419.53, 595.28], A4: [595.28, 841.89], B6: [354.33, 498.9] };
const INK = rgb(0.1, 0.1, 0.1), GRAY = rgb(0.38, 0.38, 0.38), LINK = rgb(0.1, 0.31, 0.61), RULE = rgb(0.7, 0.7, 0.7), CODE_BG = rgb(0.95, 0.95, 0.95);
const CJK = /[\u1100-\u11ff\u2e80-\u303f\u3040-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;
const OPENING = "（([{「『《〈【〔“‘";
const CLOSING = "，。、；：！？）)]}」』》〉】〕”’…—,.;:!?%·";

export interface PdfFonts { regular: Uint8Array; bold?: Uint8Array }
interface Fonts { regular: PDFFont; bold: PDFFont; mono: PDFFont; standard: boolean }
interface Style { size: number; color: RGB; bold?: boolean; italic?: boolean; code?: boolean; del?: boolean; href?: string; fn?: number; rise?: number }
interface Seg { text: string; font: PDFFont; style: Style; w: number }
interface Atom { segs: Seg[]; w: number; space: boolean; cjk: boolean }
interface Line { atoms: Atom[]; w: number; last: boolean; size: number }

export interface PdfResult { data: Uint8Array; pages: number; chapterPages: { file: string; title: string; page: number }[]; warnings: string[] }

/** 把书排成 PDF：封面、扉页、目录（带页码）、各章（章末注）、页眉页脚、书签和可点的链接。 */
export async function buildPdf(book: Book, read: (p: string) => Uint8Array | undefined, fontData: PdfFonts | undefined, opts: { fontkit?: unknown; date?: Date } = {}): Promise<PdfResult> {
  const { config, chapters } = book;
  const lang = config.language;
  const cjkBook = /^(zh|ja|ko)/i.test(lang);
  const t = L10N(lang);
  const [PW, PH] = PAGE_SIZES[config.pdf.pageSize] ?? PAGE_SIZES.A5;
  const scale = PW / PAGE_SIZES.A5[0];
  const M = { top: 54 * scale, bottom: 54 * scale, left: 48 * scale, right: 48 * scale };
  const W = PW - M.left - M.right;
  const base = config.pdf.fontSize * (scale > 1.2 ? 1.1 : 1);
  const lead = cjkBook ? 1.75 : 1.5;
  const warnings: string[] = [];

  const pdf = await PDFDocument.create();
  let fonts: Fonts;
  if (fontData && opts.fontkit) {
    pdf.registerFontkit(opts.fontkit as never);
    const regular = await pdf.embedFont(fontData.regular, { subset: true });
    fonts = { regular, bold: fontData.bold ? await pdf.embedFont(fontData.bold, { subset: true }) : regular, mono: await pdf.embedFont(StandardFonts.Courier), standard: false };
  } else {
    fonts = { regular: await pdf.embedFont(StandardFonts.TimesRoman), bold: await pdf.embedFont(StandardFonts.TimesRomanBold), mono: await pdf.embedFont(StandardFonts.Courier), standard: true };
    warnings.push("No system font with Chinese glyphs was found; the PDF uses Times and non-Latin characters are replaced with ?");
  }
  const clean = (s: string) => (fonts.standard ? s.replace(/[^\x20-\x7e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g, "?") : s.replace(/[\u200b-\u200d\ufeff]/g, ""));

  const widthCache = new Map<PDFFont, Map<string, number>>();
  const measure = (font: PDFFont, text: string, size: number) => {
    let m = widthCache.get(font);
    if (!m) widthCache.set(font, (m = new Map()));
    let w = m.get(text);
    if (w === undefined) {
      try {
        w = font.widthOfTextAtSize(text, 1000) / 1000;
      } catch {
        w = text.length * 0.6;
      }
      m.set(text, w);
    }
    return w * size;
  };
  const fontFor = (st: Style, ch: string) => (st.code && /^[\x20-\x7e]+$/.test(ch) ? fonts.mono : st.bold ? fonts.bold : fonts.regular);

  // ---------- 分词与断行 ----------
  function atomsOf(runs: Run[], st: Style): (Atom | "br")[] {
    const out: (Atom | "br")[] = [];
    for (const r of runs) {
      if (r.br) { out.push("br"); continue; }
      const style: Style = { ...st, bold: st.bold || r.bold, italic: st.italic || r.italic, code: r.code, del: r.del, href: r.href ?? st.href, color: r.fn || (r.href && linkTarget(r.href, curChapter)) ? LINK : st.color };
      if (r.fn) {
        const s = { ...style, size: st.size * 0.62, rise: st.size * 0.38, fn: r.fn };
        const seg = { text: r.text, font: fonts.regular, style: s, w: measure(fonts.regular, r.text, s.size) };
        out.push({ segs: [seg], w: seg.w, space: false, cjk: false });
        continue;
      }
      const text = clean(r.code ? r.text : r.text.replace(/\s+/g, " "));
      for (const m of text.matchAll(/(\s+)|([^\s])(?<=[\u1100-\u11ff\u2e80-\u303f\u3040-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef])|[^\s\u1100-\u11ff\u2e80-\u303f\u3040-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]+/gu)) {
        const s = r.code && m[1] ? m[0] : m[1] ? " " : m[0];
        const segs: Seg[] = [];
        // 代码里混排的中文用正文字体
        for (const part of s.match(/[\x20-\x7e]+|[^\x20-\x7e]+/g) ?? []) {
          const font = fontFor(style, part);
          segs.push({ text: part, font, style, w: measure(font, part, style.size) });
        }
        out.push({ segs, w: segs.reduce((a, b) => a + b.w, 0), space: !!m[1] && !r.code, cjk: CJK.test(s) });
      }
    }
    // 避头尾：闭合标点贴前一个，开口标点贴后一个
    const merged: (Atom | "br")[] = [];
    for (const a of out) {
      const prev = merged[merged.length - 1];
      if (a !== "br" && prev && prev !== "br" && !prev.space && !a.space) {
        const first = a.segs[0]?.text[0] ?? "";
        const last = prev.segs[prev.segs.length - 1]?.text.slice(-1) ?? "";
        if ((CLOSING.includes(first) && a.segs.map((s) => s.text).join("").length <= 2) || OPENING.includes(last) || a.segs[0]?.style.fn) {
          prev.segs.push(...a.segs);
          prev.w += a.w;
          prev.cjk ||= a.cjk;
          continue;
        }
      }
      merged.push(a);
    }
    return merged;
  }

  function breakLines(runs: Run[], width: number, st: Style, firstIndent = 0): Line[] {
    const atoms = atomsOf(runs, st);
    const lines: Line[] = [];
    let cur: Atom[] = [], w = 0, avail = width - firstIndent;
    const push = (last: boolean) => {
      while (cur.length && cur[cur.length - 1].space) w -= cur.pop()!.w;
      lines.push({ atoms: cur, w, last, size: st.size });
      cur = [];
      w = 0;
      avail = width;
    };
    const queue = [...atoms];
    while (queue.length) {
      const a = queue.shift()!;
      if (a === "br") { push(true); continue; }
      if (a.space && !cur.length) continue;
      if (w + a.w <= avail + 0.01) { cur.push(a); w += a.w; continue; }
      if (a.space) { push(false); continue; }
      if (a.w > avail) {
        // 太长的词（网址等）按字符拆开
        const chars: Atom[] = a.segs.flatMap((s) => [...s.text].map((ch) => ({ segs: [{ ...s, text: ch, w: measure(s.font, ch, s.style.size) }], w: measure(s.font, ch, s.style.size), space: false, cjk: CJK.test(ch) })));
        if (chars.length > 1) { queue.unshift(...chars.map((c) => ({ ...c, cjk: true }))); continue; }
      }
      if (cur.length) push(false);
      cur.push(a);
      w = a.w;
    }
    if (cur.length || !lines.length) push(true);
    else lines[lines.length - 1].last = true;
    return lines;
  }

  // ---------- 页面 ----------
  interface PageInfo { page: PDFPage; chapter?: Chapter; first: boolean; number?: number }
  const pages: PageInfo[] = [];
  const dests = new Map<string, { page: PDFPage; y: number }>();
  const links: { page: PDFPage; rect: [number, number, number, number]; uri?: string; dest?: string }[] = [];
  let page!: PDFPage, y = 0, curChapter: Chapter | undefined;
  const newPage = (first = false) => {
    page = pdf.addPage([PW, PH]);
    pages.push({ page, chapter: curChapter, first });
    y = PH - M.top;
  };
  const ensure = (h: number) => {
    if (y - h < M.bottom - 0.5) newPage();
  };

  const embedded = new Map<string, PDFImage | null>();
  async function image(path: string) {
    if (!embedded.has(path)) {
      const data = read(path);
      let img: PDFImage | null = null;
      try {
        if (data && extOf(path) === "png") img = await pdf.embedPng(data);
        else if (data && /^jpe?g$/.test(extOf(path))) img = await pdf.embedJpg(data);
      } catch (error) {
        warnings.push(`${path}: ${(error as Error).message}`);
      }
      embedded.set(path, img);
    }
    return embedded.get(path)!;
  }

  function drawLine(line: Line, x: number, width: number, justify: boolean, lineH: number, chapter?: Chapter) {
    const baseline = y - (lineH - line.size) / 2 - line.size * 0.86;
    let extra = 0, gapsSpace = false;
    const inner = line.atoms.length - 1;
    if (justify && !line.last && inner > 0) {
      const spaces = line.atoms.filter((a, i) => a.space && i > 0 && i < line.atoms.length - 1).length;
      const free = width - line.w;
      if (spaces && !line.atoms.some((a) => a.cjk)) { extra = free / spaces; gapsSpace = true; }
      else extra = free / inner;
      if (extra > line.size * (gapsSpace ? 1.2 : 0.5)) extra = 0;
    }
    let cx = x;
    line.atoms.forEach((a, i) => {
      for (const s of a.segs) {
        if (s.text.trim() || s.style.code) {
          page.drawText(s.text, { x: cx, y: baseline + (s.style.rise ?? 0), size: s.style.size, font: s.font, color: s.style.color, ...(s.style.italic && !s.style.code ? { xSkew: degrees(12) } : {}) });
          if (s.style.del) page.drawLine({ start: { x: cx, y: baseline + s.style.size * 0.3 }, end: { x: cx + s.w, y: baseline + s.style.size * 0.3 }, thickness: 0.5, color: s.style.color });
          if (s.style.href || s.style.fn) {
            const target = s.style.fn ? { dest: `${chapter?.id}-fn-${s.style.fn}` } : linkTarget(s.style.href!, chapter);
            if (target) links.push({ page, rect: [cx, baseline - s.style.size * 0.25, cx + s.w, baseline + s.style.size * 0.9 + (s.style.rise ?? 0)], ...target });
          }
        }
        cx += s.w;
      }
      if (i < line.atoms.length - 1 && (gapsSpace ? a.space : true)) cx += extra;
    });
    return baseline;
  }

  function linkTarget(href: string, chapter?: Chapter): { uri?: string; dest?: string } | undefined {
    if (isExternal(href)) return { uri: href };
    if (!chapter) return undefined;
    const r = resolveLink(href, chapter.file, byFile, () => false);
    if (r.kind === "anchor") return { dest: `${chapter.id}#${r.anchor ?? ""}` };
    if (r.kind === "chapter") { const c = byFile.get(r.chapter!)!; return { dest: r.anchor ? `${c.id}#${r.anchor}` : c.id }; }
    return undefined;
  }
  const byFile = new Map(chapters.map((c) => [c.file, c]));

  interface Ctx { x: number; width: number; size: number; color: RGB; bar?: number[]; indent: boolean; chapter: Chapter }

  function paragraph(runs: Run[], ctx: Ctx, opts: { firstIndent?: number; align?: "center" | "justify" | "left"; bold?: boolean; lineLead?: number; marker?: string; keep?: number } = {}) {
    const st: Style = { size: ctx.size, color: ctx.color, bold: opts.bold };
    const lines = breakLines(runs, ctx.width, st, opts.firstIndent ?? 0);
    const lineH = ctx.size * (opts.lineLead ?? lead);
    if (opts.keep) ensure(lineH * Math.min(lines.length, opts.keep));
    lines.forEach((line, i) => {
      ensure(lineH);
      const indent = i === 0 ? opts.firstIndent ?? 0 : 0;
      const x = opts.align === "center" ? ctx.x + (ctx.width - line.w) / 2 : ctx.x + indent;
      const baseline = drawLine(line, x, ctx.width - indent, opts.align !== "center" && opts.align !== "left", lineH, ctx.chapter);
      if (i === 0 && opts.marker) {
        const mw = measure(fonts.regular, opts.marker, ctx.size);
        page.drawText(opts.marker, { x: ctx.x - mw - ctx.size * 0.45, y: baseline, size: ctx.size, font: fonts.regular, color: ctx.color });
      }
      for (const bx of ctx.bar ?? []) page.drawLine({ start: { x: bx, y }, end: { x: bx, y: y - lineH }, thickness: 1.6, color: RULE });
      y -= lineH;
    });
  }

  async function blocks(list: Block[], ctx: Ctx) {
    for (const [bi, b] of list.entries()) {
      switch (b.t) {
        case "p":
          paragraph(b.runs, ctx, { firstIndent: ctx.indent && cjkBook ? ctx.size * 2 : 0, keep: 2 });
          y -= ctx.size * (cjkBook ? 0.25 : 0.55);
          break;
        case "h": {
          const size = [0, base * 1.55, base * 1.35, base * 1.16, base * 1.05][Math.min(b.level, 4)];
          y -= size * (bi === 0 ? 0.2 : 1.1);
          ensure(size * 1.4 + base * lead * 3);
          dests.set(`${ctx.chapter.id}#${b.slug}`, { page, y: y + size * 0.5 });
          paragraph(b.runs, { ...ctx, size }, { bold: true, align: "left", lineLead: 1.35 });
          y -= size * 0.45;
          break;
        }
        case "list":
          for (const [i, item] of b.items.entries()) {
            const marker = b.ordered ? `${b.start + i}.` : "•";
            const inner: Ctx = { ...ctx, x: ctx.x + ctx.size * 1.8, width: ctx.width - ctx.size * 1.8, indent: false };
            const [first, ...rest] = item;
            if (first?.t === "p") {
              paragraph(first.runs, inner, { marker, keep: 2 });
              y -= ctx.size * 0.2;
              await blocks(rest, inner);
            } else {
              ensure(ctx.size * lead);
              page.drawText(marker, { x: ctx.x + ctx.size * 0.4, y: y - ctx.size * 1.2, size: ctx.size, font: fonts.regular, color: ctx.color });
              await blocks(item, inner);
            }
          }
          y -= ctx.size * 0.4;
          break;
        case "quote": {
          const bar = [...(ctx.bar ?? []), ctx.x + ctx.size * 0.4];
          y -= ctx.size * 0.3;
          await blocks(b.blocks, { ...ctx, x: ctx.x + ctx.size * 1.4, width: ctx.width - ctx.size * 2.2, color: GRAY, bar, indent: false });
          y -= ctx.size * 0.4;
          break;
        }
        case "code": {
          const size = ctx.size * 0.82, lineH = size * 1.45, pad = 5;
          const st: Style = { size, color: INK, code: true };
          const rows = b.text.split("\n").flatMap((l) => breakLines([{ text: l || " ", code: true }], ctx.width - pad * 2, st));
          y -= ctx.size * 0.2;
          rows.forEach((line, i) => {
            ensure(lineH + (i === rows.length - 1 ? pad : 0));
            const top = i === 0 || y >= PH - M.top - 0.5 ? pad : 0;
            page.drawRectangle({ x: ctx.x, y: y - lineH - (i === rows.length - 1 ? pad : 0), width: ctx.width, height: lineH + top + (i === rows.length - 1 ? pad : 0), color: CODE_BG });
            y -= top;
            drawLine(line, ctx.x + pad, ctx.width - pad * 2, false, lineH, ctx.chapter);
            y -= lineH;
          });
          y -= pad + ctx.size * 0.6;
          break;
        }
        case "img": {
          const path = isExternal(b.src) ? "" : posix.normalize(posix.join(posix.dirname(ctx.chapter.file), safeDecode(b.src.split(/[?#]/)[0])));
          const img = path ? await image(path) : null;
          const capSize = ctx.size * 0.82;
          const capLines = b.alt ? breakLines([{ text: b.alt }], ctx.width, { size: capSize, color: GRAY }).length : 0;
          const capH = capLines * capSize * 1.45 + (capLines ? 4 : 0);
          if (!img) {
            paragraph([{ text: `[${b.alt || b.src}]` }], { ...ctx, color: GRAY, size: capSize }, { align: "center" });
            break;
          }
          const maxH = (PH - M.top - M.bottom) * 0.62;
          let w = Math.min(ctx.width, img.width * 0.75), h = (w * img.height) / img.width;
          if (h > maxH) { h = maxH; w = (h * img.width) / img.height; }
          y -= ctx.size * 0.5;
          if (y - h - capH < M.bottom) {
            const room = y - M.bottom - capH;
            if (room > maxH * 0.6) { h = room; w = (h * img.width) / img.height; }
            else newPage();
          }
          page.drawImage(img, { x: ctx.x + (ctx.width - w) / 2, y: y - h, width: w, height: h });
          y -= h + 4;
          if (b.alt) paragraph([{ text: b.alt }], { ...ctx, size: capSize, color: GRAY }, { align: "center", lineLead: 1.45 });
          y -= ctx.size * 0.6;
          break;
        }
        case "table": {
          const n = Math.max(b.header.length, ...b.rows.map((r) => r.length));
          const size = ctx.size * 0.88, pad = 4, lineH = size * 1.4, colW = ctx.width / n;
          const rowOf = (cells: Run[][], head: boolean) => {
            const ls = Array.from({ length: n }, (_, i) => breakLines(cells[i] ?? [], colW - pad * 2, { size, color: INK, bold: head }));
            return { ls, h: Math.max(...ls.map((l) => l.length)) * lineH + pad * 2, head };
          };
          const head = rowOf(b.header, true);
          const drawRow = (row: ReturnType<typeof rowOf>) => {
            const top = y;
            row.ls.forEach((ls, i) => {
              const x = ctx.x + i * colW;
              page.drawRectangle({ x, y: top - row.h, width: colW, height: row.h, borderColor: RULE, borderWidth: 0.6, ...(row.head ? { color: rgb(0.93, 0.93, 0.93) } : {}) });
              y = top - pad;
              for (const line of ls) {
                const al = b.align[i];
                const lx = al === "right" ? x + colW - pad - line.w : al === "center" ? x + (colW - line.w) / 2 : x + pad;
                drawLine(line, lx, colW - pad * 2, false, lineH, ctx.chapter);
                y -= lineH;
              }
            });
            y = top - row.h;
          };
          y -= ctx.size * 0.4;
          ensure(head.h + lineH * 2);
          drawRow(head);
          for (const r of b.rows) {
            const row = rowOf(r, false);
            if (y - row.h < M.bottom) { newPage(); drawRow(head); }
            drawRow(row);
          }
          y -= ctx.size * 0.8;
          break;
        }
        case "hr":
          ensure(ctx.size * 2);
          y -= ctx.size;
          page.drawLine({ start: { x: ctx.x + ctx.width * 0.35, y }, end: { x: ctx.x + ctx.width * 0.65, y }, thickness: 0.6, color: RULE });
          y -= ctx.size;
          break;
        case "html": {
          const text = decode(b.html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
          if (text) paragraph([{ text }], ctx, {});
          break;
        }
      }
    }
  }

  // ---------- 各章 ----------
  const chapterPages: PdfResult["chapterPages"] = [];
  for (const c of chapters) {
    curChapter = c;
    newPage(true);
    dests.set(c.id, { page, y: PH });
    chapterPages.push({ file: c.file, title: c.title, page: pages.length });
    y = PH - M.top - 40 * scale;
    const [first, ...rest] = c.blocks;
    const titleRuns = first?.t === "h" && first.level === 1 ? first.runs : [{ text: c.title }];
    if (first?.t === "h" && first.level === 1) dests.set(`${c.id}#${first.slug}`, { page, y: PH });
    const ctx: Ctx = { x: M.left, width: W, size: base, color: INK, indent: true, chapter: c };
    paragraph(titleRuns, { ...ctx, size: base * 1.9 }, { bold: true, align: "center", lineLead: 1.35 });
    y -= base * 2.4;
    await blocks(first?.t === "h" && first.level === 1 ? rest : c.blocks, ctx);
    if (c.footnotes.length) {
      y -= base * 1.2;
      ensure(base * 5);
      page.drawLine({ start: { x: M.left, y }, end: { x: M.left + W * 0.3, y }, thickness: 0.6, color: RULE });
      y -= base * 0.6;
      paragraph([{ text: t.notes }], { ...ctx, size: base * 0.95 }, { bold: true, align: "left" });
      for (const f of c.footnotes) {
        dests.set(`${c.id}-fn-${f.n}`, { page, y: y + 2 });
        const size = base * 0.85;
        paragraph(f.runs, { ...ctx, x: M.left + size * 1.8, width: W - size * 1.8, size, indent: false }, { marker: `${f.n}.`, lineLead: 1.5, keep: 2 });
        // 编号在 ensure 换页后才知道位置，补记
        y -= size * 0.25;
      }
    }
  }
  const chapterCount = pages.length;
  pages.forEach((p, i) => (p.number = i + 1));

  // ---------- 前置页：封面、扉页、目录 ----------
  const front: PDFPage[] = [];
  const coverImg = config.cover ? await image(config.cover) : null;
  if (coverImg) {
    const p = pdf.insertPage(front.length, [PW, PH]);
    const s = Math.max(PW / coverImg.width, PH / coverImg.height);
    p.drawImage(coverImg, { x: (PW - coverImg.width * s) / 2, y: (PH - coverImg.height * s) / 2, width: coverImg.width * s, height: coverImg.height * s });
    front.push(p);
  }
  {
    page = pdf.insertPage(front.length, [PW, PH]);
    front.push(page);
    y = PH * 0.68;
    const ctx: Ctx = { x: M.left, width: W, size: base * 2.3, color: INK, indent: false, chapter: chapters[0] };
    paragraph([{ text: config.title }], ctx, { bold: true, align: "center", lineLead: 1.3 });
    if (config.subtitle) { y -= base * 0.6; paragraph([{ text: config.subtitle }], { ...ctx, size: base * 1.3, color: GRAY }, { align: "center" }); }
    if (config.author) { y -= base * 3; paragraph([{ text: config.author }], { ...ctx, size: base * 1.3 }, { align: "center" }); }
    if (config.publisher || config.date) { y = M.bottom + base * 4; paragraph([{ text: [config.publisher, config.date].filter(Boolean).join(" · ") }], { ...ctx, size: base, color: GRAY }, { align: "center" }); }
  }
  // 目录
  const entries = chapters.flatMap((c) => [
    { title: c.title, level: 1, dest: c.id },
    ...(config.tocDepth === 2 ? c.headings.filter((h) => h.level === 2).map((h) => ({ title: h.text, level: 2, dest: `${c.id}#${h.slug}` })) : []),
  ]);
  const numberOf = (dest: string) => {
    const d = dests.get(dest);
    const p = d ? pages.find((x) => x.page === d.page) : undefined;
    return p?.number ? String(p.number) : "";
  };
  {
    const tocStart = front.length;
    const addTocPage = () => {
      page = pdf.insertPage(front.length, [PW, PH]);
      front.push(page);
      y = PH - M.top;
    };
    addTocPage();
    y -= 30 * scale;
    paragraph([{ text: t.toc }], { x: M.left, width: W, size: base * 1.6, color: INK, indent: false, chapter: chapters[0] }, { bold: true, align: "center", lineLead: 1.3 });
    y -= base * 1.6;
    for (const e of entries) {
      const size = e.level === 1 ? base : base * 0.92;
      const lineH = size * 1.9;
      const x = M.left + (e.level === 2 ? base * 1.5 : 0);
      const num = numberOf(e.dest);
      const nw = measure(fonts.regular, num, size);
      const lines = breakLines([{ text: e.title, bold: e.level === 1 }], W - (x - M.left) - nw - size * 2, { size, color: INK });
      lines.forEach((line, i) => {
        if (y - lineH < M.bottom) addTocPage();
        const baseline = drawLine(line, x, W, false, lineH);
        if (i === lines.length - 1) {
          const dotsFrom = x + line.w + size * 0.5, dotsTo = M.left + W - nw - size * 0.5;
          for (let dx = dotsFrom; dx < dotsTo; dx += size * 0.5) page.drawCircle({ x: dx, y: baseline + size * 0.15, size: 0.45, color: GRAY });
          page.drawText(num, { x: M.left + W - nw, y: baseline, size, font: fonts.regular, color: INK });
          links.push({ page, rect: [x, y - lineH * (lines.length - 1) - lineH, M.left + W, y + lineH * (lines.length - 1)], dest: e.dest });
        }
        y -= lineH;
      });
    }
    void tocStart;
  }

  // ---------- 页眉页脚 ----------
  const small = base * 0.72;
  for (const p of pages) {
    const n = String(p.number);
    const nw = measure(fonts.regular, n, small);
    p.page.drawText(n, { x: (PW - nw) / 2, y: M.bottom - 26 * scale, size: small, font: fonts.regular, color: GRAY });
    if (p.first) continue;
    const head = clean(p.number! % 2 === 0 ? config.title : p.chapter?.title ?? "");
    const lines = breakLines([{ text: head }], W * 0.8, { size: small, color: GRAY });
    const text = lines[0]?.atoms.flatMap((a) => a.segs.map((s) => s.text)).join("") + (lines.length > 1 ? "…" : "");
    const hw = measure(fonts.regular, text, small);
    p.page.drawText(text, { x: p.number! % 2 === 0 ? M.left : PW - M.right - hw, y: PH - M.top + 18 * scale, size: small, font: fonts.regular, color: GRAY });
    p.page.drawLine({ start: { x: M.left, y: PH - M.top + 13 * scale }, end: { x: PW - M.right, y: PH - M.top + 13 * scale }, thickness: 0.4, color: RULE });
  }

  // ---------- 链接与书签 ----------
  const destArray = (key: string) => {
    const d = dests.get(key);
    return d ? pdf.context.obj([d.page.ref, PDFName.of("XYZ"), PDFNull, PDFNumber.of(Math.round(d.y)), PDFNull]) : undefined;
  };
  for (const l of links) {
    const action = l.uri ? { A: { Type: "Action", S: "URI", URI: PDFString.of(l.uri) } } : undefined;
    const dest = l.dest ? destArray(l.dest) : undefined;
    if (!action && !dest) continue;
    const annot = pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: l.rect.map((v) => Math.round(v * 10) / 10), Border: [0, 0, 0], ...(action ?? { Dest: dest }) }));
    l.page.node.addAnnot(annot);
  }
  const outlineRef = pdf.context.nextRef();
  const itemRefs = chapters.map(() => pdf.context.nextRef());
  chapters.forEach((c, i) => {
    const dest = destArray(c.id);
    pdf.context.assign(itemRefs[i], pdf.context.obj({ Title: PDFHexString.fromText(c.title), Parent: outlineRef, ...(i > 0 ? { Prev: itemRefs[i - 1] } : {}), ...(i < chapters.length - 1 ? { Next: itemRefs[i + 1] } : {}), ...(dest ? { Dest: dest } : {}) }));
  });
  if (chapters.length) {
    pdf.context.assign(outlineRef, pdf.context.obj({ Type: "Outlines", First: itemRefs[0], Last: itemRefs[itemRefs.length - 1], Count: chapters.length }));
    pdf.catalog.set(PDFName.of("Outlines"), outlineRef);
    pdf.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  }
  // 页码标签：前置页 i, ii…，正文从 1 开始
  pdf.catalog.set(PDFName.of("PageLabels"), pdf.context.obj({ Nums: [0, { S: "r" }, front.length, { S: "D" }] }));
  void PDFArray;
  void (null as unknown as PDFRef);

  pdf.setTitle(config.title, { showInWindowTitleBar: true });
  if (config.author) pdf.setAuthor(config.author);
  if (config.description) pdf.setSubject(config.description);
  pdf.setLanguage(lang);
  pdf.setCreator("ebook-maker (ZCode)");
  pdf.setProducer("pdf-lib");
  const date = opts.date ?? new Date();
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);
  const data = await pdf.save();
  return { data, pages: pdf.getPageCount(), chapterPages: chapterPages.map((c) => ({ ...c, page: c.page })), warnings: [...warnings, ...(chapterCount ? [] : ["The book has no chapters"])] };
}

export { runsText };
