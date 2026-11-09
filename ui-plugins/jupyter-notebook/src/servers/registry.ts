import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  JupyterError,
  type DiscoveredServer,
  type JupyterEnvironment,
  type ServerInfo,
} from "#nb/contract.ts";
import { createJupyterClient, normalizeBaseUrl, type JupyterClient } from "#nb/jupyter/rest.ts";
import { discoverServers, type RuntimeServer } from "#nb/servers/discover.ts";
import { UNKNOWN_ENVIRONMENT, checkEnvironment, installCommandForTarget } from "#nb/servers/environment.ts";
import {
  findJupyterPython,
  launchJupyterServer,
  pythonCandidates,
  type LaunchedProcess,
  type LaunchOptions,
} from "#nb/servers/launch.ts";

interface Entry {
  info: ServerInfo;
  client: JupyterClient;
  process: LaunchedProcess | null;
  lastUsed: number;
}

export interface RegistryDeps {
  workspaceRoot: string;
  /** 插件设置里的 Python 路径；空表示自动探测。 */
  pythonPath: string | null;
  discover?: () => Promise<RuntimeServer[]>;
  findPython?: typeof findJupyterPython;
  /** 测试注入：替换启动前的环境检查。 */
  checkEnvironment?: () => Promise<JupyterEnvironment>;
  launch?: (options: LaunchOptions) => Promise<LaunchedProcess>;
  clientFactory?: typeof createJupyterClient;
  onLog?: (line: string) => void;
  now?: () => number;
}

/** server id：host:port，非根 base path 时追加路径，如 `127.0.0.1:8888` 或 `example.org/jupyter`。 */
export function serverIdFor(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.host}${path}`;
}

/** 解析符号链接（如 macOS 的 /var → /private/var）；路径不存在时解析最近的已存在祖先。 */
const realpath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(realpath(parent), basename(path));
  }
};

/**
 * 把模型或页面给的路径换成相对 server root 的 `/` 路径。
 * 绝对路径要求 root 已知且路径在 root 内；拒绝 `..` 越界。
 */
export function toServerPath(path: string, rootDir: string | null): string {
  let value = path.trim();
  if (!value) throw new JupyterError("invalid_path", "The path is empty.");
  if (isAbsolute(value)) {
    if (!rootDir)
      throw new JupyterError(
        "invalid_path",
        `Absolute path ${value} cannot be mapped: the server's root directory is unknown. Use a path relative to the server root.`,
      );
    const rel = relative(realpath(rootDir), realpath(value));
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new JupyterError("invalid_path", `${value} is outside the server root ${rootDir}.`);
    value = rel.split(sep).join("/");
  }
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new JupyterError("invalid_path", `Paths may not contain "..": ${path}`);
    parts.push(part);
  }
  return parts.join("/");
}

