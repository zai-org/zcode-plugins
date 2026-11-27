import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type ExportDef, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { cps, fmtTime, parse, parseTime, write, type Format } from "./subs.ts";
import { applyActions, check, fixOverlaps, FPS, syncMap, type Action, type OutCue, type SrcCue } from "./edit.ts";

export const NAME = "subtitle-editor";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const EXTS = [".srt", ".vtt", ".ass", ".ssa"];
type Meta = { file: string; format: Format; assHeader?: string; errors: string[] };
const ACTIONS: { value: Action; label: [string, string] }[] = [
  { value: "keep", label: ["保留", "Keep"] }, { value: "merge", label: ["与下一条合并", "Merge with next"] }, { value: "split", label: ["拆成两条", "Split in two"] }, { value: "delete", label: ["删除", "Delete"] },
];
const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

function build(p: Pick<Project, "rows" | "settings">) {
  const errors: Issue[] = [];
  const src: SrcCue[] = [];
  p.rows.forEach((r, i) => {
    const start = parseTime(r.start), end = parseTime(r.end);
    if (start === null) errors.push({ level: "error", row: i, key: "start", message: `Row ${i}: start “${s(r.start)}” is not a time like 00:01:02,500 / 开始时间格式不对` });
    if (end === null) errors.push({ level: "error", row: i, key: "end", message: `Row ${i}: end “${s(r.end)}” is not a time like 00:01:04,000 / 结束时间格式不对` });
    if (start === null || end === null) return;
    const text = String(r.text ?? "").replace(/\r\n?/g, "\n").replace(/\\n/g, "\n");
    src.push({ start, end, text, raw: text === r._text ? (r._raw as string | undefined) : undefined, style: r._style as string | undefined, action: (s(r.action) || "keep") as Action, row: i });
  });
  const st = p.settings;
  const points: [number, number][] = [];
  for (const [i, line] of String(st.sync ?? "").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const m = line.split(/\s*(?:=>|=|→|->)\s*/);
    const a = parseTime(m[0]), b = parseTime(m[1]);
    if (m.length !== 2 || a === null || b === null) errors.push({ level: "error", message: `Sync point line ${i + 1} “${line.trim()}” — write it as 00:10:05,000 = 00:10:07,250 / 同步点格式：字幕时间 = 正确时间` });
    else points.push([a, b]);
  }
  const map = syncMap(points);
  const offset = parseTime(st.offset ?? "0") ?? 0;
  if (parseTime(st.offset ?? "0") === null) errors.push({ level: "error", message: `Offset “${s(st.offset)}” — use seconds like -1.5 or a time like 00:00:02,000 / 偏移格式不对` });
  const fps = FPS[s(st.fps)];
  const t = (x: number) => Math.round(map ? map(x) : (fps ? (x * fps[0]) / fps[1] : x) + offset);
  const cues = applyActions(src).map((c) => ({ ...c, start: t(c.start), end: t(c.end) }));
  const lim = { maxCps: num(st.maxCps, 20), maxWidth: num(st.maxWidth, 42), maxLines: num(st.maxLines, 2), minDur: num(st.minDur, 0.8) * 1000, minGap: num(st.minGap, 80) };
  const fixed = st.fixOverlaps === true ? fixOverlaps(cues, lim.minGap) : 0;
  for (const c of cues) if (c.start < 0 && st.clamp !== false) { c.start = 0; if (c.end < 1) c.end = 1; }
  return { cues, errors, flags: check(cues, lim), fixed, synced: points.length, lim };
}

function outName(p: Project, ext: string) {
  const meta = p.meta as Meta;
  const base = s(p.settings.name) || meta.file.split("/").pop()!.replace(/\.[^.]+$/, "");
  return `${base.replace(/[\\/:*?"<>|]/g, "_")}.${ext}`;
}

