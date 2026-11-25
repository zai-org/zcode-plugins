import { KitError } from "./kit/workspace.ts";

export interface Chapter {
  title: string;
  start: number;
  end: number;
  summary: string;
}
export interface Project {
  version: 1;
  video: string;
  subtitles?: string;
  title: string;
  author: string;
  accent: string;
  /** reencode：切点精确到帧；copy：不重新编码，最快，但切点落在最近的关键帧。 */
  mode: "reencode" | "copy";
  chapters: Chapter[];
  output: string;
}

const text = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown) => {
  if (typeof v === "string" && /^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(v.trim())) return v.trim().split(":").reduce((s, x) => s * 60 + Number(x), 0);
  return Number(v);
};

/** 校正章节：按开始时间排序、去掉过近的、结束时间 = 下一章开始（最后一章到视频结尾）。 */
export function normalizeProject(input: any, duration: number): { project: Project; warnings: string[] } {
  if (!input || typeof input !== "object") throw new KitError("bad_project", "Project must be an object.");
  if (typeof input.video !== "string" || !input.video) throw new KitError("bad_project", "Project needs `video`.");
  const warnings: string[] = [];
  const raw: any[] = Array.isArray(input.chapters) ? input.chapters : [];
  let chapters = raw
    .map((c, i) => ({ title: text(c?.title, 80) || `第 ${i + 1} 章`, start: num(c?.start), summary: text(c?.summary, 400) }))
    .filter((c) => {
      if (!Number.isFinite(c.start)) {
        warnings.push(`"${c.title}" has no valid start time — dropped.`);
        return false;
      }
      if (c.start >= duration - 1) {
        warnings.push(`"${c.title}" starts after the video ends (${duration.toFixed(1)}s) — dropped.`);
        return false;
      }
      return true;
    })
    .map((c) => ({ ...c, start: Math.max(0, Math.round(c.start * 10) / 10) }))
    .sort((a, b) => a.start - b.start);
  if (!chapters.length) chapters = [{ title: text(input.title, 80) || "全部", start: 0, summary: "" }];
  if (chapters[0].start > 0.5) warnings.push(`The first chapter starts at ${chapters[0].start}s; the part before it is not included.`);
  const kept: typeof chapters = [];
  for (const c of chapters) {
    const prev = kept[kept.length - 1];
    if (prev && c.start - prev.start < 5) {
      warnings.push(`"${c.title}" starts less than 5 s after "${prev.title}" — merged into it.`);
      continue;
    }
    kept.push(c);
  }
  const out: Chapter[] = kept.map((c, i) => ({ ...c, end: i + 1 < kept.length ? kept[i + 1].start : Math.round(duration * 10) / 10 }));
  return {
    project: {
      version: 1,
      video: input.video,
      ...(typeof input.subtitles === "string" && input.subtitles ? { subtitles: input.subtitles } : {}),
      title: text(input.title, 100) || "课程",
      author: text(input.author, 80),
      accent: typeof input.accent === "string" && /^#[0-9a-f]{6}$/i.test(input.accent) ? input.accent : "#2563eb",
      mode: input.mode === "copy" ? "copy" : "reencode",
      chapters: out,
      output: typeof input.output === "string" && input.output.trim() ? input.output.trim().replace(/\/+$/, "") : "course-package",
    },
    warnings,
  };
}

/** 文件名：两位序号 + 标题（保留中文，去掉不能用的字符）。 */
export function chapterFile(i: number, title: string) {
  const clean = title.replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "chapter";
  return `${String(i + 1).padStart(2, "0")}-${clean}`;
}
