import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { convert, DIRECTIONS, parseDict, parseTerms, protectMarkdown, scriptGuess, type DirectionId, type Hit, type Options } from "./zh.ts";
import { readDocx, writeDocx } from "./docx.ts";

export const NAME = "zh-convert";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const EXTS = [".txt", ".md", ".markdown", ".srt", ".vtt", ".docx"];
const isDocx = (f: string) => /\.docx$/i.test(f);
const isMd = (f: string) => /\.(md|markdown)$/i.test(f);

type FileMeta = { path: string; kind: "text" | "docx"; lines?: { text: string; eol: string }[]; paras?: number; guess: { simp: number; trad: number }; bad?: boolean };
type Meta = { files: FileMeta[]; dictErrors: string[] };
const KIND_ZH: Record<Hit["kind"], string> = { phrase: "用词", custom: "自定义", exclude: "保留", ambiguous: "易错字" };

function options(settings: Record<string, unknown>): Options & { errors: string[] } {
  const d = parseDict(String(settings.custom ?? ""));
  return { dir: (String(settings.direction ?? "cn-twp") as DirectionId), custom: d.rules, exclude: parseTerms(String(settings.exclude ?? "")), errors: d.errors };
}

function convertLine(line: string, o: Options, md: boolean, fence: boolean, keepCode: boolean) {
  if (!md || !keepCode) { const r = convert(line, o); return { text: r.text, hits: r.hits, fence }; }
  const p = protectMarkdown(line, fence);
  const hits: Hit[] = [];
  const text = p.parts.map((x) => { if (x.keep) return x.text; const r = convert(x.text, o); hits.push(...r.hits); return r.text; }).join("");
  return { text, hits, fence: p.fence };
}
const note = (hits: Hit[]) => [...new Set(hits.map((h) => `${KIND_ZH[h.kind]} ${h.from}→${h.to}`))].join("；");

