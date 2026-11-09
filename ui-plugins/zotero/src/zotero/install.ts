import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { ZoteroError, type ZoteroInstall } from "#z/contract.ts";
import { findExecutable, tilde } from "#z/host/facts.ts";

/**
 * Zotero 桌面程序是否装在本机、在哪里、什么版本，以及“打开 Zotero”。
 * Zotero 没有运行时，设置页据此区分“未安装”（交给 Agent）与“已安装但未打开”（一键打开）。
 */

interface Candidate {
  /** macOS 为 .app 目录，其余为可执行文件。 */
  path: string;
  /** Flatpak 用 `flatpak run` 启动。 */
  flatpak?: boolean;
}

function candidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): Candidate[] {
  if (platform === "darwin") return ["/Applications/Zotero.app", join(home, "Applications", "Zotero.app")].map((path) => ({ path }));
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [
      join(env.ProgramFiles ?? "C:\\Program Files", "Zotero", "zotero.exe"),
      join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Zotero", "zotero.exe"),
      join(local, "Zotero", "zotero.exe"),
    ].map((path) => ({ path }));
  }
  const flatpak = "app/org.zotero.Zotero/current/active/files/lib/zotero/zotero";
  return [
    { path: "/opt/zotero/zotero" },
    { path: "/usr/lib/zotero/zotero" },
    { path: "/usr/local/lib/zotero/zotero" },
    { path: join(home, "Zotero_linux-x86_64", "zotero") },
    { path: join(home, "Zotero_linux-arm64", "zotero") },
    { path: join(home, ".local", "share", "zotero", "zotero") },
    { path: join(home, "opt", "zotero", "zotero") },
    { path: join("/var/lib/flatpak", flatpak), flatpak: true },
    { path: join(home, ".local", "share", "flatpak", flatpak), flatpak: true },
  ];
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** 版本：macOS 读 Info.plist；其余读程序旁的 application.ini。 */
async function versionOf(candidate: Candidate, platform: NodeJS.Platform): Promise<string | undefined> {
  if (platform === "darwin") {
    const plist = await readFile(join(candidate.path, "Contents", "Info.plist"), "utf8").catch(() => "");
    const version = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
    if (version) return version.trim();
    candidate = { path: join(candidate.path, "Contents", "Resources", "zotero") };
  }
  const ini = await readFile(join(dirname(candidate.path), "application.ini"), "utf8").catch(() => "");
  return /^Version=(.+)$/m.exec(ini)?.[1]?.trim();
}

export interface InstallOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

/** 找已安装的 Zotero。找不到时 searched 列出查找过的位置（家目录缩写为 ~），供设置页与 Agent 使用。 */
export async function findZotero(options: InstallOptions = {}): Promise<ZoteroInstall & { launch?: Candidate }> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? env.HOME ?? env.USERPROFILE ?? homedir();
  const list = candidates(platform, env, home);
  for (const candidate of list) {
    if (!(await exists(candidate.path))) continue;
    const version = await versionOf(candidate, platform);
    return { state: "found", path: tilde(candidate.path, home), ...(version ? { version } : {}), searched: [], launch: candidate };
  }
  // Linux 上也可能经包管理器装到 PATH（如 /usr/bin/zotero）。
  if (platform === "linux") {
    const onPath = await findExecutable("zotero", [], { env, platform });
    if (onPath) {
      const version = await versionOf({ path: onPath }, platform);
      return { state: "found", path: tilde(onPath, home), ...(version ? { version } : {}), searched: [], launch: { path: onPath } };
    }
  }
  const searched = platform === "darwin" ? ["/Applications", "~/Applications"] : [...new Set(list.map((candidate) => tilde(dirname(candidate.path), home)))];
  return { state: "missing", searched: platform === "linux" ? [...searched.slice(0, 3), "PATH"] : searched };
}

/** 主版本号（"7.0.15" → 7）。 */
export const majorVersion = (version: string | undefined) => (version ? Number.parseInt(version, 10) : NaN);

/** 启动已安装的 Zotero（不等待它就绪；面板的轮询会发现它）。 */
export async function launchZotero(options: InstallOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  const found = await findZotero(options);
  if (found.state !== "found" || !found.launch) throw new ZoteroError("zotero_not_installed", "Zotero is not installed on this computer.");
  const { path, flatpak } = found.launch;
  const [command, args] =
    platform === "darwin" ? ["/usr/bin/open", ["-a", path]] : flatpak ? ["flatpak", ["run", "org.zotero.Zotero"]] : [path, [] as string[]];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", (error) => reject(new ZoteroError("zotero_error", `Could not start Zotero (${basename(path)}): ${error.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return found.path!;
}
