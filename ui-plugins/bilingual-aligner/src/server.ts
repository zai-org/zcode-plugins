import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { KitError } from "./kit/workspace.ts";
import { align, docxParagraphs, paragraphsOf, sentences } from "./align.ts";
import { s, yes } from "./util.ts";

export const NAME = "bilingual-aligner";
export const VERSION = "0.1.0";
const nums = (t: string) => (t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => x.replace(/,/g, ""));
const isZh = (t: string) => /[\u4e00-\u9fff]/.test(t);
const joinT = (a: string, b: string) => (!a ? b : !b ? a : isZh(a + b) ? a + b : `${a} ${b}`);

/** 应用“与下一行合并”，得到最终句对。 */
export function pairsOf(p: Project) {
  const out: { src: string; tgt: string; rows: number[] }[] = [];
  let carry: { src: string; tgt: string; rows: number[] } | null = null;
  p.rows.forEach((r, i) => {
    if (r.include === false) return;
    const cur = carry ? { src: joinT(carry.src, s(r.src)), tgt: joinT(carry.tgt, s(r.tgt)), rows: [...carry.rows, i] } : { src: s(r.src), tgt: s(r.tgt), rows: [i] };
    if (yes(r.merge)) carry = cur;
    else { carry = null; if (cur.src || cur.tgt) out.push(cur); }
  });
  if (carry && ((carry as { src: string }).src || (carry as { tgt: string }).tgt)) out.push(carry);
  return out;
}

async function readDoc(ws: Parameters<AppDef["load"]>[0]["ws"], f: string) {
  if (f.toLowerCase().endsWith(".docx")) return docxParagraphs(new Uint8Array(await ws.read(f)));
  return paragraphsOf(await ws.readText(f));
}