function timeline(cues: OutCue[], bad: Set<number>) {
  if (!cues.length) return "";
  const end = Math.min(Math.max(...cues.map((c) => c.end)), (cues[0]?.start ?? 0) + 90000), from = Math.max(0, cues[0].start - 1000);
  const W = 640, span = Math.max(1, end - from), x = (t: number) => ((t - from) / span) * W;
  const bars = cues.filter((c) => c.start < end).map((c, i) => `<rect x="${x(c.start).toFixed(1)}" y="${i % 2 ? 22 : 6}" width="${Math.max(1, x(Math.min(c.end, end)) - x(c.start)).toFixed(1)}" height="14" rx="2" fill="${bad.has(i) ? "#ef4444" : "#3b82f6"}" opacity=".8"><title>${esc(`${i + 1} ${fmtTime(c.start)} ${c.text}`)}</title></rect>`).join("");
  return `<svg viewBox="0 0 ${W} 48" width="100%" style="max-width:${W}px;background:#f8fafc;border-radius:4px">${bars}<text x="2" y="46" font-size="9" fill="#64748b">${fmtTime(from)}</text><text x="${W - 2}" y="46" font-size="9" fill="#64748b" text-anchor="end">${fmtTime(end)}</text></svg>`;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "subtitle",
  title: ["字幕校对转换", "Subtitle Editor"],
  openDescription:
    "Open one SRT, WebVTT or ASS/SSA subtitle file to shift, retime, proofread and convert it. Each cue is a row (start, end, text, action). Settings: offset (seconds like -1.5, or 00:00:02,000), fps conversion (e.g. 23.976>25), sync points (lines 'subtitle time = correct time'; one point shifts, two or more retime linearly, overriding offset/fps), reading-speed and layout limits (maxCps, maxWidth where CJK counts 2, maxLines, minDur seconds, minGap ms), fixOverlaps, name (output base name). Row action: keep, merge (with next), split (at '|' in the text, between lines, or near the middle), delete. Edit text or times directly; '\\n' or a real newline starts a new line. Flags show overlaps, too-fast reading speed, long lines, too many lines and too-short cues with the new times. Exports <name>.srt, .vtt, .ass and a check report CSV.",
  inputs: { exts: EXTS, min: 1, max: 1, label: ["选择字幕文件（SRT / VTT / ASS）", "Pick a subtitle file (SRT / VTT / ASS)"] },
  settings: [
    { key: "offset", label: ["整体平移（秒，可为负，如 -1.5）", "Shift (seconds, e.g. -1.5)"], type: "text", default: "0" },
    { key: "fps", label: ["帧率换算", "Frame-rate change"], type: "select", default: "", options: [{ value: "", label: ["不换算", "None"] }, ...Object.keys(FPS).map((k) => ({ value: k, label: [k.replace(">", " → "), k.replace(">", " → ")] as [string, string] }))] },
    { key: "sync", label: ["同步点（每行 字幕时间 = 正确时间）", "Sync points (subtitle time = correct time)"], type: "textarea", default: "" },
    { key: "maxCps", label: ["每秒最多字符（中文算 2）", "Max chars/second (CJK counts 2)"], type: "number", default: 20, min: 1, max: 100 },
    { key: "maxWidth", label: ["每行最宽（中文算 2）", "Max line width (CJK counts 2)"], type: "number", default: 42, min: 10, max: 200 },
    { key: "maxLines", label: ["最多行数", "Max lines"], type: "number", default: 2, min: 1, max: 6 },
    { key: "minDur", label: ["最短显示（秒）", "Min duration (s)"], type: "number", default: 0.8, min: 0, max: 10 },
    { key: "minGap", label: ["两条之间最小间隔（毫秒）", "Min gap (ms)"], type: "number", default: 80, min: 0, max: 2000 },
    { key: "fixOverlaps", label: ["自动修正重叠", "Fix overlaps"], type: "bool", default: false },
    { key: "name", label: ["导出文件名（不含扩展名）", "Output name (no extension)"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "action", label: ["操作", "Action"], type: "select", options: ACTIONS.map((a) => a.value) },
    { key: "start", label: ["开始", "Start"] },
    { key: "end", label: ["结束", "End"] },
    { key: "text", label: ["字幕", "Text"], wide: true },
    { key: "newStart", label: ["新开始", "New start"], readOnly: true },
    { key: "newEnd", label: ["新结束", "New end"], readOnly: true },
    { key: "cps", label: ["字/秒", "CPS"], type: "number", readOnly: true },
    { key: "flags", label: ["检查", "Checks"], readOnly: true },
  ] as Column[],
  async load({ ws, files }) {
    const f = files[0];
    const buf = await ws.read(f, 20 * 1024 * 1024);
    const text = buf.toString("utf8");
    const p = parse(f, text);
    if (!p.cues.length) throw new KitError("no_cues", `${f}: no subtitle cues found${p.errors.length ? ` (${p.errors.slice(0, 3).join("; ")})` : ""}.`);
    const rows: Row[] = p.cues.map((c) => ({ action: "keep", start: fmtTime(c.start), end: fmtTime(c.end), text: c.text, _text: c.text, _raw: c.raw, _style: c.style }));
    return { rows, meta: { file: f, format: p.format, assHeader: p.assHeader, errors: p.errors, bad: /\uFFFD/.test(text) } };
  },
  compute(p): Computed {
    const meta = p.meta as Meta & { bad?: boolean };
    const b = build(p);
    const issues: Issue[] = [...b.errors];
    for (const e of meta.errors) issues.push({ level: "warn", message: `${meta.file} ${e} — skipped / 已跳过` });
    if (meta.bad) issues.push({ level: "warn", message: "The file has characters that are not valid UTF-8 (GBK/Big5?) — save it as UTF-8 first / 文件可能不是 UTF-8 编码" });
    if (b.synced && (s(p.settings.offset) !== "0" && s(p.settings.offset) || s(p.settings.fps))) issues.push({ level: "info", message: "Sync points are set, so shift and frame-rate settings are ignored / 已设置同步点，忽略平移和帧率" });
    const perRow = new Map<number, { cue: OutCue; i: number }[]>();
    b.cues.forEach((c, i) => c.rows.forEach((r) => perRow.set(r, [...(perRow.get(r) ?? []), { cue: c, i }])));
    const flagsBy = new Map<number, string[]>();
    for (const f of b.flags) flagsBy.set(f.cue, [...(flagsBy.get(f.cue) ?? []), f.message]);
    for (const f of b.flags) {
      const c = b.cues[f.cue];
      issues.push({ level: f.kind === "order" || f.kind === "empty" ? "warn" : f.kind === "overlap" ? "warn" : "info", row: c?.rows[0], key: f.kind === "cps" || f.kind === "width" || f.kind === "lines" || f.kind === "empty" ? "text" : "end", message: `#${f.cue + 1} ${fmtTime(c?.start ?? 0)} — ${f.message}` });
    }
    const rows = p.rows.map((r, i) => {
      const outs = perRow.get(i) ?? [];
      if (!outs.length) return { ...r, newStart: s(r.action) === "delete" ? "（删除）" : "", newEnd: "", cps: "", flags: "" };
      const first = outs[0];
      const merged = first.cue.rows.length > 1 && first.cue.rows[0] !== i;
      return {
        ...r,
        newStart: merged ? `↑ 并入 #${first.i + 1}` : fmtTime(first.cue.start),
        newEnd: merged ? "" : fmtTime(outs[outs.length - 1].cue.end),
        cps: merged ? "" : Math.round(cps(first.cue) * 10) / 10,
        flags: merged ? "" : [...new Set(outs.flatMap((o) => flagsBy.get(o.i) ?? []).map((m) => m.split(" / ")[1] ?? m))].join("；") + (outs.length > 1 ? `${flagsBy.size ? "" : ""}（拆成 ${outs.length} 条）` : ""),
      };
    });
    const bad = new Set(b.flags.filter((f) => f.kind === "overlap" || f.kind === "order").map((f) => f.cue));
    const kinds = (k: string) => b.flags.filter((f) => f.kind === k).length;
    return {
      rows,
      issues,
      summary: `${p.rows.length} cue(s) in → ${b.cues.length} out (${meta.format.toUpperCase()}); ${kinds("overlap")} overlap(s), ${kinds("cps")} too fast, ${kinds("width") + kinds("lines")} layout${b.fixed ? `; ${b.fixed} overlap(s) fixed` : ""}. 输入 ${p.rows.length} 条，输出 ${b.cues.length} 条。`,
      stats: { in: p.rows.length, out: b.cues.length, overlaps: kinds("overlap"), fast: kinds("cps"), long: kinds("width") + kinds("lines"), short: kinds("short"), fixed: b.fixed, duration: b.cues.length ? fmtTime(Math.max(...b.cues.map((c) => c.end))) : "" },
      preview: `${timeline(b.cues, bad)}<div style="font-size:12px;margin-top:8px">${b.cues.slice(0, 8).map((c, i) => `<div style="margin-bottom:4px"><span class="muted">${i + 1} · ${fmtTime(c.start)} → ${fmtTime(c.end)}</span><br>${esc(c.text).replace(/\n/g, "<br>")}</div>`).join("")}${b.cues.length > 8 ? `<p class="muted">… ${b.cues.length - 8} more</p>` : ""}</div>`,
    };
  },
  exports: [...(["srt", "vtt", "ass"] as Format[]).map((f): ExportDef => ({
    id: f,
    label: [`导出 ${f.toUpperCase()}`, `${f.toUpperCase()} file`] as [string, string],
    description: `<name>.${f} — the edited subtitles as ${f === "ass" ? "ASS (keeps the original styles when the input was ASS)" : f.toUpperCase()}`,
    async run({ project, write: w }: ExportCtx) {
      const b = build(project);
      if (b.errors.some((e) => e.level === "error")) throw new KitError("bad_times", b.errors.map((e) => e.message).join("\n"));
      const meta = project.meta as Meta;
      const cues = f === "ass" && meta.format === "ass" ? b.cues : b.cues.map((c) => ({ ...c, raw: undefined }));
      return [await w(outName(project, f), (f === "vtt" ? "" : f === "ass" ? "\uFEFF" : "") + write(cues, f, { header: meta.format === "ass" ? meta.assHeader : undefined, title: outName(project, f) }))];
    },
  })), {
    id: "report", label: ["检查报告 CSV", "Check report (CSV)"] as [string, string], description: "<name>-checks.csv — every flagged cue with times and the problem",
    async run({ project, write: w }: ExportCtx) {
      const b = build(project);
      return [await w(outName(project, "csv").replace(/\.csv$/, "-checks.csv"), toCsv(["cue", "start", "end", "problem", "text"], b.flags.map((f) => { const c = b.cues[f.cue]; return [f.cue + 1, fmtTime(c.start), fmtTime(c.end), f.message, c.text]; })))];
    },
  }],
  describeRow: (r, i) => `#${i} [${s(r.action) || "keep"}] ${s(r.start)} → ${s(r.end)} ${String(r.text ?? "").replace(/\n/g, " / ")}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
