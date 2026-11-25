import { readFile, stat } from "node:fs/promises";
import { basename, extname, join, posix } from "node:path";
import { z } from "zod";
import { ffmpeg, probe } from "./kit/ffmpeg.ts";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace, safeFileName } from "./kit/workspace.ts";
import { toCsv, toHtml, toMarkdown, type Session } from "./export.ts";
import { clock, digest, normalizeNeeds, parseTranscript } from "./transcript.ts";

export const NAME = "interview-notes";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const AUDIO_EXTS = [".mp3", ".m4a", ".wav", ".ogg", ".opus", ".aac", ".flac", ".mp4", ".mov", ".webm", ".mkv"];
const TEXT_EXTS = [".srt", ".vtt", ".txt", ".md"];
const OUT = "interviews";

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  log?: (line: string) => void;
}

const stem = (audio: string) => safeFileName(basename(audio, extname(audio)), "interview");
export const sessionPath = (audio: string) => `${OUT}/${stem(audio)}.interview.json`;

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

  async function checkAudio(audio: unknown) {
    if (typeof audio !== "string" || !audio) throw new KitError("missing_audio", "Pass `audio`: the interview recording.");
    if (!AUDIO_EXTS.includes(extname(audio).toLowerCase())) throw new KitError("bad_audio", `Unsupported recording type: ${extname(audio) || audio}`);
    const abs = ws.resolve(audio);
    await stat(abs).catch(() => {
      throw new KitError("not_found", `File not found: ${audio}`);
    });
    let info;
    try {
      info = await probe(abs);
    } catch {
      throw new KitError("bad_audio", `Cannot decode the recording ${basename(audio)}: it is not a valid audio or video file.`);
    }
    if (!info.hasAudio && !info.hasVideo) {
      throw new KitError("bad_audio", `Cannot decode the recording ${basename(audio)}: no audio or video stream found.`);
    }
    return audio;
  }
  async function loadSession(audio: string): Promise<Session | undefined> {
    try {
      const s = JSON.parse(await ws.readText(sessionPath(audio))) as Session;
      return s?.audio === audio ? s : undefined;
    } catch {
      return undefined;
    }
  }
  /** 两个原始说话人改成同一个名字时合并成一个。 */
  function mergeSpeakers(s: Session) {
    const first = new Map<string, string>();
    for (const [raw, name] of Object.entries(s.speakers)) {
      const key = name.trim().toLowerCase();
      const keep = first.get(key);
      if (!keep) first.set(key, raw);
      else {
        for (const u of s.utterances) if (u.speaker === raw) u.speaker = keep;
        delete s.speakers[raw];
      }
    }
  }
  async function saveSession(s: Session) {
    mergeSpeakers(s);
    await ws.write(sessionPath(s.audio), JSON.stringify(s, null, 1) + "\n");
  }
  const needsSchema = z
    .array(z.record(z.string(), z.unknown()))
    .describe('[{title, detail, category ("痛点" / "功能需求" / "体验问题" / "pain point" …), priority "high"|"medium"|"low", quotes: [{utterance: "u12", text: "exact words from that line"}]}]');

  tool(
    "interview_open",
    {
      description:
        "Open Interview Notes with an interview recording (audio or video) and its transcript (SRT, WebVTT, or timestamped text exports such as Feishu Minutes / Tencent Meeting, with speaker names). Returns the transcript with line ids [u12 01:05 Name] and opens the panel. Then extract needs with interview_submit; each need must quote line ids so the user can replay the original words.",
      input: {
        audio: z.string().describe("Recording in the workspace."),
        transcript: z.string().optional().describe("Transcript file (default: same name next to the recording)."),
        title: z.string().optional(),
      },
      openPanel: true,
      timeoutMs: 120_000,
    },
    async ({ audio, transcript, title }) => {
      const path = await checkAudio(audio);
      let session = await loadSession(path);
      if (!session || (transcript && transcript !== session.transcript)) {
        let tpath = transcript;
        if (!tpath) {
          const base = path.slice(0, path.length - extname(path).length);
          const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
          tpath = (await ws.list({ dir, exts: TEXT_EXTS, recursive: false })).map((f) => f.path).find((f) => f.startsWith(base));
          if (!tpath) throw new KitError("missing_transcript", `No transcript found next to ${path}. Pass \`transcript\` (SRT/VTT/TXT). This plugin does not do speech recognition.`);
        }
        if (!TEXT_EXTS.includes(extname(tpath).toLowerCase())) throw new KitError("bad_transcript", "Transcript must be .srt, .vtt, .txt or .md.");
        const utterances = parseTranscript(await ws.readText(tpath), tpath);
        const speakers = Object.fromEntries([...new Set(utterances.map((u) => u.speaker))].map((s) => [s, s]));
        session = { version: 1, audio: path, transcript: tpath, title: title || basename(path, extname(path)), speakers, utterances, needs: session?.needs ?? [] };
        await saveSession(session);
      }
      const counts = Object.entries(session.speakers).map(([raw, name]) => `${name}${raw !== name ? ` (${raw})` : ""}: ${session!.utterances.filter((u) => u.speaker === raw).length}`);
      const text = [
        `${session.title}: ${session.utterances.length} lines, ${clock(session.utterances[session.utterances.length - 1].end)}; speakers — ${counts.join(", ")}.`,
        session.needs.length ? `${session.needs.length} need(s) already saved in ${sessionPath(path)}.` : "",
        "",
        digest(session.utterances, session.speakers),
        "",
        "Next: interview_submit(audio, needs: [{title, detail, category, priority, quotes: [{utterance: \"u12\", text: \"exact words\"}]}], speakers?: {\"Speaker 1\": \"Interviewer\"}). Only list needs the interviewee actually expressed; quote their own words.",
      ].join("\n");
      return { text, structured: { kind: "session", session } };
    },
  );

  tool(
    "interview_submit",
    {
      description:
        "Save the needs you extracted from the interview (replaces the list; keeps the user's status changes for needs with the same title). Every quote must reference a transcript line id; quote text must be words from that line. Optionally rename speakers.",
      input: { audio: z.string(), needs: needsSchema, speakers: z.record(z.string(), z.string()).optional() },
    },
    async ({ audio, needs: raw, speakers }) => {
      const path = await checkAudio(audio);
      const session = await loadSession(path);
      if (!session) throw new KitError("not_open", `Open the interview first with interview_open(audio: "${path}").`);
      const { needs, warnings } = normalizeNeeds(raw, session.utterances);
      const old = new Map(session.needs.map((n) => [n.title, n]));
      for (const n of needs) if (old.get(n.title)?.status !== undefined && n.status === "open") n.status = old.get(n.title)!.status;
      session.needs = needs;
      for (const [k, v] of Object.entries((speakers ?? {}) as Record<string, string>)) if (k in session.speakers && String(v).trim()) session.speakers[k] = String(v).trim().slice(0, 40);
      await saveSession(session);
      return {
        text: [`Saved ${needs.length} need(s) to ${sessionPath(path)} with ${needs.reduce((s, n) => s + n.quotes.length, 0)} quote(s).`, ...warnings.map((w) => `! ${w}`), "The user can review them in the panel (click a quote to hear it) and then export with interview_export."].join("\n"),
        structured: { kind: "session", session, warnings },
      };
    },
  );

  tool(
    "interview_save",
    { description: "Save panel edits (speakers, speaker of a line, needs and their status).", input: { session: z.record(z.string(), z.unknown()) }, visibility: ["app"] },
    async ({ session: raw }) => {
      const s = raw as unknown as Session;
      const path = await checkAudio(s.audio);
      const current = await loadSession(path);
      if (!current) throw new KitError("not_open", "Interview not open.");
      const ids = new Set(current.utterances.map((u) => u.id));
      for (const u of Array.isArray(s.utterances) ? s.utterances : []) {
        const cur = current.utterances.find((x) => x.id === u.id);
        if (cur && typeof u.speaker === "string" && u.speaker.trim()) cur.speaker = u.speaker.trim().slice(0, 40);
      }
      for (const sp of new Set(current.utterances.map((u) => u.speaker))) current.speakers[sp] = (s.speakers?.[sp] ?? current.speakers[sp] ?? sp).slice(0, 40);
      const { needs } = normalizeNeeds(s.needs, current.utterances);
      current.needs = needs.map((n) => ({ ...n, quotes: n.quotes.filter((q) => ids.has(q.utterance)) }));
      if (typeof s.title === "string" && s.title.trim()) current.title = s.title.trim().slice(0, 120);
      await saveSession(current);
      return { text: "Saved.", structured: { kind: "saved", session: current } };
    },
  );

  tool(
    "interview_export",
    {
      description:
        "Export the needs list and transcript: Markdown (needs with quotes + full transcript), CSV (one row per quote) and a self-contained HTML page where clicking a quote plays the recording at that moment (the recording is referenced by relative path). Default: all three into interviews/.",
      input: { audio: z.string(), format: z.enum(["md", "csv", "html", "all"]).optional() },
    },
    async ({ audio, format = "all" }) => {
      const path = await checkAudio(audio);
      const s = await loadSession(path);
      if (!s) throw new KitError("not_open", `Open the interview first with interview_open(audio: "${path}").`);
      const base = `${OUT}/${stem(path)}`;
      const files: string[] = [];
      if (format === "md" || format === "all") files.push(await ws.write(`${base}.md`, toMarkdown(s)));
      if (format === "csv" || format === "all") files.push(await ws.write(`${base}.csv`, toCsv(s)));
      if (format === "html" || format === "all") files.push(await ws.write(`${base}.html`, toHtml(s, posix.relative(OUT, path))));
      return { text: `Exported ${files.join(", ")} (${s.needs.length} needs).`, structured: { kind: "exported", files, session: s } };
    },
  );

  tool(
    "audio_clip",
    {
      description: "MP3 clip of the recording for the panel player.",
      input: { audio: z.string(), start: z.number(), end: z.number() },
      visibility: ["app"],
      readOnly: true,
    },
    async ({ audio, start, end }) => {
      const path = await checkAudio(audio);
      const from = Math.max(0, start - 0.3);
      const len = Math.min(120, Math.max(0.5, end - from + 0.3));
      const { stdout } = await ffmpeg([...(from > 0 ? ["-ss", from.toFixed(2)] : []), "-i", ws.resolve(path), "-t", len.toFixed(2), "-vn", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", "pipe:1"], { timeoutMs: 60_000 });
      return { text: `${len.toFixed(1)}s`, structured: { data: stdout.toString("base64"), offset: from } };
    },
  );

  tool(
    "workspace_files",
    { description: "Recordings and transcripts for the panel.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const files = (await ws.list({ exts: [...AUDIO_EXTS, ...TEXT_EXTS], limit: 3000 })).map((f) => f.path);
      return { text: `${files.length}`, structured: { recordings: files.filter((f) => AUDIO_EXTS.includes(extname(f).toLowerCase())), transcripts: files.filter((f) => TEXT_EXTS.includes(extname(f).toLowerCase())) } };
    },
  );

  return server;
}
