import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeBaseUrl } from "#nb/jupyter/rest.ts";

/** runtime 文件里的一台本机 server；token 只留在插件进程内。 */
export interface RuntimeServer {
  baseUrl: string;
  token: string | null;
  rootDir: string | null;
  pid: number;
  version: string | null;
  file: string;
}

/** 与 `jupyter --runtime-dir` 相同的查找顺序。 */
export function runtimeDirs(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string[] {
  if (env.JUPYTER_RUNTIME_DIR) return [env.JUPYTER_RUNTIME_DIR];
  if (env.JUPYTER_DATA_DIR) return [join(env.JUPYTER_DATA_DIR, "runtime")];
  const home = env.HOME || homedir();
  if (platform === "darwin") return [join(home, "Library/Jupyter/runtime")];
  if (platform === "win32")
    return [join(env.APPDATA || join(home, "AppData/Roaming"), "jupyter/runtime")];
  return [join(env.XDG_DATA_HOME || join(home, ".local/share"), "jupyter/runtime")];
}

/** 解析 jpserver-*.json（Jupyter Server）或 nbserver-*.json（经典 Notebook < 7）。 */
export function parseRuntimeFile(text: string, file: string): RuntimeServer | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof data.url !== "string" || typeof data.pid !== "number") return null;
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(data.url).baseUrl;
  } catch {
    return null;
  }
  const root = data.root_dir ?? data.notebook_dir;
  return {
    baseUrl,
    token: typeof data.token === "string" && data.token ? data.token : null,
    rootDir: typeof root === "string" ? root : null,
    pid: data.pid,
    version: typeof data.version === "string" ? data.version : null,
    file,
  };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM：进程存在但属于别的用户。
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export async function discoverServers(
  dirs: string[] = runtimeDirs(),
  isAlive: (pid: number) => boolean = alive,
): Promise<RuntimeServer[]> {
  const found = new Map<string, RuntimeServer>();
  for (const dir of dirs) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (!/^(jp|nb)server-\d+\.json$/.test(name)) continue;
      const file = join(dir, name);
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch {
        continue;
      }
      const server = parseRuntimeFile(text, file);
      if (server && isAlive(server.pid) && !found.has(server.baseUrl)) found.set(server.baseUrl, server);
    }
  }
  return [...found.values()];
}
