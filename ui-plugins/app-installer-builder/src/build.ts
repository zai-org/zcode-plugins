import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { builderArgs, type Target } from "./config.ts";

export interface Job {
  id: number;
  target: Target;
  state: "running" | "done" | "failed";
  step: "install" | "build" | "";
  started: number;
  ended?: number;
  log: string[];
  outputs: { path: string; size: number }[];
  error?: string;
}

const MAX_LOG = 4000;
export const hasWine = () => { try { return spawnSync(process.platform === "win32" ? "where" : "which", ["wine"], { stdio: "ignore" }).status === 0; } catch { return false; } };

/** npm install（如需要）+ electron-builder，日志逐行收集；完成后列出 release/ 里的安装包。 */
export function runBuild(id: number, desktopAbs: string, target: Target, env: Record<string, string>, onEnd: (j: Job) => void): Job {
  const job: Job = { id, target, state: "running", step: "", started: Date.now(), log: [], outputs: [] };
  const push = (s: string) => { for (const l of s.split(/\r?\n/)) if (l.trim()) job.log.push(l.replace(/\x1b\[[0-9;]*m/g, "")); if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG); };
  const npm = process.platform === "win32" ? "npm.cmd" : "npm", npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const run = (cmd: string, args: string[]) => new Promise<number>((resolve) => {
    push(`$ ${cmd} ${args.join(" ")}`);
    const p = spawn(cmd, args, { cwd: desktopAbs, env: { ...process.env, ...env, FORCE_COLOR: "0", npm_config_fund: "false", npm_config_audit: "false" }, shell: process.platform === "win32" });
    p.stdout.on("data", (d) => push(String(d)));
    p.stderr.on("data", (d) => push(String(d)));
    p.on("error", (e) => { push(String(e)); resolve(127); });
    p.on("close", (code) => resolve(code ?? 1));
  });
  (async () => {
    if (!existsSync(join(desktopAbs, "node_modules/electron-builder")) || !existsSync(join(desktopAbs, "node_modules/electron"))) {
      job.step = "install";
      push("Installing Electron and electron-builder (first build only; downloads ~150 MB)…");
      if ((await run(npm, ["install", "--no-audit", "--no-fund"])) !== 0) throw new Error("npm install failed — see the log.");
    }
    job.step = "build";
    if ((await run(npx, ["electron-builder", ...builderArgs(target, process.platform), "--publish", "never"])) !== 0) throw new Error("electron-builder failed — see the log.");
    job.outputs = listOutputs(desktopAbs);
  })().then(() => { job.state = "done"; }, (e: Error) => { job.state = "failed"; job.error = e.message; push(`✗ ${e.message}`); })
    .finally(() => { job.ended = Date.now(); onEnd(job); });
  return job;
}

/** release/ 下的安装包与免安装目录（只列一层 + 可执行目录）。 */
export function listOutputs(desktopAbs: string) {
  const rel = join(desktopAbs, "release");
  if (!existsSync(rel)) return [];
  const out: { path: string; size: number }[] = [];
  for (const name of readdirSync(rel)) {
    const p = join(rel, name), st = statSync(p);
    if (st.isFile() && /\.(dmg|exe|AppImage|zip|blockmap)$/i.test(name) && !name.endsWith(".blockmap")) out.push({ path: relative(desktopAbs, p).split("\\").join("/"), size: st.size });
    if (st.isDirectory() && /-unpacked$|^mac(-arm64|-universal)?$/.test(name)) out.push({ path: relative(desktopAbs, p).split("\\").join("/") + "/", size: dirSize(p) });
  }
  return out;
}
function dirSize(p: string): number { let n = 0; for (const e of readdirSync(p, { withFileTypes: true })) { const c = join(p, e.name); n += e.isDirectory() ? dirSize(c) : e.isFile() ? statSync(c).size : 0; } return n; }
