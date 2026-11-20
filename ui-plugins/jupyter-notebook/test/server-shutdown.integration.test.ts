import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ensureJupyterPython } from "../scripts/jupyter-env.mjs";
import { launchJupyterServer, type LaunchedProcess } from "#nb/servers/launch.ts";
import { createServerRegistry } from "#nb/servers/registry.ts";

it("stops a real Jupyter process that becomes ready during registry shutdown", async () => {
  const python = await ensureJupyterPython();
  const workspace = await mkdtemp(join(tmpdir(), "jupyter-nb-shutdown-"));
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  let resume!: () => void;
  const released = new Promise<void>((resolve) => { resume = resolve; });
  let proc: LaunchedProcess | undefined;
  const registry = createServerRegistry({
    workspaceRoot: workspace, pythonPath: python,
    launch: async (options) => {
      proc = await launchJupyterServer(options);
      ready();
      await released;
      return proc;
    },
  });
  try {
    const launch = registry.launch();
    const result = launch.then(() => null, (error: unknown) => error);
    await started;
    expect(proc!.child.exitCode).toBeNull();
    const closing = registry.closeAll();
    resume();
    await closing;
    const completion = await result;
    expect(proc!.child.exitCode !== null || proc!.child.signalCode !== null).toBe(true);
    expect(completion).toMatchObject({ code: "invalid_operation" });
    expect(registry.list()).toEqual([]);
    await expect(fetch(new URL("api/status", proc!.baseUrl))).rejects.toThrow();
  } finally {
    resume();
    await proc?.stop();
    await registry.closeAll();
    await rm(workspace, { recursive: true, force: true });
  }
});