const DEF: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "align",
  title: ["双语句对齐", "Bilingual Aligner"],
  openDescription:
    "Align a source text and its translation sentence by sentence to build a translation memory. Pick two files (.txt, .md or .docx): the first is the source, the second the translation (setting swap=true reverses them). Paragraphs are split into sentences (Chinese and English punctuation, abbreviations handled), then aligned with the Gale–Church length model plus number anchors, allowing 1-1, 1-2, 2-1, 2-2 and unmatched sentences. Each row is one pair: edit src or tgt text to move words between rows, tick merge to join a row with the next one, untick include to drop it. QA flags: unmatched sentences, unusual length ratios, numbers that differ between source and translation (e.g. 3 年 vs 2 years). Exports XLSX, TMX 1.4 (for CAT tools), a tab-separated file and a side-by-side HTML.",
  inputs: { exts: [".txt", ".md", ".docx"], min: 2, max: 2, label: ["选择原文和译文两个文件", "Pick the source and the translation"] },
  settings: [
    { key: "swap", label: ["交换原文和译文", "Swap source and translation"], type: "bool", default: false, reload: true },
    { key: "srcLang", label: ["原文语言代码", "Source language code"], type: "text", default: "zh-CN" },
    { key: "tgtLang", label: ["译文语言代码", "Target language code"], type: "text", default: "en-US" },
    { key: "byParagraph", label: ["段落数相同时按段落先对齐", "Align paragraphs first when counts match"], type: "bool", default: true, reload: true },
    { key: "checkNumbers", label: ["检查数字是否一致", "Check numbers match"], type: "bool", default: true },
  ],
  columns: () => [
    { key: "include", label: ["保留", "Keep"], type: "bool" },
    { key: "src", label: ["原文", "Source"], wide: true },
    { key: "tgt", label: ["译文", "Translation"], wide: true },
    { key: "merge", label: ["与下一行合并", "Merge with next"], type: "bool" },
    { key: "_kind", label: ["对齐方式", "Match"], readOnly: true },
    { key: "_check", label: ["检查", "Check"], readOnly: true },
  ],
  newRow: () => ({ include: true, src: "", tgt: "", merge: false, kind: "manual", cost: 0 }),
  onCellEdit: (row, key) => { if (key === "src" || key === "tgt") { row.kind = "edited"; row.cost = 0; } },
  async load({ ws, files, settings }) {
    if (files.length !== 2) throw new KitError("need_two", "Pick exactly two files: the source and its translation.");
    const [fa, fb] = yes(settings.swap) ? [files[1], files[0]] : files;
    const pa = await readDoc(ws, fa), pb = await readDoc(ws, fb);
    if (!pa.length || !pb.length) throw new KitError("empty", `${!pa.length ? fa : fb} has no text.`);
    let pairs;
    if (settings.byParagraph !== false && pa.length === pb.length) pairs = pa.flatMap((p, i) => align(sentences(p), sentences(pb[i])));
    else pairs = align(pa.flatMap(sentences), pb.flatMap(sentences));
    const rows: Row[] = pairs.map((p) => ({ include: true, src: p.src, tgt: p.tgt, merge: false, kind: p.kind, cost: Math.round(p.cost * 10) / 10 }));
    return { rows, meta: { source: fa, target: fb, paragraphs: [pa.length, pb.length] } };
  },
  compute(p): Computed {
    const issues: Issue[] = [];
    const all = p.rows.filter((r) => r.include !== false);
    const tot = (k: string) => all.reduce((a, r) => a + [...s(r[k])].length, 0);
    const ratio = tot("tgt") / Math.max(1, tot("src"));
    const checks: string[] = p.rows.map(() => "");
    p.rows.forEach((r, i) => {
      if (r.include === false || yes(r.merge)) return;
      const a = s(r.src), b = s(r.tgt);
      const note = (level: Issue["level"], msg: string, tag: string) => { issues.push({ level, row: i, key: a ? "tgt" : "src", message: msg }); checks[i] = checks[i] ? `${checks[i]}; ${tag}` : tag; };
      if (!a || !b) { note("warn", `Row ${i}: ${!a ? "translation" : "source"} sentence has no counterpart — merge it into a neighbour or fill the other side.`, !a ? "原文缺失" : "译文缺失"); return; }
      const rr = [...b].length / Math.max(1, [...a].length);
      if (s(r.kind) !== "edited" && s(r.kind) !== "manual" && (rr > ratio * 2.2 || rr < ratio / 2.2)) note("warn", `Row ${i}: length ratio is unusual — check the split (“${a.slice(0, 16)}…”).`, "长度异常");
      if (p.settings.checkNumbers !== false) {
        const na = nums(a), nb = nums(b);
        const miss = na.filter((x) => !nb.includes(x)), extra = nb.filter((x) => !na.includes(x));
        if (miss.length || extra.length) note("error", `Row ${i}: numbers differ — source has ${na.join(", ") || "none"}, translation has ${nb.join(", ") || "none"}.`, "数字不一致");
      }
    });
    const pairs = pairsOf(p);
    return {
      rows: p.rows.map((r, i) => ({ ...r, _kind: s(r.kind) === "edited" ? "手动" : s(r.kind), _check: checks[i] })),
      issues,
      summary: `${pairs.length} sentence pair(s) from ${s(p.meta.source)} → ${s(p.meta.target)}; ${p.rows.filter((r) => /^(2-1|1-2|2-2)$/.test(s(r.kind))).length} many-to-one, ${p.rows.filter((r) => /^(1-0|0-1)$/.test(s(r.kind))).length} unmatched; length ratio ${ratio.toFixed(2)}.`,
      stats: { pairs: pairs.length, flagged: checks.filter(Boolean).length },
      preview: `<table><tr><th>#</th><th>原文</th><th>译文</th></tr>${pairs.slice(0, 60).map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.src)}</td><td>${esc(x.tgt)}</td></tr>`).join("")}</table>`,
    };
  },
  exports: [
    { id: "xlsx", label: ["句对 XLSX", "Pairs (XLSX)"], description: "aligned.xlsx", async run({ project, write }: ExportCtx) { const ps = pairsOf(project); return [await write("aligned.xlsx", await writeXlsx([{ name: "Aligned", headers: ["#", `原文 ${s(project.settings.srcLang)}`, `译文 ${s(project.settings.tgtLang)}`], rows: ps.map((x, i) => [i + 1, x.src, x.tgt]), widths: [5, 70, 70] }]))]; } },
    {
      id: "tmx", label: ["翻译记忆 TMX", "Translation memory (TMX)"], description: "aligned.tmx — TMX 1.4 for Trados, memoQ, OmegaT",
      async run({ project, write }: ExportCtx) {
        const sl = s(project.settings.srcLang) || "zh-CN", tl = s(project.settings.tgtLang) || "en-US";
        const tus = pairsOf(project).filter((x) => x.src && x.tgt).map((x) => `    <tu>\n      <tuv xml:lang="${esc(sl)}"><seg>${esc(x.src)}</seg></tuv>\n      <tuv xml:lang="${esc(tl)}"><seg>${esc(x.tgt)}</seg></tuv>\n    </tu>`).join("\n");
        return [await write("aligned.tmx", `<?xml version="1.0" encoding="UTF-8"?>\n<tmx version="1.4">\n  <header creationtool="Penova bilingual-aligner" creationtoolversion="${VERSION}" segtype="sentence" o-tmf="none" adminlang="en" srclang="${esc(sl)}" datatype="plaintext"/>\n  <body>\n${tus}\n  </body>\n</tmx>\n`)];
      },
    },
    { id: "tsv", label: ["制表符文本", "Tab-separated"], description: "aligned.tsv", async run({ project, write }: ExportCtx) { return [await write("aligned.tsv", pairsOf(project).map((x) => `${x.src.replace(/\t|\n/g, " ")}\t${x.tgt.replace(/\t|\n/g, " ")}`).join("\n") + "\n")]; } },
    { id: "html", label: ["对照 HTML", "Side-by-side HTML"], description: "aligned.html", async run({ project, write }: ExportCtx) { return [await write("aligned.html", `<!doctype html><meta charset="utf-8"><title>Aligned</title><style>body{font:15px/1.6 -apple-system,"PingFang SC",sans-serif;max-width:1200px;margin:24px auto}td{vertical-align:top;padding:6px 10px;border-bottom:1px solid #eee}td:first-child{color:#9ca3af}</style><table>${pairsOf(project).map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.src)}</td><td>${esc(x.tgt)}</td></tr>`).join("")}</table>`)]; } },
  ],
  describeRow: (r, i) => `#${i}${r.include === false ? " [dropped]" : ""}${yes(r.merge) ? " [merge→next]" : ""} [${s(r.kind)}] ${s(r.src)} || ${s(r.tgt)}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(DEF, options).server;
}
