import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createApp, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { ffmpeg, fmtTime, probe } from "./kit/ffmpeg.ts";
import { args, AUDIO, estimate, mb, outSize, PRESETS, targetKbps, type Audio, type Plan, type Preset, type Src } from "./plan.ts";

export const NAME = "video-compressor";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const EXTS = [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".wmv", ".flv", ".mts", ".m2ts", ".3gp"];
const num = (v: unknown, d: number) => { const t = String(v ?? "").trim(); const n = Number(t); return t !== "" && Number.isFinite(n) ? n : d; };
const HEIGHTS = ["", "keep", "2160", "1440", "1080", "720", "540", "480", "360"];

const src = (r: Row): Src => ({ width: Number(r._w), height: Number(r._h), fps: Number(r._fps) || 30, duration: Number(r._dur) || 0, bytes: Number(r._bytes) || 0, hasAudio: r._audio === true });
function plan(r: Row, st: Record<string, unknown>): Plan {
  const h = s(r.maxHeight) || s(st.maxHeight) || "1080";
  return {
    preset: (s(r.preset) || s(st.preset) || "balanced") as Preset,
    targetMB: num(r.targetMB, num(st.targetMB, 25)),
    maxHeight: h === "keep" ? 0 : num(h, 0),
    audio: (s(r.audio) || s(st.audio) || "aac128") as Audio,
    speed: s(st.speed) || "medium",
  };
}
const outName = (r: Row) => `${s(r.name) || s(r.file).split("/").pop()!.replace(/\.[^.]+$/, "")}.mp4`;

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "vcompress",
  title: ["视频批量压缩", "Video Compressor"],
  openDescription:
    "Batch-compress videos (MP4/MOV/MKV/WebM/AVI/…) to H.264 MP4 with the ffmpeg already installed on this computer. One row per video with its resolution, length, size and bitrate. Per row (blank = settings default): preset (high = CRF 20, balanced = CRF 23, small = CRF 28, target = two-pass to targetMB), targetMB, maxHeight (keep/2160/1440/1080/720/540/480/360 — only scales down), audio (aac160/aac128/aac96/aac64/copy/none), name. Settings: the same defaults plus speed (x264 preset veryfast…slow) and keepSmaller (if the result isn't smaller than the original, the original is copied instead). Shows a rough size estimate before encoding. Exports compressed/<name>.mp4 (originals untouched) and compress-report.csv with real sizes and savings. Needs ffmpeg (free) installed.",
  inputs: { exts: EXTS, min: 1, max: 200, folders: true, label: ["选择视频或文件夹", "Pick videos or a folder"] },
  settings: [
    { key: "preset", label: ["默认方案", "Default preset"], type: "select", default: "balanced", options: (Object.keys(PRESETS) as Preset[]).map((k) => ({ value: k, label: [`${PRESETS[k].zh}${PRESETS[k].crf ? `（CRF ${PRESETS[k].crf}）` : "（两遍编码）"}`, `${PRESETS[k].en}${PRESETS[k].crf ? ` (CRF ${PRESETS[k].crf})` : " (two-pass)"}`] as [string, string] })) },
    { key: "targetMB", label: ["指定大小（MB）", "Target size (MB)"], type: "number", default: 25, min: 0.1, max: 100000 },
    { key: "maxHeight", label: ["最大高度", "Max height"], type: "select", default: "1080", options: HEIGHTS.slice(1).map((h) => ({ value: h, label: [h === "keep" ? "保持原尺寸" : `${h}p`, h === "keep" ? "Keep size" : `${h}p`] as [string, string] })) },
    { key: "audio", label: ["音频", "Audio"], type: "select", default: "aac128", options: (Object.keys(AUDIO) as Audio[]).map((a) => ({ value: a, label: (a === "copy" ? ["保持原音频", "Copy original"] : a === "none" ? ["去掉声音", "Remove"] : [`AAC ${AUDIO[a]}k`, `AAC ${AUDIO[a]}k`]) as [string, string] })) },
    { key: "speed", label: ["编码速度", "Encoding speed"], type: "select", default: "medium", options: ["veryfast", "faster", "fast", "medium", "slow"].map((v) => ({ value: v, label: [{ veryfast: "很快（文件稍大）", faster: "较快", fast: "快", medium: "标准", slow: "慢（文件更小）" }[v]!, v] as [string, string] })) },
    { key: "keepSmaller", label: ["压缩后反而变大时保留原文件", "Keep the original if it isn't smaller"], type: "bool", default: true },
  ],
  columns: () => [
    { key: "file", label: ["视频", "Video"], readOnly: true },
    { key: "info", label: ["原视频", "Source"], readOnly: true },
    { key: "preset", label: ["方案", "Preset"], type: "select", options: ["", ...Object.keys(PRESETS)] },
    { key: "targetMB", label: ["目标MB", "Target MB"], type: "number" },
    { key: "maxHeight", label: ["最大高度", "Max height"], type: "select", options: HEIGHTS },
    { key: "audio", label: ["音频", "Audio"], type: "select", options: ["", ...Object.keys(AUDIO)] },
    { key: "name", label: ["文件名", "Name"] },
    { key: "estimate", label: ["预计", "Estimate"], readOnly: true },
  ] as Column[],
  async load({ ws, files, previous }) {
    const list: string[] = [];
    for (const f of files) {
      if (EXTS.some((e) => f.toLowerCase().endsWith(e))) list.push(f);
      else for (const x of await ws.list({ dir: f, exts: EXTS, limit: 2000 })) list.push(x.path);
    }
    const uniq = [...new Set(list)].filter((f) => !f.split("/").includes("video-compressor")).sort((a, b) => a.localeCompare(b, "en"));
    if (!uniq.length) throw new KitError("no_files", `No video files found (${EXTS.join(" ")}).`);
    const prev = new Map((previous ?? []).map((r) => [s(r.file), r]));
    const rows: Row[] = [];
    for (const f of uniq) {
      const abs = ws.resolve(f);
      const info = await probe(abs);
      if (!info.hasVideo) continue;
      const bytes = (await stat(abs)).size;
      const kbps = info.duration ? Math.round((bytes * 8) / 1000 / info.duration) : 0;
      const old = prev.get(f);
      rows.push({
        file: f, info: `${info.width}×${info.height} · ${fmtTime(info.duration)} · ${mb(bytes)} MB · ${kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`}`,
        preset: old?.preset ?? "", targetMB: old?.targetMB ?? "", maxHeight: old?.maxHeight ?? "", audio: old?.audio ?? "", name: old?.name ?? "",
        _w: info.width, _h: info.height, _fps: info.fps, _dur: info.duration, _bytes: bytes, _audio: info.hasAudio,
      });
    }
    if (!rows.length) throw new KitError("no_video", "None of the files has a video stream.");
    return { rows };
  },
  compute(p): Computed {
    const issues: Issue[] = [];
    let before = 0, after = 0;
    const names = new Map<string, number>();
    const rows = p.rows.map((r, i) => {
      const sr = src(r), pl = plan(r, p.settings);
      const est = estimate(sr, pl);
      before += sr.bytes; after += Math.min(est, sr.bytes);
      const n = outName(r);
      if (names.has(n)) issues.push({ level: "error", row: i, key: "name", message: `Rows ${names.get(n)} and ${i} would both write compressed/${n} — give one a name / 输出文件名重复` });
      names.set(n, i);
      if (!(pl.preset in PRESETS)) issues.push({ level: "error", row: i, key: "preset", message: `Row ${i}: preset must be ${Object.keys(PRESETS).join(", ")} / 方案不对` });
      if (!(pl.audio in AUDIO)) issues.push({ level: "error", row: i, key: "audio", message: `Row ${i}: audio must be ${Object.keys(AUDIO).join(", ")} / 音频选项不对` });
      if (pl.preset === "target") {
        const k = targetKbps(sr, pl);
        if (pl.targetMB * 1048576 >= sr.bytes) issues.push({ level: "info", row: i, key: "targetMB", message: `Row ${i}: ${s(r.file).split("/").pop()} is already ${mb(sr.bytes)} MB — the ${pl.targetMB} MB target is not smaller / 原文件已小于目标` });
        else if (k.video < 150) issues.push({ level: "warn", row: i, key: "targetMB", message: `Row ${i}: ${pl.targetMB} MB leaves only ${Math.max(0, k.video)} kbps for ${fmtTime(sr.duration)} of video — expect a blurry result; raise the target or lower the max height / 目标太小，画面会很糊` });
      }
      const { w, h } = outSize(sr, pl.maxHeight);
      const saved = sr.bytes ? Math.round((1 - Math.min(est, sr.bytes) / sr.bytes) * 100) : 0;
      return { ...r, estimate: `${w}×${h} · ${pl.preset === "target" ? "" : "≈"}${mb(est)} MB${saved > 0 ? ` (−${saved}%)` : " (不会更小)"}` };
    });
    return {
      rows,
      issues,
      summary: `${p.rows.length} video(s), ${mb(before)} MB → about ${mb(after)} MB (rough estimate). 共 ${p.rows.length} 个视频，预计 ${mb(before)} MB → 约 ${mb(after)} MB。`,
      stats: { videos: p.rows.length, beforeMB: Number(mb(before)), estimateMB: Number(mb(after)) },
    };
  },
  exports: [
    {
      id: "videos", label: ["压缩视频", "Compress videos"], description: "compressed/<name>.mp4 for every row (H.264 + AAC, fast start) and compress-report.csv",
      async run({ project, write, ws, outDir, log }: ExportCtx) {
        const files: string[] = [], report: unknown[][] = [], notes: string[] = [];
        const tmp = join(tmpdir(), `vcompress-${process.pid}-${Date.now()}`);
        await mkdir(tmp, { recursive: true });
        try {
          for (const [i, r] of project.rows.entries()) {
            const sr = src(r), pl = plan(r, project.settings);
            const input = ws.resolve(s(r.file));
            const rel = `${outDir}/compressed/${outName(r)}`;
            const abs = ws.resolve(rel);
            await mkdir(dirname(abs), { recursive: true });
            const t0 = Date.now();
            const skip = project.settings.keepSmaller !== false && pl.preset === "target" && pl.targetMB * 1048576 >= sr.bytes;
            if (skip) await copyFile(input, abs);
            else if (pl.preset === "target") {
              const log2 = join(tmp, `p${i}`);
              await ffmpeg(args(input, abs, sr, pl, { n: 1, log: log2 }), { timeoutMs: 4 * 3600_000, duration: sr.duration });
              await ffmpeg(args(input, abs, sr, pl, { n: 2, log: log2 }), { timeoutMs: 4 * 3600_000, duration: sr.duration });
            } else await ffmpeg(args(input, abs, sr, pl), { timeoutMs: 4 * 3600_000, duration: sr.duration });
            let size = (await stat(abs)).size;
            let result = "compressed";
            if (skip || (project.settings.keepSmaller !== false && size >= sr.bytes)) {
              await rm(abs, { force: true });
              const keep = `${outDir}/compressed/${s(r.file).split("/").pop()}`;
              await copyFile(input, ws.resolve(keep));
              size = sr.bytes; result = "kept original (already small)";
              notes.push(`${s(r.file)} was already well compressed — copied the original as ${keep.split("/").pop()}`);
              files.push(keep);
            } else files.push(rel);
            const { w, h } = outSize(sr, pl.maxHeight);
            log(`${s(r.file)} → ${mb(size)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
            report.push([s(r.file), result === "compressed" ? outName(r) : s(r.file).split("/").pop(), pl.preset, pl.preset === "target" ? pl.targetMB : PRESETS[pl.preset].crf, `${sr.width}x${sr.height}`, result === "compressed" ? `${w}x${h}` : `${sr.width}x${sr.height}`, pl.audio, mb(sr.bytes), mb(size), sr.bytes ? `${Math.round((1 - size / sr.bytes) * 100)}%` : "", ((Date.now() - t0) / 1000).toFixed(1), result]);
          }
        } finally { await rm(tmp, { recursive: true, force: true }); }
        files.push(await write("compress-report.csv", toCsv(["video", "output", "preset", "crf_or_target_mb", "source_size", "output_size", "audio", "before_mb", "after_mb", "saved", "seconds", "result"], report)));
        return { files, note: notes.join("\n") || undefined };
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${s(r.file)} [${s(r.info)}] ${s(r.preset) || "(default)"}${s(r.preset) === "target" ? ` ${s(r.targetMB)}MB` : ""}${s(r.maxHeight) ? ` ≤${s(r.maxHeight)}p` : ""}${s(r.audio) ? ` ${s(r.audio)}` : ""} → ${s(r.estimate)}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
