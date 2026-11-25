import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { KitError } from "./workspace.ts";

/** 查找用户电脑上已安装的 ffmpeg / ffprobe（不随插件分发）。 */
const COMMON_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "C:\\ffmpeg\\bin", "C:\\Program Files\\ffmpeg\\bin"];
let found: Promise<{ ffmpeg: string; ffprobe: string }> | undefined;

async function which(name: string, explicit?: string) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const dirs = [...(process.env.PATH ?? "").split(delimiter), ...COMMON_DIRS].filter(Boolean);
  const candidates = explicit ? [explicit] : dirs.map((d) => join(d, exe));
  for (const c of candidates) {
    try {
      await access(c, constants.X_OK);
      return c;
    } catch {
      // 下一个
    }
  }
  return undefined;
}

export function findFfmpeg(): Promise<{ ffmpeg: string; ffprobe: string }> {
  found ??= (async () => {
    const ffmpeg = await which("ffmpeg", process.env.FFMPEG_PATH || undefined);
    const ffprobe = await which("ffprobe", process.env.FFPROBE_PATH || (process.env.FFMPEG_PATH ? process.env.FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1") : undefined));
    if (!ffmpeg || !ffprobe) {
      found = undefined;
      throw new KitError(
        "ffmpeg_missing",
        "ffmpeg was not found. Install it (macOS: `brew install ffmpeg`; Windows: `winget install ffmpeg`; Linux: your package manager) or set the plugin's ffmpeg path setting.",
      );
    }
    return { ffmpeg, ffprobe };
  })();
  return found;
}

export interface RunOptions {
  timeoutMs?: number;
  /** 0..1 进度（需要传 duration）。 */
  onProgress?: (fraction: number) => void;
  duration?: number;
  cwd?: string;
}

/** 运行 ffmpeg，失败时返回 stderr 末尾。参数数组，不经过 shell。 */
export async function ffmpeg(args: string[], options: RunOptions = {}): Promise<{ stderr: string; stdout: Buffer }> {
  const { ffmpeg: bin } = await findFfmpeg();
  return run(bin, ["-hide_banner", "-nostdin", "-y", ...args], options);
}

export async function run(bin: string, args: string[], options: RunOptions = {}): Promise<{ stderr: string; stdout: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = options.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs) : undefined;
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => {
      const text = d.toString();
      err = (err + text).slice(-20000);
      if (options.onProgress && options.duration) {
        const m = /time=(\d+):(\d+):([\d.]+)/.exec(text);
        if (m) options.onProgress(Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / options.duration));
      }
    });
    child.on("error", (e) => reject(new KitError("ffmpeg_failed", e.message)));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stderr: err, stdout: Buffer.concat(out) });
      else reject(new KitError("ffmpeg_failed", `ffmpeg exited with ${code}: ${err.split("\n").filter(Boolean).slice(-6).join(" | ")}`));
    });
  });
}

export interface MediaInfo {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  sampleRate?: number;
  channels?: number;
}

export async function probe(path: string): Promise<MediaInfo> {
  const { ffprobe } = await findFfmpeg();
  let json: any;
  try {
    const { stdout } = await run(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], { timeoutMs: 60_000 });
    json = JSON.parse(stdout.toString());
  } catch {
    throw new KitError("bad_media", `Cannot read media file ${path.split(/[\\/]/).pop()}.`);
  }
  const v = json.streams?.find((s: any) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const a = json.streams?.find((s: any) => s.codec_type === "audio");
  const rate = v?.avg_frame_rate && v.avg_frame_rate !== "0/0" ? v.avg_frame_rate : v?.r_frame_rate;
  const [n, d] = String(rate ?? "0/1").split("/").map(Number);
  let duration = Number(json.format?.duration ?? v?.duration ?? a?.duration ?? 0);
  if (!Number.isFinite(duration)) duration = 0;
  return {
    duration,
    hasVideo: !!v,
    hasAudio: !!a,
    ...(v ? { width: Number(v.width), height: Number(v.height), fps: d ? n / d : undefined } : {}),
    ...(a ? { sampleRate: Number(a.sample_rate), channels: Number(a.channels) } : {}),
  };
}

/** 抽一帧 JPEG（用于面板预览）。 */
export async function frameAt(path: string, seconds: number, maxWidth = 960): Promise<Buffer> {
  const { stdout } = await ffmpeg([...(seconds > 0 ? ["-ss", String(seconds)] : []), "-i", path, "-frames:v", "1", "-vf", `scale='min(${maxWidth},iw)':-2`, "-q:v", "4", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], { timeoutMs: 60_000 });
  if (!stdout.length) throw new KitError("no_frame", `No frame at ${seconds}s.`);
  return stdout;
}

export const fmtTime = (s: number) => {
  const sign = s < 0 ? "-" : "";
  s = Math.abs(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${sign}${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${sec.toFixed(1).padStart(4, "0")}`;
};
