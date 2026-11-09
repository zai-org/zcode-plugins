import { afterEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { createTypstMcpServer } from "#t/adapters/server.ts";
import { TypstSession } from "#t/app/session.ts";
import { STATE_URI, URIS, type HostFacts, type SessionState, type Toolchain } from "#t/contract.ts";
import { pdfjsDataDir } from "#t/pdf/extract.ts";

const FAKE = resolve(dirname(fileURLToPath(import.meta.url)), "fake-typst.mjs");

interface Setup {
  client: Client;
  session: TypstSession;
  workspace: string;
  updates: string[];
  call: (name: string, args?: Record<string, unknown>) => Promise<{ isError?: boolean; text: string; content: any[]; structuredContent?: any }>;
  state: () => Promise<SessionState>;
  write: (path: string, text: string) => Promise<void>;
}

const open: Setup[] = [];
afterEach(async () => {
  for (const setup of open.splice(0)) {
    await setup.session.close();
    await setup.client.close();
  }
});

async function setup(
  files: Record<string, string>,
  options: { env?: Record<string, string>; dataDir?: string; locate?: () => Promise<Toolchain>; facts?: () => Promise<HostFacts> } = {},
): Promise<Setup> {
  const workspace = await mkdtemp(join(tmpdir(), "typst-tools-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(workspace, path)), { recursive: true });
    await writeFile(join(workspace, path), text);
  }
  const session = new TypstSession({
    workspaceRoot: workspace,
    dataDir: options.dataDir ?? join(workspace, ".data"),
    typstPath: FAKE,
    pdfjsDataDir: pdfjsDataDir(),
    env: { ...process.env, ...options.env },
    ...(options.locate ? { locate: options.locate } : {}),
    facts: options.facts ?? (async () => FACTS),
  });
  const server = createTypstMcpServer({ session, assetRoot: workspace, pdfjsDataDir: pdfjsDataDir() });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  const updates: string[] = [];
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => void updates.push(notification.params.uri));
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const result: Setup = {
    client,
    session,
    workspace,
    updates,
    call: async (name, args = {}) => {
      const response = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: any[]; structuredContent?: any };
      return { ...response, text: response.content[0]!.text };
    },
    state: async () => JSON.parse(((await client.readResource({ uri: STATE_URI })).contents[0] as { text: string }).text),
    write: async (path, text) => {
      // 保证修改时间晚于上一次编译开始的时间（文件系统时间精度）。
      await new Promise((done) => setTimeout(done, 15));
      await writeFile(join(workspace, path), text);
    },
  };
  open.push(result);
  return result;
}

const FACTS: HostFacts = { os: "macos", osName: "macOS 15.4", arch: "Apple silicon", tools: [{ name: "Homebrew", version: "4.5.2", path: "/opt/homebrew/bin/brew" }] };

const PAPER = {
  "main.typ": '= Introduction\nThe quick brown fox jumps over the lazy dog.\n#include "chapters/one.typ"\nClosing words of the paper.\n',
  "chapters/one.typ": "= Chapter One\nA sentence that lives in the first chapter.\n",
};

