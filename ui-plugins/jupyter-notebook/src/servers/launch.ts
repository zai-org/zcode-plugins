import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { JupyterError, type MissingJupyterDetails } from "#nb/contract.ts";

export interface PythonProbe {
  executable: string;
  version: string;
  jupyterServer: string | null;
  ipykernel: string | null;
}

export interface PythonCandidate {
  command: string;
  source: string;
  /** 给人看的写法：工作区内的解释器写成相对路径。 */
  display?: string;
  /** 所在虚拟环境的目录（工作区虚拟环境、VIRTUAL_ENV、CONDA_PREFIX）。 */
  venv?: string;
}

const PROBE = [
  "import json, sys",
  "def v(name):",
  "    try:",
  "        return __import__(name).__version__",
  "    except Exception:",
  "        return None",
  "print(json.dumps({'executable': sys.executable, 'version': sys.version.split()[0],",
  "  'jupyterServer': v('jupyter_server'), 'ipykernel': v('ipykernel')}))",
].join("\n");

/**
 * 启动脚本：在 jupyter_server 进程内起一个线程读 stdin，父进程（插件 server）退出导致 EOF 时
 * 向自己发 SIGTERM，jupyter_server 随之正常关闭 kernel。避免插件被强杀后留下孤儿 server。
 */
export const BOOTSTRAP = [
  "import os, signal, sys, threading",
  "def _watch():",
  "    try:",
  "        while sys.stdin.buffer.read(1024):",
  "            pass",
  "    except Exception:",
  "        pass",
  "    os.kill(os.getpid(), signal.SIGTERM)",
  "threading.Thread(target=_watch, daemon=True).start()",
  "from jupyter_server.serverapp import main",
  "sys.argv = ['jupyter-server'] + sys.argv[1:]",
  "sys.exit(main())",
].join("\n");

/** 候选解释器：配置项、工作区虚拟环境、激活的环境、PATH。 */
export function pythonCandidates(
  workspaceRoot: string,
  configured: string | null,
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): PythonCandidate[] {
  const bin = platform === "win32" ? "Scripts/python.exe" : "bin/python";
  const list: PythonCandidate[] = [];
  if (configured) list.push({ command: configured, source: "plugin setting" });
  for (const dir of [".venv", "venv", ".env", "env"]) {
    const path = join(workspaceRoot, dir, bin);
    if (existsSync(path)) list.push({ command: path, source: `workspace ${dir}`, display: `${dir}/${bin}`, venv: join(workspaceRoot, dir) });
  }
  if (env.VIRTUAL_ENV) list.push({ command: join(env.VIRTUAL_ENV, bin), source: "VIRTUAL_ENV", venv: env.VIRTUAL_ENV });
  if (env.CONDA_PREFIX)
    list.push({
      command: join(env.CONDA_PREFIX, platform === "win32" ? "python.exe" : "bin/python"),
      source: "CONDA_PREFIX",
      venv: env.CONDA_PREFIX,
    });
  for (const name of platform === "win32" ? ["python", "py"] : ["python3", "python"])
    list.push({ command: name, source: "PATH" });
  const seen = new Set<string>();
  return list.filter((item) => !seen.has(item.command) && seen.add(item.command));
}

export function probePython(command: string, timeoutMs = 20_000): Promise<PythonProbe | null> {
  return new Promise((resolve) => {
    execFile(command, ["-c", PROBE], { timeout: timeoutMs }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const line = stdout.trim().split("\n").pop() ?? "";
        resolve(JSON.parse(line) as PythonProbe);
      } catch {
        resolve(null);
      }
    });
  });
}

export interface PythonInspection {
  /** 第一个同时装有 jupyter_server 与 ipykernel 的解释器。 */
  found: { candidate: PythonCandidate; probe: PythonProbe } | null;
  /** 没有找到时的安装目标：第一个能运行的解释器（通常是工作区虚拟环境）。 */
  target: { candidate: PythonCandidate; probe: PythonProbe } | null;
  pythons: MissingJupyterDetails["pythons"];
  report: string[];
}

/** 依次探测候选解释器，直到找到装有两者的那个。 */
export async function inspectPythons(
  candidates: PythonCandidate[],
  probe: (command: string) => Promise<PythonProbe | null> = probePython,
): Promise<PythonInspection> {
  const report: string[] = [];
  const pythons: MissingJupyterDetails["pythons"] = [];
  let target: PythonInspection["target"] = null;
  for (const candidate of candidates) {
    const shown = candidate.display ?? candidate.command;
    const result = await probe(candidate.command);
    if (!result) {
      report.push(`- ${candidate.command} (${candidate.source}): not found or not runnable`);
      pythons.push({ executable: shown, source: candidate.source, version: null, missing: [] });
      continue;
    }
    if (result.jupyterServer && result.ipykernel) return { found: { candidate, probe: result }, target: null, pythons, report };
    target ??= { candidate, probe: result };
    const missing = [!result.jupyterServer && "jupyter-server", !result.ipykernel && "ipykernel"].filter(
      (name): name is string => !!name,
    );
    report.push(`- ${result.executable} (${candidate.source}, Python ${result.version}): missing ${missing.join(" and ")}`);
    pythons.push({ executable: shown, source: candidate.source, version: result.version, missing });
  }
  return { found: null, target, pythons, report };
}