/** 已连接 server 的唯一 owner：attach 与 launch 最终都得到同样的 Entry。 */
export function createServerRegistry(deps: RegistryDeps) {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const now = deps.now ?? Date.now;
  const clientFactory = deps.clientFactory ?? createJupyterClient;
  const discover = deps.discover ?? (() => discoverServers());
  let launching: Promise<ServerInfo> | null = null;
  let environment: JupyterEnvironment = UNKNOWN_ENVIRONMENT;
  let checkingEnvironment: Promise<JupyterEnvironment> | null = null;

  const changed = () => {
    for (const listener of listeners) listener();
  };
  const snapshot = (entry: Entry): ServerInfo => ({ ...entry.info });

  /** 检查工作区能否启动 Jupyter Server（并发的检查合并为一次）；结果变化时通知。 */
  function refreshEnvironment(): Promise<JupyterEnvironment> {
    checkingEnvironment ??= (deps.checkEnvironment ?? (() => checkEnvironment({ workspaceRoot: deps.workspaceRoot, pythonPath: deps.pythonPath })))()
      .then((next) => {
        const same = JSON.stringify({ ...next, checkedAt: 0 }) === JSON.stringify({ ...environment, checkedAt: 0 });
        environment = next;
        if (!same) changed();
        return next;
      })
      .finally(() => {
        checkingEnvironment = null;
      });
    return checkingEnvironment;
  }

  async function verify(client: JupyterClient) {
    // /api/status 需要认证；/api 给出版本。
    await client.status();
    const { version } = await client.version().catch(() => ({ version: null as string | null }));
    return version ?? null;
  }

  function find(server: string): Entry | undefined {
    const direct = entries.get(server);
    if (direct) return direct;
    try {
      const { baseUrl } = normalizeBaseUrl(server);
      return [...entries.values()].find((entry) => entry.info.url === baseUrl);
    } catch {
      return undefined;
    }
  }

  return {
    onChange(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    list: (): ServerInfo[] =>
      [...entries.values()].sort((a, b) => b.lastUsed - a.lastUsed).map(snapshot),

    async discovered(): Promise<DiscoveredServer[]> {
      const found = await discover();
      return found.map((server) => ({
        url: server.baseUrl,
        rootDir: server.rootDir,
        pid: server.pid,
        version: server.version,
        connectedAs:
          [...entries.values()].find((entry) => entry.info.url === server.baseUrl)?.info.id ?? null,
      }));
    },

    /** 连接已有 server。未给 token 时从 URL 的 `?token=` 或本机 runtime 文件取。 */
    async attach({ url, token }: { url: string; token?: string | null }): Promise<ServerInfo> {
      const normalized = normalizeBaseUrl(url);
      let secret = token?.trim() || normalized.token;
      const runtime = (await discover()).find((server) => server.baseUrl === normalized.baseUrl);
      if (!secret && runtime) secret = runtime.token;
      const id = serverIdFor(normalized.baseUrl);
      const existing = entries.get(id);
      if (existing?.process) {
        existing.lastUsed = now();
        return snapshot(existing);
      }
      const client = clientFactory({ baseUrl: normalized.baseUrl, token: secret ?? null });
      let version: string | null;
      try {
        version = await verify(client);
      } catch (error) {
        if (error instanceof JupyterError && error.code === "unauthorized" && !secret)
          throw new JupyterError(
            "unauthorized",
            `The Jupyter Server at ${normalized.baseUrl} needs a token. Pass it as \`token\`, or paste the full URL with ?token=…`,
          );
        throw error;
      }
      const entry: Entry = {
        info: {
          id,
          kind: "attached",
          url: normalized.baseUrl,
          status: "ready",
          rootDir: runtime?.rootDir ?? existing?.info.rootDir ?? null,
          version,
          error: null,
          python: null,
        },
        client,
        process: null,
        lastUsed: now(),
      };
      entries.set(id, entry);
      changed();
      return snapshot(entry);
    },

    /** 最近一次环境检查的结果。 */
    environment: (): JupyterEnvironment => environment,

    checkEnvironment: refreshEnvironment,

    /** start_server 首先尝试的解释器（只看文件是否存在，不探测）。 */
    launchPython(): string | null {
      const first = pythonCandidates(deps.workspaceRoot, deps.pythonPath)[0];
      return first ? (first.display ?? first.command) : null;
    },

    /** 启动本插件自己的 server；已有运行中的 launched server 时直接返回它。 */
    launch({ python, useUv }: { python?: string; useUv?: boolean } = {}): Promise<ServerInfo> {
      const running = [...entries.values()].find(
        (entry) => entry.process && entry.info.status === "ready",
      );
      if (running) {
        running.lastUsed = now();
        return Promise.resolve(snapshot(running));
      }
      if (launching) return launching;
      launching = (async () => {
        let command: string | undefined;
        if (!useUv) {
          const candidates = python
            ? [{ command: python, source: "requested" }]
            : pythonCandidates(deps.workspaceRoot, deps.pythonPath);
          try {
            command = (
              await (deps.findPython ?? findJupyterPython)(candidates, undefined, (target) => installCommandForTarget(target, deps.workspaceRoot))
            ).command;
          } catch (error) {
            // 设置页随之显示缺少的依赖。
            if (error instanceof JupyterError && error.code === "jupyter_not_installed") void refreshEnvironment().catch(() => undefined);
            throw error;
          }
        }
        const proc = await (deps.launch ?? launchJupyterServer)({
          workspaceRoot: deps.workspaceRoot,
          python: command,
          useUv,
          onLog: deps.onLog,
        });
        const id = serverIdFor(proc.baseUrl);
        const entry: Entry = {
          info: {
            id,
            kind: "launched",
            url: proc.baseUrl,
            status: "ready",
            rootDir: deps.workspaceRoot,
            version: null,
            error: null,
            python: proc.python,
          },
          client: clientFactory({ baseUrl: proc.baseUrl, token: proc.token }),
          process: proc,
          lastUsed: now(),
        };
        entry.info.version = await entry.client
          .version()
          .then((value) => value.version)
          .catch(() => null);
        proc.child.once("exit", () => {
          if (entries.get(id) !== entry) return;
          entry.info.status = entry.info.status === "stopped" ? "stopped" : "error";
          entry.info.error ??= `Jupyter Server exited.\n${proc.logTail()}`.trim();
          changed();
        });
        entries.set(id, entry);
        changed();
        return snapshot(entry);
      })().finally(() => {
        launching = null;
      });
      return launching;
    },

    async stop(server: string) {
      const entry = find(server);
      if (!entry) throw new JupyterError("server_not_found", `No connected server ${server}.`);
      if (!entry.process)
        throw new JupyterError(
          "not_launched",
          `${entry.info.id} was not started by this plugin; it can only be disconnected, not stopped.`,
        );
      entry.info.status = "stopped";
      await entry.process.stop();
      entries.delete(entry.info.id);
      changed();
    },

    /** 断开 attached server（不影响 server 本身）。 */
    disconnect(server: string) {
      const entry = find(server);
      if (!entry) return;
      entries.delete(entry.info.id);
      changed();
    },

    /** 解析工具参数里的 server：id 或 URL；省略时取最近使用的可用 server。 */
    resolve(server?: string | null): { info: ServerInfo; client: JupyterClient } {
      let entry: Entry | undefined;
      if (server) {
        entry = find(server);
        if (!entry)
          throw new JupyterError(
            "server_not_found",
            `No connected Jupyter Server "${server}". Call list_servers to see connected and discoverable servers.`,
          );
      } else {
        entry = [...entries.values()]
          .filter((item) => item.info.status === "ready")
          .sort((a, b) => b.lastUsed - a.lastUsed)[0];
        if (!entry)
          throw new JupyterError(
            "no_server",
            "No Jupyter Server is connected. Call list_servers to find a running one and connect_server to use it, or start_server to start one for this workspace.",
          );
      }
      if (entry.info.status !== "ready")
        throw new JupyterError(
          "server_unreachable",
          `Jupyter Server ${entry.info.id} is ${entry.info.status}.${entry.info.error ? ` ${entry.info.error}` : ""}`,
        );
      entry.lastUsed = now();
      return { info: snapshot(entry), client: entry.client };
    },

    async closeAll() {
      await Promise.allSettled(
        [...entries.values()].filter((entry) => entry.process).map((entry) => entry.process!.stop()),
      );
      entries.clear();
    },
  };
}

export type ServerRegistry = ReturnType<typeof createServerRegistry>;
