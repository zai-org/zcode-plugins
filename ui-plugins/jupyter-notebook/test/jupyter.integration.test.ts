import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureJupyterPython } from "../scripts/jupyter-env.mjs";
import { createNotebookOwner, type NotebookOwner } from "#nb/app/notebooks.ts";
import { JupyterError, type NotebookDoc } from "#nb/contract.ts";
import { createJupyterClient } from "#nb/jupyter/rest.ts";
import { discoverServers } from "#nb/servers/discover.ts";
import { launchJupyterServer, type LaunchedProcess } from "#nb/servers/launch.ts";
import { createServerRegistry, type ServerRegistry } from "#nb/servers/registry.ts";

let python: string;
let workspace: string;
let registry: ServerRegistry;
let owner: NotebookOwner;

const waitFor = async (check: () => boolean | Promise<boolean>, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for condition");
};

const cell = (doc: NotebookDoc, id: string) => doc.cells.find((item) => item.id === id)!;
const text = (doc: NotebookDoc, id: string) =>
  cell(doc, id)
    .outputs.map((output) =>
      output.output_type === "stream"
        ? output.text
        : output.output_type === "error"
          ? `${output.ename}: ${output.evalue}`
          : String(output.data["text/plain"] ?? ""),
    )
    .join("");

beforeAll(async () => {
  python = await ensureJupyterPython();
  workspace = await mkdtemp(join(tmpdir(), "jupyter-nb-it-"));
  registry = createServerRegistry({ workspaceRoot: workspace, pythonPath: python });
  owner = createNotebookOwner({ resolveServer: (server) => registry.resolve(server), saveDelayMs: 50 });
});

