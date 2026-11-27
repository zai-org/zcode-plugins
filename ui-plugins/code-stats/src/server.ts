import { createApp, esc, htmlPage, htmlTable, toCsv, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { KitError } from "./kit/workspace.ts";
import { CODE_EXTS, countLines, excludeMatcher, gitignoreMatcher, langOf } from "./count.ts";
import { s } from "./util.ts";

export const NAME = "code-stats";
export const VERSION = "0.1.0";

type Agg = { key: string; files: number; lines: number; code: number; comment: number; blank: number };
const add = (m: Map<string, Agg>, key: string, r: Row) => {
  const a = m.get(key) ?? { key, files: 0, lines: 0, code: 0, comment: 0, blank: 0 };
  a.files++; a.lines += Number(r.lines) || 0; a.code += Number(r.code) || 0; a.comment += Number(r.comment) || 0; a.blank += Number(r.blank) || 0;
  m.set(key, a);
};
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "0%");

function analyse(p: Project) {
  const ex = excludeMatcher(s(p.settings.exclude));
  const rel = (r: Row) => s(r._rel) || s(r.path);
  const kept = p.rows.filter((r) => r.include !== false && !ex.test(rel(r)));
  const langs = new Map<string, Agg>(), folders = new Map<string, Agg>();
  const depth = Math.max(1, Number(p.settings.folderDepth) || 1);
  for (const r of kept) {
    add(langs, s(r.language), r);
    add(folders, rel(r).split("/").slice(0, -1).slice(0, depth).join("/") || ".", r);
  }
  const by = (m: Map<string, Agg>) => [...m.values()].sort((a, b) => b.code - a.code || a.key.localeCompare(b.key));
  const zero = { files: 0, lines: 0, code: 0, comment: 0, blank: 0 };
  const total = kept.reduce((t: typeof zero, r) => ({ files: t.files + 1, lines: t.lines + (Number(r.lines) || 0), code: t.code + (Number(r.code) || 0), comment: t.comment + (Number(r.comment) || 0), blank: t.blank + (Number(r.blank) || 0) }), zero);
  const top = Math.max(1, Number(p.settings.topN) || 10);
  const largest = [...kept].sort((a, b) => (Number(b.code) || 0) - (Number(a.code) || 0)).slice(0, top);
  return { kept, langs: by(langs), folders: by(folders), total, largest, excluded: p.rows.length - kept.length };
}

