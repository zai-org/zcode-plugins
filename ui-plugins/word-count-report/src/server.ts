import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { KitError } from "./kit/workspace.ts";
import { add, count, fmtMinutes, minutes, ZERO, type Counts } from "./count.ts";
import { fromDocx, fromMarkdown, fromPdf, fromText, sections, type Para, type Section } from "./extract.ts";

export const NAME = "word-count-report";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const EXTS = [".docx", ".md", ".markdown", ".txt", ".pdf"];
const r2 = (x: number) => Math.round(x * 100) / 100;

type Meta = { sections: Section[]; failed: { file: string; error: string }[]; files: string[] };

function compileRules(text: string): { test: (t: string) => boolean; errors: string[] } {
  const errors: string[] = [];
  const rules = String(text ?? "").split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^\/(.+)\/([gimsuy]*)$/.exec(l);
    if (m) { try { return new RegExp(m[1], m[2].replace("g", "")); } catch { errors.push(l); return undefined; } }
    return l;
  }).filter((x): x is string | RegExp => x !== undefined);
  return { test: (t) => rules.some((r) => (typeof r === "string" ? t.includes(r) : r.test(t))), errors };
}

/** 一个章节在当前规则下要统计的文字。 */
function countable(sec: Section, settings: Record<string, unknown>, rule: (t: string) => boolean): { text: string; dropped: number } {
  let dropped = 0;
  const keep = (p: Para) => {
    if (p.k === "code" && settings.code === false) return false;
    if (p.k === "table" && settings.tables === false) return false;
    if (p.k === "heading" && settings.headings === false) return false;
    if (rule(p.t)) return false;
    return true;
  };
  const text = sec.paras.filter((p) => { const k = keep(p); if (!k) dropped++; return k; }).map((p) => p.t).join("\n");
  return { text, dropped };
}

function analyse(p: Pick<Project, "rows" | "settings" | "meta">) {
  const meta = p.meta as Meta;
  const { test, errors } = compileRules(s(p.settings.exclude));
  const stop = s(p.settings.stopAt) ? (() => { try { return new RegExp(`^\\s*(${s(p.settings.stopAt)})\\s*$`, "i"); } catch { errors.push(s(p.settings.stopAt)); return undefined; } })() : undefined;
  const numbers = p.settings.numbers !== false;
  let stopFile = "";
  const per = p.rows.map((r) => {
    const sec = meta.sections[Number(r._sec)];
    if (!sec) return { r, c: ZERO, dropped: 0, auto: false };
    if (stop && sec.title && stop.test(sec.title)) stopFile = sec.file;
    const auto = !!stopFile && stopFile === sec.file;
    if (stopFile && stopFile !== sec.file) stopFile = "";
    const { text, dropped } = countable(sec, p.settings, test);
    return { r, c: count(text, { numbers }), dropped, auto };
  });
  return { per, errors };
}

