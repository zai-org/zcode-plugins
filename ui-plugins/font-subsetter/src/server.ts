import * as fontkit from "fontkit";
import { createApp, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { escapeXml, renderSvg } from "./kit/render.ts";
import { KitError, type Workspace } from "./kit/workspace.ts";
import { ASCII, CN_PUNCT, collect, FONT_EXTS, TEXT_EXTS, unicodeRange, visibleText, headingText, type CharMap } from "./chars.ts";
import { embedding, faceOffsets, fromWoff2, isVariable, isWoff, isWoff2, os2, sfntToWoff, subsetFont, toWoff2, woffToSfnt } from "./hb.ts";
import { fontsFor } from "./png.ts";
import { s, yes } from "./util.ts";

export const NAME = "font-subsetter";
export const VERSION = "0.1.0";
const has = (f: string, exts: string[]) => exts.some((e) => f.toLowerCase().endsWith(e));
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const MAX_TEXT = 2 * 1024 * 1024;
/** 字体许可证、版权说明不是页面文字。 */
const LICENSE = /(^|\/)(OFL|LICEN[SC]E|COPYING|NOTICE|FONTLOG)[^/]*$/i;

/* ---------- 字体字节缓存（project.json 里只存路径） ---------- */
interface FontFile { sfnt: Uint8Array; kind: string; size: number }
const fileCache = new Map<string, { key: string; f: FontFile }>();
async function fontFile(ws: Workspace, path: string): Promise<FontFile> {
  const size = await ws.size(path), key = `${size}:${(await ws.mtime(path)).getTime()}`;
  const hit = fileCache.get(path);
  if (hit?.key === key) return hit.f;
  const raw = new Uint8Array(await ws.read(path, 300 * 1024 * 1024));
  let f: FontFile;
  if (isWoff2(raw)) f = { sfnt: await fromWoff2(raw), kind: "woff2", size };
  else if (isWoff(raw)) f = { sfnt: woffToSfnt(raw), kind: "woff", size };
  else f = { sfnt: raw, kind: String.fromCharCode(...raw.subarray(0, 4)) === "ttcf" ? "ttc" : String.fromCharCode(...raw.subarray(0, 4)) === "OTTO" ? "otf" : "ttf", size };
  fileCache.set(path, { key, f });
  return f;
}
type FkFont = { familyName: string; subfamilyName: string; numGlyphs: number; hasGlyphForCodePoint(cp: number): boolean; layout(t: string): { glyphs: { path: { toSVG(): string } }[]; positions: { xAdvance: number; xOffset: number; yOffset: number }[] }; unitsPerEm: number; ascent: number; descent: number };
const fkCache = new WeakMap<Uint8Array, FkFont[]>();
function faces(sfnt: Uint8Array): FkFont[] {
  let v = fkCache.get(sfnt);
  if (!v) {
    const f = fontkit.create(Buffer.from(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength)) as unknown as { fonts?: FkFont[] } & FkFont;
    v = f.fonts ? f.fonts : [f];
    fkCache.set(sfnt, v);
  }
  return v;
}

/* ---------- 子集结果缓存 ---------- */
interface Out { ttf: Uint8Array; woff2: Uint8Array; glyphs: number }
const outCache = new Map<string, Out>();

function needed(p: Project, r: Row) {
  const m = p.meta as { all?: CharMap; heads?: CharMap };
  const use = s(r.use) || "all";
  const fromText: CharMap = use === "headings" ? (m.heads ?? {}) : use === "extra" ? {} : (m.all ?? {});
  const extra: CharMap = {};
  for (const ch of s(p.settings.extra) + s(r.extra)) if (ch.trim()) extra[ch] ??= { n: 1, at: "extra" };
  const preset = new Set<string>();
  if (yes(p.settings.ascii ?? true)) for (const ch of ASCII) preset.add(ch);
  if (yes(p.settings.cnPunct ?? true)) for (const ch of CN_PUNCT) preset.add(ch);
  const text: CharMap = { ...fromText, ...extra };
  const all = new Set<string>([...Object.keys(text), ...preset, " "]);
  return { text, all, use };
}

async function subsetRow(ws: Workspace, assetRoot: string, p: Project, r: Row) {
  const ff = await fontFile(ws, s(r.file)), face = Number(r.face) || 0;
  const fk = faces(ff.sfnt)[face];
  if (!fk) throw new KitError("face", `${s(r.file)} has no face #${face}.`);
  const { text, all } = needed(p, r);
  const keep = [...all].filter((ch) => fk.hasGlyphForCodePoint(ch.codePointAt(0)!));
  const missing = Object.entries(text).filter(([ch]) => !fk.hasGlyphForCodePoint(ch.codePointAt(0)!));
  const key = `${s(r.file)}|${ff.size}|${face}|${yes(p.settings.dropHinting) ? 1 : 0}|${keep.sort().join("")}`;
  let out = outCache.get(key);
  if (!out) {
    const ttf = await subsetFont(assetRoot, ff.sfnt, face, keep.map((c) => c.codePointAt(0)!), { dropHinting: yes(p.settings.dropHinting) });
    out = { ttf, woff2: await toWoff2(ttf), glyphs: faces(ttf)[0].numGlyphs };
    outCache.set(key, out);
  }
  const off = faceOffsets(ff.sfnt)[face] ?? 0;
  return { ff, fk, keep, missing, out, os: os2(ff.sfnt, off), variable: isVariable(ff.sfnt, off) };
}

/* ---------- 预览：用子集字体自己的字形轮廓画（缺的字会显示成方框） ---------- */
function glyphRun(font: FkFont, text: string, x0: number, y0: number, size: number, maxW: number, lh: number, color: string) {
  const sc = size / font.unitsPerEm, parts: string[] = [];
  let x = x0, y = y0, lines = 1;
  for (const para of text.split("\n")) {
    const run = font.layout(para);
    run.glyphs.forEach((g, i) => {
      const pos = run.positions[i], adv = pos.xAdvance * sc;
      if (x + adv > x0 + maxW) { x = x0; y += lh; lines++; }
      const d = g.path.toSVG();
      if (d) parts.push(`<path transform="translate(${(x + pos.xOffset * sc).toFixed(1)} ${(y - pos.yOffset * sc).toFixed(1)}) scale(${sc.toFixed(5)} ${(-sc).toFixed(5)})" d="${d}"/>`);
      x += adv;
    });
    x = x0; y += lh; lines++;
  }
  return { svg: `<g fill="${color}">${parts.join("")}</g>`, lines: lines - 1 };
}

function sampleFor(p: Project, r: Row): string {
  const own = s(p.settings.sample);
  if (own) return own;
  const src = (p.meta.sources as Record<string, string>) ?? {};
  if (s(r.use) === "headings") return [...new Set(Object.entries(src).flatMap(([f, t]) => headingText(f, t)))].slice(0, 5).join("  ");
  if (s(r.use) === "extra") return s(p.settings.extra) + s(r.extra);
  const lines: string[] = [];
  for (const [f, t] of Object.entries(src)) for (const l of visibleText(f, t, true).split("\n")) { const v = l.replace(/\s+/g, " ").trim().replace(/^(#{1,6}|[-*>]|\d+\.)\s+/, ""); if (/[^\x00-\x7f]/.test(v) && v.length > 3) lines.push(v); }
  return lines.slice(0, 4).join(" ").slice(0, 80);
}

interface Card { r: Row; family: string; fk: FkFont; sample: string; missing: string[]; label: string }
function previewSvg(cards: Card[], width = 760) {
  const pad = 20, size = 26, lh = 38, parts: string[] = [];
  let y = pad;
  for (const c of cards) {
    const top = y;
    const head = `<text x="${pad + 14}" y="${y + 24}" font-size="14" font-weight="bold" fill="#111827">${escapeXml(c.family)}</text><text x="${width - pad - 14}" y="${y + 24}" font-size="12" fill="#6b7280" text-anchor="end">${escapeXml(c.label)}</text>`;
    y += 40;
    const g = glyphRun(c.fk, c.sample || "—", pad + 14, y + size, size, width - 2 * pad - 28, lh, "#111827");
    let body = g.svg;
    y += g.lines * lh + 6;
    if (c.missing.length) {
      body += `<text x="${pad + 14}" y="${y + 22}" font-size="13" fill="#b91c1c">缺字 / missing:</text>`;
      body += glyphRun(c.fk, c.missing.slice(0, 16).join(" "), pad + 130, y + 24, 22, width - 2 * pad - 150, 30, "#b91c1c").svg;
      y += 40;
    }
    y += 10;
    parts.push(`<rect x="${pad}" y="${top}" width="${width - 2 * pad}" height="${y - top}" rx="10" fill="#ffffff" stroke="#e5e7eb"/>${head}${body}`);
    y += 14;
  }
  const H = y + pad - 14;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}"><rect width="100%" height="100%" fill="#f3f4f6"/>${parts.join("")}</svg>`, W: width, H };
}

const slug = (t: string) => t.replace(/[\\/:*?"<>|\s]+/g, "") || "font";

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "fontsub",
    title: ["网页字体瘦身", "Font Subsetter"],
    openDescription:
      "Shrink web fonts to only the characters a site actually uses (great for Chinese fonts: 10–20 MB → tens of KB). Pick a project folder (or font files plus text files). It finds fonts (.ttf .otf .ttc .woff .woff2) and text sources (HTML, Vue/Svelte, JS/TS, CSS, Markdown, JSON, YAML, subtitles…), collects the characters that are really shown (comments and HTML markup are skipped), and subsets each font with HarfBuzz. Each row is one font face: include, file, face (index in a .ttc), family (CSS font-family name), weight, style, use (all = every character in the text; headings = only <title>/<h1>–<h6>/# headings and title fields — for display fonts; extra = only the extra characters), extra (characters to always keep for this font), output (file base name). Settings: ascii (always keep printable ASCII), cnPunct (keep common Chinese punctuation), extra (characters to keep in every font), skipComments, formats (woff2 / woff2+woff / woff2+woff+ttf), dropHinting, unicodeRange (write unicode-range in the CSS), fontDisplay, sample (preview text). Checks: characters used in the text that a font doesn't have (with file:line), fonts whose license forbids embedding (OS/2 fsType), variable fonts, outputs that are still large, duplicate output names. Exports the subset fonts, fonts.css (@font-face), chars.txt, report.md and preview.png.",
    inputs: { exts: [...FONT_EXTS, ...TEXT_EXTS], min: 1, max: 200, folders: true, label: ["选择网站 / 项目文件夹（含字体和页面文件）", "Pick the site or project folder (fonts + pages)"] },
    settings: [
      { key: "formats", label: ["输出格式", "Formats"], type: "select", default: "woff2,woff", options: [{ value: "woff2", label: ["只要 WOFF2", "WOFF2 only"] }, { value: "woff2,woff", label: ["WOFF2 + WOFF", "WOFF2 + WOFF"] }, { value: "woff2,woff,ttf", label: ["WOFF2 + WOFF + TTF/OTF", "WOFF2 + WOFF + TTF/OTF"] }] },
      { key: "ascii", label: ["始终保留英文字母、数字和半角标点", "Always keep ASCII letters, digits, punctuation"], type: "bool", default: true },
      { key: "cnPunct", label: ["始终保留常用中文标点", "Always keep common Chinese punctuation"], type: "bool", default: true },
      { key: "extra", label: ["每个字体都额外保留的字符", "Extra characters for every font"], type: "text", default: "" },
      { key: "skipComments", label: ["忽略代码注释里的字", "Ignore characters in code comments"], type: "bool", default: true, reload: true },
      { key: "dropHinting", label: ["去掉 hinting（更小，Windows 小字号略糊）", "Drop hinting (smaller)"], type: "bool", default: false },
      { key: "unicodeRange", label: ["CSS 写 unicode-range", "Write unicode-range in CSS"], type: "bool", default: false },
      { key: "fontDisplay", label: ["font-display", "font-display"], type: "select", default: "swap", options: ["swap", "fallback", "optional", "block", "auto"].map((v) => ({ value: v, label: [v, v] as [string, string] })) },
      { key: "sample", label: ["预览文字（留空=取页面里的文字）", "Preview text (blank = from the pages)"], type: "text", default: "" },
    ],
    columns: () => [
      { key: "include", label: ["导出", "Export"], type: "bool" },
      { key: "file", label: ["字体文件", "Font file"], readOnly: true },
      { key: "face", label: ["序号", "Face"], type: "number", readOnly: true },
      { key: "family", label: ["CSS 字体名", "CSS family"] },
      { key: "weight", label: ["字重", "Weight"], type: "number" },
      { key: "style", label: ["样式", "Style"], type: "select", options: ["normal", "italic"] },
      { key: "use", label: ["用于", "Use for"], type: "select", options: ["all", "headings", "extra"] },
      { key: "extra", label: ["额外字符", "Extra chars"] },
      { key: "output", label: ["输出文件名", "Output name"] },
      { key: "_chars", label: ["保留字数", "Chars kept"], readOnly: true },
      { key: "_missing", label: ["缺字", "Missing"], readOnly: true },
      { key: "_size", label: ["原大小 → WOFF2", "Size → WOFF2"], readOnly: true },
    ] as Column[],
    async load({ ws, files, settings, previous }) {
      const fonts: string[] = [], texts: string[] = [];
      const add = (f: string) => { if (has(f, FONT_EXTS)) fonts.push(f); else if (has(f, TEXT_EXTS)) texts.push(f); };
      for (const f of files) {
        if (has(f, FONT_EXTS) || has(f, TEXT_EXTS)) add(f);
        else for (const x of await ws.list({ dir: f, exts: [...FONT_EXTS, ...TEXT_EXTS], limit: 5000 })) add(x.path);
      }
      const notOut = (f: string) => !f.startsWith(NAME + "/") && !LICENSE.test(f);
      const fontList = [...new Set(fonts)].filter(notOut), textList = [...new Set(texts)].filter(notOut);
      if (!fontList.length) throw new KitError("no_fonts", "No font files found (.ttf .otf .ttc .woff .woff2). Put the fonts in the picked folder or pick them too.");
      const sources: Record<string, string> = {}, skipped: string[] = [];
      for (const f of textList) {
        if ((await ws.size(f)) > MAX_TEXT) { skipped.push(f); continue; }
        const t = await ws.readText(f);
        if (t.includes("\u0000")) continue;
        sources[f] = t;
      }
      const skip = yes(settings.skipComments ?? true);
      const all = collect(sources, { skipComments: skip }), heads = collect(sources, { skipComments: skip, headingsOnly: true });
      const rows: Row[] = [], bad: Record<string, string> = {};
      for (const f of fontList) {
        let ff: FontFile;
        try { ff = await fontFile(ws, f); faces(ff.sfnt); } catch (e) { bad[f] = (e as Error).message.split("\n")[0]; rows.push({ include: false, file: f, face: 0, family: "", weight: 400, style: "normal", use: "all", extra: "", output: slug(f.split("/").pop()!.replace(/\.[^.]+$/, "")) }); continue; }
        faces(ff.sfnt).slice(0, 24).forEach((fk, i) => {
          const prev = previous?.find((r) => s(r.file) === f && Number(r.face) === i);
          if (prev) { rows.push(prev); return; }
          const o = os2(ff.sfnt, faceOffsets(ff.sfnt)[i] ?? 0);
          rows.push({ include: true, file: f, face: i, family: fk.familyName, weight: o.weight || 400, style: o.italic ? "italic" : "normal", use: "all", extra: "", output: slug(`${fk.familyName}-${fk.subfamilyName}`) });
        });
      }
      return { rows, meta: { sources, all: all.chars, heads: heads.chars, commentOnly: all.commentOnly, skipped, bad, kinds: Object.fromEntries(fontList.map((f) => [f, fileCache.get(f)?.f.kind ?? ""])) } };
    },
    async compute(p, ctx): Promise<Computed> {
      const ws = ctx.ws, issues: Issue[] = [];
      const meta = p.meta as { sources?: Record<string, string>; all?: CharMap; heads?: CharMap; commentOnly?: number; skipped?: string[]; bad?: Record<string, string> };
      const nsrc = Object.keys(meta.sources ?? {}).length;
      if (!nsrc) issues.push({ level: "warn", message: "No text files (HTML, JS/TS, CSS, Markdown, JSON…) were found, so only the extra/ASCII characters are kept. Pick the folder that has the pages too." });
      if (meta.commentOnly && yes(p.settings.skipComments ?? true)) issues.push({ level: "info", message: `${meta.commentOnly} character(s) appear only in comments or HTML markup and are left out (turn off “Ignore comments” to keep them).` });
      for (const f of meta.skipped ?? []) issues.push({ level: "info", message: `${f} is larger than 2 MB and was not scanned.` });
      const names = new Map<string, number>();
      let orig = 0, small = 0;
      const seenFile = new Set<string>();
      const cards: Card[] = [];
      const out = [] as Row[];
      for (const [i, r] of p.rows.entries()) {
        const f = s(r.file);
        if (meta.bad?.[f]) { issues.push({ level: "error", row: i, key: "file", message: `${f} could not be read as a font: ${meta.bad[f]}` }); out.push({ ...r, _chars: "", _missing: "", _size: "" }); continue; }
        if (!yes(r.include)) { out.push({ ...r, _chars: "", _missing: "", _size: "" }); continue; }
        if (!["all", "headings", "extra"].includes(s(r.use) || "all")) issues.push({ level: "error", row: i, key: "use", message: `Use must be all, headings or extra (got “${s(r.use)}”).` });
        const name = slug(s(r.output)) || `font-${i}`;
        names.set(name, (names.get(name) ?? 0) + 1);
        try {
          const x = await subsetRow(ws, assetRoot, p, r);
          if (!seenFile.has(f)) { orig += x.ff.size; seenFile.add(f); }
          small += x.out.woff2.length;
          const fam = s(r.family) || x.fk.familyName;
          if (x.missing.length) {
            const list = x.missing.slice(0, 10).map(([ch, h]) => `${ch} (${h.at})`).join(", ");
            issues.push({ level: "warn", row: i, key: "file", message: `${x.missing.length} character(s) used in the text are not in ${fam}: ${list}${x.missing.length > 10 ? " …" : ""}. Browsers will draw them with a fallback font — use a font that has them or check the CSS fallback.` });
          }
          const emb = embedding(x.os.fsType);
          if (emb === "restricted") issues.push({ level: "warn", row: i, key: "file", message: `${fam}'s license flag (OS/2 fsType) says Restricted: it must not be embedded. Check the font license before putting it on a website.` });
          else if (emb === "preview") issues.push({ level: "info", row: i, key: "file", message: `${fam} allows only “preview & print” embedding (OS/2 fsType); check its license covers web use.` });
          if (x.variable) issues.push({ level: "info", row: i, key: "file", message: `${fam} is a variable font; its axes (weight, width…) are kept in the subset.` });
          if (s(r.use) === "extra" && !(s(p.settings.extra) + s(r.extra)).trim()) issues.push({ level: "warn", row: i, key: "extra", message: "Use is “extra” but no extra characters are set, so only ASCII/punctuation is kept." });
          if (x.out.woff2.length > 400 * 1024) issues.push({ level: "warn", row: i, key: "use", message: `The WOFF2 is still ${kb(x.out.woff2.length)}. For a display font set use to “headings”, or split pages into several fonts.` });
          const kinds = (p.meta.kinds as Record<string, string>) ?? {};
          out.push({ ...r, _chars: `${x.keep.length}`, _missing: x.missing.length ? x.missing.map(([c]) => c).join("") : "0", _size: `${kb(x.ff.size)}${kinds[f] === "ttc" ? " (ttc)" : ""} → ${kb(x.out.woff2.length)}` });
          if (cards.length < 6) cards.push({ r, family: `${fam} · ${s(r.weight) || 400}${s(r.style) === "italic" ? " italic" : ""}`, fk: faces(x.out.ttf)[0], sample: sampleFor(p, r), missing: x.missing.map(([c]) => c), label: `${x.keep.length} chars · ${kb(x.ff.size)} → ${kb(x.out.woff2.length)} WOFF2` });
        } catch (e) {
          issues.push({ level: "error", row: i, key: "file", message: `${f}: ${(e as Error).message}` });
          out.push({ ...r, _chars: "", _missing: "", _size: "" });
        }
      }
      for (const [n, c] of names) if (c > 1) issues.push({ level: "error", key: "output", message: `Output name “${n}” is used by ${c} rows; give each font its own output name.` });
      const included = out.filter((r) => yes(r.include) && s(r._size));
      if (!included.length) issues.push({ level: "error", message: "No font is included for export." });
      const prev = cards.length ? previewSvg(cards).svg.replace("<svg ", '<svg style="max-width:100%;height:auto" ') : "";
      const chars = Object.keys(meta.all ?? {}).length;
      return {
        rows: out,
        issues,
        summary: `${included.length} font(s), ${chars} distinct character(s) found in ${nsrc} text file(s); ${kb(orig)} of fonts → ${kb(small)} WOFF2${orig ? ` (${Math.round((1 - small / orig) * 100)}% smaller)` : ""}.`,
        stats: { fonts: included.length, chars, sources: nsrc, originalKB: Math.round(orig / 1024), woff2KB: Math.round(small / 1024) },
        preview: prev,
      };
    },
    exports: [
      { id: "fonts", label: ["字体 + CSS", "Fonts + CSS"], description: "<output>.woff2/.woff(/.ttf), fonts.css, chars.txt, report.md, preview.png", async run(ctx: ExportCtx) {
        const p = ctx.project, files: string[] = [], fmts = (s(p.settings.formats) || "woff2,woff").split(",");
        const css: string[] = [`/* Generated by ${NAME}: only the characters used by the site are kept. */`];
        const rep: string[] = [`# Font subset report — ${p.name}`, "", "| Font | Use | Chars kept | Glyphs | Original | WOFF2 | Missing |", "|---|---|---|---|---|---|---|"];
        const cards: Card[] = [];
        const families = new Set<string>();
        for (const [i, r] of p.rows.entries()) {
          if (!yes(r.include) || (p.meta.bad as Record<string, string>)?.[s(r.file)]) continue;
          const x = await subsetRow(ctx.ws, ctx.assetRoot, p, r);
          const name = slug(s(r.output)) || `font-${i}`, fam = s(r.family) || x.fk.familyName, ext = x.ff.kind === "otf" || (x.ff.kind === "ttc" && String.fromCharCode(...x.out.ttf.subarray(0, 4)) === "OTTO") ? "otf" : "ttf";
          const src: string[] = [];
          if (fmts.includes("woff2")) { files.push(await ctx.write(`${name}.woff2`, x.out.woff2)); src.push(`url("${name}.woff2") format("woff2")`); }
          if (fmts.includes("woff")) { files.push(await ctx.write(`${name}.woff`, sfntToWoff(x.out.ttf))); src.push(`url("${name}.woff") format("woff")`); }
          if (fmts.includes("ttf")) { files.push(await ctx.write(`${name}.${ext}`, x.out.ttf)); src.push(`url("${name}.${ext}") format("${ext === "otf" ? "opentype" : "truetype"}")`); }
          const ur = yes(p.settings.unicodeRange) ? `\n  unicode-range: ${unicodeRange(x.keep.map((c) => c.codePointAt(0)!))};` : "";
          css.push(`@font-face {\n  font-family: "${fam}";\n  src: ${src.join(",\n       ")};\n  font-weight: ${Number(r.weight) || 400};\n  font-style: ${s(r.style) || "normal"};\n  font-display: ${s(p.settings.fontDisplay) || "swap"};${ur}\n}`);
          families.add(fam);
          rep.push(`| ${fam} ${Number(r.weight) || 400} (${s(r.file)}${Number(r.face) ? ` #${r.face}` : ""}) | ${s(r.use) || "all"} | ${x.keep.length} | ${x.fk.numGlyphs} → ${x.out.glyphs} | ${kb(x.ff.size)} | ${kb(x.out.woff2.length)} | ${x.missing.map(([c, h]) => `${c} (${h.at})`).join(", ") || "—"} |`);
          cards.push({ r, family: `${fam} · ${Number(r.weight) || 400}`, fk: faces(x.out.ttf)[0], sample: sampleFor(p, r), missing: x.missing.map(([c]) => c), label: `${x.keep.length} chars · ${kb(x.ff.size)} → ${kb(x.out.woff2.length)} WOFF2` });
        }
        if (!cards.length) throw new KitError("nothing", "No font is included for export.");
        css.push(`\n/* Usage: body { font-family: ${[...families].map((f) => `"${f}"`).join(", ")}, sans-serif; } */`);
        files.push(await ctx.write("fonts.css", css.join("\n\n") + "\n"));
        const all = Object.keys((p.meta.all as CharMap) ?? {}).sort();
        files.push(await ctx.write("chars.txt", all.join("") + "\n"));
        rep.push("", `Characters found in the text: ${all.length}. Text files scanned: ${Object.keys((p.meta.sources as object) ?? {}).length}.`);
        files.push(await ctx.write("report.md", rep.join("\n") + "\n"));
        const pv = previewSvg(cards, 900), fonts = await fontsFor(ctx.assetRoot);
        files.push(await ctx.write("preview.png", (await renderSvg(pv.svg, fonts, pv.W * 2)).png));
        return files;
      } },
    ],
    describeRow: (r, i) => `#${i} ${yes(r.include) ? "" : "(off) "}${s(r.file)}${Number(r.face) ? ` [face ${r.face}]` : ""} “${s(r.family)}” ${s(r.weight) || 400} use=${s(r.use) || "all"}${s(r.extra) ? ` extra=${s(r.extra)}` : ""} → ${s(r.output)}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