async function convertFileName(path: string, o: Options) {
  const parts = path.split("/");
  const base = parts.pop()!;
  return [...parts, convert(base, { ...o, custom: o.custom, exclude: o.exclude }).text].join("/");
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "zhconv",
  title: ["繁简转换", "Chinese Script Converter"],
  openDescription:
    "Convert Chinese text between Simplified and Traditional in .txt/.md/.srt/.vtt/.docx files or folders, with Taiwan or Hong Kong character forms and optional regional phrasing (软件 → 軟體, 鼠标 → 滑鼠, and back). Uses the open-source OpenCC dictionaries locally. Settings: direction (cn-tw, cn-twp, cn-hk, cn-hkp, cn-t, tw-cn, twp-cn, hk-cn, hkp-cn, t-cn), custom dictionary (one 'source=target' per line, wins over OpenCC), exclude terms (kept exactly as written, e.g. product or person names), keepCode (don't convert Markdown code and link URLs), names (also convert file names). Every changed line (or Word paragraph) is a row: untick accept to keep the original, or edit the converted text. The note column lists phrase replacements, custom entries, kept terms and one-to-many characters worth a second look. Exports converted copies (originals untouched), terms.csv and changes.csv.",
  inputs: { exts: EXTS, min: 1, max: 500, folders: true, label: ["选择文件或文件夹（TXT / MD / SRT / DOCX）", "Pick files or a folder (TXT / MD / SRT / DOCX)"] },
  settings: [
    { key: "direction", label: ["转换方向", "Direction"], type: "select", default: "cn-twp", reload: true, options: DIRECTIONS.map((d) => ({ value: d.id, label: [d.zh, d.en] as [string, string] })) },
    { key: "custom", label: ["自定义词条（每行 源=目标，优先于词典）", "Custom dictionary (one source=target per line)"], type: "textarea", default: "", reload: true },
    { key: "exclude", label: ["不转换的词（人名、品牌、产品名，每行一个）", "Exclude terms (names kept as written, one per line)"], type: "textarea", default: "", reload: true },
    { key: "keepCode", label: ["Markdown 代码和链接地址不转换", "Keep Markdown code and link URLs"], type: "bool", default: true, reload: true },
    { key: "names", label: ["同时转换文件名", "Also convert file names"], type: "bool", default: false },
  ],
  columns: () => [
    { key: "accept", label: ["接受", "Accept"], type: "bool" },
    { key: "file", label: ["文件", "File"], readOnly: true },
    { key: "line", label: ["行/段", "Line"], type: "number", readOnly: true },
    { key: "before", label: ["原文", "Before"], readOnly: true, wide: true },
    { key: "after", label: ["转换后", "After"], wide: true },
    { key: "note", label: ["提示", "Notes"], readOnly: true },
  ] as Column[],
  async load({ ws, files, settings, previous }) {
    const list: string[] = [];
    for (const f of files) {
      if (EXTS.some((e) => f.toLowerCase().endsWith(e))) list.push(f);
      else for (const x of await ws.list({ dir: f, exts: EXTS, limit: 5000 })) list.push(x.path);
    }
    const uniq = [...new Set(list)].filter((f) => !/(^|\/)~\$/.test(f)).sort((a, b) => a.localeCompare(b, "en"));
    if (!uniq.length) throw new KitError("no_files", `No ${EXTS.join(" ")} files found.`);
    const o = options(settings);
    const keepCode = settings.keepCode !== false;
    const prev = new Map((previous ?? []).map((r) => [`${s(r.file)}:${s(r.line)}:${String(r.before ?? "")}`, r]));
    const metaFiles: FileMeta[] = [], rows: Row[] = [];
    const push = (file: string, line: number, before: string, after: string, hits: Hit[]) => {
      const row: Row = { accept: true, file, line, before, after, note: note(hits), _auto: after, _hits: hits };
      const old = prev.get(`${file}:${line}:${before}`);
      if (old) { row.accept = old.accept; if (String(old.after ?? "") !== String(old._auto ?? "")) row.after = old.after; }
      rows.push(row);
    };
    for (const f of uniq) {
      const buf = await ws.read(f, 50 * 1024 * 1024);
      if (isDocx(f)) {
        let doc;
        try { doc = readDocx(new Uint8Array(buf)); } catch (e) { throw new KitError("bad_docx", `${f}: ${(e as Error).message}`); }
        metaFiles.push({ path: f, kind: "docx", paras: doc.paras.length, guess: scriptGuess(doc.paras.map((p) => p.text).join("\n")) });
        doc.paras.forEach((p, i) => { const r = convert(p.text, o); if (r.text !== p.text || r.hits.some((h) => h.kind === "exclude" || h.kind === "custom")) push(f, i + 1, p.text, r.text, r.hits); });
        continue;
      }
      const text = buf.toString("utf8").replace(/^\uFEFF/, "");
      const lines = [...text.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)].filter((m, i, a) => !(i === a.length - 1 && m[0] === "")).map((m) => ({ text: m[1], eol: m[2] }));
      metaFiles.push({ path: f, kind: "text", lines, guess: scriptGuess(text), bad: /\uFFFD/.test(text) });
      let fence = false;
      lines.forEach((l, i) => {
        const r = convertLine(l.text, o, isMd(f), fence, keepCode);
        fence = r.fence;
        if (r.text !== l.text || r.hits.some((h) => h.kind === "custom")) push(f, i + 1, l.text, r.text, r.hits);
      });
    }
    return { rows, meta: { files: metaFiles, dictErrors: o.errors } };
  },
  compute(p): Computed {
    const meta = p.meta as Meta;
    const issues: Issue[] = [];
    const dir = DIRECTIONS.find((d) => d.id === p.settings.direction) ?? DIRECTIONS[1];
    for (const e of meta.dictErrors ?? []) issues.push({ level: "warn", message: `Custom dictionary ${e} — use source=target / 自定义词条格式应为 源=目标` });
    for (const f of meta.files) {
      if (f.bad) issues.push({ level: "warn", message: `${f.path} has characters that are not valid UTF-8 (GBK/Big5 file?) — save it as UTF-8 first / 文件可能不是 UTF-8 编码` });
      const toTrad = dir.from === "cn";
      const { simp, trad } = f.guess;
      if (toTrad && trad > 20 && simp * 3 < trad) issues.push({ level: "warn", message: `${f.path} already looks like Traditional Chinese — check the direction / 文件看起来已经是繁体，请检查转换方向` });
      if (!toTrad && simp > 20 && trad * 3 < simp) issues.push({ level: "warn", message: `${f.path} already looks like Simplified Chinese — check the direction / 文件看起来已经是简体，请检查转换方向` });
    }
    const tally = new Map<string, { kind: Hit["kind"]; from: string; to: string; n: number; files: Set<string> }>();
    p.rows.forEach((r, i) => {
      const hits = (r._hits as Hit[] | undefined) ?? [];
      for (const h of hits) {
        const k = `${h.kind}|${h.from}|${h.to}`;
        const t = tally.get(k) ?? { ...h, n: 0, files: new Set<string>() };
        t.n++; t.files.add(s(r.file)); tally.set(k, t);
      }
      const amb = hits.filter((h) => h.kind === "ambiguous");
      if (amb.length && r.accept !== false && r.after === r._auto) issues.push({ level: "info", row: i, key: "after", message: `${s(r.file)}:${s(r.line)} — ${amb.map((h) => `${h.from}→${h.to}`).join(", ")}: one Simplified character, several Traditional ones; worth a look / 一简多繁，建议确认` });
      if (isDocx(s(r.file)) && r.after !== r._auto && r.accept !== false) issues.push({ level: "info", row: i, key: "after", message: `${s(r.file)} paragraph ${s(r.line)} was edited by hand; its text goes into the paragraph's first run, so mixed formatting inside that paragraph is lost / 手改的 Word 段落会合并成一种格式` });
    });
    if (!p.rows.length) issues.push({ level: "info", message: `Nothing to convert for ${dir.en} / 没有需要转换的内容` });
    const acc = p.rows.filter((r) => r.accept !== false).length;
    const terms = [...tally.values()].filter((t) => t.kind !== "ambiguous").sort((a, b) => b.n - a.n);
    const KCOL: Record<string, string> = { phrase: "#1d4ed8", custom: "#7c3aed", exclude: "#047857" };
    const rowsHtml = p.rows.slice(0, 10).map((r) => `<div style="margin:0 0 6px;${r.accept === false ? "opacity:.45" : ""}"><span class="muted">${esc(s(r.file).split("/").pop()!)}:${esc(s(r.line))}</span> ${esc(String(r.after ?? ""))}</div>`).join("");
    return {
      rows: p.rows,
      issues,
      summary: `${dir.en}: ${p.rows.length} line(s) change in ${new Set(p.rows.map((r) => s(r.file))).size} of ${meta.files.length} file(s); ${acc} accepted. ${dir.zh}：${p.rows.length} 处，接受 ${acc} 处。`,
      stats: { files: meta.files.length, lines: p.rows.length, accepted: acc, phrases: terms.filter((t) => t.kind === "phrase").reduce((a, t) => a + t.n, 0), custom: terms.filter((t) => t.kind === "custom").reduce((a, t) => a + t.n, 0), kept: terms.filter((t) => t.kind === "exclude").reduce((a, t) => a + t.n, 0) },
      preview: `<div style="font-size:13px">${terms.length ? `<p style="margin:0 0 8px">${terms.slice(0, 40).map((t) => `<span style="display:inline-block;margin:0 6px 4px 0;padding:1px 6px;border-radius:8px;border:1px solid ${KCOL[t.kind]};color:${KCOL[t.kind]}">${esc(t.from)}${t.kind === "exclude" ? " ✓" : ` → ${esc(t.to)}`} ×${t.n}</span>`).join("")}</p><p class="muted" style="margin:0 0 8px">蓝 = 地区用词　紫 = 自定义词条　绿 = 保留不转换</p>` : ""}${rowsHtml}${p.rows.length > 10 ? `<p class="muted">… ${p.rows.length - 10} more</p>` : ""}</div>`,
    };
  },
  exports: [
    {
      id: "files", label: ["转换后的文件", "Converted files"], description: "converted/<path> — converted copies of every changed file (originals are not touched)",
      async run({ project, write, ws }: ExportCtx) {
        const meta = project.meta as Meta;
        const o = options(project.settings);
        const out: string[] = [];
        for (const f of meta.files) {
          const mine = project.rows.filter((r) => s(r.file) === f.path && r.accept !== false);
          if (!mine.length) continue;
          const name = project.settings.names === true ? await convertFileName(f.path, o) : f.path;
          const target = `converted/${name.replace(/^\.?\/*/, "")}`;
          if (f.kind === "docx") {
            const doc = readDocx(new Uint8Array(await ws.read(f.path, 50 * 1024 * 1024)));
            const next = new Map<(typeof doc.paras)[number], string>();
            for (const r of mine) { const p = doc.paras[Number(r.line) - 1]; if (p && p.text === String(r.before ?? "")) next.set(p, String(r.after ?? "")); }
            out.push(await write(target, writeDocx(doc.files, doc.paras, next)));
          } else {
            const byLine = new Map(mine.map((r) => [Number(r.line), String(r.after ?? "")]));
            out.push(await write(target, f.lines!.map((l, i) => (byLine.get(i + 1) ?? l.text) + l.eol).join("")));
          }
        }
        if (!out.length) throw new KitError("nothing", "No accepted changes — nothing to write.");
        return out;
      },
    },
    {
      id: "terms", label: ["词条清单 CSV", "Terms (CSV)"], description: "terms.csv — phrase replacements, custom entries, kept terms and one-to-many characters with counts",
      async run({ project, write }: ExportCtx) {
        const t = new Map<string, [string, string, string, number, Set<string>]>();
        for (const r of project.rows) for (const h of (r._hits as Hit[] | undefined) ?? []) {
          const k = `${h.kind}|${h.from}|${h.to}`;
          const v = t.get(k) ?? [KIND_ZH[h.kind], h.from, h.to, 0, new Set<string>()];
          v[3]++; v[4].add(s(r.file)); t.set(k, v);
        }
        return [await write("terms.csv", toCsv(["type", "source", "result", "lines", "files"], [...t.values()].sort((a, b) => b[3] - a[3]).map((v) => [v[0], v[1], v[2], v[3], [...v[4]].join(" ")])))];
      },
    },
    {
      id: "csv", label: ["修改清单 CSV", "Change list (CSV)"], description: "changes.csv — file, line, before, after, notes, accepted",
      async run({ project, write }: ExportCtx) {
        return [await write("changes.csv", toCsv(["file", "line", "before", "after", "notes", "accepted"], project.rows.map((r) => [s(r.file), r.line, String(r.before ?? ""), String(r.after ?? ""), s(r.note), r.accept !== false ? "yes" : "no"])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i}${r.accept === false ? " [skip]" : ""} ${s(r.file)}:${s(r.line)} ${String(r.after ?? "")}${s(r.note) ? ` (${s(r.note)})` : ""}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