const BILL: Record<string, keyof Counts> = { words: "words", cjk: "cjk", latin: "latin", chars: "chars" };

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "wordcount",
  title: ["字数统计", "Word Count Report"],
  openDescription:
    "Count words in documents (.docx, .md, .txt, .pdf — files or whole folders) the way Word does for Chinese: CJK characters, CJK punctuation and Latin words counted separately; 字数 = CJK characters + CJK punctuation + other words. Splits each file into chapters (DOCX heading styles, Markdown #/##, “第一章 / Chapter 1” lines in TXT and PDF) and adds reading time and an optional fee (settings.rate per 1,000 of billBy: words/cjk/latin/chars). Exclude parts by switching rows off, by settings.exclude (one text or /regex/ per line; matching paragraphs are dropped), by toggles for code blocks, tables and headings, or by settings.stopAt (sections from a heading such as 参考文献|References onward). Exports word-count.xlsx and word-count.csv.",
  inputs: { exts: EXTS, min: 1, max: 500, folders: true, label: ["选择文档或文件夹", "Pick documents or a folder"] },
  settings: [
    { key: "split", label: ["统计粒度", "Rows"], type: "select", default: "chapter", reload: true, options: [{ value: "chapter", label: ["按章节", "Per chapter"] }, { value: "file", label: ["按文件", "Per file"] }] },
    { key: "chapterLevel", label: ["章节标题级别", "Chapter heading level"], type: "number", default: 2, min: 1, max: 6, reload: true, help: ["1 = 只按一级标题分章；2 = 一、二级标题", "1 = top-level headings only; 2 = levels 1–2"] },
    { key: "exclude", label: ["排除内容", "Exclude paragraphs"], type: "textarea", default: "", help: ["每行一条文字或 /正则/，包含它的段落不计数", "One text or /regex/ per line; matching paragraphs aren't counted"] },
    { key: "stopAt", label: ["从这些标题起不计", "Stop counting at heading"], type: "text", default: "参考文献|References|Bibliography|致谢|Acknowledg(e)?ments", help: ["正则；标题匹配的章节及之后（同一文件）不计", "Regex; that section and later ones in the same file are left out"] },
    { key: "code", label: ["统计代码块", "Count code blocks"], type: "bool", default: false },
    { key: "tables", label: ["统计表格", "Count tables"], type: "bool", default: true },
    { key: "headings", label: ["统计标题", "Count headings"], type: "bool", default: true },
    { key: "numbers", label: ["数字算作词", "Count numbers as words"], type: "bool", default: true },
    { key: "cjkPerMin", label: ["中文阅读速度（字/分钟）", "Chinese reading speed (chars/min)"], type: "number", default: 400, min: 50 },
    { key: "wpm", label: ["英文阅读速度（词/分钟）", "Reading speed (words/min)"], type: "number", default: 230, min: 50 },
    { key: "rate", label: ["单价（每千）", "Rate per 1,000"], type: "number", default: 0, min: 0, help: ["0 = 不计费", "0 = no fee"] },
    { key: "billBy", label: ["计费依据", "Bill by"], type: "select", default: "words", options: [{ value: "words", label: ["字数（Word 口径）", "Word count (字数)"] }, { value: "cjk", label: ["中文字符", "CJK characters"] }, { value: "latin", label: ["英文单词", "Latin words"] }, { value: "chars", label: ["字符数（不含空格）", "Characters (no spaces)"] }] },
    { key: "currency", label: ["货币符号", "Currency"], type: "text", default: "¥" },
  ],
  columns: () => [
    { key: "include", label: ["计入", "Count"], type: "bool" },
    { key: "file", label: ["文件", "File"], readOnly: true },
    { key: "chapter", label: ["章节", "Chapter"], readOnly: true, wide: true },
    { key: "words", label: ["字数", "Words (字数)"], type: "number", readOnly: true },
    { key: "cjk", label: ["中文字符", "CJK chars"], type: "number", readOnly: true },
    { key: "latin", label: ["英文单词", "Latin words"], type: "number", readOnly: true },
    { key: "punct", label: ["中文标点", "CJK punct."], type: "number", readOnly: true },
    { key: "chars", label: ["字符(不含空格)", "Chars (no spaces)"], type: "number", readOnly: true },
    { key: "time", label: ["阅读时长", "Reading time"], readOnly: true },
    { key: "fee", label: ["费用", "Fee"], type: "number", readOnly: true },
  ] as Column[],
  async load({ ws, files, settings }) {
    const list: string[] = [];
    for (const f of files) {
      if (EXTS.some((e) => f.toLowerCase().endsWith(e))) list.push(f);
      else for (const x of await ws.list({ dir: f, exts: EXTS, limit: 5000 })) list.push(x.path);
    }
    const uniq = [...new Set(list)].filter((f) => !/(^|\/)(~\$|\.)/.test(f)).sort((a, b) => a.localeCompare(b, "zh"));
    if (!uniq.length) throw new KitError("no_files", `No ${EXTS.join(" ")} files found.`);
    const secs: Section[] = [], failed: Meta["failed"] = [];
    const level = Math.max(1, Math.min(6, Number(settings.chapterLevel ?? 2)));
    for (const f of uniq) {
      try {
        const bytes = await ws.read(f, 100 * 1024 * 1024);
        const lower = f.toLowerCase();
        const paras = lower.endsWith(".docx") ? fromDocx(bytes) : lower.endsWith(".pdf") ? await fromPdf(bytes) : /\.(md|markdown)$/.test(lower) ? fromMarkdown(bytes.toString("utf8")) : fromText(bytes.toString("utf8"));
        if (s(settings.split) === "file") secs.push({ file: f, title: "", level: 0, paras });
        else secs.push(...sections(f, paras, level));
      } catch (e) { failed.push({ file: f, error: (e as Error).message }); }
    }
    if (!secs.length) throw new KitError("unreadable", `Could not read any file: ${failed.map((x) => `${x.file} (${x.error})`).join("; ")}`);
    const rows: Row[] = secs.map((sec, i) => ({ _sec: i, include: true, file: sec.file, chapter: sec.title || (s(settings.split) === "file" ? "（全文）" : "（开头 / start）") }));
    const meta: Meta = { sections: secs, failed, files: uniq };
    return { rows, meta };
  },
  compute(p): Computed {
    const meta = p.meta as Meta, issues: Issue[] = [];
    const { per, errors } = analyse(p);
    for (const e of errors) issues.push({ level: "error", message: `Can't read the rule “${e}” as a regular expression / 规则不是有效的正则` });
    for (const f of meta.failed) issues.push({ level: "warn", message: `${f.file}: ${f.error} / 无法读取` });
    const rate = Number(p.settings.rate ?? 0), bill = BILL[s(p.settings.billBy)] ?? "words", cur = s(p.settings.currency) || "¥";
    const cpm = Number(p.settings.cjkPerMin ?? 400), wpm = Number(p.settings.wpm ?? 230);
    let total = ZERO, autoOff = 0;
    const rows: Row[] = per.map(({ r, c, dropped, auto }, i): Row => {
      const on = r.include !== false && !auto;
      if (auto && r.include !== false) autoOff++;
      if (on) total = add(total, c);
      if (dropped && on) issues.push({ level: "info", row: i, message: `${s(r.chapter)}: ${dropped} paragraph(s) left out by the exclude rules / 排除 ${dropped} 段` });
      return { ...r, chapter: auto && r.include !== false ? `${s(r.chapter)}（不计 · not counted）` : r.chapter, words: c.words, cjk: c.cjk, latin: c.latin, punct: c.punct, chars: c.chars, time: fmtMinutes(minutes(c, cpm, wpm)), fee: rate && on ? r2((c[bill] / 1000) * rate) : "", _off: !on };
    });
    if (autoOff) issues.push({ level: "info", message: `${autoOff} section(s) from “${s(p.settings.stopAt)}” onward are not counted / ${autoOff} 个章节按“从这些标题起不计”排除` });
    const scanned = meta.sections.filter((x) => x.file.toLowerCase().endsWith(".pdf") && !x.paras.length).map((x) => x.file);
    for (const f of new Set(scanned)) issues.push({ level: "warn", message: `${f} has no text layer (scanned?) — it counts as 0 / PDF 没有文字层` });
    const fee = rate ? r2((total[bill] / 1000) * rate) : 0;
    const byFile = new Map<string, number>();
    rows.forEach((r, i) => { if (!r._off) byFile.set(s(r.file), (byFile.get(s(r.file)) ?? 0) + per[i].c.words); });
    const maxF = Math.max(1, ...byFile.values());
    return {
      rows,
      issues,
      summary: `${total.words.toLocaleString("en")} words (字数) in ${meta.files.length} file(s): ${total.cjk.toLocaleString("en")} CJK chars, ${total.latin.toLocaleString("en")} Latin words; reading ≈ ${fmtMinutes(minutes(total, cpm, wpm))}${rate ? `; fee ${cur}${fee.toLocaleString("en")}` : ""}. 共 ${total.words.toLocaleString("en")} 字。`,
      stats: { files: meta.files.length, sections: rows.length, words: total.words, cjk: total.cjk, latin: total.latin, punct: total.punct, chars: total.chars, minutes: Math.round(minutes(total, cpm, wpm)), fee },
      preview: `<div style="font-size:12px"><div style="font-size:28px;font-weight:700">${total.words.toLocaleString("en")} <span style="font-size:13px;font-weight:400" class="muted">字 / words</span></div><div class="muted">中文 ${total.cjk.toLocaleString("en")} · 英文词 ${total.latin.toLocaleString("en")} · 标点 ${total.punct.toLocaleString("en")} · 字符 ${total.chars.toLocaleString("en")} · ≈ ${esc(fmtMinutes(minutes(total, cpm, wpm)))}${rate ? ` · ${esc(cur)}${fee}` : ""}</div><table style="margin-top:8px;width:100%">${[...byFile].map(([f, n]) => `<tr><td style="white-space:nowrap;padding-right:8px">${esc(f.split("/").pop()!)}</td><td style="width:60%"><div style="background:#3b82f6;height:10px;border-radius:3px;width:${((n / maxF) * 100).toFixed(1)}%"></div></td><td style="text-align:right">${n.toLocaleString("en")}</td></tr>`).join("")}</table></div>`,
    };
  },
  exports: [
    {
      id: "xlsx", label: ["统计表 Excel", "Report (Excel)"], description: "word-count.xlsx — per chapter, per file and totals, with reading time and fee",
      async run({ project, write, computed }: ExportCtx) {
        const rows = (computed.rows ?? []) as Row[];
        const on = rows.filter((r) => !r._off);
        const files = [...new Set(rows.map((r) => s(r.file)))];
        const sum = (list: Row[], k: string) => list.reduce((a, r) => a + Number(r[k] || 0), 0);
        const st = computed.stats as Record<string, number>;
        const cur = s(project.settings.currency) || "¥";
        const xlsx = await writeXlsx([
          { name: "按章节 By chapter", headers: ["计入 Counted", "文件 File", "章节 Chapter", "字数 Words", "中文字符 CJK", "英文单词 Latin", "中文标点 Punct.", "字符(不含空格) Chars", "阅读时长 Reading", `费用 Fee (${cur})`], rows: rows.map((r) => [r._off ? "否 no" : "是 yes", s(r.file), s(r.chapter), r.words, r.cjk, r.latin, r.punct, r.chars, s(r.time), r.fee === "" ? "" : r.fee]), marks: rows.flatMap((r, i) => (r._off ? [{ row: i, col: 0, color: "#E5E7EB" }] : [])) },
          { name: "按文件 By file", headers: ["文件 File", "章节数 Chapters", "字数 Words", "中文字符 CJK", "英文单词 Latin", "中文标点 Punct.", "字符(不含空格) Chars", `费用 Fee (${cur})`], rows: files.map((f) => { const l = on.filter((r) => s(r.file) === f); return [f, l.length, sum(l, "words"), sum(l, "cjk"), sum(l, "latin"), sum(l, "punct"), sum(l, "chars"), Number(project.settings.rate) ? r2(sum(l, "fee")) : ""]; }) },
          { name: "汇总 Totals", headers: ["项目 Item", "数值 Value"], rows: [["文件 Files", st.files], ["字数 Words (CJK + punct. + other words)", st.words], ["中文字符 CJK characters", st.cjk], ["中文标点 CJK punctuation", st.punct], ["英文单词 Latin words", st.latin], ["字符(不含空格) Characters", st.chars], ["阅读时长（分钟） Reading minutes", st.minutes], ...(Number(project.settings.rate) ? [[`费用 Fee (${cur}, ${project.settings.rate} / 1000 ${s(project.settings.billBy) || "words"})`, st.fee]] : [])] },
        ]);
        return [await write("word-count.xlsx", xlsx)];
      },
    },
    {
      id: "csv", label: ["统计 CSV", "Report (CSV)"], description: "word-count.csv — one row per chapter",
      async run({ write, computed }: ExportCtx) {
        const rows = (computed.rows ?? []) as Row[];
        return [await write("word-count.csv", toCsv(["counted", "file", "chapter", "words", "cjk", "latin", "punct", "chars", "reading_time", "fee"], rows.map((r) => [r._off ? "no" : "yes", s(r.file), s(r.chapter), r.words, r.cjk, r.latin, r.punct, r.chars, s(r.time), r.fee])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i}${r.include === false ? " [off]" : ""} ${s(r.file)} · ${s(r.chapter)}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
