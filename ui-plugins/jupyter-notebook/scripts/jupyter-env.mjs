import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 测试用的隔离 Python 环境：`.cache/jupyter-env`，由 uv 创建，装 jupyter-server + ipykernel。
 * 不写全局环境。`JUPYTER_TEST_PYTHON` 可直接指定一个已装好依赖的解释器。
 */
export async function ensureJupyterPython() {
  if (process.env.JUPYTER_TEST_PYTHON) return process.env.JUPYTER_TEST_PYTHON;
  const venv = join(root, ".cache/jupyter-env");
  const python = join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  if (!existsSync(python)) {
    await run("uv", ["venv", "--quiet", "--python", "3.12", venv]);
  }
  try {
    await run(python, ["-c", "import jupyter_server, ipykernel"]);
  } catch {
    await run("uv", [
      "pip",
      "install",
      "--quiet",
      "--python",
      python,
      "jupyter-server==2.21.1",
      "ipykernel==7.4.0",
    ]);
  }
  return python;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${await ensureJupyterPython()}\n`);
}