afterAll(async () => {
  await owner?.closeAll();
  await registry?.closeAll();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe("launched server", () => {
  it("starts a server rooted at the workspace", async () => {
    expect(() => registry.resolve()).toThrow(JupyterError);
    const info = await registry.launch();
    expect(info).toMatchObject({ kind: "launched", status: "ready", rootDir: workspace });
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(JSON.stringify(info)).not.toMatch(/token/i);
    // 第二次 launch 复用同一个 server
    expect((await registry.launch()).id).toBe(info.id);
  });

  it("creates, edits, runs and saves a notebook", async () => {
    const { doc, created } = await owner.open({ path: "work/a.ipynb", create: true });
    expect(created).toBe(true);
    expect(doc.path).toBe("work/a.ipynb");
    const { inserted } = owner.edit(null, [
      { op: "insert", source: "import sys\nprint('hello'); print('oops', file=sys.stderr)\nsys.executable" },
      {
        op: "insert",
        source:
          "from IPython.display import display, HTML, clear_output\nh = display(HTML('<b>x</b>'), display_id=True)\nh.update(HTML('<i>y</i>'))",
      },
      { op: "insert", source: "print('gone')\nclear_output(wait=True)\nprint('kept')" },
      { op: "insert", type: "markdown", source: "# Title" },
      { op: "insert", source: "1/0" },
      { op: "insert", source: "print('never')" },
    ]);
    expect(inserted).toHaveLength(6);
    const [a, b, c, md, err, never] = inserted as [string, string, string, string, string, string];
    const run = await owner.execute(null, { all: true }, { wait: true, timeoutMs: 60_000 });
    expect(run.finished).toBe(true);
    expect(run.cellIds).not.toContain(md);
    const after = await owner.read();
    expect(text(after, a)).toContain("hello\n");
    expect(text(after, a)).toContain("oops\n");
    // kernel 使用启动 server 的解释器
    expect(text(after, a)).toContain(".cache/jupyter-env");
    expect(cell(after, a).run?.state).toBe("ok");
    expect(cell(after, a).executionCount).toBe(1);
    const display = cell(after, b).outputs[0]!;
    expect(display.output_type === "display_data" && display.data["text/html"]).toBe("<i>y</i>");
    expect(text(after, c)).toBe("kept\n");
    expect(cell(after, err).run?.state).toBe("error");
    expect(text(after, err)).toContain("ZeroDivisionError");
    expect(cell(after, never).run?.state).toBe("aborted");
    expect(cell(after, never).outputs).toEqual([]);

    await waitFor(async () => (await owner.read()).save.state === "saved");
    const client = registry.resolve().client;
    const file = await client.getContents("work/a.ipynb", { type: "notebook" });
    const saved = file.content as { nbformat_minor: number; cells: { id: string; outputs?: { output_type: string }[]; source: string }[] };
    expect(saved.nbformat_minor).toBeGreaterThanOrEqual(5);
    expect(saved.cells.map((item) => item.id)).toEqual(inserted);
    // Contents API 读回时合并多行；磁盘上是按行切分的数组。
    expect(saved.cells[0]!.source).toMatch(/^import sys\nprint/);
    expect(saved.cells[4]!.outputs?.[0]?.output_type).toBe("error");
    // 文件也在工作区磁盘上
    const disk = JSON.parse(await readFile(join(workspace, "work/a.ipynb"), "utf8"));
    expect(disk.cells).toHaveLength(6);
    expect(disk.cells[0].source[0]).toBe("import sys\n");
  });

  it("interrupts a running cell", async () => {
    const { inserted } = owner.edit(null, [{ op: "insert", source: "import time\ntime.sleep(60)" }]);
    const id = inserted[0]!;
    const run = await owner.execute(null, { cellIds: [id] });
    expect(run.finished).toBe(false);
    await waitFor(async () => cell(await owner.read(), id).run?.state === "running");
    await owner.interrupt();
    await waitFor(async () => cell(await owner.read(), id).run?.state === "error");
    expect(text(await owner.read(), id)).toContain("KeyboardInterrupt");
  });

  it("reports a still-running cell when the wait times out, and restarts", async () => {
    const { inserted } = owner.edit(null, [
      { op: "insert", source: "x = 41" },
      { op: "insert", source: "import time\ntime.sleep(30)" },
    ]);
    await owner.execute(null, { cellIds: [inserted[0]!] }, { wait: true });
    const slow = await owner.execute(null, { cellIds: [inserted[1]!] }, { wait: true, timeoutMs: 1_000 });
    expect(slow.finished).toBe(false);
    expect(cell(await owner.read(), inserted[1]!).run?.state).toBe("running");
    await owner.restart();
    expect(cell(await owner.read(), inserted[1]!).run?.state).toBe("aborted");
    await waitFor(async () => (await owner.read()).kernel.status === "idle");
    const { inserted: probe } = owner.edit(null, [{ op: "insert", source: "print('x' in dir())" }]);
    await owner.execute(null, { cellIds: probe }, { wait: true, timeoutMs: 30_000 });
    expect(text(await owner.read(), probe[0]!)).toBe("False\n");
  });

  it("recovers when the kernel dies", async () => {
    const { inserted } = owner.edit(null, [
      { op: "insert", source: "import os\nos._exit(1)" },
      { op: "insert", source: "print('after crash')" },
    ]);
    await owner.execute(null, { cellIds: [inserted[0]!] }, { wait: true, timeoutMs: 30_000 });
    const crashed = cell(await owner.read(), inserted[0]!);
    expect(crashed.run?.state).toBe("aborted");
    expect(text(await owner.read(), inserted[0]!)).toContain("KernelRestarted");
    await waitFor(async () => (await owner.read()).kernel.status === "idle", 30_000);
    await owner.execute(null, { cellIds: [inserted[1]!] }, { wait: true, timeoutMs: 30_000 });
    expect(text(await owner.read(), inserted[1]!)).toBe("after crash\n");
  });

  it("detects a conflicting external save and can reload", async () => {
    await waitFor(async () => (await owner.read()).save.state === "saved");
    const client = registry.resolve().client;
    const file = await client.getContents("work/a.ipynb", { type: "notebook" });
    const content = file.content as { cells: { source: string[] }[] };
    content.cells[0]!.source = ["print('changed elsewhere')\n"];
    // 保证 last_modified 不同
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.saveNotebook("work/a.ipynb", content);
    const before = await owner.read();
    owner.edit(null, [{ op: "update", cellId: before.cells[1]!.id, source: "# local change" }]);
    await waitFor(async () => (await owner.read()).save.state === "conflict");
    await expect(owner.save()).rejects.toMatchObject({ code: "save_conflict" });
    const { doc, reloaded } = await owner.open({ path: "work/a.ipynb", reload: true });
    expect(reloaded).toBe(true);
    expect(doc.save.state).toBe("saved");
    expect(doc.cells[0]!.source).toBe("print('changed elsewhere')\n");
    expect(doc.cells[0]!.revision).toBeGreaterThan(before.cells[0]!.revision);
  });

  it("auto-reloads a clean notebook changed on the server", async () => {
    const client = registry.resolve().client;
    const file = await client.getContents("work/a.ipynb", { type: "notebook" });
    const content = file.content as { cells: unknown[] };
    content.cells.push({ id: "ext1", cell_type: "markdown", metadata: {}, source: "added" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.saveNotebook("work/a.ipynb", content);
    const doc = await owner.read(null, { refresh: true });
    expect(doc.cells.at(-1)).toMatchObject({ id: "ext1", source: "added" });
  });

  it("runs the latest source when a cell is edited while the kernel starts", async () => {
    const { doc } = await owner.open({ path: "fresh.ipynb", create: true });
    expect(doc.kernel.status).toBe("none");
    const { inserted } = owner.edit(doc.id, [{ op: "insert", source: "print('old')" }]);
    const running = owner.execute(doc.id, { cellIds: inserted }, { wait: true, timeoutMs: 60_000 });
    owner.edit(doc.id, [{ op: "update", cellId: inserted[0]!, source: "print('new')" }]);
    await running;
    expect(text(await owner.read(doc.id), inserted[0]!)).toBe("new\n");
    await owner.close(doc.id);
    owner.select((await owner.open({ path: "work/a.ipynb" })).doc.id);
  });

  it("rejects paths outside the server root", async () => {
    await expect(owner.open({ path: "../x.ipynb", create: true })).rejects.toMatchObject({ code: "invalid_path" });
    await expect(owner.open({ path: "/etc/x.ipynb", create: true })).rejects.toMatchObject({ code: "invalid_path" });
    await expect(owner.open({ path: join(workspace, "abs.ipynb"), create: true })).resolves.toMatchObject({
      doc: { path: "abs.ipynb" },
    });
    await expect(owner.open({ path: "missing.ipynb" })).rejects.toMatchObject({ code: "notebook_not_found" });
  });
});

describe("attached server", () => {
  let external: LaunchedProcess;
  let externalRoot: string;

  beforeAll(async () => {
    externalRoot = await mkdtemp(join(tmpdir(), "jupyter-nb-ext-"));
    external = await launchJupyterServer({ workspaceRoot: externalRoot, python });
  });
  afterAll(async () => {
    await external?.stop();
    if (externalRoot) await rm(externalRoot, { recursive: true, force: true });
  });

  it("is discovered from the runtime directory without exposing its token", async () => {
    const found = await discoverServers();
    expect(found.some((server) => server.baseUrl === external.baseUrl)).toBe(true);
    const listed = await registry.discovered();
    const entry = listed.find((server) => server.url === external.baseUrl)!;
    expect(entry.connectedAs).toBeNull();
    expect(JSON.stringify(listed)).not.toContain(external.token);
  });

  it("rejects a wrong token and connects with the discovered one", async () => {
    await expect(registry.attach({ url: external.baseUrl, token: "wrong" })).rejects.toMatchObject({
      code: "unauthorized",
    });
    const info = await registry.attach({ url: `${external.baseUrl}lab?foo=1` });
    expect(info).toMatchObject({ kind: "attached", url: external.baseUrl, rootDir: externalRoot, status: "ready" });
    expect((await registry.discovered()).find((server) => server.url === external.baseUrl)?.connectedAs).toBe(info.id);
  });

  it("joins an existing kernel session for the same notebook (as JupyterLab would)", async () => {
    const client = createJupyterClient({ baseUrl: external.baseUrl, token: external.token });
    await client.saveNotebook("shared.ipynb", { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] });
    const lab = await client.createSession("shared.ipynb", "python3");
    const serverId = registry.list().find((server) => server.url === external.baseUrl)!.id;
    const { doc } = await owner.open({ server: serverId, path: "shared.ipynb" });
    expect(doc.kernel.id).toBe(lab.kernel!.id);
    const { inserted } = owner.edit(doc.id, [{ op: "insert", source: "shared_value = 7\nshared_value * 6" }]);
    await owner.execute(doc.id, { cellIds: inserted }, { wait: true, timeoutMs: 30_000 });
    expect(text(await owner.read(doc.id), inserted[0]!)).toBe("42");
    // 关闭 notebook 不应删除别人的 session
    await owner.close(doc.id);
    expect((await client.listSessions()).some((session) => session.id === lab.id)).toBe(true);
  });

  it("refuses to stop a server it did not start", async () => {
    const serverId = registry.list().find((server) => server.url === external.baseUrl)!.id;
    await expect(registry.stop(serverId)).rejects.toMatchObject({ code: "not_launched" });
  });
});

describe("shutdown", () => {
  it("stops the launched server and its kernels", async () => {
    const launched = registry.list().find((server) => server.kind === "launched")!;
    await owner.closeAll();
    await registry.stop(launched.id);
    await expect(fetch(new URL("api", launched.url))).rejects.toThrow();
  });
});
