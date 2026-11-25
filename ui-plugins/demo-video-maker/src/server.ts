import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { ffmpeg, findFfmpeg, fmtTime, probe, type MediaInfo } from "./kit/ffmpeg.ts";
import { initRenderer, loadFonts } from "./kit/render.ts";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { normalizeProject, toSrt, totalDuration, type Project } from "./project.ts";
import { concat, renderIntro, renderSegment } from "./render.ts";

export const NAME = "demo-video-maker";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".mkv", ".m4v"];
const DEFAULT_PROJECT = "demo/demo.demovideo.json";

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  fontPath?: string;
  log?: (line: string) => void;
}

const GUIDE = `Project shape (times in seconds; zoom/callout/subtitle "at" is relative to the segment start; rectangles are fractions 0..1 of the output frame):
{ size: "1920x1080", fps: 30, background: "#0f172a", accent: "#2563eb",
  intro: { title, subtitle, seconds: 3 },
  segments: [ { id, label, source, start, end, mute,
    zooms: [ { at, duration, x, y, w, h } ],
    callouts: [ { at, duration, text, position: "bottom"|"top" } ],
    subtitles: [ { at, duration, text } ] } ],
  output: "demo/demo.mp4" }
Tips: keep each segment to one step of the demo; zoom into the control being used (w 0.3–0.5), 2–4 s; one short callout per step; subtitles ≤ 2 lines.`;

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

  const infoCache = new Map<string, { mtime: number; info: MediaInfo }>();
  async function info(path: string) {
    if (!VIDEO_EXTS.includes(extname(path).toLowerCase())) throw new KitError("bad_video", `${path} is not a video (${VIDEO_EXTS.join(", ")}).`);
    const abs = ws.resolve(path);
    let st;
    try {
      st = await stat(abs);
    } catch {
      throw new KitError("not_found", `File not found: ${path}`);
    }
    const hit = infoCache.get(path);
    if (hit && hit.mtime === st.mtimeMs) return { ...hit, path };
    const result = await probe(ws.resolve(path));
    if (!result.hasVideo || !result.duration) throw new KitError("bad_video", `${path} has no video stream.`);
    infoCache.set(path, { mtime: st.mtimeMs, info: result });
    return { mtime: st.mtimeMs, info: result, path };
  }
  async function normalize(input: unknown) {
    const raw: any = input;
    const sources = [...new Set((Array.isArray(raw?.segments) ? raw.segments : []).map((s: any) => s?.source).filter((s: unknown) => typeof s === "string"))] as string[];
    const durations = new Map<string, number>();
    for (const s of sources) durations.set(s, (await info(s)).info.duration);
    const result = normalizeProject(raw, durations);
    ws.resolve(result.project.output);
    return result;
  }
  async function loadProjectFile(path: string) {
    try {
      return JSON.parse(await ws.readText(path));
    } catch (error) {
      if (error instanceof KitError) throw error;
      throw new KitError("bad_project", `${path} is not valid JSON.`);
    }
  }
  const describe = (project: Project) =>
    [
      `${project.width}×${project.height} @ ${project.fps} fps, total ${fmtTime(totalDuration(project))}${project.intro ? ` (intro ${project.intro.seconds}s)` : ""}.`,
      ...project.segments.map((s, i) => `${i + 1}. [${s.id}] ${s.label}: ${s.source} ${fmtTime(s.start)}–${fmtTime(s.end)} · ${s.zooms.length} zoom · ${s.callouts.length} callout · ${s.subtitles.length} subtitle${s.mute ? " · muted" : ""}`),
    ].join("\n");

  tool(
    "demo_open",
    {
      description:
        "Open Demo Video Maker with screen recordings (MP4/MOV/WebM) or a saved .demovideo.json project. Creates a draft with one segment per recording and opens the timeline panel. Then fill in zooms, callouts, subtitles and an intro with demo_save, and render with demo_render. Needs ffmpeg installed on the user's computer.",
      input: {
        recordings: z.array(z.string()).optional().describe("Workspace paths of screen recordings, in order."),
        project: z.string().optional().describe("Workspace path of a saved .demovideo.json project."),
      },
      openPanel: true,
      readOnly: true,
      timeoutMs: 120_000,
    },
    async ({ recordings, project: projectPath }) => {
      await findFfmpeg();
      let raw: any;
      if (projectPath) raw = await loadProjectFile(projectPath);
      else {
        if (!recordings?.length) throw new KitError("missing_input", "Pass `recordings` (screen recordings) or `project`.");
        const segments = [];
        for (const [i, r] of recordings.entries()) {
          const { info: m } = await info(r);
          segments.push({ id: `s${i + 1}`, label: basename(r, extname(r)), source: r, start: 0, end: m.duration });
        }
        raw = { size: "1920x1080", fps: 30, segments };
      }
      const { project, warnings } = await normalize(raw);
      const media = Object.fromEntries(await Promise.all([...new Set(project.segments.map((s) => s.source))].map(async (s) => [s, (await info(s)).info])));
      const text = [describe(project), ...warnings.map((w) => `! ${w}`), "", GUIDE, "", `Save with demo_save(path: "${projectPath ?? DEFAULT_PROJECT}", project).`].join("\n");
      return { text, structured: { kind: "project", project, path: projectPath ?? DEFAULT_PROJECT, media, warnings } };
    },
  );

  tool(
    "demo_save",
    {
      description: `Validate and save a demo video project (.demovideo.json). Times are clamped to the recordings, overlapping zooms are shortened, and zoom boxes are made to match the frame shape; the warnings say what changed. ${GUIDE}`,
      input: { path: z.string().optional().describe(`Default ${DEFAULT_PROJECT}.`), project: z.record(z.string(), z.unknown()) },
    },
    async ({ path = DEFAULT_PROJECT, project: raw }) => {
      const target = /\.json$/i.test(path) ? path : `${path}.demovideo.json`;
      const { project, warnings } = await normalize(raw);
      const written = await ws.write(target, JSON.stringify(project, null, 2) + "\n");
      return { text: [`Saved ${written}.`, describe(project), ...warnings.map((w) => `! ${w}`)].join("\n"), structured: { kind: "project", project, path: written, warnings } };
    },
  );

  tool(
    "demo_replace_segment",
    {
      description:
        "After a product update: replace the recording of one segment in a saved project (keeps its zooms, callouts and subtitles unless clear: true; they are clamped to the new length). Only that segment is re-rendered by demo_render; the others come from the cache.",
      input: {
        path: z.string().describe("Saved .demovideo.json project."),
        segment: z.string().describe("Segment id."),
        source: z.string().describe("New recording."),
        start: z.number().optional(),
        end: z.number().optional(),
        clear: z.boolean().optional().describe("Drop the old zooms, callouts and subtitles."),
      },
    },
    async ({ path, segment, source, start, end, clear }) => {
      const raw = await loadProjectFile(path);
      const seg = (raw.segments ?? []).find((s: any) => s.id === segment);
      if (!seg) throw new KitError("bad_segment", `No segment "${segment}". Ids: ${(raw.segments ?? []).map((s: any) => s.id).join(", ")}`);
      const { info: m } = await info(source);
      Object.assign(seg, { source, start: start ?? 0, end: end ?? m.duration });
      if (clear) Object.assign(seg, { zooms: [], callouts: [], subtitles: [] });
      const { project, warnings } = await normalize(raw);
      await ws.write(path, JSON.stringify(project, null, 2) + "\n");
      return { text: [`Segment ${segment} now uses ${source} (${fmtTime(m.duration)}). Saved ${path}. Run demo_render to update the video.`, ...warnings.map((w) => `! ${w}`)].join("\n"), structured: { kind: "project", project, path, warnings } };
    },
  );

  let rendering = false;
  tool(
    "demo_render",
    {
      description:
        "Render the project to MP4 (H.264/AAC) plus a .srt with the subtitles. Each segment is cached by its content, so after small edits or demo_replace_segment only changed segments are re-rendered. Saves the project next to the output.",
      input: { path: z.string().optional().describe(`Saved project (default ${DEFAULT_PROJECT}).`), project: z.record(z.string(), z.unknown()).optional().describe("Unsaved project to render (it is saved to path first).") },
      timeoutMs: 3_600_000,
    },
    async ({ path = DEFAULT_PROJECT, project: rawIn }) => {
      if (rendering) throw new KitError("busy", "A render is already running.");
      rendering = true;
      try {
        const raw = rawIn ?? (await loadProjectFile(path));
        const { project, warnings } = await normalize(raw);
        await ws.write(path, JSON.stringify(project, null, 2) + "\n");
        const fonts = await loadFonts(options.fontPath);
        const outAbs = ws.resolve(project.output);
        const cacheDir = join(dirname(outAbs), ".demo-cache");
        await mkdir(cacheDir, { recursive: true });
        const mt = new Map<string, number>();
        const audio = new Map<string, boolean>();
        for (const s of project.segments) {
          const i = await info(s.source);
          mt.set(s.source, i.mtime);
          audio.set(s.source, i.info.hasAudio);
        }
        const ctx = { project, fonts, cacheDir, abs: (p: string) => ws.resolve(p), hasAudio: (s: string) => !!audio.get(s), mtime: (s: string) => mt.get(s) ?? 0 };
        const files: string[] = [];
        const fresh: string[] = [];
        const reused: string[] = [];
        if (project.intro) {
          const r = await renderIntro(ctx);
          files.push(r.file);
          (r.fresh ? fresh : reused).push("intro");
        }
        for (const s of project.segments) {
          const r = await renderSegment(s, ctx);
          files.push(r.file);
          (r.fresh ? fresh : reused).push(s.id);
        }
        await mkdir(dirname(outAbs), { recursive: true });
        await concat(files, outAbs, join(cacheDir, "concat.txt"));
        const srt = project.output.replace(/\.mp4$/i, ".srt");
        const srtText = toSrt(project);
        if (srtText) await ws.write(srt, srtText);
        const result = await probe(outAbs);
        const text = [
          `Rendered ${project.output} (${fmtTime(result.duration)}, ${project.width}×${project.height}).${srtText ? ` Subtitles: ${srt}.` : ""}`,
          `Re-rendered: ${fresh.join(", ") || "none"}; reused from cache: ${reused.join(", ") || "none"}.`,
          ...warnings.map((w) => `! ${w}`),
        ].join("\n");
        return { text, structured: { kind: "rendered", project, path, output: project.output, srt: srtText ? srt : null, duration: result.duration, fresh, reused } };
      } finally {
        rendering = false;
      }
    },
  );

  tool(
    "frame",
    {
      description: "A JPEG frame of a video at time t, fitted into the project frame size (panel preview).",
      input: { source: z.string(), t: z.number(), width: z.number().optional(), height: z.number().optional(), background: z.string().optional() },
      visibility: ["app"],
      readOnly: true,
    },
    async ({ source, t, width = 1920, height = 1080, background = "#0f172a" }) => {
      const path = ws.resolve(source);
      await stat(path).catch(() => {
        throw new KitError("not_found", `File not found: ${source}`);
      });
      const W = 640;
      const H = Math.round((640 * height) / width / 2) * 2;
      const bg = /^#[0-9a-f]{6}$/i.test(background) ? background : "#0f172a";
      const { stdout } = await ffmpeg(["-ss", String(Math.max(0, t)), "-i", path, "-frames:v", "1", "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bg}`, "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], { timeoutMs: 60_000 });
      return { text: "frame", structured: { data: stdout.toString("base64") } };
    },
  );

  tool(
    "workspace_files",
    { description: "List videos and saved projects for the panel.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const files = await ws.list({ exts: [...VIDEO_EXTS, ".json"], limit: 3000 });
      return {
        text: `${files.length} file(s)`,
        structured: { videos: files.filter((f) => VIDEO_EXTS.includes(extname(f.path).toLowerCase())).map((f) => f.path), projects: files.filter((f) => f.path.endsWith(".demovideo.json")).map((f) => f.path) },
      };
    },
  );

  return server;
}
