import { createHash } from "node:crypto";
import { KitError } from "./kit/workspace.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Zoom extends Rect {
  /** 段内秒数（相对于段开头）。 */
  at: number;
  duration: number;
}
export interface Callout {
  at: number;
  duration: number;
  text: string;
  position: "top" | "bottom";
}
export interface Subtitle {
  at: number;
  duration: number;
  text: string;
}
export interface Segment {
  id: string;
  label: string;
  source: string;
  start: number;
  end: number;
  zooms: Zoom[];
  callouts: Callout[];
  subtitles: Subtitle[];
  /** 静音原声。 */
  mute: boolean;
}
export interface Intro {
  title: string;
  subtitle: string;
  seconds: number;
}
export interface Project {
  version: 1;
  width: number;
  height: number;
  fps: number;
  background: string;
  accent: string;
  intro?: Intro;
  segments: Segment[];
  output: string;
}

const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hex = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
const text = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** 校正工程：时间夹在源长度内、矩形归一化到 0..1、放大不重叠。durations 为各源文件时长。 */
export function normalizeProject(input: any, durations: Map<string, number>): { project: Project; warnings: string[] } {
  if (!input || typeof input !== "object") throw new KitError("bad_project", "Project must be an object.");
  const warnings: string[] = [];
  const size = String(input.size ?? "");
  const [w, h] = /^\d+x\d+$/.test(size) ? size.split("x").map(Number) : [num(input.width, 1920), num(input.height, 1080)];
  const width = clamp(Math.round(w / 2) * 2, 320, 3840);
  const height = clamp(Math.round(h / 2) * 2, 240, 2160);
  const segIn: any[] = Array.isArray(input.segments) ? input.segments : [];
  if (!segIn.length) throw new KitError("no_segments", "Add at least one segment: {source, start, end}.");
  const ids = new Set<string>();
  const segments = segIn.map((s, i): Segment => {
    if (typeof s?.source !== "string" || !s.source) throw new KitError("bad_segment", `Segment ${i + 1} has no source.`);
    const duration = durations.get(s.source);
    if (duration === undefined) throw new KitError("bad_segment", `Segment ${i + 1}: ${s.source} is not a readable video.`);
    let id = text(s.id, 40).replace(/[^\w-]/g, "") || `s${i + 1}`;
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    const start = clamp(num(s.start, 0), 0, Math.max(0, duration - 0.2));
    let end = clamp(num(s.end, duration), start + 0.2, duration);
    if (s.end !== undefined && num(s.end, duration) > duration + 0.05) warnings.push(`${id}: end ${s.end}s is past the end of ${s.source} (${duration.toFixed(1)}s) — clamped.`);
    end = Math.round(end * 100) / 100;
    const len = end - start;
    const within = (at: number, d: number, what: string) => {
      const a = clamp(at, 0, Math.max(0, len - 0.1));
      const dd = clamp(d, 0.3, len - a);
      if (at > len) warnings.push(`${id}: ${what} at ${at}s is after the segment ends (${len.toFixed(1)}s) — moved.`);
      return [Math.round(a * 100) / 100, Math.round(dd * 100) / 100] as const;
    };
    const zooms = (Array.isArray(s.zooms) ? s.zooms : [])
      .map((z: any) => {
        const [at, d] = within(num(z.at, 0), num(z.duration, 2.5), "zoom");
        let zw = clamp(num(z.w, 0.5), 0.1, 1);
        let zh = clamp(num(z.h, zw), 0.1, 1);
        // 矩形是相对输出画面的比例坐标；放大框必须与画面同比例，取能容纳选区的最小正方（归一化）框。
        zw = zh = Math.max(zw, zh);
        zw = Math.min(1, zw);
        zh = Math.min(1, zh);
        const x = clamp(num(z.x, 0.25), 0, 1 - zw);
        const y = clamp(num(z.y, 0.25), 0, 1 - zh);
        return { at, duration: d, x: round4(x), y: round4(y), w: round4(zw), h: round4(zh) };
      })
      .sort((a: Zoom, b: Zoom) => a.at - b.at);
    for (let k = 1; k < zooms.length; k++) {
      const prev = zooms[k - 1];
      if (zooms[k].at < prev.at + prev.duration) {
        prev.duration = Math.max(0.3, Math.round((zooms[k].at - prev.at) * 100) / 100);
        warnings.push(`${id}: zooms overlapped — shortened the one at ${prev.at}s.`);
      }
    }
    const timed = (list: unknown, what: string) =>
      (Array.isArray(list) ? list : [])
        .map((c: any) => {
          const t = text(c.text, 160);
          if (!t) return undefined;
          const [at, d] = within(num(c.at, 0), num(c.duration, 3), what);
          return { at, duration: d, text: t, position: c.position === "top" ? "top" : "bottom" };
        })
        .filter(Boolean) as Callout[];
    return {
      id,
      label: text(s.label, 60) || id,
      source: s.source,
      start: Math.round(start * 100) / 100,
      end,
      zooms,
      callouts: timed(s.callouts, "callout"),
      subtitles: timed(s.subtitles, "subtitle").map(({ at, duration, text: t }) => ({ at, duration, text: t })),
      mute: !!s.mute,
    };
  });
  const introIn = input.intro;
  const intro = introIn && text(introIn.title) ? { title: text(introIn.title, 80), subtitle: text(introIn.subtitle, 120), seconds: clamp(num(introIn.seconds, 3), 1, 10) } : undefined;
  return {
    project: {
      version: 1,
      width,
      height,
      fps: clamp(Math.round(num(input.fps, 30)), 15, 60),
      background: hex(input.background, "#0f172a"),
      accent: hex(input.accent, "#2563eb"),
      ...(intro ? { intro } : {}),
      segments,
      output: typeof input.output === "string" && /\.mp4$/i.test(input.output) ? input.output : "demo/demo.mp4",
    },
    warnings,
  };
}
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** 段的缓存键：内容 + 源文件修改时间 + 全局画面设置。 */
export function segmentKey(seg: Segment, project: Project, mtime: number, fontPath: string) {
  const h = createHash("sha1");
  h.update(JSON.stringify({ seg: { ...seg, label: undefined }, w: project.width, h: project.height, fps: project.fps, bg: project.background, accent: project.accent, mtime, fontPath, v: 3 }));
  return h.digest("hex").slice(0, 16);
}

export function totalDuration(project: Project) {
  return (project.intro?.seconds ?? 0) + project.segments.reduce((s, x) => s + (x.end - x.start), 0);
}

/** SRT：全片字幕（按段偏移）。 */
export function toSrt(project: Project) {
  let offset = project.intro?.seconds ?? 0;
  const cues: string[] = [];
  const ts = (s: number) => {
    const ms = Math.round(s * 1000);
    const p = (n: number, l = 2) => String(n).padStart(l, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  for (const seg of project.segments) {
    for (const sub of seg.subtitles) cues.push(`${cues.length + 1}\n${ts(offset + sub.at)} --> ${ts(offset + sub.at + sub.duration)}\n${sub.text}\n`);
    offset += seg.end - seg.start;
  }
  return cues.join("\n");
}