/** 依次探测，返回第一个同时装有 jupyter_server 与 ipykernel 的解释器。 */
export async function findJupyterPython(
  candidates: PythonCandidate[],
  probe: (command: string) => Promise<PythonProbe | null> = probePython,
  installCommand?: (target: PythonCandidate | null) => Promise<string | null>,
): Promise<{ command: string; probe: PythonProbe }> {
  const { found, target, pythons, report } = await inspectPythons(candidates, probe);
  if (found) return { command: found.candidate.command, probe: found.probe };
  // 建议装进第一个能运行的解释器（通常是工作区虚拟环境）。
  const shown = target ? (target.candidate.display ?? target.candidate.command) : "python3";
  const details: MissingJupyterDetails = {
    checked: report,
    pythons,
    installCommand: (await installCommand?.(target?.candidate ?? null)) ?? `${shown} -m pip install jupyter-server ipykernel`,
  };
  throw new JupyterError(
    "jupyter_not_installed",
    [
      "No Python environment with jupyter-server and ipykernel was found. Checked:",
      ...report,
      `Install them into the project's environment (\`${details.installCommand}\`), pass \`python\` with the path of an interpreter that has them, or start with \`useUv: true\` to let uv provide them.`,
    ].join("\n"),
    details as unknown as Record<string, unknown>,
  );
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export interface LaunchedProcess {
  baseUrl: string;
  token: string;
  python: string;
  pid: number;
  child: ChildProcess;
  /** stderr 末尾若干行，用于诊断。 */
  logTail: () => string;
  stop: () => Promise<void>;
}

export interface LaunchOptions {
  workspaceRoot: string;
  /** 解释器命令；与 useUv 二选一。 */
  python?: string;
  useUv?: boolean;
  readyTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  onLog?: (line: string) => void;
}

const LOG_LINES = 60;

export async function launchJupyterServer(options: LaunchOptions): Promise<LaunchedProcess> {
  const port = await freePort();
  const token = randomBytes(24).toString("hex");
  const baseUrl = `http://127.0.0.1:${port}/`;
  const serverArgs = [
    "--no-browser",
    "--ServerApp.ip=127.0.0.1",
    `--ServerApp.port=${port}`,
    "--ServerApp.port_retries=0",
    `--ServerApp.root_dir=${options.workspaceRoot}`,
  ];
  const [command, args, python] = options.useUv
    ? [
        "uv",
        ["run", "--with", "jupyter-server", "--with", "ipykernel", "python", "-c", BOOTSTRAP, ...serverArgs],
        "uv run python",
      ]
    : [options.python!, ["-c", BOOTSTRAP, ...serverArgs], options.python!];
  const child = spawn(command, args, {
    cwd: options.workspaceRoot,
    env: { ...process.env, JUPYTER_TOKEN: token, PYTHONUNBUFFERED: "1" },
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true,
  });
  const lines: string[] = [];
  let partial = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    partial += chunk;
    const parts = partial.split("\n");
    partial = parts.pop() ?? "";
    for (const line of parts) {
      // 日志里可能出现带 token 的 URL。
      const clean = line.split(token).join("<token>");
      lines.push(clean);
      if (lines.length > LOG_LINES) lines.shift();
      options.onLog?.(clean);
    }
  });
  const logTail = () => lines.join("\n");
  let exited = false;
  let exitInfo = "";
  const exitPromise = new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      exited = true;
      exitInfo = signal ? `signal ${signal}` : `exit code ${code}`;
      resolve();
    });
    child.once("error", (error) => {
      exited = true;
      exitInfo = error.message;
      resolve();
    });
  });

  const stop = async () => {
    if (exited) return;
    // 关闭 stdin 触发 BOOTSTRAP 的看门狗，jupyter_server 正常关闭 kernel。
    child.stdin?.end();
    const timer = setTimeout(() => child.kill("SIGTERM"), 5_000);
    const hard = setTimeout(() => child.kill("SIGKILL"), 10_000);
    await exitPromise;
    clearTimeout(timer);
    clearTimeout(hard);
  };

  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + (options.readyTimeoutMs ?? (options.useUv ? 180_000 : 60_000));
  while (Date.now() < deadline) {
    if (exited) {
      throw new JupyterError(
        "launch_failed",
        `Jupyter Server exited during startup (${exitInfo}).\n${logTail()}`.trim(),
      );
    }
    try {
      const response = await fetchImpl(new URL("api/status", baseUrl), {
        headers: { Authorization: `token ${token}` },
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return { baseUrl, token, python, pid: child.pid ?? 0, child, logTail, stop };
      }
    } catch {
      // 尚未监听
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stop();
  throw new JupyterError("launch_failed", `Jupyter Server did not become ready in time.\n${logTail()}`.trim());
}
