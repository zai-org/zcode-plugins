import { spawn } from "node:child_process";
import { access, constants, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, sep } from "node:path";
import { MIN_TYPST, type Toolchain } from "#t/contract.ts";

export type Version = [number, number, number];

/** "typst 0.14.2 (unknown hash)" → [0, 14, 2]。 */
export function parseVersion(text: string): Version | null {
  const match = /(?:^|\s)typst\s+v?(\d+)\.(\d+)\.(\d+)/i.exec(text) ?? /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareVersion(a: Version, b: Version): number {
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return 0;
}

export const versionText = (version: Version) => version.join(".");

/** 至少 major.minor.patch。 */
export function atLeast(version: string | undefined, required: Version): boolean {
  const parsed = version ? parseVersion(version) : null;
  return !!parsed && compareVersion(parsed, required) >= 0;
}

/** macOS 的图形界面程序往往拿不到 shell 的 PATH；按常见安装位置补找。 */
export function commonDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[] {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [
      join(local, "Microsoft", "WinGet", "Links"),
      join(local, "Programs", "typst"),
      join(home, ".cargo", "bin"),
      join(home, "scoop", "shims"),
      join(env.ProgramData ?? "C:\\ProgramData", "chocolatey", "bin"),
    ];
  }
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".cargo", "bin"),
    join(home, ".local", "bin"),
    join(home, "bin"),
    join(home, ".nix-profile", "bin"),
    "/run/current-system/sw/bin",
    "/nix/var/nix/profiles/default/bin",
    "/snap/bin",
    "/usr/bin",
  ];
}

/** 设置页显示的查找位置：与本机最相关的在前（Homebrew / WinGet、cargo），家目录缩写为 ~。 */
export function searchedDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string, arch: string = process.arch): string[] {
  const dirs = commonDirs(platform, env, home);
  const first =
    platform === "win32"
      ? [dirs[0]!, join(home, ".cargo", "bin")]
      : platform === "darwin"
        ? [arch === "arm64" ? "/opt/homebrew/bin" : "/usr/local/bin", join(home, ".cargo", "bin")]
        : [join(home, ".cargo", "bin"), join(home, ".local", "bin")];
  const ordered = [...new Set([...first, ...dirs])];
  return ordered.map((dir) => (home && dir.startsWith(home + sep) ? `~${dir.slice(home.length)}` : dir));
}

async function executable(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      resolve({ code: null, stdout, stderr: error instanceof Error ? error.message : String(error), timedOut });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 10_000);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => (stderr += error.message));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** 在用户的登录 shell 中查找（版本管理器如 mise、asdf 往往只在 shell 配置里加入 PATH）。 */
async function fromShell(env: NodeJS.ProcessEnv): Promise<string | null> {
  const shell = env.SHELL;
  if (!shell || process.platform === "win32") return null;
  for (const flags of ["-lc", "-ilc"]) {
    const result = await run(shell, [flags, "command -v typst"], { env, timeoutMs: 4_000 });
    const line = result.stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .reverse()
      .find((entry) => isAbsolute(entry));
    if (line && (await executable(line))) return line;
  }
  return null;
}

export interface LocateOptions {
  /** 插件设置 typstPath。 */
  setting?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  /** 是否尝试登录 shell（测试中关闭）。 */
  shell?: boolean;
  /** 替换常见安装位置（测试用）。 */
  common?: string[];
}

/** 查找 typst：设置 → PATH → 常见安装位置 → 登录 shell；然后检查版本。 */
export async function locateTypst(options: LocateOptions = {}): Promise<Toolchain> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? env.HOME ?? env.USERPROFILE ?? "";
  const names = platform === "win32" ? ["typst.exe", "typst.cmd", "typst"] : ["typst"];
  let found: { path: string; source: Toolchain["source"] } | null = null;

  if (options.setting) {
    if (!(await executable(options.setting)))
      return { state: "error", path: options.setting, source: "setting", error: `The Typst path in the plugin settings (${options.setting}) is not an executable file.` };
    found = { path: options.setting, source: "setting" };
  }
  const search = async (dirs: string[], source: Toolchain["source"]) => {
    for (const dir of dirs)
      for (const name of names) {
        const path = join(dir, name);
        if (dir && (await executable(path))) return { path, source };
      }
    return null;
  };
  found ??= await search((env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean), "path");
  found ??= await search(options.common ?? commonDirs(platform, env, home), "common");
  if (!found && options.shell !== false) {
    const path = await fromShell(env);
    if (path) found = { path, source: "shell" };
  }
  if (!found) return { state: "missing" };

  const result = await run(found.path, ["--version"], { env, timeoutMs: 10_000 });
  const version = parseVersion(`${result.stdout}\n${result.stderr}`);
  if (result.code !== 0 || !version)
    return {
      state: "error",
      ...found,
      error: `\`${found.path} --version\` failed: ${(result.stderr || result.stdout).trim().slice(0, 300) || `exit code ${result.code}`}`,
    };
  if (compareVersion(version, MIN_TYPST) < 0)
    return { state: "too_old", ...found, version: versionText(version), error: `Typst ${versionText(version)} is older than ${versionText(MIN_TYPST)}.` };
  return { state: "ready", ...found, version: versionText(version) };
}
