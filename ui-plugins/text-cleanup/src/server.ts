import { createTwoFilesPatch } from "diff";
import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { assemble, cleanText, RULES, type RuleId } from "./clean.ts";

export const NAME = "text-cleanup";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const EXTS = [".md", ".markdown", ".txt", ".text"];
type Meta = { files: { path: string; text: string }[] };
const RULE_LABEL = Object.fromEntries(RULES.map((r) => [r.id, r.zh])) as Record<RuleId, string>;

function outputs(p: Pick<Project, "rows" | "meta">) {
  const meta = p.meta as Meta;
  return meta.files.map((f) => {
    const acc = new Map<number, string | null>();
    for (const r of p.rows) if (s(r.file) === f.path && r.accept !== false) acc.set(Number(r.line), r._delete === true && String(r.after ?? "") === "" ? null : String(r.after ?? ""));
    const cleaned = assemble(f.text, acc);
    return { path: f.path, before: f.text, after: cleaned, changed: cleaned !== f.text };
  });
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "cleanup",
  title: ["中文文本排版清洗", "Text Cleanup"],
  openDescription:
    "Tidy Chinese (and mixed Chinese–English) text in .md/.txt files or folders: full-width letters/digits → half-width, half-width punctuation inside Chinese → full-width (，。！？：；（）), …… and ——, straight quotes → “ ” in Chinese, a space between Chinese and Latin letters/digits/inline code, no spaces around full-width punctuation, collapse repeated spaces and blank lines, trim line ends. Each rule can be switched off in settings. Markdown code blocks, inline code, link URLs, HTML tags and front matter are never changed. Every changed line is a row: untick accept to skip it or edit the after text. Exports cleaned copies (originals untouched), changes.diff and changes.csv.",
  inputs: { exts: EXTS, min: 1, max: 500, folders: true, label: ["选择文本文件或文件夹", "Pick text files or a folder"] },
  settings: RULES.map((r) => ({ key: r.id, label: [r.zh, r.en] as [string, string], type: "bool" as const, default: r.on, reload: true })),
  columns: () => [
    { key: "accept", label: ["接受", "Accept"], type: "bool" },
    { key: "file", label: ["文件", "File"], readOnly: true },
    { key: "line", label: ["行", "Line"], type: "number", readOnly: true },
    { key: "rules", label: ["规则", "Rules"], readOnly: true },
    { key: "before", label: ["原文", "Before"], readOnly: true, wide: true },
    { key: "after", label: ["修改后", "After"], wide: true },
  ] as Column[],
  async load({ ws, files, settings, previous }) {
    const list: string[] = [];
    for (const f of files) {
      if (EXTS.some((e) => f.toLowerCase().endsWith(e))) list.push(f);
      else for (const x of await ws.list({ dir: f, exts: EXTS, limit: 5000 })) list.push(x.path);
    }
    const uniq = [...new Set(list)].sort((a, b) => a.localeCompare(b, "en"));
    if (!uniq.length) throw new KitError("no_files", `No ${EXTS.join(" ")} files found.`);
    const on = new Set(RULES.filter((r) => (settings[r.id] ?? r.on) !== false).map((r) => r.id));
    const prev = new Map((previous ?? []).map((r) => [`${s(r.file)}:${s(r.line)}:${String(r.before ?? "")}`, r]));
    const metaFiles: Meta["files"] = [], rows: Row[] = [];
    for (const f of uniq) {
      const buf = await ws.read(f, 20 * 1024 * 1024);
      const text = buf.toString("utf8").replace(/^\uFEFF/, "");
      metaFiles.push({ path: f, text });
      for (const c of cleanText(text, on, /\.(md|markdown)$/i.test(f))) {
        const row: Row = { accept: true, file: f, line: c.line, rules: c.rules.map((r) => RULE_LABEL[r]).join("、"), before: c.before, after: c.after ?? "", _delete: c.after === null, _auto: c.after ?? "" };
        const old = prev.get(`${f}:${c.line}:${c.before}`);
        if (old) { row.accept = old.accept; if (String(old.after ?? "") !== String(old._auto ?? "")) row.after = old.after; }
        rows.push(row);
      }
    }
    return { rows, meta: { files: metaFiles } };
  },
  compute(p): Computed {
    const issues: Issue[] = [];
    const meta = p.meta as Meta;
    const outs = outputs(p);
    const acc = p.rows.filter((r) => r.accept !== false).length;
    const byRule = new Map<string, number>();
    for (const r of p.rows) for (const x of s(r.rules).split("、").filter(Boolean)) byRule.set(x, (byRule.get(x) ?? 0) + 1);
    for (const f of meta.files) if (/\uFFFD/.test(f.text)) issues.push({ level: "warn", message: `${f.path} has characters that are not valid UTF-8 (GBK file?) — save it as UTF-8 first / 文件可能不是 UTF-8 编码` });
    p.rows.forEach((r, i) => { if (r.accept !== false && !r._delete && !s(r.after) && s(r.before)) issues.push({ level: "warn", row: i, key: "after", message: `Line ${s(r.line)} of ${s(r.file)} would become empty / 修改后为空行` }); });
    if (!p.rows.length) issues.push({ level: "info", message: "Nothing to change — the text already follows the selected rules / 没有需要修改的地方" });
    const show = p.rows.slice(0, 12);
    const mark = (a: string, b: string) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++; return [esc(a.slice(0, i)), esc(a.slice(i, a.length - j)), esc(b.slice(i, b.length - j)), esc(a.slice(a.length - j))]; };
    return {
      rows: p.rows,
      issues,
      summary: `${p.rows.length} line(s) to change in ${outs.filter((o) => o.changed || p.rows.some((r) => s(r.file) === o.path)).length} of ${meta.files.length} file(s); ${acc} accepted. ${p.rows.length} 处修改，接受 ${acc} 处。`,
      stats: { files: meta.files.length, changes: p.rows.length, accepted: acc, ...Object.fromEntries([...byRule].map(([k, v]) => [k, v])) },
      preview: `<div style="font-size:12px;font-family:ui-monospace,monospace">${show.map((r) => { const [pre, del, ins, post] = mark(String(r.before ?? ""), r._delete ? "" : String(r.after ?? "")); return `<div style="margin:0 0 6px;${r.accept === false ? "opacity:.45" : ""}"><span class="muted">${esc(s(r.file).split("/").pop()!)}:${esc(s(r.line))}</span> ${r._delete ? `<span style="background:#fee2e2">（删除空行）</span>` : `${pre}<del style="background:#fee2e2">${del}</del><ins style="background:#dcfce7;text-decoration:none">${ins}</ins>${post}`}</div>`; }).join("")}${p.rows.length > 12 ? `<p class="muted">… ${p.rows.length - 12} more</p>` : ""}</div>`,
    };
  },
  exports: [
    {
      id: "files", label: ["清洗后的文件", "Cleaned files"], description: "cleaned/<path> — cleaned copies of every changed file (originals are not touched)",
      async run({ project, write }: ExportCtx) {
        const out: string[] = [];
        for (const o of outputs(project)) if (o.changed) out.push(await write(`cleaned/${o.path.replace(/^\.?\/*/, "")}`, o.after));
        if (!out.length) throw new KitError("nothing", "No accepted changes — nothing to write.");
        return out;
      },
    },
    {
      id: "diff", label: ["差异 diff", "Diff"], description: "changes.diff — unified diff of the accepted changes",
      async run({ project, write }: ExportCtx) {
        const patch = outputs(project).filter((o) => o.changed).map((o) => createTwoFilesPatch(`a/${o.path}`, `b/${o.path}`, o.before, o.after, "", "", { context: 2 })).join("");
        return [await write("changes.diff", patch || "# no changes\n")];
      },
    },
    {
      id: "csv", label: ["修改清单 CSV", "Change list (CSV)"], description: "changes.csv — file, line, rules, before, after, accepted",
      async run({ project, write }: ExportCtx) {
        return [await write("changes.csv", toCsv(["file", "line", "rules", "before", "after", "accepted"], project.rows.map((r) => [s(r.file), r.line, s(r.rules), String(r.before ?? ""), r._delete ? "(deleted blank line)" : String(r.after ?? ""), r.accept !== false ? "yes" : "no"])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i}${r.accept === false ? " [skip]" : ""} ${s(r.file)}:${s(r.line)} [${s(r.rules)}] ${String(r.before ?? "")} → ${r._delete ? "(delete)" : String(r.after ?? "")}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
