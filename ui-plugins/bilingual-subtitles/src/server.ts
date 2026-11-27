import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { assHeader, fmtTime, parse, parseTime, write, type Cue } from "./subs.ts";
import { cjkRatio, pairUp } from "./pair.ts";

export const NAME = "bilingual-subtitles";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const EXTS = [".srt", ".vtt", ".ass", ".ssa"];
const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
type Meta = { top: string; bottom: string; counts: [number, number]; ratios: [number, number]; auto: boolean };
const HEX = /^#?[0-9a-f]{6}$/i;

type Line = { start: number; end: number; top: string; bottom: string; row: number };
function lines(p: Pick<Project, "rows">) {
  const issues: Issue[] = [];
  const out: Line[] = [];
  p.rows.forEach((r, i) => {
    if (r.keep === false) return;
    const start = parseTime(r.start), end = parseTime(r.end);
    if (start === null || end === null) { issues.push({ level: "error", row: i, key: start === null ? "start" : "end", message: `Row ${i}: “${s(start === null ? r.start : r.end)}” is not a time like 00:01:02,500 / 时间格式不对` }); return; }
    const top = String(r.top ?? "").replace(/\\n/g, "\n").trim(), bottom = String(r.bottom ?? "").replace(/\\n/g, "\n").trim();
    if (!top && !bottom) return;
    out.push({ start, end, top, bottom, row: i });
  });
  out.sort((a, b) => a.start - b.start);
  return { out, issues };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "bilingual",
  title: ["双语字幕合并", "Bilingual Subtitles"],
  openDescription:
    "Merge two subtitle files (SRT, WebVTT or ASS) in different languages into one bilingual track. Pick exactly two files. Cues are paired by timing overlap: every cue of the lower track joins the upper cue it overlaps most, if the overlap is at least minOverlap × the shorter cue (two short English cues can join one Chinese cue). Settings: order (auto = the Chinese/Japanese/Korean file on top, first, second), minOverlap (0–1, default 0.3), timing (top = keep the upper track's times, union = cover both), orphans (keep cues that matched nothing as their own lines), ASS style (font, sizes, colours) and name. Each output line is a row with start, end, top, bottom and match; edit the text or times, or untick keep. Exports <name>.srt, .vtt, .ass (two styles) and pairs.csv.",
  inputs: { exts: EXTS, min: 2, max: 2, label: ["选择两个字幕文件（不同语言）", "Pick two subtitle files (two languages)"] },
  settings: [
    { key: "order", label: ["上下顺序", "Which on top"], type: "select", default: "auto", reload: true, options: [{ value: "auto", label: ["自动（中文在上）", "Auto (CJK on top)"] }, { value: "first", label: ["第一个文件在上", "First file on top"] }, { value: "second", label: ["第二个文件在上", "Second file on top"] }] },
    { key: "minOverlap", label: ["最少重叠比例（0–1）", "Min overlap (0–1)"], type: "number", default: 0.3, min: 0.01, max: 1, reload: true },
    { key: "timing", label: ["时间轴", "Timing"], type: "select", default: "top", reload: true, options: [{ value: "top", label: ["按上面一条", "Use the upper track"] }, { value: "union", label: ["覆盖两条", "Cover both"] }] },
    { key: "orphans", label: ["保留没配上的字幕", "Keep unmatched cues"], type: "bool", default: true, reload: true },
    { key: "font", label: ["ASS 字体", "ASS font"], type: "text", default: "Noto Sans CJK SC" },
    { key: "topSize", label: ["上行字号", "Top size"], type: "number", default: 56, min: 10, max: 200 },
    { key: "bottomSize", label: ["下行字号", "Bottom size"], type: "number", default: 40, min: 10, max: 200 },
    { key: "topColor", label: ["上行颜色", "Top colour"], type: "text", default: "#FFFFFF" },
    { key: "bottomColor", label: ["下行颜色", "Bottom colour"], type: "text", default: "#FFE08A" },
    { key: "name", label: ["导出文件名（不含扩展名）", "Output name (no extension)"], type: "text", default: "bilingual" },
  ],
  columns: () => [
    { key: "keep", label: ["保留", "Keep"], type: "bool" },
    { key: "start", label: ["开始", "Start"] },
    { key: "end", label: ["结束", "End"] },
    { key: "top", label: ["上行", "Top"], wide: true },
    { key: "bottom", label: ["下行", "Bottom"], wide: true },
    { key: "match", label: ["配对", "Match"], readOnly: true },
  ] as Column[],
  async load({ ws, files, settings, previous }) {
    const parsed = [] as { file: string; cues: Cue[] }[];
    for (const f of files.slice(0, 2)) {
      const p = parse(f, (await ws.read(f, 20 * 1024 * 1024)).toString("utf8"));
      if (!p.cues.length) throw new KitError("no_cues", `${f}: no subtitle cues found.`);
      parsed.push({ file: f, cues: p.cues });
    }
    if (parsed.length < 2) throw new KitError("need_two", "Pick two subtitle files.");
    const ratios: [number, number] = [cjkRatio(parsed[0].cues), cjkRatio(parsed[1].cues)];
    const order = s(settings.order) || "auto";
    const topIdx = order === "second" ? 1 : order === "first" ? 0 : ratios[1] > ratios[0] ? 1 : 0;
    const [T, B] = [parsed[topIdx], parsed[1 - topIdx]];
    const pairs = pairUp(T.cues, B.cues, { minOverlap: num(settings.minOverlap, 0.3), timing: s(settings.timing) === "union" ? "union" : "top", orphans: settings.orphans !== false });
    const prev = new Map((previous ?? []).map((r) => [s(r._key), r]));
    const rows: Row[] = pairs.map((p) => {
      const key = `${p.a.join(",")}|${p.b.join(",")}`;
      const row: Row = {
        keep: true, start: fmtTime(p.start), end: fmtTime(p.end), top: p.top, bottom: p.bottom,
        match: !p.a.length ? "仅下行 bottom only" : !p.b.length ? "仅上行 top only" : p.b.length > 1 ? `1 : ${p.b.length}` : "1 : 1",
        _key: key, _auto: { top: p.top, bottom: p.bottom, start: fmtTime(p.start), end: fmtTime(p.end) },
      };
      const old = prev.get(key);
      if (old) {
        row.keep = old.keep;
        const auto = (old._auto ?? {}) as Record<string, string>;
        for (const k of ["top", "bottom", "start", "end"]) if (String(old[k] ?? "") !== String(auto[k] ?? "")) row[k] = old[k];
      }
      return row;
    });
    return { rows, meta: { top: T.file, bottom: B.file, counts: [T.cues.length, B.cues.length], ratios: [ratios[topIdx], ratios[1 - topIdx]], auto: order === "auto" } };
  },
  compute(p): Computed {
    const meta = p.meta as Meta;
    const { out, issues } = lines(p);
    if (meta.auto && Math.abs(meta.ratios[0] - meta.ratios[1]) < 0.2) issues.push({ level: "info", message: "Both files look like the same script, so the first file is on top — set order if needed / 两个文件文字类型相近，默认第一个在上" });
    for (const [k, l] of [["topColor", "Top colour"], ["bottomColor", "Bottom colour"]]) if (!HEX.test(s(p.settings[k]))) issues.push({ level: "error", message: `${l} “${s(p.settings[k])}” — use #RRGGBB / 颜色格式应为 #RRGGBB` });
    p.rows.forEach((r, i) => {
      if (r.keep === false) return;
      if (String(r.match).startsWith("仅")) issues.push({ level: "info", row: i, key: String(r.match).includes("下") ? "top" : "bottom", message: `${s(r.start)} — ${String(r.match).includes("下") ? "no upper-track cue here" : "no lower-track cue here"}: ${String(r.top || r.bottom).slice(0, 30)} / ${String(r.match).split(" ")[0]}` });
    });
    for (let i = 0; i < out.length - 1; i++) if (out[i + 1].start < out[i].end) issues.push({ level: "warn", row: out[i].row, key: "end", message: `${fmtTime(out[i].start)} overlaps the next line by ${((out[i].end - out[i + 1].start) / 1000).toFixed(2)}s / 与下一行重叠` });
    const kept = p.rows.filter((r) => r.keep !== false);
    const both = kept.filter((r) => s(r.top) && s(r.bottom)).length;
    const topName = meta.top.split("/").pop(), botName = meta.bottom.split("/").pop();
    return {
      rows: p.rows,
      issues,
      summary: `${topName} (${meta.counts[0]}) on top + ${botName} (${meta.counts[1]}) below → ${out.length} line(s), ${both} with both languages. 上：${topName}，下：${botName}，合并为 ${out.length} 行。`,
      stats: { top: meta.counts[0], bottom: meta.counts[1], lines: out.length, paired: both, topOnly: kept.filter((r) => s(r.top) && !s(r.bottom)).length, bottomOnly: kept.filter((r) => !s(r.top) && s(r.bottom)).length },
      preview: `<div style="background:#1f2937;border-radius:6px;padding:10px 12px;font-size:13px">${out.slice(0, 8).map((l) => `<div style="text-align:center;margin-bottom:10px"><div class="muted" style="font-size:10px;color:#9ca3af">${fmtTime(l.start)} → ${fmtTime(l.end)}</div><div style="color:${HEX.test(s(p.settings.topColor)) ? "#" + s(p.settings.topColor).replace("#", "") : "#fff"};font-size:15px">${esc(l.top).replace(/\n/g, "<br>")}</div><div style="color:${HEX.test(s(p.settings.bottomColor)) ? "#" + s(p.settings.bottomColor).replace("#", "") : "#fe8"}">${esc(l.bottom).replace(/\n/g, "<br>")}</div></div>`).join("")}${out.length > 8 ? `<p style="color:#9ca3af">… ${out.length - 8} more</p>` : ""}</div>`,
    };
  },
  exports: [
    ...(["srt", "vtt"] as const).map((f) => ({
      id: f, label: [`双语 ${f.toUpperCase()}`, `Bilingual ${f.toUpperCase()}`] as [string, string], description: `<name>.${f} — top line, then bottom line in each cue`,
      async run({ project, write: w }: ExportCtx) {
        const { out, issues } = lines(project);
        if (issues.some((x) => x.level === "error")) throw new KitError("bad_rows", issues.map((x) => x.message).join("\n"));
        const cues = out.map((l) => ({ start: l.start, end: l.end, text: [l.top, l.bottom].filter(Boolean).join("\n") }));
        return [await w(`${s(project.settings.name) || "bilingual"}.${f}`, write(cues, f))];
      },
    })),
    {
      id: "ass", label: ["双语 ASS（两种样式）", "Bilingual ASS (two styles)"], description: "<name>.ass — top line in the Top style and bottom line in the Bottom style (font, size and colour from settings)",
      async run({ project, write: w }: ExportCtx) {
        const { out, issues } = lines(project);
        const st = project.settings;
        for (const k of ["topColor", "bottomColor"]) if (!HEX.test(s(st[k]))) issues.push({ level: "error", message: `${k} must be #RRGGBB` });
        if (issues.some((x) => x.level === "error")) throw new KitError("bad_rows", issues.map((x) => x.message).join("\n"));
        const font = s(st.font) || "Noto Sans CJK SC";
        const header = assHeader([
          { name: "Top", font, size: num(st.topSize, 56), color: `#${s(st.topColor).replace("#", "")}` },
          { name: "Bottom", font, size: num(st.bottomSize, 40), color: `#${s(st.bottomColor).replace("#", "")}` },
        ], s(st.name) || "bilingual");
        const esc2 = (t: string) => t.replace(/\{/g, "(").replace(/\}/g, ")").replace(/\r?\n/g, "\\N");
        const cues = out.map((l) => ({ start: l.start, end: l.end, text: "", style: l.top ? "Top" : "Bottom", raw: l.top && l.bottom ? `${esc2(l.top)}\\N{\\rBottom}${esc2(l.bottom)}` : esc2(l.top || l.bottom) }));
        return [await w(`${s(st.name) || "bilingual"}.ass`, "\uFEFF" + write(cues, "ass", { header }))];
      },
    },
    {
      id: "csv", label: ["配对清单 CSV", "Pairs (CSV)"], description: "pairs.csv — start, end, top, bottom, match, kept",
      async run({ project, write: w }: ExportCtx) {
        return [await w("pairs.csv", toCsv(["start", "end", "top", "bottom", "match", "kept"], project.rows.map((r) => [s(r.start), s(r.end), String(r.top ?? ""), String(r.bottom ?? ""), s(r.match), r.keep !== false ? "yes" : "no"])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i}${r.keep === false ? " [dropped]" : ""} ${s(r.start)}→${s(r.end)} [${s(r.match)}] ${String(r.top ?? "").replace(/\n/g, " ")} | ${String(r.bottom ?? "").replace(/\n/g, " ")}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
