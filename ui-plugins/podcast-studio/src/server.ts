import { readFile, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { analyse, buildGraph, estimateOffset, parseLoudnorm, type Analysis } from "./audio.ts";
import { ffmpeg, fmtTime } from "./kit/ffmpeg.ts";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace, safeFileName } from "./kit/workspace.ts";
import { AUDIO_EXTS, afterCuts, keptSegments, normalizeProject, timelineLength, type Project } from "./project.ts";

export const NAME = "podcast-studio";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const MIN_CONFIDENCE = 1.25;

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  log?: (line: string) => void;
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

  const cache = new Map<string, { mtime: number; data: Promise<Analysis> }>();
  async function audioFile(file: unknown, what: string) {
    if (typeof file !== "string" || !file) throw new KitError("missing_file", `${what}: pass a file path.`);
    if (!AUDIO_EXTS.includes(extname(file).toLowerCase())) throw new KitError("bad_audio", `${what}: unsupported file type ${extname(file) || file}.`);
    const abs = ws.resolve(file);
    const st = await stat(abs).catch(() => {
      throw new KitError("not_found", `${what}: file not found: ${file}`);
    });
    return { abs, mtime: st.mtimeMs };
  }
  async function analysis(file: string) {
    const { abs, mtime } = await audioFile(file, "Track");
    const hit = cache.get(abs);
    if (hit && hit.mtime === mtime) return hit.data;
    const data = analyse(abs);
    cache.set(abs, { mtime, data });
    data.catch(() => cache.delete(abs));
    return data;
  }
  async function durations(p: { tracks?: unknown }) {
    const out: Record<string, number> = {};
    for (const t of Array.isArray(p.tracks) ? p.tracks : []) {
      const file = typeof t === "string" ? t : (t as any)?.file;
      out[file] = (await analysis(file)).duration;
    }
    return out;
  }
  async function normalize(raw: any) {
    const d = await durations(raw ?? {});
    const { project, warnings } = normalizeProject(raw, d);
    if (project.tracks.every((t) => t.mute)) throw new KitError("all_muted", "All tracks are muted.");
    for (const [k, f] of [["Intro", project.intro], ["Outro", project.outro]] as const) if (f) await audioFile(f, k);
    return { project, warnings, durations: d, total: timelineLength(project.tracks, d) };
  }
  const projectPath = (p: Project) => `${p.output}/${safeFileName(p.title, "episode")}.podcast.json`;

  /** 以第 1 轨为参考，估计其余音轨的偏移。 */
  async function align(p: Project) {
    const ref = await analysis(p.tracks[0].file);
    const report: string[] = [];
    const confidences: number[] = [99];
    for (const t of p.tracks.slice(1)) {
      const r = estimateOffset(ref.head, (await analysis(t.file)).head);
      confidences.push(r.confidence);
      if (r.confidence >= MIN_CONFIDENCE) {
        t.offset = p.tracks[0].offset + r.offset;
        report.push(`${t.name}: ${r.offset >= 0 ? "+" : ""}${r.offset.toFixed(3)} s vs ${p.tracks[0].name} (confidence ${r.confidence.toFixed(2)})`);
      } else report.push(`${t.name}: no reliable match (confidence ${r.confidence.toFixed(2)}); offset left at ${(t.offset - p.tracks[0].offset).toFixed(3)} s — line it up in the panel, or record a clap at the start next time.`);
    }
    return { report, confidences };
  }

  async function pauses(p: Project, total: number) {
    const { inputs, filter } = buildGraph(p, (f) => ws.resolve(f), { total, cuts: false, loudnorm: false });
    const { stderr } = await ffmpeg([...inputs, "-filter_complex", `${filter};[out]silencedetect=n=-38dB:d=2.5[o]`, "-map", "[o]", "-f", "null", "-"], { timeoutMs: 900_000 });
    const out: { start: number; end: number }[] = [];
    let s: number | undefined;
    for (const line of stderr.split("\n")) {
      const a = /silence_start: ([\d.]+)/.exec(line);
      const b = /silence_end: ([\d.]+)/.exec(line);
      if (a) s = Number(a[1]);
      if (b && s !== undefined) {
        out.push({ start: Math.round(s * 10) / 10, end: Math.round(Number(b[1]) * 10) / 10 });
        s = undefined;
      }
    }
    return out;
  }

  function summary(p: Project, total: number) {
    const kept = keptSegments(p.cuts, total).reduce((s, [a, b]) => s + b - a, 0);
    return [
      `${p.title}: ${p.tracks.length} track(s) — ${p.tracks.map((t) => `${t.name}${t.mute ? " (muted)" : ""} @${t.offset.toFixed(2)}s ${t.gain ? `${t.gain > 0 ? "+" : ""}${t.gain} dB` : ""}`.trim()).join(", ")}.`,
      `Timeline ${fmtTime(total)}; ${p.cuts.length} cut(s) removing ${fmtTime(total - kept)} → episode body ${fmtTime(kept)}${p.intro ? ` + intro ${p.intro}` : ""}${p.outro ? ` + outro ${p.outro}` : ""}.`,
      `Noise reduction: ${p.denoise}; loudness target ${p.loudness} LUFS; output ${p.output}/ (${p.format}).`,
    ].join("\n");
  }

  const projectSchema = z
    .record(z.string(), z.unknown())
    .describe('{title, tracks: [{file, name, offset (s on the timeline), gain (dB), mute}], cuts: [{start, end, note}] (timeline times, seconds or "mm:ss"; applied to all tracks), intro, outro, denoise "off"|"light"|"strong", loudness (LUFS, default -16), format "mp3"|"wav"|"both", output (folder)}');

  tool(
    "podcast_open",
    {
      description:
        "Open Podcast Studio with the host/guest recordings of one episode (one file per microphone, or a single file), or an existing project (.podcast.json). Lines the tracks up automatically (cross-correlation on mic bleed or a clap), finds long pauses in the mix, and opens the panel with waveforms. Then plan cuts with podcast_save and render with podcast_render.",
      input: {
        tracks: z.array(z.string()).optional().describe("Audio/video files, one per speaker. The first is the reference."),
        project: z.string().optional().describe("Existing .podcast.json"),
        title: z.string().optional(),
        intro: z.string().optional(),
        outro: z.string().optional(),
      },
      openPanel: true,
      timeoutMs: 1_200_000,
    },
    async ({ tracks, project: path, title, intro, outro }) => {
      let raw: any;
      let report: string[] = [];
      if (path) {
        try {
          raw = JSON.parse(await ws.readText(path));
        } catch {
          throw new KitError("bad_project", `Cannot read project ${path}.`);
        }
      } else {
        if (!tracks?.length) throw new KitError("no_tracks", "Pass `tracks` (one recording per speaker) or `project`.");
        raw = { title: title || basename(tracks[0], extname(tracks[0])), tracks: tracks.map((file: string) => ({ file })), intro, outro };
      }
      let { project, warnings, total } = await normalize(raw);
      let confidences: number[] = [];
      if (!path && project.tracks.length > 1) {
        ({ report, confidences } = await align(project));
        ({ project, total } = await normalize(project));
      }
      const found = await pauses(project, total);
      await ws.write(projectPath(project), JSON.stringify(project, null, 1) + "\n");
      const text = [
        summary(project, total),
        report.length ? `Alignment:\n${report.map((r) => `- ${r}`).join("\n")}` : "",
        found.length ? `Long pauses (≥2.5 s) in the mix: ${found.map((p) => `${fmtTime(p.start)}–${fmtTime(p.end)}`).join(", ")}` : "No pauses ≥2.5 s.",
        ...warnings.map((w) => `! ${w}`),
        `Project saved: ${projectPath(project)}. Next: podcast_save(project) with cuts the user asked for (e.g. {start: "12:30", end: "14:05", note: "off-topic"}); shorten long pauses to ~1 s only if the user wants that. Then podcast_render(project).`,
      ].filter(Boolean).join("\n");
      return { text, structured: { kind: "project", project, total, pauses: found, confidences, warnings } };
    },
  );

  tool(
    "podcast_save",
    { description: "Validate and save the episode project (track offsets/gains/mutes, cuts, intro/outro, noise reduction, loudness, format). Cuts are sorted and merged.", input: { project: projectSchema } },
    async ({ project: raw }) => {
      const { project, warnings, total } = await normalize(raw);
      await ws.write(projectPath(project), JSON.stringify(project, null, 1) + "\n");
      return { text: [summary(project, total), ...warnings.map((w) => `! ${w}`), `Saved ${projectPath(project)}.`].join("\n"), structured: { kind: "project", project, total, warnings } };
    },
  );

  tool(
    "podcast_align",
    { description: "Re-run automatic alignment of the tracks.", input: { project: projectSchema }, visibility: ["app"] },
    async ({ project: raw }) => {
      let { project } = await normalize(raw);
      for (const t of project.tracks) t.offset = 0;
      const { report, confidences } = await align(project);
      let total: number;
      ({ project, total } = await normalize(project));
      return { text: report.join("\n"), structured: { kind: "aligned", project, total, report, confidences } };
    },
  );

  tool(
    "podcast_render",
    {
      description:
        "Render the episode: align, apply gains and noise reduction, mix, remove the cuts on all tracks at once (with 15 ms fades), add intro/outro, two-pass EBU R128 loudness normalisation to the target, and export MP3 (128 kbps stereo, ID3 title) and/or WAV, plus the project file and a cut list.",
      input: { project: projectSchema },
      timeoutMs: 3_600_000,
    },
    async ({ project: raw }) => {
      const { project: p, total } = await normalize(raw);
      const abs = (f: string) => ws.resolve(f);
      const g1 = buildGraph(p, abs, { total, intro: p.intro, outro: p.outro, loudnorm: {} });
      const pass1 = await ffmpeg([...g1.inputs, "-filter_complex", g1.filter, "-map", "[out]", "-f", "null", "-"], { timeoutMs: 3_600_000 });
      const measured = parseLoudnorm(pass1.stderr);
      const g2 = buildGraph(p, abs, { total, intro: p.intro, outro: p.outro, loudnorm: { measured } });
      const base = `${p.output}/${safeFileName(p.title, "episode")}`;
      const files: string[] = [];
      const wav = `${base}.wav`;
      const tmp = `${base}.render.wav`;
      await ws.write(tmp, "");
      const pass2 = await ffmpeg([...g2.inputs, "-filter_complex", g2.filter, "-map", "[out]", "-ar", "44100", "-c:a", "pcm_s16le", ws.resolve(tmp)], { timeoutMs: 3_600_000 });
      const stats = parseLoudnorm(pass2.stderr);
      if (p.format === "mp3" || p.format === "both") {
        await ffmpeg(["-i", ws.resolve(tmp), "-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "3", "-metadata", `title=${p.title}`, ws.resolve(`${base}.mp3`)], { timeoutMs: 1_800_000 });
        files.push(`${base}.mp3`);
      }
      if (p.format === "wav" || p.format === "both") {
        await ffmpeg(["-i", ws.resolve(tmp), "-c", "copy", "-metadata", `title=${p.title}`, ws.resolve(wav)], { timeoutMs: 600_000 });
        files.push(wav);
      }
      await rm(ws.resolve(tmp), { force: true });
      const introLen = p.intro ? (await analysis(p.intro).catch(() => undefined))?.duration ?? 0 : 0;
      const kept = keptSegments(p.cuts, total).reduce((s, [a, b]) => s + b - a, 0);
      const cutList = [
        `# ${p.title}`,
        "",
        `Rendered ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · loudness ${stats.output_i} LUFS (target ${p.loudness}), true peak ${stats.output_tp} dBTP`,
        "",
        "| Track | Offset | Gain | |",
        "|---|---|---|---|",
        ...p.tracks.map((t) => `| ${t.name} (${t.file}) | ${t.offset.toFixed(3)} s | ${t.gain} dB | ${t.mute ? "muted" : ""} |`),
        "",
        p.cuts.length ? "| Cut (recording time) | Length | Lands at (episode time) | Note |\n|---|---|---|---|" : "No cuts.",
        ...p.cuts.map((c) => `| ${fmtTime(c.start)} – ${fmtTime(c.end)} | ${(c.end - c.start).toFixed(1)} s | ${fmtTime(introLen + afterCuts(c.start, p.cuts))} | ${c.note} |`),
        "",
      ].join("\n");
      files.push(await ws.write(`${base}.cuts.md`, cutList));
      await ws.write(projectPath(p), JSON.stringify(p, null, 1) + "\n");
      const length = introLen + kept + (p.outro ? ((await analysis(p.outro).catch(() => undefined))?.duration ?? 0) : 0);
      return {
        text: `Rendered ${files.join(", ")} — ${fmtTime(length)}, ${stats.output_i} LUFS integrated (target ${p.loudness}), true peak ${stats.output_tp} dBTP. Project: ${projectPath(p)}.`,
        structured: { kind: "rendered", project: p, total, files, length, loudness: Number(stats.output_i), truePeak: Number(stats.output_tp) },
      };
    },
  );

  tool(
    "waveform",
    { description: "Waveform peaks (10 per second) for the panel.", input: { file: z.string() }, visibility: ["app"], readOnly: true, timeoutMs: 600_000 },
    async ({ file }) => {
      const a = await analysis(file);
      return { text: `${a.duration.toFixed(1)}s`, structured: { data: Buffer.from(a.peaks).toString("base64"), rate: 10, duration: a.duration } };
    },
  );

  tool(
    "preview",
    {
      description: "MP3 preview of the mix (no cuts, no loudness pass) from a timeline position, or of a rendered file.",
      input: { project: projectSchema.optional(), file: z.string().optional(), start: z.number(), length: z.number().optional() },
      visibility: ["app"],
      readOnly: true,
    },
    async ({ project: raw, file, start, length = 15 }) => {
      const len = Math.max(1, Math.min(60, length));
      let args: string[];
      if (file) {
        const { abs } = await audioFile(file, "File");
        args = [...(start > 0 ? ["-ss", start.toFixed(2)] : []), "-i", abs, "-t", len.toFixed(2)];
      } else {
        const { project, total } = await normalize(raw);
        const s = Math.max(0, Math.min(total - 0.5, start));
        const g = buildGraph(project, (f) => ws.resolve(f), { total, range: [s, Math.min(total, s + len)], loudnorm: false });
        args = [...g.inputs, "-filter_complex", g.filter, "-map", "[out]"];
      }
      const { stdout } = await ffmpeg([...args, "-vn", "-c:a", "libmp3lame", "-b:a", "96k", "-f", "mp3", "pipe:1"], { timeoutMs: 120_000 });
      return { text: `${len}s`, structured: { data: stdout.toString("base64") } };
    },
  );

  tool(
    "workspace_files",
    { description: "Audio files and projects for the panel.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const all = await ws.list({ exts: [...AUDIO_EXTS, ".json"], limit: 3000 });
      return { text: `${all.length}`, structured: { audio: all.map((f) => f.path).filter((f) => !f.endsWith(".json")), projects: all.map((f) => f.path).filter((f) => f.endsWith(".podcast.json")) } };
    },
  );

  return server;
}
