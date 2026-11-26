import { execFile } from "node:child_process";

export interface Commit { hash: string; short: string; author: string; date: string; subject: string; body: string; tags: string[] }

function run(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C.UTF-8" }, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        reject(new Error(code === "ENOENT" ? "git is not installed or not on PATH." : String(stderr || err.message).trim().split("\n")[0]));
      } else resolve(stdout);
    });
  });
}

export async function readRepo(cwd: string, limit: number) {
  const top = (await run(cwd, ["rev-parse", "--show-toplevel"]).catch(() => { throw new Error("This folder is not inside a git repository."); })).trim();
  const raw = await run(cwd, ["log", "--no-merges", `--max-count=${limit}`, "--decorate-refs=refs/tags", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%D%x1f%s%x1f%b%x1e", "--", "."]);
  const commits: Commit[] = raw.split("\x1e").map((s) => s.replace(/^\n/, "")).filter((s) => s.trim()).map((rec) => {
    const [hash, short, author, date, refs, subject, body] = rec.split("\x1f");
    return { hash, short, author, date, subject: subject.trim(), body: (body ?? "").trim(), tags: refs.split(",").map((r) => r.trim().replace(/^tag: /, "")).filter(Boolean) };
  });
  const remote = (await run(cwd, ["remote", "get-url", "origin"]).catch(() => "")).trim();
  return { top, commits, remote: webUrl(remote) };
}

export function webUrl(remote: string): string {
  if (!remote) return "";
  let m = /^git@([^:]+):(.+?)(\.git)?$/.exec(remote);
  if (m) return `https://${m[1]}/${m[2]}`;
  m = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(\.git)?\/?$/.exec(remote);
  if (m) return `https://${m[1]}/${m[2]}`;
  return "";
}
