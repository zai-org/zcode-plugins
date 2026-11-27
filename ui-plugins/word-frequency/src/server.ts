import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { KitError } from "./kit/workspace.ts";
import { countWords, EN_STOP, layoutCloud, ZH_STOP } from "./count.ts";
import { fontsFor, svgToPng } from "./png.ts";
import { notOutput, s, yes } from "./util.ts";

export const NAME = "word-frequency";
export const VERSION = "0.1.0";
const PALETTES: Record<string, string[]> = { vivid: ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#4d7c0f"], ocean: ["#0c4a6e", "#0369a1", "#0284c7", "#0ea5e9", "#155e75", "#0f766e"], warm: ["#7c2d12", "#c2410c", "#ea580c", "#b45309", "#be123c", "#9f1239"], mono: ["#111827", "#374151", "#4b5563"] };
const MAX_ROWS = 300;

/** 设置里的合并规则：“顾客=客户”“顾客→客户”“顾客 > 客户”，每行或逗号一条；左边可写多个词（“顾客 客人=客户”）。 */
export function mergeRules(text: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of s(text).split(/[\n,，;；]+/)) {
    const m = /^(.+?)\s*(?:=|→|->|>|＝)\s*(.+)$/.exec(part.trim());
    if (!m) continue;
    for (const w of m[1].split(/[\s、/]+/).filter(Boolean)) out.set(w.toLowerCase(), m[2].trim());
  }
  return out;
}
const targetOf = (r: Row, rules: Map<string, string>) => s(r.mergeInto) || rules.get(s(r.word).toLowerCase()) || s(r.word);

