import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { readTable } from "./kit/table.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { KitError } from "./kit/workspace.ts";
import { extract } from "./terms.ts";
import { notOutput, s, yes } from "./util.ts";

export const NAME = "glossary-builder";
export const VERSION = "0.1.0";
const TEXT = [".txt", ".md", ".markdown"], TABLE = [".csv", ".xlsx", ".tsv"];
const ALIAS = { term: ["术语", "原文", "中文", "词条", "term", "source", "source term"], translation: ["译文", "英文", "翻译", "译名", "translation", "target", "english"], note: ["备注", "说明", "note", "comment"] };
const isZh = (w: string) => /[\u4e00-\u9fff]/.test(w);

async function expand(ws: Parameters<AppDef["load"]>[0]["ws"], files: string[]) {
  const out: string[] = [];
  for (const f of files) {
    if ([...TEXT, ...TABLE].some((e) => f.toLowerCase().endsWith(e))) out.push(f);
    else out.push(...(await ws.list({ dir: f, exts: [...TEXT, ...TABLE], limit: 500 })).map((x) => x.path));
  }
  return [...new Set(out)].filter(notOutput(NAME));
}

const key = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

const DEF: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "glossary",
  title: ["术语表整理", "Glossary Builder"],
  openDescription:
    "Build a bilingual glossary from documents (.txt/.md files or a folder, Chinese and/or English). Candidate terms are multi-word phrases and compounds that recur (n-gram frequency with nested-term dedupe); translations are picked up automatically from in-text pairs like 会员积分（Loyalty Points） or Coupon（优惠券）, and from an existing glossary CSV/XLSX if one is among the inputs (columns 术语/term, 译文/translation, 备注/note). Rows: term, translation, frequency, files, an example sentence, keep, note. Untick noise, type or fix translations, add terms by hand. Warns when the existing glossary and the documents disagree on a translation, and about duplicate terms. Exports XLSX, CSV, TBX (for CAT tools such as Trados/memoQ) and Markdown.",
  inputs: { exts: [...TEXT, ...TABLE], min: 0, max: 50, folders: true, label: ["选择资料（文本/Markdown，可含旧术语表）", "Pick documents (and an existing glossary)"] },
  settings: [
    { key: "title", label: ["术语表名称", "Glossary name"], type: "text", default: "术语表" },
    { key: "sourceLang", label: ["源语言", "Source language"], type: "select", default: "zh", options: [{ value: "zh", label: ["中文", "Chinese"] }, { value: "en", label: ["英文", "English"] }], reload: true },
    { key: "targetLang", label: ["目标语言代码", "Target language code"], type: "text", default: "en" },
    { key: "minFreq", label: ["最少出现次数", "Minimum frequency"], type: "number", default: 2, min: 1, max: 20, reload: true },
    { key: "maxTerms", label: ["最多候选词", "Max candidates"], type: "number", default: 200, min: 10, max: 1000, reload: true },
    { key: "exclude", label: ["排除的词（空格分隔）", "Exclude words (space separated)"], type: "textarea", default: "", reload: true },
    { key: "keptOnly", label: ["导出时只要勾选的", "Export kept terms only"], type: "bool", default: true },
  ],
  columns: () => [
    { key: "keep", label: ["保留", "Keep"], type: "bool" },
    { key: "term", label: ["术语", "Term"] },
    { key: "translation", label: ["译文", "Translation"] },
    { key: "freq", label: ["次数", "Count"], type: "number", readOnly: true },
    { key: "files", label: ["文件数", "Files"], type: "number", readOnly: true },
    { key: "context", label: ["例句", "Example"], readOnly: true, wide: true },
    { key: "note", label: ["备注", "Note"] },
    { key: "_source", label: ["译文来源", "Translation from"], readOnly: true },
  ],
  newRow: () => ({ keep: true, term: "", translation: "", freq: 0, files: 0, context: "", note: "", source: "manual" }),
  async load({ ws, files, settings, previous }) {
    if (!files.length) return { rows: [] };
    const all = await expand(ws, files);
    const texts = all.filter((f) => TEXT.some((e) => f.toLowerCase().endsWith(e))), tables = all.filter((f) => TABLE.some((e) => f.toLowerCase().endsWith(e)));
    if (!texts.length) throw new KitError("no_text", "No .txt or .md documents among the inputs.");
    const old = new Map<string, { term: string; translation: string; note: string; file: string }>();
    for (const f of tables) {
      const t = await readTable(ws, f);
      const m = mapHeaders(t.columns, ALIAS);
      const tc = m.term ?? t.columns[0], tr = m.translation ?? t.columns[1];
      for (const r of t.rows) if (s(r[tc])) old.set(key(s(r[tc])), { term: s(r[tc]), translation: s(r[tr]), note: m.note ? s(r[m.note]) : "", file: f });
    }
    const docs = await Promise.all(texts.map(async (f) => ({ name: f, text: await ws.readText(f) })));
    const src = s(settings.sourceLang) || "zh";
    const cands = extract(docs, { minFreq: Number(settings.minFreq ?? 2), max: Number(settings.maxTerms ?? 200) * 2, stop: new Set(s(settings.exclude).split(/[\s,，、]+/).filter(Boolean).map((w) => w.toLowerCase())) });
    const rows: Row[] = [];
    const seen = new Set<string>();
    const inSrc = (t: string) => (src === "zh" ? isZh(t) : !isZh(t));
    for (const c of cands) {
      let term = c.term, tr = c.pair ?? "";
      if (!inSrc(term)) { if (c.pair && inSrc(c.pair)) { term = c.pair; tr = c.term; } else if (src === "zh" && !c.pair) tr = ""; else continue; }
      if (seen.has(key(term))) continue;
      seen.add(key(term));
      const other = cands.find((d) => key(d.term) === key(term));
      const o = old.get(key(term));
      rows.push({ keep: true, term, translation: o?.translation || tr, freq: other?.freq ?? c.freq, files: (other ?? c).docs.size, context: (other ?? c).context, note: o?.note ?? "", source: o?.translation ? "glossary" : tr ? "document" : "", docPair: tr, oldPair: o?.translation ?? "" });
      if (rows.length >= Number(settings.maxTerms ?? 200)) break;
    }
    for (const [k, o] of old) if (!seen.has(k)) rows.push({ keep: true, term: o.term, translation: o.translation, freq: 0, files: 0, context: "", note: o.note, source: "glossary", docPair: "", oldPair: o.translation });
    const prev = new Map((previous ?? []).map((r) => [key(s(r.term)), r]));
    for (const r of rows) { const p = prev.get(key(s(r.term))); if (p) { r.keep = p.keep; if (s(p.translation)) r.translation = p.translation; r.note = p.note; } }
    for (const p of previous ?? []) if (s(p.source) === "manual" && !rows.some((r) => key(s(r.term)) === key(s(p.term)))) rows.push(p);
    return { rows, meta: { files: texts, glossaries: tables } };
  },
  compute(p): Computed {
    const issues: Issue[] = [];
    const seen = new Map<string, number>();
    p.rows.forEach((r, i) => {
      const t = s(r.term);
      if (!t) { issues.push({ level: "error", row: i, key: "term", message: "Empty term — delete the row or fill it in." }); return; }
      if (seen.has(key(t))) issues.push({ level: "error", row: i, key: "term", message: `“${t}” is listed twice (rows ${seen.get(key(t))} and ${i}) — remove one.` });
      seen.set(key(t), i);
      if (s(r.oldPair) && s(r.docPair) && key(s(r.oldPair)) !== key(s(r.docPair)) && key(s(r.translation)) === key(s(r.oldPair))) issues.push({ level: "warn", row: i, key: "translation", message: `${t}: the old glossary says “${s(r.oldPair)}” but the documents use “${s(r.docPair)}” — pick one.` });
    });
    const kept = p.rows.filter((r) => r.keep !== false && s(r.term));
    const missing = kept.filter((r) => !s(r.translation)).length;
    if (missing) issues.push({ level: "info", message: `${missing} kept term(s) have no translation yet.` });
    return {
      rows: p.rows.map((r) => ({ ...r, _source: s(r.source) === "glossary" ? "旧术语表" : s(r.source) === "document" ? "文档对照" : s(r.source) === "manual" ? "手动" : "" })),
      issues,
      summary: `${p.rows.length} candidate term(s) from ${((p.meta.files as string[]) ?? []).length} document(s); ${kept.length} kept, ${kept.length - missing} translated.`,
      stats: { candidates: p.rows.length, kept: kept.length, translated: kept.length - missing },
      preview: `<table><tr><th>术语</th><th>译文</th><th>次数</th></tr>${kept.slice(0, 40).map((r) => `<tr><td>${esc(s(r.term))}</td><td>${esc(s(r.translation))}</td><td>${esc(s(r.freq))}</td></tr>`).join("")}</table>`,
    };
  },
  exports: [
    {
      id: "xlsx", label: ["术语表 XLSX", "Glossary (XLSX)"], description: "glossary.xlsx",
      async run({ project, write }: ExportCtx) {
        const rows = list(project);
        return [await write("glossary.xlsx", await writeXlsx([{ name: s(project.settings.title) || "Glossary", headers: ["术语 Term", "译文 Translation", "备注 Note", "次数 Count", "例句 Example"], rows: rows.map((r) => [s(r.term), s(r.translation), s(r.note), Number(r.freq) || 0, s(r.context)]), widths: [24, 28, 20, 8, 70], marks: rows.flatMap((r, row) => (s(r.translation) ? [] : [{ row, col: 1, color: "FFFFF3C4" }])) }]))];
      },
    },
    { id: "csv", label: ["CSV", "CSV"], description: "glossary.csv — term, translation, note", async run({ project, write }: ExportCtx) { const q = (v: string) => `"${v.replace(/"/g, '""')}"`; return [await write("glossary.csv", "\ufeffterm,translation,note\n" + list(project).map((r) => [s(r.term), s(r.translation), s(r.note)].map(q).join(",")).join("\n") + "\n")]; } },
    {
      id: "tbx", label: ["TBX（翻译软件）", "TBX (CAT tools)"], description: "glossary.tbx — TBX-Basic for Trados, memoQ, Phrase",
      async run({ project, write }: ExportCtx) {
        const src = s(project.settings.sourceLang) || "zh", tgt = s(project.settings.targetLang) || (src === "zh" ? "en" : "zh");
        const x = (v: string) => esc(v);
        const entries = list(project).map((r, i) => `      <termEntry id="t${i + 1}">${s(r.note) ? `\n        <descrip type="definition">${x(s(r.note))}</descrip>` : ""}
        <langSet xml:lang="${src}"><tig><term>${x(s(r.term))}</term></tig></langSet>${s(r.translation) ? `\n        <langSet xml:lang="${tgt}"><tig><term>${x(s(r.translation))}</term></tig></langSet>` : ""}
      </termEntry>`).join("\n");
        return [await write("glossary.tbx", `<?xml version="1.0" encoding="UTF-8"?>\n<martif type="TBX-Basic" xml:lang="${src}">\n  <martifHeader><fileDesc><sourceDesc><p>${x(s(project.settings.title) || "Glossary")}</p></sourceDesc></fileDesc></martifHeader>\n  <text>\n    <body>\n${entries}\n    </body>\n  </text>\n</martif>\n`)];
      },
    },
    { id: "md", label: ["Markdown", "Markdown"], description: "glossary.md", async run({ project, write }: ExportCtx) { const c = (v: string) => v.replace(/\|/g, "\\|"); return [await write("glossary.md", `# ${s(project.settings.title) || "术语表"}\n\n| 术语 | 译文 | 备注 |\n|---|---|---|\n${list(project).map((r) => `| ${c(s(r.term))} | ${c(s(r.translation))} | ${c(s(r.note))} |`).join("\n")}\n`)]; } },
  ],
  describeRow: (r, i) => `#${i}${r.keep === false ? " [dropped]" : ""} ${s(r.term)} = ${s(r.translation) || "?"} (×${s(r.freq)})${s(r.note) ? ` note=${s(r.note)}` : ""}`,
};

function list(p: Project) {
  const rows = p.rows.filter((r) => s(r.term) && (!yes(p.settings.keptOnly ?? true) || r.keep !== false));
  return rows.sort((a, b) => s(a.term).localeCompare(s(b.term), "zh-Hans-CN-u-co-pinyin"));
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(DEF, options).server;
}
