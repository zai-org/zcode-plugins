import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import type { JupyterEnvironment } from "#nb/contract.ts";
import { findExecutable, tilde } from "#nb/host/facts.ts";
import { inspectPythons, probePython, pythonCandidates, type PythonCandidate, type PythonProbe } from "#nb/servers/launch.ts";

/**
 * 启动前检查工作区能否启动 Jupyter Server：与 start_server 同样的解释器顺序，
 * 另外判断环境是否由 uv 管理（决定安装命令）以及本机是否有 uv。只读，不安装任何东西。
 */

export interface EnvironmentDeps {
  workspaceRoot: string;
  pythonPath: string | null;
  env?: NodeJS.ProcessEnv;
  probe?: (command: string) => Promise<PythonProbe | null>;
  /** 测试注入：替换 uv 的查找。 */
  findUv?: () => Promise<JupyterEnvironment["uv"]>;
}

export const UNKNOWN_ENVIRONMENT: JupyterEnvironment = {
  state: "unknown",
  python: null,
  packages: [],
  checked: [],
  installCommand: null,
  uv: null,
  checkedAt: 0,
};

async function findUv(env: NodeJS.ProcessEnv): Promise<JupyterEnvironment["uv"]> {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const path = await findExecutable("uv", [join(home, ".local", "bin"), join(home, ".cargo", "bin"), "/opt/homebrew/bin", "/usr/local/bin"], { env });
  if (!path) return null;
  const version = await new Promise<string | undefined>((resolve) =>
    execFile(path, ["--version"], { timeout: 5_000, windowsHide: true }, (error, stdout) => resolve(error ? undefined : /uv\s+(\d+\.\d+\.\d+)/.exec(String(stdout))?.[1])),
  );
  return { path: tilde(path, home), ...(version ? { version } : {}) };
}

/** uv 创建的虚拟环境在 pyvenv.cfg 里写有 `uv = <版本>`；项目有 uv.lock 也说明由 uv 管理。 */
export async function managedByUv(venv: string | undefined, workspaceRoot: string): Promise<boolean> {
  if (!venv) return false;
  const config = await readFile(join(venv, "pyvenv.cfg"), "utf8").catch(() => "");
  return /^uv\s*=/m.test(config) || existsSync(join(workspaceRoot, "uv.lock"));
}

/** 虚拟环境的显示写法：工作区内的写成相对路径，否则家目录缩写为 ~。 */
export function venvLabel(venv: string | undefined, workspaceRoot: string, home: string): string | null {
  if (!venv) return null;
  const rel = relative(workspaceRoot, venv);
  return rel && !rel.startsWith("..") && !rel.includes(":") ? rel.split(sep).join("/") : tilde(venv, home);
}

/**
 * 装进目标环境的命令。uv 管理的项目用 `uv add --dev`（写进 pyproject.toml，`uv sync` 不会删掉）；
 * uv 创建但没有 pyproject.toml 的环境用 `uv pip install`（这种环境默认没有 pip）；其余用 pip。
 */
export function installCommandFor(target: PythonCandidate | null, uv: boolean, workspaceRoot: string, venv: string | null): string | null {
  if (!target) return null;
  if (uv && existsSync(join(workspaceRoot, "pyproject.toml"))) return "uv add --dev jupyter-server ipykernel";
  if (uv && venv) return `uv pip install --python ${venv} jupyter-server ipykernel`;
  return `${target.display ?? target.command} -m pip install jupyter-server ipykernel`;
}

/** start_server 失败时给出的安装命令，与设置页一致。 */
export async function installCommandForTarget(target: PythonCandidate | null, workspaceRoot: string, env: NodeJS.ProcessEnv = process.env) {
  const managed = await managedByUv(target?.venv, workspaceRoot);
  return installCommandFor(target, managed, workspaceRoot, venvLabel(target?.venv, workspaceRoot, env.HOME ?? env.USERPROFILE ?? homedir()));
}

export async function checkEnvironment(deps: EnvironmentDeps): Promise<JupyterEnvironment> {
  const env = deps.env ?? process.env;
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const candidates = pythonCandidates(deps.workspaceRoot, deps.pythonPath, env);
  const [inspection, uv] = await Promise.all([inspectPythons(candidates, deps.probe ?? probePython), (deps.findUv ?? (() => findUv(env)))()]);
  const chosen = inspection.found ?? inspection.target;
  const managed = await managedByUv(chosen?.candidate.venv, deps.workspaceRoot);
  const venv = venvLabel(chosen?.candidate.venv, deps.workspaceRoot, home);
  return {
    state: inspection.found ? "ready" : "missing",
    python: chosen
      ? {
          executable: chosen.candidate.display ?? chosen.candidate.command,
          source: chosen.candidate.source,
          version: chosen.probe.version,
          venv,
          uv: managed,
        }
      : null,
    packages: chosen
      ? [
          { name: "jupyter-server", version: chosen.probe.jupyterServer },
          { name: "ipykernel", version: chosen.probe.ipykernel },
        ]
      : [],
    checked: candidates.map((candidate) => candidate.display ?? candidate.command),
    installCommand: inspection.found ? null : installCommandFor(chosen?.candidate ?? null, managed, deps.workspaceRoot, venv),
    uv,
    checkedAt: Date.now(),
  };
}