function merged(p: Project) {
  const rules = mergeRules(p.settings.merge);
  const by = new Map<string, { word: string; count: number; files: Record<string, number>; rows: number[] }>();
  p.rows.forEach((r, i) => {
    if (r.include === false) return;
    const target = targetOf(r, rules);
    const files = (r.files as Record<string, number> | undefined) ?? {};
    const e = by.get(target) ?? { word: target, count: 0, files: {}, rows: [] };
    e.count += Number(r.count) || 0;
    for (const [f, c] of Object.entries(files)) e.files[f] = (e.files[f] ?? 0) + c;
    e.rows.push(i);
    by.set(target, e);
  });
  return [...by.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

function cloudSvg(p: Project, family?: string) {
  const W = Number(p.settings.width) || 1200, H = Math.round(W * (s(p.settings.shape) === "wide" ? 0.5 : s(p.settings.shape) === "circle" ? 0.75 : 0.625));
  const words = merged(p).slice(0, Number(p.settings.cloudWords) || 80);
  const placed = layoutCloud(words.map((w) => ({ word: w.word, weight: w.count })), { width: W, height: H, palette: PALETTES[s(p.settings.palette)] ?? PALETTES.vivid, rotate: yes(p.settings.rotate), circle: s(p.settings.shape) === "circle", minSize: Math.round(W / 70), maxSize: Math.round(W / 9) });
  const txt = placed.map((w) => /[\u4e00-\u9fff]/.test(w.word) && w.rot
    ? [...w.word].map((ch, k, arr) => `<text x="${w.x.toFixed(1)}" y="${(w.y + (k - (arr.length - 1) / 2) * w.size).toFixed(1)}" font-size="${w.size}" font-weight="${w.size > W / 25 ? 700 : 500}" fill="${w.color}" text-anchor="middle" dominant-baseline="central">${esc(ch)}</text>`).join("")
    : `<text x="${w.x.toFixed(1)}" y="${w.y.toFixed(1)}" font-size="${w.size}" font-weight="${w.size > W / 25 ? 700 : 500}" fill="${w.color}" text-anchor="middle" dominant-baseline="central"${w.rot ? ` transform="rotate(-90 ${w.x.toFixed(1)} ${w.y.toFixed(1)})"` : ""}>${esc(w.word)}</text>`).join("");
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(family ?? "sans-serif")}"><rect width="100%" height="100%" fill="${s(p.settings.background) || "#ffffff"}"/>${txt}</svg>`, placed: placed.length, wanted: words.length };
}

const stopSet = (settings: Record<string, unknown>) => new Set([...(yes(settings.builtinStop ?? true) ? [...ZH_STOP, ...EN_STOP] : []), ...s(settings.stopwords).split(/[\s,，、]+/).map((w) => w.trim().toLowerCase()).filter(Boolean)]);

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "wordfreq",
    title: ["词频统计词云", "Word Frequency"],
    openDescription:
      "Count word frequencies in Chinese and/or English text files (.txt/.md, several files or a folder) and draw a word cloud. Chinese is split into words with the system's word segmenter, English is lower-cased; built-in stopwords (的/了/the/and…) plus your own (setting “stopwords”, space or comma separated) are removed; optional 2- and 3-word phrases. Rows are the top words with their count and per-file counts: untick a row to drop the word, or fold synonyms together — easiest with the “merge” setting (one rule per line or comma: “顾客=客户”, “顾客 客人=客户”, “AI=人工智能”; works for any word, even ones not listed in the reply), or per row with mergeInto. Stopwords match case-insensitively (AI, ai). Exports an XLSX (totals + per-file), a CSV and the word cloud as SVG and PNG.",
    inputs: { exts: [".txt", ".md", ".markdown"], min: 0, max: 50, folders: true, label: ["选择文本文件或文件夹", "Pick text files or a folder"] },
    settings: [
      { key: "stopwords", label: ["自定义停用词", "Extra stopwords"], type: "textarea", default: "", reload: true },
      { key: "merge", label: ["合并同义词（每行 顾客=客户）", "Merge words (one per line: 顾客=客户)"], type: "textarea", default: "" },
      { key: "builtinStop", label: ["使用内置停用词", "Use built-in stopwords"], type: "bool", default: true, reload: true },
      { key: "minLen", label: ["中文词最少字数", "Min Chinese word length"], type: "number", default: 2, min: 1, max: 6, reload: true },
      { key: "ngram", label: ["词组", "Phrases"], type: "select", default: "1", options: [{ value: "1", label: ["只统计单词", "Single words"] }, { value: "2", label: ["加二元词组", "+ 2-word phrases"] }, { value: "3", label: ["加三元词组", "+ 2/3-word phrases"] }], reload: true },
      { key: "numbers", label: ["统计数字", "Count numbers"], type: "bool", default: false, reload: true },
      { key: "cloudWords", label: ["词云词数", "Words in cloud"], type: "number", default: 80, min: 5, max: 300 },
      { key: "shape", label: ["词云形状", "Cloud shape"], type: "select", default: "rect", options: [{ value: "rect", label: ["矩形", "Rectangle"] }, { value: "wide", label: ["横幅", "Banner"] }, { value: "circle", label: ["椭圆", "Ellipse"] }] },
      { key: "palette", label: ["配色", "Colours"], type: "select", default: "vivid", options: [{ value: "vivid", label: ["多彩", "Vivid"] }, { value: "ocean", label: ["海洋", "Ocean"] }, { value: "warm", label: ["暖色", "Warm"] }, { value: "mono", label: ["单色", "Mono"] }] },
      { key: "rotate", label: ["部分词竖排", "Rotate some words"], type: "bool", default: true },
      { key: "background", label: ["背景色", "Background"], type: "color", default: "#ffffff" },
      { key: "width", label: ["图片宽度", "Image width"], type: "number", default: 1200, min: 400, max: 4000 },
    ],
    columns: () => [
      { key: "include", label: ["保留", "Keep"], type: "bool" },
      { key: "word", label: ["词", "Word"], readOnly: true },
      { key: "count", label: ["次数", "Count"], type: "number", readOnly: true },
      { key: "_share", label: ["占比", "Share"], readOnly: true },
      { key: "_docs", label: ["出现文件数", "Files"], type: "number", readOnly: true },
      { key: "mergeInto", label: ["合并到", "Merge into"] },
      { key: "_total", label: ["合并后次数", "Merged total"], readOnly: true },
    ],
    async load({ ws, files, settings, previous }) {
      if (!files.length) return { rows: [] };
      const EXTS = [".txt", ".md", ".markdown"];
      const all: string[] = [];
      for (const f of files) {
        if (EXTS.some((e) => f.toLowerCase().endsWith(e))) all.push(f);
        else all.push(...(await ws.list({ dir: f, exts: EXTS, limit: 500 })).map((x) => x.path));
      }
      all.splice(0, all.length, ...[...new Set(all)].filter(notOutput(NAME)));
      if (!all.length) throw new KitError("no_text", "No .txt or .md files found.");
      const docs = await Promise.all(all.map(async (f) => ({ name: f, text: (await ws.readText(f)).replace(/^---\n[\s\S]*?\n---\n/, "").replace(/```[\s\S]*?```/g, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "") })));
      const { list, total } = countWords(docs, { stop: stopSet(settings), minLen: Number(settings.minLen ?? 2), ngram: Number(settings.ngram ?? 1), numbers: yes(settings.numbers) });
      const prev = new Map((previous ?? []).map((r) => [s(r.word), r]));
      const rows: Row[] = list.slice(0, MAX_ROWS).map((c) => ({ include: prev.get(c.word)?.include ?? true, word: c.word, count: c.count, files: c.files, mergeInto: s(prev.get(c.word)?.mergeInto) }));
      return { rows, meta: { total, distinct: list.length, files: all } };
    },
    compute(p): Computed {
      const issues: Issue[] = [];
      const words = new Set(p.rows.map((r) => s(r.word)));
      const total = Number(p.meta.total) || 1;
      p.rows.forEach((r, i) => {
        const m = s(r.mergeInto);
        if (m && m === s(r.word)) issues.push({ level: "warn", row: i, key: "mergeInto", message: `“${m}” is merged into itself.` });
        else if (m && !words.has(m)) issues.push({ level: "info", row: i, key: "mergeInto", message: `“${s(r.word)}” → “${m}”: “${m}” is a new word (not in the list) — fine for renaming.` });
        else if (m && p.rows.some((x) => s(x.word) === m && s(x.mergeInto))) issues.push({ level: "error", row: i, key: "mergeInto", message: `“${m}” is itself merged into another word — point “${s(r.word)}” at the final word.` });
      });
      const rules = mergeRules(p.settings.merge), lower = new Set(p.rows.map((r) => s(r.word).toLowerCase()));
      for (const [w, t] of rules) if (!lower.has(w)) issues.push({ level: "warn", message: `Merge rule “${w}=${t}”: “${w}” isn't among the counted words (check the spelling, or it may be a stopword).` });
      const m = merged(p), cloud = cloudSvg(p);
      const totals = new Map(m.map((w) => [w.word, w.count]));
      if (cloud.placed < cloud.wanted) issues.push({ level: "info", message: `Only ${cloud.placed} of ${cloud.wanted} words fit in the cloud — widen the image or lower “words in cloud”.` });
      const nfiles = ((p.meta.files as string[] | undefined) ?? []).length;
      const docsOf = (i: number) => Object.keys((p.rows[i].files as Record<string, number>) ?? {}).length;
      return {
        rows: p.rows.map((r, i) => { const t = targetOf(r, rules); return { ...r, _share: `${((Number(r.count) / total) * 100).toFixed(2)}%`, _docs: docsOf(i), _into: t !== s(r.word) ? t : "", _total: r.include === false ? "" : t === s(r.word) ? totals.get(t) ?? "" : "" }; }),
        issues,
        summary: `${nfiles} file(s), ${p.meta.total ?? 0} counted word(s), ${p.meta.distinct ?? 0} distinct; top: ${m.slice(0, 8).map((w) => `${w.word} ${w.count}`).join(", ")}.`,
        stats: { files: nfiles, words: Number(p.meta.total) || 0, distinct: Number(p.meta.distinct) || 0, shown: m.length },
        preview: cloud.svg.replace(/^<svg /, `<svg style="max-width:100%;height:auto" `),
      };
    },
    exports: [
      {
        id: "xlsx", label: ["词频表 XLSX", "Frequencies (XLSX)"], description: "word-frequency.xlsx — totals and per-file counts",
        async run({ project, write }: ExportCtx) {
          const m = merged(project), files = (project.meta.files as string[]) ?? [], total = Number(project.meta.total) || 1;
          return [await write("word-frequency.xlsx", await writeXlsx([
            { name: "词频", headers: ["排名", "词", "次数", "占比", "出现文件数"], rows: m.map((w, i) => [i + 1, w.word, w.count, w.count / total, Object.keys(w.files).length]), numberFormat: { 3: "0.00%" }, widths: [6, 20, 8, 8, 10] },
            { name: "按文件", headers: ["词", ...files.map((f) => f.split("/").pop()!)], rows: m.map((w) => [w.word, ...files.map((f) => w.files[f] ?? 0)]) },
          ]))];
        },
      },
      { id: "csv", label: ["词频 CSV", "Frequencies (CSV)"], description: "word-frequency.csv", async run({ project, write }: ExportCtx) { return [await write("word-frequency.csv", "\ufeffword,count\n" + merged(project).map((w) => `"${w.word.replace(/"/g, '""')}",${w.count}`).join("\n") + "\n")]; } },
      { id: "svg", label: ["词云 SVG", "Word cloud (SVG)"], description: "wordcloud.svg", async run({ project, write }: ExportCtx) { return [await write("wordcloud.svg", cloudSvg(project).svg)]; } },
      {
        id: "png", label: ["词云 PNG", "Word cloud (PNG)"], description: "wordcloud.png",
        async run({ project, write }: ExportCtx) { const f = await fontsFor(assetRoot, "WORD_FREQUENCY_FONT"); const svg = cloudSvg(project, f.family).svg; return [await write("wordcloud.png", await svgToPng(assetRoot, svg, Number(project.settings.width) || 1200, "WORD_FREQUENCY_FONT"))]; },
      },
    ],
    describeRow: (r, i) => `#${i}${r.include === false ? " [dropped]" : ""} ${s(r.word)} ×${s(r.count)}${s(r._into) ? ` → ${s(r._into)}` : ""}${s(r._total) !== "" && Number(r._total) !== Number(r.count) ? ` (merged total ${s(r._total)})` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
