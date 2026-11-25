import { readFile, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import { decodeWav, encodeWav, fade, loudness, makeLoop, mono, normalize, peak, resample, trimSilence } from "./audio.ts";
import { ffmpeg } from "./kit/ffmpeg.ts";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { guess, normalizeProject, type Project, type Sound } from "./project.ts";
import { normalizeParams, preset, SR, synth, PRESETS } from "./synth.ts";

export const NAME = "game-sfx-pack";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const AUDIO_EXTS = [".wav", ".mp3", ".ogg", ".oga", ".flac", ".m4a", ".aac", ".aif", ".aiff", ".opus"];

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

  /** 读音频为单声道浮点：WAV 直接解析，其他格式用电脑上的 ffmpeg 转。 */
  async function readAudio(path: string, sr: number) {
    const ext = extname(path).toLowerCase();
    if (!AUDIO_EXTS.includes(ext)) throw new KitError("bad_audio", `${path}: unsupported audio type.`);
    if (!(await ws.exists(path))) throw new KitError("not_found", `File not found: ${path}`);
    let wav: Buffer;
    if (ext === ".wav") wav = await ws.read(path, 200 * 1024 * 1024);
    else {
      wav = (await ffmpeg(["-v", "error", "-i", ws.resolve(path), "-ac", "1", "-ar", String(sr), "-f", "wav", "-acodec", "pcm_s16le", "pipe:1"], { timeoutMs: 120_000 })).stdout;
      wav.writeUInt32LE(wav.length - 8, 4);
      const d = wav.indexOf("data");
      wav.writeUInt32LE(wav.length - d - 8, d + 4);
    }
    const { channels, sampleRate } = decodeWav(wav, path);
    return resample(mono(channels), sampleRate, sr);
  }

  async function render(s: Sound, p: Project) {
    let x: Float32Array;
    let info: Record<string, unknown> = {};
    if (s.kind === "synth") {
      const params = normalizeParams(s.params, preset(s.preset, s.seed));
      x = synth(params, s.seed);
      if (p.sampleRate !== SR) x = resample(x, SR, p.sampleRate);
      fade(x, p.sampleRate, 0.003, "out");
      info = { preset: s.preset, seed: s.seed, params };
    } else {
      x = await readAudio(s.source, p.sampleRate);
      if (s.trim) x = trimSilence(x, p.sampleRate);
      info = { source: s.source };
    }
    if (s.loop) x = makeLoop(x, p.sampleRate, s.crossfade);
    const n = normalize(x, p.sampleRate, p.loudness + s.gain);
    return { x, info, loudness: loudness(x, p.sampleRate), peak: 20 * Math.log10(Math.max(1e-9, peak(x))), limited: n.limited, duration: x.length / p.sampleRate };
  }

  const projectPath = (p: Project) => `${p.output}/${p.name}.sfx.json`;
  const describe = (p: Project) => {
    const cats = new Map<string, Sound[]>();
    for (const s of p.sounds) cats.set(s.category, [...(cats.get(s.category) ?? []), s]);
    return [...cats.entries()].map(([c, list]) => `${c}/: ${list.map((s) => `${s.name} (${s.kind === "synth" ? `${s.preset} #${s.seed}` : s.source}${s.loop ? ", loop" : ""})`).join(", ")}`).join("\n");
  };
  const projectSchema = z
    .record(z.string(), z.unknown())
    .describe(`{name, sounds: [{name, category, event, kind "synth"|"file", preset (${PRESETS.join("|")}), seed (int: variation), params {freq, slide, sustain, decay, wave, lpf, …}, source (file), trim, loop, crossfade (s), gain (dB, relative)}], loudness (dBFS RMS, default -18), format "wav"|"ogg"|"both", sampleRate, output}`);

  tool(
    "sfx_open",
    {
      description:
        "Open Game SFX Pack with a game's sound event list (e.g. button click, jump, coin pickup, hit, explosion) and/or existing sound files to clean up. Each event gets a procedurally synthesised sound (sfxr-style presets, reproducible seeds) and a category folder; existing files get silence trimming, loudness matching and optional seamless loops. Opens the panel to audition, re-roll variations and tweak. Or pass an existing .sfx.json project.",
      input: {
        events: z.array(z.union([z.string(), z.object({ name: z.string(), category: z.string().optional(), event: z.string().optional(), preset: z.string().optional() })])).optional(),
        files: z.array(z.string()).optional().describe("Existing sounds (WAV; MP3/OGG/FLAC… need ffmpeg)."),
        name: z.string().optional(),
        project: z.string().optional(),
      },
      openPanel: true,
    },
    async ({ events, files, name, project: path }) => {
      let raw: any;
      if (path) {
        try {
          raw = JSON.parse(await ws.readText(path));
        } catch {
          throw new KitError("bad_project", `Cannot read project ${path}.`);
        }
      } else {
        const sounds: any[] = [];
        for (const e of events ?? []) sounds.push(typeof e === "string" ? { name: e, event: e } : { ...e });
        for (const f of files ?? []) {
          const base = f.split("/").pop()!.replace(/\.[^.]+$/, "");
          sounds.push({ name: base, kind: "file", source: f, category: guess(base).category === "misc" ? "imported" : guess(base).category, loop: /loop|ambien|music|bgm|环境|循环|背景/i.test(base) });
        }
        raw = { name: name ?? "sfx", sounds };
      }
      const { project, warnings } = normalizeProject(raw);
      for (const s of project.sounds) if (s.kind === "file") await render(s, project); // 早点发现读不了的文件
      await ws.write(projectPath(project), JSON.stringify(project, null, 1) + "\n");
      return {
        text: [`${project.sounds.length} sound(s), loudness target ${project.loudness} dBFS RMS:`, describe(project), ...warnings.map((w) => `! ${w}`), `Saved ${projectPath(project)}. Adjust with sfx_save (preset, seed for a different variation, params like freq/slide/sustain/decay, gain), then sfx_export.`].join("\n"),
        structured: { kind: "project", project, warnings },
      };
    },
  );

  tool(
    "sfx_save",
    { description: "Validate and save the sound list (names, categories, presets, seeds, synth parameters, files, trim/loop/crossfade, relative gain, loudness target, format).", input: { project: projectSchema } },
    async ({ project: raw }) => {
      const { project, warnings } = normalizeProject(raw);
      await ws.write(projectPath(project), JSON.stringify(project, null, 1) + "\n");
      return { text: [describe(project), ...warnings.map((w) => `! ${w}`), `Saved ${projectPath(project)}.`].join("\n"), structured: { kind: "project", project, warnings } };
    },
  );

  tool(
    "sfx_export",
    {
      description: "Render every sound and export to <output>/<category>/<name>.wav (and/or .ogg via ffmpeg), loudness-matched, plus manifest.json / manifest.csv and the project file.",
      input: { project: projectSchema },
      timeoutMs: 1_800_000,
    },
    async ({ project: raw }) => {
      const { project: p, warnings } = normalizeProject(raw);
      const rows: Record<string, unknown>[] = [];
      let ogg = p.format !== "wav";
      for (const s of p.sounds) {
        const r = await render(s, p);
        const base = `${p.output}/${s.category}/${s.name}`;
        const outFiles: string[] = [];
        const wavPath = `${base}.wav`;
        await ws.write(wavPath, encodeWav([r.x], p.sampleRate));
        if (ogg) {
          try {
            await ffmpeg(["-v", "error", "-i", ws.resolve(wavPath), "-c:a", "libvorbis", "-q:a", "5", ws.resolve(`${base}.ogg`)], { timeoutMs: 120_000 });
            outFiles.push(`${s.category}/${s.name}.ogg`);
          } catch (e) {
            ogg = false;
            warnings.push(`OGG export skipped: ${e instanceof Error ? e.message : e}`);
          }
        }
        if (p.format === "ogg" && ogg) await rm(ws.resolve(wavPath), { force: true });
        else outFiles.unshift(`${s.category}/${s.name}.wav`);
        if (r.limited) warnings.push(`${s.name}: peak-limited, so it is a little quieter than the target.`);
        rows.push({ name: s.name, category: s.category, event: s.event, files: outFiles, duration: Math.round(r.duration * 1000) / 1000, loop: s.loop, loudness: Math.round(r.loudness * 10) / 10, peak: Math.round(r.peak * 10) / 10, ...r.info });
      }
      const manifest = { name: p.name, sampleRate: p.sampleRate, loudnessTarget: p.loudness, sounds: rows };
      const csv = ["category,name,event,file,duration_s,loop,loudness_dbfs,peak_dbfs,source"]
        .concat(rows.map((r: any) => [r.category, r.name, r.event, r.files[0], r.duration, r.loop, r.loudness, r.peak, r.source ?? `${r.preset} #${r.seed}`].map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")))
        .join("\n");
      const files = [await ws.write(`${p.output}/manifest.json`, JSON.stringify(manifest, null, 1) + "\n"), await ws.write(`${p.output}/manifest.csv`, "\uFEFF" + csv + "\n"), await ws.write(projectPath(p), JSON.stringify(p, null, 1) + "\n")];
      return {
        text: [`Exported ${rows.length} sound(s) to ${p.output}/ (${[...new Set(p.sounds.map((s) => s.category))].join(", ")}) + ${files.join(", ")}.`, ...warnings.map((w) => `! ${w}`)].join("\n"),
        structured: { kind: "exported", project: p, rows, files, warnings },
      };
    },
  );

  tool(
    "sfx_render",
    { description: "Render one sound to WAV for auditioning in the panel.", input: { project: projectSchema, index: z.number().int().min(0) }, visibility: ["app"], readOnly: true },
    async ({ project: raw, index }) => {
      const { project } = normalizeProject(raw);
      const s = project.sounds[index];
      if (!s) throw new KitError("bad_index", "No such sound.");
      const r = await render(s, project);
      const step = Math.max(1, Math.floor(r.x.length / 300));
      const wave: number[] = [];
      for (let i = 0; i < r.x.length; i += step) { let m = 0; for (let k = i; k < Math.min(r.x.length, i + step); k++) m = Math.max(m, Math.abs(r.x[k])); wave.push(Math.round(m * 100) / 100); }
      return { text: `${r.duration.toFixed(2)}s`, structured: { data: encodeWav([r.x], project.sampleRate).toString("base64"), duration: r.duration, loudness: r.loudness, peak: r.peak, wave, params: r.info.params } };
    },
  );

  tool(
    "workspace_files",
    { description: "Audio files and projects for the panel.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const all = (await ws.list({ exts: [...AUDIO_EXTS, ".json"], limit: 4000 })).map((f) => f.path);
      return { text: `${all.length}`, structured: { audio: all.filter((f) => !f.endsWith(".json")), projects: all.filter((f) => f.endsWith(".sfx.json")) } };
    },
  );

  return server;
}