const COLORS = ["#2563eb", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#64748b"];
function barSvg(langs: Agg[]) {
  const rows = langs.slice(0, 12), max = Math.max(1, ...rows.map((l) => l.code)), W = 640, H = rows.length * 26 + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif" font-size="12">${rows.map((l, i) => { const w = Math.max(2, (l.code / max) * 400); return `<text x="120" y="${i * 26 + 22}" text-anchor="end" fill="#374151">${esc(l.key)}</text><rect x="130" y="${i * 26 + 9}" width="${w.toFixed(1)}" height="18" rx="3" fill="${COLORS[i % COLORS.length]}"/><text x="${(136 + w).toFixed(1)}" y="${i * 26 + 22}" fill="#111827">${l.code.toLocaleString("en")}</text>`; }).join("")}</svg>`;
}
const aggTable = (title: string, xs: Agg[], total: number) => htmlTable([title, "Files 文件", "Code 代码", "Comment 注释", "Blank 空行", "Total 总行", "Share 占比"], xs.map((a) => [a.key, a.files, a.code, a.comment, a.blank, a.lines, pct(a.code, total)]));

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "codestats",
  title: ["代码统计报告", "Code Stats"],
  openDescription:
    "Count lines of code in a project folder: code, comment and blank lines per language (40+ languages by file extension), per folder and per file, plus the largest files. Respects the folder's .gitignore and skips node_modules, .git, dist and similar folders. Exclude more with patterns like tests/, *.min.js or vendor/** (setting exclude) or untick files in the table.",
  inputs: { exts: CODE_EXTS, min: 1, max: 20, folders: true, label: ["选择项目文件夹（或几个文件）", "Pick a project folder (or files)"] },
  settings: [
    { key: "title", label: ["报告标题", "Report title"], type: "text", default: "" },
    { key: "exclude", label: ["排除（逗号分隔，如 tests/, *.min.js）", "Exclude (comma-separated, e.g. tests/, *.min.js)"], type: "text", default: "" },
    { key: "gitignore", label: ["遵守 .gitignore", "Respect .gitignore"], type: "bool", default: true, reload: true },
    { key: "folderDepth", label: ["按几级文件夹汇总", "Folder depth for the folder table"], type: "number", default: 1, min: 1, max: 6 },
    { key: "topN", label: ["列出最大的前几个文件", "Largest files to list"], type: "number", default: 10, min: 1, max: 100 },
  ],
  columns: () => [
    { key: "include", label: ["统计", "Count"], type: "bool" },
    { key: "path", label: ["文件", "File"], readOnly: true, wide: true },
    { key: "language", label: ["语言", "Language"] },
    { key: "code", label: ["代码行", "Code"], type: "number", readOnly: true },
    { key: "comment", label: ["注释行", "Comment"], type: "number", readOnly: true },
    { key: "blank", label: ["空行", "Blank"], type: "number", readOnly: true },
    { key: "lines", label: ["总行数", "Lines"], type: "number", readOnly: true },
  ],
  async load({ ws, files, settings }) {
    const out: Row[] = [];
    let ignored = 0, negations = 0;
    for (const f of files) {
      const isDir = !langOf(f);
      const list = isDir ? (await ws.list({ dir: f, exts: CODE_EXTS, limit: 20000 })).map((x) => x.path) : [f];
      let gi = { test: (_: string) => false, negations: 0 };
      if (isDir && settings.gitignore !== false) {
        const gp = (f === "." ? "" : `${f}/`) + ".gitignore";
        if (await ws.exists(gp)) gi = gitignoreMatcher(await ws.readText(gp));
        negations += gi.negations;
      }
      for (const p of list) {
        if (p.startsWith(`${NAME}/`)) continue;
        const rel = isDir && f !== "." ? p.slice(f.length + 1) : p;
        if (gi.test(rel)) { ignored++; continue; }
        const lang = langOf(p)!;
        const buf = await ws.read(p, 20 * 1024 * 1024);
        if (buf.subarray(0, 8000).includes(0)) continue;
        const c = countLines(buf.toString("utf8"), lang);
        out.push({ include: !(c.longest > 1000 && /\.min\.|bundle|vendor/i.test(p)), path: p, language: lang.name, code: c.code, comment: c.comment, blank: c.blank, lines: c.lines, _longest: c.longest, _rel: rel });
      }
    }
    if (!out.length) throw new KitError("no_files", "No source files found in the chosen folder(s).");
    return { rows: out, meta: { ignored, negations } };
  },
  compute(p): Computed {
    const a = analyse(p);
    const issues: Issue[] = [];
    const meta = p.meta as { ignored?: number; negations?: number };
    if (meta.ignored) issues.push({ level: "info", message: `${meta.ignored} file(s) skipped by .gitignore.` });
    if (meta.negations) issues.push({ level: "warn", message: `.gitignore has ${meta.negations} “!” re-include rule(s); those are not applied — tick the files in the table if you need them.` });
    p.rows.forEach((r, i) => {
      if (Number(r._longest) > 1000 && r.include !== false) issues.push({ level: "warn", row: i, message: `${s(r.path)} has a ${r._longest}-character line — probably generated or minified; untick it or add it to exclude.` });
    });
    const t = a.total;
    return {
      summary: `${t.files} file(s), ${t.code.toLocaleString("en")} code lines (${pct(t.comment, t.lines)} comments, ${pct(t.blank, t.lines)} blank) in ${a.langs.length} language(s); ${a.excluded} excluded.`,
      stats: { files: t.files, code: t.code, comment: t.comment, blank: t.blank, lines: t.lines, languages: a.langs.length },
      issues,
      preview: barSvg(a.langs) + aggTable("Language 语言", a.langs, t.code) + `<h4>Largest files 最大文件</h4>` + htmlTable(["File", "Code", "Lines"], a.largest.map((r) => [r.path, r.code, r.lines])),
    };
  },
  exports: [
    {
      id: "html", label: ["HTML 报告", "HTML report"], description: "code-stats.html — languages with a bar chart, folders, largest files",
      async run({ project, write }: ExportCtx) {
        const a = analyse(project), t = a.total, title = s(project.settings.title) || `Code stats — ${project.name}`;
        const body = `<h1>${esc(title)}</h1><p class="muted">${t.files} files · ${t.code.toLocaleString("en")} code · ${t.comment.toLocaleString("en")} comment · ${t.blank.toLocaleString("en")} blank · ${new Date().toISOString().slice(0, 10)}</p>${barSvg(a.langs)}<h2>Languages 语言</h2>${aggTable("Language", a.langs, t.code)}<h2>Folders 文件夹</h2>${aggTable("Folder", a.folders, t.code)}<h2>Largest files 最大文件</h2>${htmlTable(["File", "Language", "Code", "Comment", "Blank", "Lines"], a.largest.map((r) => [r.path, r.language, r.code, r.comment, r.blank, r.lines]))}`;
        return [await write("code-stats.html", htmlPage(title, body))];
      },
    },
    {
      id: "xlsx", label: ["Excel 明细", "Workbook"], description: "code-stats.xlsx — Languages, Folders and Files sheets",
      async run({ project, write }: ExportCtx) {
        const a = analyse(project);
        const agg = (xs: Agg[]) => xs.map((x) => [x.key, x.files, x.code, x.comment, x.blank, x.lines]);
        const h = ["files", "code", "comment", "blank", "lines"];
        return [await write("code-stats.xlsx", await writeXlsx([
          { name: "Languages", headers: ["language", ...h], rows: agg(a.langs) },
          { name: "Folders", headers: ["folder", ...h], rows: agg(a.folders) },
          { name: "Files", headers: ["file", "language", "code", "comment", "blank", "lines"], rows: a.kept.map((r) => [r.path, r.language, r.code, r.comment, r.blank, r.lines]) },
        ]))];
      },
    },
    {
      id: "csv", label: ["语言汇总 CSV", "Language summary (CSV)"], description: "languages.csv",
      async run({ project, write }: ExportCtx) {
        const a = analyse(project);
        return [await write("languages.csv", toCsv(["language", "files", "code", "comment", "blank", "lines"], a.langs.map((x) => [x.key, x.files, x.code, x.comment, x.blank, x.lines])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i}${r.include === false ? " [excluded]" : ""} ${s(r.path)} ${s(r.language)} code=${r.code} comment=${r.comment} blank=${r.blank}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
