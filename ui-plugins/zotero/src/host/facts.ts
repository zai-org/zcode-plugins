import { execFile } from "node:child_process";
import { access, constants, lstat, readFile, stat } from "node:fs/promises";
import { homedir, release } from "node:os";
import { delimiter, join, sep } from "node:path";
import type { HostFacts } from "#z/contract.ts";

/**
 * 本机事实：系统、架构与可用的包管理器。设置页显示它们，交给 Agent 的消息也带上它们，
 * Agent 因此不必猜用哪种安装方式。只读探测，不安装任何东西。
 */

export interface ToolSpec {
  /** 显示名，如 "Homebrew"。 */
  name: string;
  /** 可执行文件名（Windows 上另试 .exe / .cmd）。 */
  bin: string;
  /** PATH 之外的常见位置（图形界面程序常常拿不到 shell 的 PATH）。 */
  dirs: string[];
  /** 读版本：参数与匹配版本号的正则；省略时只检查是否存在。 */
  version?: { args: string[]; pattern: RegExp };
}

export interface FactsOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  home?: string;
}

function output(command: string, args: string[], env: NodeJS.ProcessEnv, timeout = 5_000): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(command, args, { env, timeout, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout)));
    } catch {
      resolve(null);
    }
  });
}

async function isExecutable(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    // Windows 的应用执行别名（如 WindowsApps\winget.exe）无法 stat，lstat 把它报告为符号链接；它能直接运行。
    if (platform === "win32") return lstat(path).then((info) => info.isSymbolicLink(), () => false);
    return false;
  }
}

/** 在 PATH 与给定目录中找可执行文件。 */
export async function findExecutable(bin: string, dirs: string[], options: FactsOptions = {}): Promise<string | null> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const names = platform === "win32" ? [`${bin}.exe`, `${bin}.cmd`, bin] : [bin];
  const path = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  for (const dir of [...path, ...dirs])
    for (const name of names) {
      const candidate = join(dir, name);
      if (await isExecutable(candidate, platform)) return candidate;
    }
  return null;
}

/** 家目录缩写为 ~（显示用）。 */
export function tilde(path: string, home: string): string {
  if (!home) return path;
  if (path === home) return "~";
  return path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

async function osName(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<string> {
  if (platform === "darwin") {
    const version = (await output("/usr/bin/sw_vers", ["-productVersion"], env))?.trim();
    return version ? `macOS ${version}` : "macOS";
  }
  if (platform === "win32") {
    // Windows 11 的内核版本仍是 10.0，以构建号 22000 区分。
    const [major, , build] = release().split(".").map(Number);
    return major === 10 ? (build! >= 22000 ? "Windows 11" : "Windows 10") : `Windows ${release()}`;
  }
  if (platform === "linux") {
    const text = await readFile("/etc/os-release", "utf8").catch(() => "");
    const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(text)?.[1];
    return pretty ?? "Linux";
  }
  return platform;
}

async function archName(platform: NodeJS.Platform, arch: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (platform === "darwin") {
    if (arch === "arm64") return "Apple silicon";
    // x64 的 Node 可能运行在 Apple 芯片的 Rosetta 下。
    const arm = (await output("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"], env))?.trim();
    return arm === "1" ? "Apple silicon" : "Intel";
  }
  return arch;
}

/** 常见包管理器；插件可以追加自己关心的（如 cargo、uv）。 */
export function packageManagers(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): ToolSpec[] {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [
      { name: "winget", bin: "winget", dirs: [join(local, "Microsoft", "WindowsApps")] },
      { name: "Scoop", bin: "scoop", dirs: [join(home, "scoop", "shims")] },
      { name: "Chocolatey", bin: "choco", dirs: [join(env.ProgramData ?? "C:\\ProgramData", "chocolatey", "bin")] },
    ];
  }
  const brew: ToolSpec = {
    name: "Homebrew",
    bin: "brew",
    dirs: ["/opt/homebrew/bin", "/usr/local/bin", "/home/linuxbrew/.linuxbrew/bin", join(home, ".linuxbrew", "bin")],
    version: { args: ["--version"], pattern: /Homebrew\s+(\d+\.\d+\.\d+)/ },
  };
  if (platform !== "linux") return [brew];
  return [
    brew,
    { name: "apt", bin: "apt-get", dirs: ["/usr/bin"] },
    { name: "dnf", bin: "dnf", dirs: ["/usr/bin"] },
    { name: "pacman", bin: "pacman", dirs: ["/usr/bin"] },
    { name: "zypper", bin: "zypper", dirs: ["/usr/bin"] },
    { name: "snap", bin: "snap", dirs: ["/usr/bin", "/snap/bin"] },
    { name: "Flatpak", bin: "flatpak", dirs: ["/usr/bin"] },
  ];
}

/** 探测本机事实。每一项失败都只是缺省，不抛出。 */
export async function detectFacts(extra: ToolSpec[] = [], options: FactsOptions = {}): Promise<HostFacts> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? env.HOME ?? env.USERPROFILE ?? homedir();
  const specs = [...packageManagers(platform, env, home), ...extra];
  const [name, arch, tools] = await Promise.all([
    osName(platform, env),
    archName(platform, options.arch ?? process.arch, env),
    Promise.all(
      specs.map(async (spec) => {
        const path = await findExecutable(spec.bin, spec.dirs, { env, platform });
        if (!path) return null;
        const text = spec.version ? await output(path, spec.version.args, env) : null;
        const version = text ? spec.version!.pattern.exec(text)?.[1] : undefined;
        return { name: spec.name, ...(version ? { version } : {}), path: tilde(path, home) };
      }),
    ),
  ]);
  const os = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : platform === "linux" ? "linux" : "other";
  return { os, osName: name, arch, tools: tools.filter((tool) => tool !== null) };
}
