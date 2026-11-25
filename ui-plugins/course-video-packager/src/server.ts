import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { zipSync } from "fflate";
import { z } from "zod";
import { ffmpeg, findFfmpeg, fmtTime, probe } from "./kit/ffmpeg.ts";
import { escapeXml, initRenderer, loadFonts, renderSvg, textSvg, wrapLines, type FontSet } from "./kit/render.ts";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { chapterFile, normalizeProject, type Project } from "./course.ts";
import { clock, digest, gaps, parseSubtitles, sliceCues, toSrt, toVtt, type Cue } from "./subs.ts";

export const NAME = "course-video-packager";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".mkv", ".m4v"];
const SUB_EXTS = [".srt", ".vtt"];

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  fontPath?: string;
  log?: (line: string) => void;
}

/** 静音段（可能的换章处）。 */
async function silences(path: string, duration: number) {
  const { stderr } = await ffmpeg(["-i", path, "-vn", "-af", "silencedetect=n=-35dB:d=0.8", "-f", "null", "-"], { timeoutMs: 20 * 60_000, duration });
  const out: { at: number; length: number }[] = [];
  let start: number | undefined;
  for (const line of stderr.split("\n")) {
    const s = /silence_start: ([\d.]+)/.exec(line);
    if (s) start = Number(s[1]);
    const e = /silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/.exec(line);
    if (e && start !== undefined) {
      out.push({ at: Math.round(((start + Number(e[1])) / 2) * 10) / 10, length: Math.round(Number(e[2]) * 10) / 10 });
      start = undefined;
    }
  }
  return out;
}

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({
    name: NAME,
    version: VERSION,
    panelUri: PANEL_URI,
    surface: "editor",
    panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"),
    log: options.log,
  });
  void initRenderer(join(options.assetRoot, "resvg.wasm")).catch(() => undefined);

  async function videoInfo(path: string) {
    if (!VIDEO_EXTS.includes(extname(path).toLowerCase())) throw new KitError("bad_video", `${path} is not a video (${VIDEO_EXTS.join(", ")}).`);
    const abs = ws.resolve(path);
    await stat(abs).catch(() => {
      throw new KitError("not_found", `File not found: ${path}`);
    });
    const info = await probe(abs);
    if (!info.hasVideo || !info.duration) throw new KitError("bad_video", `${path} has no video stream.`);
    return info;
  }
  async function cuesOf(path?: string): Promise<Cue[]> {
    if (!path) return [];
    if (!SUB_EXTS.includes(extname(path).toLowerCase())) throw new KitError("bad_subtitles", "Subtitles must be .srt or .vtt.");
    return parseSubtitles(await ws.readText(path));
  }
  async function findSubtitles(video: string) {
    const stem = video.slice(0, video.length - extname(video).length);
    const dir = video.includes("/") ? video.slice(0, video.lastIndexOf("/")) : ".";
    const files = (await ws.list({ dir, exts: SUB_EXTS, recursive: false })).map((f) => f.path);
    return files.find((f) => f.startsWith(stem));
  }
  const projectPath = (p: Project) => `${p.output}/course.json`;

  async function load(value: unknown) {
    let raw: any = value;
    if (typeof value === "string") {
      try {
        raw = JSON.parse(await ws.readText(value));
      } catch (error) {
        if (error instanceof KitError) throw error;
        throw new KitError("bad_project", `${value} is not valid JSON.`);
      }
    }
    // 先检查结构再探测视频，否则 {project:{}} 会在 ffprobe 处变成 internal_error（TEST-FINDINGS #5）
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new KitError("bad_project", "Project must be an object like {video, subtitles?, title?, chapters: [{title, start}]}.");
    if (typeof raw.video !== "string" || !raw.video.trim()) throw new KitError("bad_project", "Project needs `video` (workspace path of the full lecture recording).");
    const info = await videoInfo(raw.video);
    const result = normalizeProject(raw, info.duration);
    if (result.project.subtitles) ws.resolve(result.project.subtitles);
    ws.resolve(result.project.output);
    return { ...result, info };
  }

  const describe = (p: Project) => p.chapters.map((c, i) => `${i + 1}. ${clock(c.start)}–${clock(c.end)} ${c.title}`).join("\n");

  tool(
    "course_open",
    {
      description:
        "Open Course Video Packager for a full lecture recording (MP4/MOV/WebM/MKV) and its subtitles (SRT/VTT; found automatically next to the video). Returns the duration, a timestamped transcript digest, long silences and subtitle gaps (likely chapter breaks), and opens the chapter panel. Then propose chapters (title + start) with course_save and build the package with course_build. Needs ffmpeg.",
      input: {
        video: z.string().optional(),
        subtitles: z.string().optional().describe("SRT/VTT for the whole video (optional)."),
        project: z.string().optional().describe("A saved course.json to reopen."),
      },
      openPanel: true,
      readOnly: true,
      timeoutMs: 1_200_000,
    },
    async ({ video, subtitles, project: saved }) => {
      await findFfmpeg();
      let project: Project;
      let warnings: string[] = [];
      let duration: number;
      if (saved) {
        const r = await load(saved);
        ({ project, warnings } = r);
        duration = r.info.duration;
      } else {
        if (!video) throw new KitError("missing_video", "Pass `video` (or `project`).");
        const info = await videoInfo(video);
        duration = info.duration;
        const subs = subtitles ?? (await findSubtitles(video));
        project = normalizeProject({ video, subtitles: subs, title: basename(video, extname(video)), chapters: [] }, duration).project;
      }
      const cues = await cuesOf(project.subtitles);
      const quiet = await silences(ws.resolve(project.video), duration);
      const subGaps = gaps(cues);
      const candidates = [...quiet.map((s) => ({ ...s, kind: "silence" })), ...subGaps.map((g) => ({ ...g, kind: "subtitle gap" }))].sort((a, b) => b.length - a.length).slice(0, 40).sort((a, b) => a.at - b.at);
      const text = [
        `${project.video}: ${fmtTime(duration)}${project.subtitles ? `, subtitles ${project.subtitles} (${cues.length} cues)` : ", no subtitles (chapters can still be set by time; per-chapter subtitles are skipped)"}.`,
        candidates.length ? `Possible breaks (longest pauses): ${candidates.map((c) => `${clock(c.at)} (${c.kind} ${c.length}s)`).join(", ")}` : "No long pauses found.",
        ...warnings.map((w) => `! ${w}`),
        cues.length ? `\nTranscript digest:\n${digest(cues)}` : "",
        `\nNext: course_save(project: {video, subtitles, title, author, chapters: [{title, start, summary}]}) — chapter starts in seconds or "mm:ss"; each chapter runs until the next one starts. Prefer starts at the pauses above. Then course_build.`,
      ].join("\n");
      return { text, structured: { kind: "project", project, duration, candidates, cues: cues.map((c) => [c.start, c.end]), warnings } };
    },
  );

  tool(
    "course_save",
    {
      description: "Validate and save the chapter plan as <output>/course.json (default course-package/). Chapters are sorted, chapters < 5 s apart are merged, each ends where the next starts.",
      input: { project: z.record(z.string(), z.unknown()) },
    },
    async ({ project: raw }) => {
      const { project, warnings, info } = await load(raw);
      const written = await ws.write(projectPath(project), JSON.stringify(project, null, 2) + "\n");
      return { text: [`Saved ${written}.`, describe(project), ...warnings.map((w) => `! ${w}`)].join("\n"), structured: { kind: "project", project, duration: info.duration, warnings, saved: written } };
    },
  );

  async function coverPng(fonts: FontSet, w: number, h: number, number: string, title: string, sub: string, accent: string) {
    const size = Math.round(h * 0.085);
    const family = fonts.boldFamily ?? fonts.family;
    const { lines } = wrapLines(title, w * 0.86, (t) => fonts.measure(t, size, true), 2);
    const top = h - h * 0.08 - lines.length * size * 1.2 - size * 0.9;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.82"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<rect x="${w * 0.07}" y="${top}" width="${size * 2.3}" height="${size * 0.82}" rx="${size * 0.2}" fill="${accent}"/>
${textSvg([number], { x: w * 0.07 + size * 1.15, y: top + size * 0.12, size: Math.round(size * 0.58), color: "#fff", family, weight: 700, anchor: "middle" })}
${textSvg(lines, { x: w * 0.07, y: top + size * 1.05, size, color: "#ffffff", family, weight: 700, lineHeight: 1.2, boldStroke: !fonts.boldFamily })}
${sub ? textSvg([sub], { x: w * 0.07, y: h - h * 0.07, size: Math.round(size * 0.38), color: "#e2e8f0", family: fonts.family }) : ""}
</svg>`;
    return (await renderSvg(svg, fonts)).png;
  }

  let building = false;
  tool(
    "course_build",
    {
      description:
        "Build the publishing package into the output folder: chapters/NN-title.mp4 (+ .srt/.vtt cut and re-timed from the full subtitles), covers/NN-title.jpg (frame + chapter number and title), cover.jpg, index.md (course outline with timestamps and summaries; also a YouTube-style chapter list), chapters.json / chapters.csv, and <title>.zip with everything. Saves course.json too.",
      input: { project: z.union([z.string(), z.record(z.string(), z.unknown())]).describe("Project object or path of a saved course.json.") },
      timeoutMs: 3_600_000,
    },
    async ({ project: value }) => {
      if (building) throw new KitError("busy", "A build is already running.");
      building = true;
      try {
        const { project, warnings, info } = await load(value);
        await ws.write(projectPath(project), JSON.stringify(project, null, 2) + "\n");
        const cues = await cuesOf(project.subtitles);
        const fonts = await loadFonts(options.fontPath);
        const src = ws.resolve(project.video);
        const out = project.output;
        await mkdir(ws.resolve(`${out}/chapters`), { recursive: true });
        await mkdir(ws.resolve(`${out}/covers`), { recursive: true });
        const W = 1280;
        const H = 720;
        const files: string[] = [];
        const tmpDir = ws.resolve(`${out}/.tmp`);
        await mkdir(tmpDir, { recursive: true });
        const cover = async (at: number, number: string, title: string, sub: string, target: string) => {
          const overlay = join(tmpDir, "overlay.png");
          await writeFile(overlay, await coverPng(fonts, W, H, number, title, sub, project.accent));
          await ffmpeg(["-ss", at.toFixed(2), "-i", src, "-i", overlay, "-frames:v", "1", "-filter_complex", `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[b];[b][1:v]overlay=0:0`, "-q:v", "3", ws.resolve(target)], { timeoutMs: 120_000 });
          files.push(target);
        };
        const rows = [];
        for (const [i, c] of project.chapters.entries()) {
          const base = chapterFile(i, c.title);
          const len = c.end - c.start;
          const mp4 = `${out}/chapters/${base}.mp4`;
          const args =
            project.mode === "copy"
              ? ["-ss", c.start.toFixed(3), "-i", src, "-t", len.toFixed(3), "-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-avoid_negative_ts", "make_zero", ...(extname(project.video).toLowerCase() === ".webm" ? [] : ["-movflags", "+faststart"])]
              : ["-ss", c.start.toFixed(3), "-i", src, "-t", len.toFixed(3), "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"];
          const target = project.mode === "copy" && extname(project.video).toLowerCase() === ".webm" ? mp4.replace(/\.mp4$/, ".webm") : mp4;
          await ffmpeg([...args, ws.resolve(target)], { timeoutMs: 60 * 60_000, duration: len });
          files.push(target);
          let subCount = 0;
          if (cues.length) {
            const part = sliceCues(cues, c.start, c.end);
            subCount = part.length;
            if (part.length) {
              files.push(await ws.write(`${out}/chapters/${base}.srt`, toSrt(part)));
              files.push(await ws.write(`${out}/chapters/${base}.vtt`, toVtt(part)));
            }
          }
          await cover(c.start + Math.min(8, len / 3), String(i + 1).padStart(2, "0"), c.title, project.title, `${out}/covers/${base}.jpg`);
          rows.push({ n: i + 1, title: c.title, start: c.start, end: c.end, duration: Math.round(len * 10) / 10, file: target.slice(out.length + 1), cover: `covers/${base}.jpg`, subtitles: subCount ? `chapters/${base}.srt` : "", summary: c.summary });
        }
        await cover(Math.min(info.duration / 4, 30), `${project.chapters.length}${/\p{Script=Han}/u.test(project.title + project.chapters[0].title) ? " 章" : " ch."}`, project.title, project.author, `${out}/cover.jpg`);
        await rm(tmpDir, { recursive: true, force: true });
        const zh = /\p{Script=Han}/u.test(project.title + project.chapters.map((c) => c.title).join(""));
        const md = [
          `# ${project.title}`,
          project.author ? `\n${zh ? "讲者" : "By"}：${project.author}` : "",
          `\n![${escapeXml(project.title)}](cover.jpg)\n`,
          `${zh ? "总时长" : "Total"}: ${clock(info.duration)} · ${rows.length} ${zh ? "章" : "chapters"}\n`,
          `| # | ${zh ? "章节" : "Chapter"} | ${zh ? "原片时间" : "Time"} | ${zh ? "时长" : "Length"} | ${zh ? "文件" : "File"} |`,
          "|---|---|---|---|---|",
          ...rows.map((r) => `| ${r.n} | ${r.title} | ${clock(r.start)}–${clock(r.end)} | ${clock(r.duration)} | [${r.file}](${encodeURI(r.file)}) |`),
          "",
          ...rows.flatMap((r) => [`## ${r.n}. ${r.title}`, "", `![](${encodeURI(r.cover)})`, "", r.summary || "", ""]),
          `## ${zh ? "整段视频的章节时间（可直接贴到视频平台简介）" : "Chapter list for the full video (paste into a video description)"}`,
          "",
          "```",
          ...rows.map((r) => `${clock(r.start)} ${r.title}`),
          "```",
          "",
        ].join("\n");
        files.push(await ws.write(`${out}/index.md`, md));
        files.push(await ws.write(`${out}/chapters.json`, JSON.stringify({ title: project.title, author: project.author, source: project.video, chapters: rows }, null, 2) + "\n"));
        const csv = ["n,title,start,end,duration,file,cover,subtitles", ...rows.map((r) => [r.n, r.title, clock(r.start), clock(r.end), r.duration, r.file, r.cover, r.subtitles].map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(","))].join("\n");
        files.push(await ws.write(`${out}/chapters.csv`, "\uFEFF" + csv + "\n"));
        const zipEntries: Record<string, Uint8Array> = {};
        for (const f of files) zipEntries[f.slice(out.length + 1)] = new Uint8Array(await readFile(ws.resolve(f)));
        const zipName = `${out}/${chapterFile(-1, project.title).slice(3)}.zip`;
        await ws.write(zipName, zipSync(zipEntries, { level: 0 }));
        return {
          text: [`Built ${rows.length} chapter(s) in ${out}/ and ${zipName}.`, ...rows.map((r) => `${r.n}. ${r.title} — ${clock(r.duration)}${r.subtitles ? "" : cues.length ? " (no subtitles in this range)" : ""}`), ...warnings.map((w) => `! ${w}`)].join("\n"),
          structured: { kind: "built", project, duration: info.duration, rows, zip: zipName, index: `${out}/index.md`, warnings },
        };
      } finally {
        building = false;
      }
    },
  );

  tool(
    "frame",
    { description: "JPEG frame at time t (panel preview).", input: { source: z.string(), t: z.number(), width: z.number().optional() }, visibility: ["app"], readOnly: true },
    async ({ source, t, width = 480 }) => {
      const abs = ws.resolve(source);
      await stat(abs).catch(() => {
        throw new KitError("not_found", `File not found: ${source}`);
      });
      const { stdout } = await ffmpeg([...(t > 0 ? ["-ss", String(t)] : []), "-i", abs, "-frames:v", "1", "-vf", `scale=${Math.min(960, Math.round(width))}:-2`, "-q:v", "5", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], { timeoutMs: 60_000 });
      return { text: "frame", structured: { data: stdout.toString("base64") } };
    },
  );

  tool(
    "workspace_files",
    { description: "Videos, subtitles and saved course.json files for the panel.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const files = (await ws.list({ exts: [...VIDEO_EXTS, ...SUB_EXTS, ".json"], limit: 3000 })).map((f) => f.path);
      return { text: `${files.length}`, structured: { videos: files.filter((f) => VIDEO_EXTS.includes(extname(f).toLowerCase()) && !/\/chapters\//.test(f)), subtitles: files.filter((f) => SUB_EXTS.includes(extname(f).toLowerCase())), projects: files.filter((f) => f.endsWith("/course.json") || f === "course.json") } };
    },
  );

  return server;
}