describe.skipIf(process.platform === "win32")("tools", () => {
  it("status describes Typst, the main file and the compile result", async () => {
    const t = await setup(PAPER);
    const tools = await t.client.listTools();
    expect(tools.tools.find((tool) => tool.name === "status")!._meta).toMatchObject({ "openai/ui": { preferredModelDisplayMode: "fullscreen" } });
    expect(tools.tools.find((tool) => tool.name === "locate_source")!._meta).toMatchObject({ ui: { visibility: ["app"] } });
    await t.call("check");
    const status = await t.call("status");
    expect(status.text).toMatch(/^Typst 0\.14\.2 \(.*fake-typst\.mjs\)\./);
    expect(status.text).toContain("Main file: main.typ (other .typ files: chapters/one.typ)");
    expect(status.text).toMatch(/main\.typ compiled successfully in [\d.]+ ms — 1 page\. No errors or warnings\./);
    expect(status.structuredContent).toMatchObject({ main: "main.typ", candidates: ["main.typ", "chapters/one.typ"], phase: "ok", pages: 1, errors: 0 });
  });

  it("check waits for edits, reports errors with hints and keeps the last good preview", async () => {
    const t = await setup(PAPER);
    expect((await t.call("check")).text).toContain("compiled successfully");
    const first = (await t.state()).snapshot!;
    await t.write("main.typ", `${PAPER["main.typ"]}#error("unknown variable: oops")\n`);
    const failed = await t.call("check");
    expect(failed.isError).toBeFalsy();
    expect(failed.text).toContain("main.typ failed to compile: 1 error. The preview still shows the last successful version (1 page).");
    expect(failed.text).toContain('error: unknown variable: oops\n  at main.typ:5:1\n  | #error("unknown variable: oops")\n  hint: a hint from the fake compiler');
    expect(failed.structuredContent).toMatchObject({ phase: "error", errors: 1, warnings: 0 });
    expect((await t.state()).snapshot!.seq).toBe(first.seq);

    // 修改被引入的文件：依赖列表来自 typst。
    await t.write("main.typ", PAPER["main.typ"]);
    await t.write("chapters/one.typ", `${PAPER["chapters/one.typ"]}#warn("unknown font family: nope")\nA new line.\n`);
    const warned = await t.call("check");
    expect(warned.text).toMatch(/main\.typ compiled with 1 warning in [\d.]+ ms — 1 page\./);
    expect(warned.text).toContain("at chapters/one.typ:3:1");
    expect((await t.state()).snapshot!.seq).toBeGreaterThan(first.seq);
  });

  it("restarts typst watch when it misses a change", async () => {
    const t = await setup(PAPER, { env: { FAKE_TYPST_DEAF: "1" } });
    await t.call("check");
    await t.write("main.typ", `${PAPER["main.typ"]}#error("missed")\n`);
    const started = Date.now();
    const result = await t.call("check");
    expect(result.text).toContain("error: missed");
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("works with Typst 0.12/0.13 (Makefile dependencies)", async () => {
    const t = await setup(PAPER, { env: { FAKE_TYPST_VERSION: "0.13.1" } });
    expect((await t.call("check")).text).toContain("compiled successfully");
    await t.write("chapters/one.typ", '#error("in chapter")\n');
    expect((await t.call("check")).text).toContain("at chapters/one.typ:1:1");
    const located = await t.call("locate_source", { text: "Closing words of the paper." });
    expect(located.structuredContent.matches[0]).toMatchObject({ file: "main.typ", line: 4 });
  });

  it("publishes snapshots in chunks and notifies subscribers", async () => {
    const t = await setup(PAPER);
    await t.client.subscribeResource({ uri: STATE_URI });
    await t.call("check");
    const state = await t.state();
    expect(state.snapshot).toMatchObject({ seq: 1, parts: 1, pages: 1 });
    const part = await t.client.readResource({ uri: URIS.pdfPart(state.snapshot!.seq, 0) });
    expect(Buffer.from((part.contents[0] as { blob: string }).blob, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    t.updates.length = 0;
    for (let round = 1; round <= 4; round++) {
      await t.write("main.typ", `${PAPER["main.typ"]}Round ${round}.\n`);
      await t.call("check");
    }
    expect(t.updates.filter((uri) => uri === STATE_URI).length).toBeGreaterThanOrEqual(4);
    expect((await t.state()).snapshot!.seq).toBe(5);
    // 只保留最近的快照。
    await expect(t.client.readResource({ uri: URIS.pdfPart(1, 0) })).rejects.toThrow(/no longer available/);
  });

  it("show highlights quotes and source lines, follows edits, and scrolls to pages", async () => {
    const t = await setup(PAPER);
    const quoted = await t.call("show", { quote: "quick brown fox jumps", comment: "Classic." });
    expect(quoted.text).toBe("Highlighted h1 on page 1: “quick brown fox jumps”.");
    const fromSource = await t.call("show", { file: "chapters/one.typ", line: 2 });
    expect(fromSource.text).toBe("Highlighted h2 on page 1: “A sentence that lives in the first chapter.”.");
    let state = await t.state();
    expect(state.view).toEqual({ kind: "highlight", id: "h2" });
    expect(state.highlights[1]).toMatchObject({ source: { file: "chapters/one.typ", line: 2, endLine: 2 }, pageIndex: 0, stale: false });
    expect(state.highlights[0]!.rects.length).toBe(1);
    const before = state.highlights[0]!.rects[0]!;

    // 前面插入一行：高亮跟着文字走。
    await t.write("main.typ", `Inserted line.\n${PAPER["main.typ"]}`);
    await t.call("check");
    await expect.poll(async () => (await t.state()).highlights[0]!.seq).toBe(2);
    state = await t.state();
    expect(state.highlights[0]!.stale).toBe(false);
    expect(state.highlights[0]!.rects[0]![1]).toBeLessThan(before[1]);

    // 文字删掉后标记为 stale。
    await t.write("main.typ", PAPER["main.typ"].replace("The quick brown fox jumps over the lazy dog.", "Something else entirely."));
    await t.call("check");
    await expect.poll(async () => (await t.state()).highlights[0]!.stale).toBe(true);

    expect((await t.call("show", { page: 1 })).text).toBe("Showing page 1.");
    expect((await t.state()).view).toEqual({ kind: "page", pageIndex: 0 });
    expect((await t.call("show", { page: 3 })).text).toMatch(/^\[invalid_input\] The document has 1 page/);
    expect((await t.call("show", { quote: "nothing like this appears anywhere" })).text).toMatch(/^\[quote_not_found\]/);
    expect((await t.call("show", { page: 1, quote: "fox" })).text).toMatch(/^\[invalid_input\] Give exactly one/);
    expect((await t.call("show", { file: "main.typ" })).text).toMatch(/^\[invalid_input\] file and line go together/);
    expect((await t.call("show", { file: "../outside.typ", line: 1 })).text).toMatch(/^\[path_outside_workspace\]/);
    expect((await t.call("clear_highlights", { ids: ["h1"] })).text).toBe("Removed 1 highlight.");
    expect((await t.call("clear_highlights")).text).toBe("Removed 1 highlight.");
  });

  it("locate_source maps rendered text to files and lines", async () => {
    const t = await setup(PAPER);
    await t.call("check");
    const result = await t.call("locate_source", { text: "A sentence that lives in the first chapter." });
    expect(result.structuredContent.matches[0]).toEqual({
      file: "chapters/one.typ",
      line: 2,
      column: 1,
      endLine: 2,
      excerpt: "A sentence that lives in the first chapter.",
      score: 1,
    });
    expect((await t.call("locate_source", { text: "zebra crossing elephants" })).structuredContent.matches).toEqual([]);
  });

  it("render_pages returns images and refuses broken documents", async () => {
    const t = await setup({ "main.typ": "#pages(1)\nOne\nTwo\nThree\nFour\nFive\nSix\n" });
    const rendered = await t.call("render_pages", { pages: "1,3", ppi: 72 });
    expect(rendered.text).toBe("Rendered page 1, page 3 of 6.");
    expect(rendered.content.slice(1).map((part) => part.type)).toEqual(["image", "image"]);
    // 超出末页的部分忽略；全部超出时报错。
    expect((await t.call("render_pages", { pages: "5-9" })).text).toBe("Rendered page 5, page 6 of 6.");
    expect((await t.call("render_pages", { pages: "8" })).text).toMatch(/^\[invalid_input\] The document has 6 page/);
    expect((await t.call("render_pages", { pages: "1-5" })).text).toMatch(/^\[invalid_input\] Render at most 4 pages/);
    expect((await t.call("render_pages", { pages: "x" })).text).toMatch(/^\[invalid_input\] Invalid page range/);
    await t.write("main.typ", '#error("broken")\n');
    expect((await t.call("render_pages", { pages: "1" })).text).toMatch(/^\[compile_failed\] The document does not compile[\s\S]*error: broken/);
  });

  it("export_pdf writes inside the workspace only", async () => {
    const t = await setup(PAPER);
    const exported = await t.call("export_pdf", { path: "out/paper.pdf" });
    expect(exported.text).toMatch(/^Wrote out\/paper\.pdf \(1 page, \d+ KB\)\.$/);
    expect((await readFile(join(t.workspace, "out/paper.pdf"))).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await t.call("export_pdf", { path: "../escape.pdf" })).text).toMatch(/^\[path_outside_workspace\]/);
    expect((await t.call("export_pdf", { path: "/etc/x.pdf" })).text).toMatch(/^\[path_outside_workspace\]/);
    expect((await t.call("export_pdf", { path: "out/paper.png" })).text).toMatch(/^\[invalid_input\]/);
    await t.write("main.typ", '#error("broken")\n');
    expect((await t.call("export_pdf", { path: "out/broken.pdf" })).text).toMatch(/^\[compile_failed\] Nothing was written to out\/broken\.pdf/);
  });

  it("asks for a main file when there are several, and remembers the choice", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typst-data-"));
    const files = { "a.typ": "Alpha document.\n", "b.typ": "Beta document.\n" };
    const t = await setup(files, { dataDir });
    const check = await t.call("check");
    expect(check.text).toBe("[no_main] Choose the main file with set_main. .typ files in the workspace: a.typ, b.typ.");
    expect((await t.state()).candidates).toEqual(["a.typ", "b.typ"]);
    expect((await t.call("set_main", { path: "notes.md" })).text).toMatch(/^\[invalid_input\]/);
    expect((await t.call("set_main", { path: "c.typ" })).text).toMatch(/^\[not_found\]/);
    const chosen = await t.call("set_main", { path: "b.typ" });
    expect(chosen.text).toMatch(/^Main file set to b\.typ\. b\.typ compiled successfully/);
    const other = await setup(files, { dataDir });
    // 不同的工作区目录不共享选择。
    expect((await other.call("check")).text).toMatch(/^\[no_main\]/);
    const again = new TypstSession({ workspaceRoot: t.workspace, dataDir, typstPath: FAKE, pdfjsDataDir: null });
    await again.activate();
    expect(again.state().main).toBe("b.typ");
    await again.close();
  });

  it("picks up a main file created after the panel opened", async () => {
    const t = await setup({});
    expect((await t.call("check")).text).toMatch(/There are no \.typ files in the workspace yet/);
    await t.write("main.typ", "Fresh document.\n");
    expect((await t.call("check")).text).toMatch(/main\.typ compiled successfully/);
  });

  it("explains a missing Typst", async () => {
    const t = await setup(PAPER, { locate: async () => ({ state: "missing" }) });
    const result = await t.call("check");
    expect(result.text).toMatch(/^\[typst_missing\] Typst was not found on this computer\. Install Typst \(for example `brew install typst`/);
    expect((await t.call("status")).text).toMatch(/^Typst was not found/);
    expect((await t.state()).toolchain).toEqual({ state: "missing" });
  });

  it("describes the computer for the setup page and records the hand-off to the agent", async () => {
    const t = await setup(PAPER, { locate: async () => ({ state: "missing" }) });
    await t.session.activate();
    await expect.poll(async () => (await t.state()).setup.facts).toEqual(FACTS);
    const state = await t.state();
    expect(state.setup.searched.length).toBeGreaterThan(1);
    expect(state.setup.handoffAt).toBeNull();
    const read = async (uri: string): Promise<SessionState> => JSON.parse(((await t.client.readResource({ uri })).contents[0] as { text: string }).text);
    expect((await read(URIS.setup("handoff", "a1"))).setup.handoffAt).toEqual(expect.any(Number));
    expect((await t.state()).setup.handoffAt).toEqual(expect.any(Number));
    await expect(read(URIS.setup("nope" as "check", "a2"))).rejects.toThrow();
  });

  it("picks up Typst installed while the panel is open and starts the preview", async () => {
    let toolchain: Toolchain = { state: "missing" };
    const t = await setup(PAPER, { locate: async () => toolchain });
    await t.client.subscribeResource({ uri: STATE_URI });
    await expect.poll(async () => (await t.state()).toolchain.state).toBe("missing");
    await t.client.readResource({ uri: URIS.setup("handoff", "b1") });
    toolchain = { state: "ready", path: FAKE, source: "setting", version: "0.14.2" };
    // 面板打开期间的定时查找发现了 Typst：预览自动开始，“已交给 Agent”清除。
    await expect.poll(async () => (await t.state()).toolchain.state, { timeout: 8_000 }).toBe("ready");
    expect((await t.state()).setup.handoffAt).toBeNull();
    await expect.poll(async () => (await t.state()).snapshot?.pages ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
    await t.client.unsubscribeResource({ uri: STATE_URI });
  });

  it("checks again right away from the setup page", async () => {
    let toolchain: Toolchain = { state: "missing" };
    const t = await setup(PAPER, { locate: async () => toolchain });
    await t.session.activate();
    toolchain = { state: "ready", path: FAKE, source: "setting", version: "0.14.2" };
    const state = JSON.parse(((await t.client.readResource({ uri: URIS.setup("check", "c1") })).contents[0] as { text: string }).text) as SessionState;
    expect(state.toolchain.state).toBe("ready");
    expect(state.main).toBe("main.typ");
  });

  it("stops typst watch processes left by a server that was killed", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typst-data-"));
    // 一个已经退出的“server”进程号，以及它留下的 watch（命令行含构建目录）。
    const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
    const buildDir = join(dataDir, "build", `${dead}-0badc0de`);
    await mkdir(buildDir, { recursive: true });
    await writeFile(join(buildDir, "main.typ"), "Orphan.\n");
    const orphan = spawn(FAKE, ["watch", join(buildDir, "main.typ"), join(buildDir, "preview.pdf")], { stdio: "ignore" });
    await writeFile(join(buildDir, "watch.pid"), String(orphan.pid));
    const exited = new Promise((done) => orphan.once("exit", done));
    const t = await setup(PAPER, { dataDir });
    await t.call("check");
    await exited;
    expect(existsSync(buildDir)).toBe(false);
  });

  it("reports a crashed typst watch", async () => {
    const t = await setup(PAPER, { env: { FAKE_TYPST_CRASH: "1" } });
    await t.session.activate();
    await expect.poll(async () => (await t.state()).status.phase, { timeout: 5_000 }).toBe("crashed");
    expect((await t.state()).status.error).toContain("the fake compiler crashed");
    expect((await t.call("status")).text).toContain("typst watch stopped:");
  });
});
