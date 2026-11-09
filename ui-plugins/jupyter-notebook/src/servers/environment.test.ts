import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PythonProbe } from "#nb/servers/launch.ts";
import { checkEnvironment } from "#nb/servers/environment.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jnb-env-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const venvPython = (root: string) => join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
async function makeVenv(config: string) {
  await mkdir(join(venvPython(dir), ".."), { recursive: true });
  await writeFile(venvPython(dir), "");
  await writeFile(join(dir, ".venv", "pyvenv.cfg"), config);
}
const probeWith =
  (packages: { jupyterServer: string | null; ipykernel: string | null } | null) =>
  async (command: string): Promise<PythonProbe | null> =>
    command === venvPython(dir) && packages ? { executable: command, version: "3.12.4", ...packages } : null;
const base = { pythonPath: null, env: { PATH: "" }, findUv: async () => ({ path: "~/.local/bin/uv", version: "0.8.3" }) };

describe.skipIf(process.platform === "win32")("environment check", () => {
  it("reports what is missing in a uv project and suggests uv add --dev", async () => {
    await makeVenv("home = /usr/bin\nuv = 0.8.3\n");
    await writeFile(join(dir, "pyproject.toml"), "[project]\nname = 'x'\n");
    const env = await checkEnvironment({ ...base, workspaceRoot: dir, probe: probeWith({ jupyterServer: null, ipykernel: "6.29.5" }) });
    expect(env).toMatchObject({
      state: "missing",
      python: { executable: ".venv/bin/python", source: "workspace .venv", version: "3.12.4", venv: ".venv", uv: true },
      packages: [
        { name: "jupyter-server", version: null },
        { name: "ipykernel", version: "6.29.5" },
      ],
      installCommand: "uv add --dev jupyter-server ipykernel",
      uv: { path: "~/.local/bin/uv", version: "0.8.3" },
    });
    expect(env.checked[0]).toBe(".venv/bin/python");
  });

  it("uses uv pip for a uv environment without pyproject.toml, and pip otherwise", async () => {
    await makeVenv("uv = 0.8.3\n");
    expect((await checkEnvironment({ ...base, workspaceRoot: dir, probe: probeWith({ jupyterServer: null, ipykernel: null }) })).installCommand).toBe(
      "uv pip install --python .venv jupyter-server ipykernel",
    );
    await writeFile(join(dir, ".venv", "pyvenv.cfg"), "home = /usr/bin\n");
    const plain = await checkEnvironment({ ...base, workspaceRoot: dir, probe: probeWith({ jupyterServer: null, ipykernel: null }) });
    expect(plain.python?.uv).toBe(false);
    expect(plain.installCommand).toBe(".venv/bin/python -m pip install jupyter-server ipykernel");
  });

  it("is ready when both packages are installed, and has no target without Python", async () => {
    await makeVenv("home = /usr/bin\n");
    const ready = await checkEnvironment({ ...base, workspaceRoot: dir, probe: probeWith({ jupyterServer: "2.14.2", ipykernel: "6.29.5" }) });
    expect(ready).toMatchObject({ state: "ready", installCommand: null });
    const none = await checkEnvironment({ ...base, workspaceRoot: dir, probe: async () => null, findUv: async () => null });
    expect(none).toMatchObject({ state: "missing", python: null, packages: [], installCommand: null, uv: null });
  });
});
