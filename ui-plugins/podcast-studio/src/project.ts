import { KitError } from "./kit/workspace.ts";

export interface Track { file: string; name: string; offset: number; gain: number; mute: boolean }
export interface Cut { start: number; end: number; note: string }
export interface Project {
  version: 1;
  title: string;
  tracks: Track[];
  cuts: Cut[];
  intro: string;
  outro: string;
  denoise: "off" | "light" | "strong";
  loudness: number;
  format: "mp3" | "wav" | "both";
  output: string;
}

export const AUDIO_EXTS = [".mp3", ".m4a", ".wav", ".aif", ".aiff", ".flac", ".ogg", ".opus", ".aac", ".mp4", ".mov", ".webm", ".mkv"];

/** "1:02:03.5" / "12:30" / 75 → 秒。 */
export function seconds(v: unknown, what: string): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(v.trim())) {
    const neg = v.trim().startsWith("-");
    const s = v.trim().replace(/^-/, "").split(":").reduce((a, x) => a * 60 + Number(x), 0);
    return neg ? -s : s;
  }
  throw new KitError("bad_time", `${what}: "${String(v)}" is not a time (use seconds or mm:ss).`);
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function normalizeProject(raw: any, durations: Record<string, number>): { project: Project; warnings: string[] } {
  const warnings: string[] = [];
  const list = Array.isArray(raw?.tracks) ? raw.tracks : [];
  if (!list.length) throw new KitError("no_tracks", "Add at least one track (the host and guest recordings).");
  if (list.length > 8) throw new KitError("too_many_tracks", "At most 8 tracks.");
  const tracks: Track[] = list.map((t: any, i: number) => {
    const file = String(typeof t === "string" ? t : t?.file ?? "");
    if (!(file in durations)) throw new KitError("unknown_track", `Track ${i + 1}: ${file || "(empty)"} was not opened.`);
    return {
      file,
      name: String(t?.name ?? "").trim().slice(0, 40) || file.split("/").pop()!.replace(/\.[^.]+$/, ""),
      offset: r3(seconds(t?.offset ?? 0, `Track ${i + 1} offset`)),
      gain: Math.max(-30, Math.min(20, Number(t?.gain ?? 0) || 0)),
      mute: !!t?.mute,
    };
  });
  // 让最早开始的音轨从 0 开始
  const min = Math.min(...tracks.map((t) => t.offset));
  if (min !== 0) for (const t of tracks) t.offset = r3(t.offset - min);
  const total = timelineLength(tracks, durations);
  const cuts: Cut[] = [];
  for (const c of Array.isArray(raw?.cuts) ? raw.cuts : []) {
    let start = seconds(c?.start, "Cut start");
    let end = seconds(c?.end, "Cut end");
    if (end < start) [start, end] = [end, start];
    start = Math.max(0, start);
    end = Math.min(total, end);
    if (end - start < 0.05) {
      warnings.push(`Cut ${String(c?.start)}–${String(c?.end)} is empty or outside the recording — ignored.`);
      continue;
    }
    cuts.push({ start: r3(start), end: r3(end), note: String(c?.note ?? "").slice(0, 80) });
  }
  cuts.sort((a, b) => a.start - b.start);
  const merged: Cut[] = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end + 0.05) {
      last.end = Math.max(last.end, c.end);
      last.note = [last.note, c.note].filter(Boolean).join("; ");
    } else merged.push({ ...c });
  }
  const kept = total - merged.reduce((s, c) => s + c.end - c.start, 0);
  if (kept < 1) throw new KitError("everything_cut", "The cuts remove the whole episode.");
  const loud = Number(raw?.loudness ?? -16);
  return {
    project: {
      version: 1,
      title: String(raw?.title ?? "").trim().slice(0, 100) || "Episode",
      tracks,
      cuts: merged,
      intro: String(raw?.intro ?? ""),
      outro: String(raw?.outro ?? ""),
      denoise: ["off", "light", "strong"].includes(raw?.denoise) ? raw.denoise : "light",
      loudness: Number.isFinite(loud) ? Math.max(-30, Math.min(-10, loud)) : -16,
      format: ["mp3", "wav", "both"].includes(raw?.format) ? raw.format : "mp3",
      output: String(raw?.output ?? "").replace(/^\/+|\/+$/g, "") || "podcast",
    },
    warnings,
  };
}

export const timelineLength = (tracks: Track[], durations: Record<string, number>) => Math.max(...tracks.map((t) => t.offset + (durations[t.file] ?? 0)));

/** 剪掉区间后保留的片段。 */
export function keptSegments(cuts: Cut[], total: number): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const c of cuts) {
    if (c.start > at + 0.01) out.push([at, c.start]);
    at = Math.max(at, c.end);
  }
  if (total > at + 0.01) out.push([at, total]);
  return out;
}

/** 节目时间 → 剪辑后时间（用于章节/导出说明）。 */
export function afterCuts(t: number, cuts: Cut[]) {
  let removed = 0;
  for (const c of cuts) {
    if (t >= c.end) removed += c.end - c.start;
    else if (t > c.start) return c.start - removed;
  }
  return t - removed;
}
