import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pngSize } from "./png.ts";

export interface Detected {
  dir: string;
  kind: "static" | "server" | "unknown";
  name: string;
  version: string;
  description: string;
  author?: string;
  /** 静态站点目录（相对项目） */
  webDir?: string;
  /** Node 服务入口（相对项目） */
  entry?: string;
  usesPortEnv?: boolean;
  port?: number;
  /** 需要先构建（有 build 脚本但还没有输出目录） */
  needsBuild?: string;
  icons: { path: string; width: number; height: number }[];
  notes: string[];
}

const WEB_DIRS = ["dist", "build", "out", "public", "www", "site", "_site", "docs", "."];
const exists = async (p: string) => stat(p).then(() => true, () => false);

/** 识别项目：静态站点（某个目录里有 index.html）或 Node 服务（package.json 的 start/main 指向 .js 入口）。 */
export async function detect(abs: string, rel: string): Promise<Detected> {
  const notes: string[] = [];
  let pkg: Record<string, any> = {};
  if (await exists(join(abs, "package.json"))) {
    try { pkg = JSON.parse(await readFile(join(abs, "package.json"), "utf8")); } catch { notes.push("package.json is not valid JSON."); }
  }
  const base = rel === "." ? "app" : rel.split("/").pop()!;
  const d: Detected = {
    dir: rel, kind: "unknown", name: String(pkg.productName ?? pkg.name ?? base).replace(/^@[^/]+\//, ""), version: /^\d+\.\d+\.\d+/.test(pkg.version ?? "") ? pkg.version : "1.0.0",
    description: pkg.description ?? "", author: typeof pkg.author === "string" ? pkg.author : pkg.author?.name, icons: [], notes,
  };
  // Node 服务：start 脚本 "node x.js" 或 main 字段，且代码里有 listen(
  const start: string = pkg.scripts?.start ?? "";
  const m = /^\s*node\s+(?:--[\w-]+(?:=\S+)?\s+)*([\w./-]+\.(?:c|m)?js)\b/.exec(start);
  const candidates = [m?.[1], pkg.main, "server.js", "index.js", "app.js", "server.mjs"].filter(Boolean) as string[];
  for (const c of candidates) {
    const f = join(abs, c);
    if (!(await exists(f))) continue;
    const src = await readFile(f, "utf8");
    if (/\.listen\s*\(|createServer\s*\(/.test(src)) {
      d.kind = "server"; d.entry = c.replace(/^\.\//, "");
      d.usesPortEnv = /process\.env\.PORT\b/.test(src);
      const pm = /\.listen\s*\(\s*(?:process\.env\.PORT\s*(?:\|\||\?\?)\s*)?(\d{2,5})/.exec(src) ?? /\bPORT\s*=\s*(?:Number\(|parseInt\()?\s*(?:process\.env\.PORT\s*(?:\|\||\?\?)\s*)?["\x27]?(\d{2,5})/.exec(src);
      if (pm) d.port = Number(pm[1]);
      if (!d.usesPortEnv) notes.push(`${d.entry} does not read process.env.PORT; the app will use the fixed port ${d.port ?? "(unknown — set it)"}.`);
      break;
    }
  }
  if (d.kind === "unknown") {
    for (const w of WEB_DIRS) if (await exists(join(abs, w, "index.html"))) { d.kind = "static"; d.webDir = w; break; }
    if (d.kind === "unknown" && pkg.scripts?.build) d.needsBuild = `npm run build`;
    if (d.kind === "static" && d.webDir === "." ) notes.push("The site is at the project root; the whole folder (except desktop/) will be packaged.");
  }
  if (pkg.dependencies?.next || pkg.dependencies?.nuxt) notes.push("Next/Nuxt server rendering is not supported in v0.1; use a static export (next export / nuxt generate).");
  // 图标候选：项目里 ≥256 的 PNG，名字含 icon/logo 的优先
  const pngs: string[] = [];
  const walk = async (p: string, r: string, depth: number) => {
    if (depth > 3 || pngs.length > 200) return;
    for (const e of await readdir(p, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".") || ["node_modules", "desktop", "release"].includes(e.name)) continue;
      if (e.isDirectory()) await walk(join(p, e.name), `${r}${e.name}/`, depth + 1);
      else if (/\.png$/i.test(e.name)) pngs.push(`${r}${e.name}`);
    }
  };
  await walk(abs, "", 0);
  for (const p of pngs) {
    const s = pngSize(await readFile(join(abs, p)).catch(() => new Uint8Array()));
    if (s && s.width >= 256 && s.width === s.height) d.icons.push({ path: p, ...s });
  }
  d.icons.sort((a, b) => Number(/icon|logo/i.test(b.path)) - Number(/icon|logo/i.test(a.path)) || b.width - a.width);
  return d;
}
