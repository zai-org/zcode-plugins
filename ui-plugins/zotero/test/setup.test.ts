import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startFakeZotero } from "#test/fake-zotero.mjs";
import { createZoteroMcpServer } from "#z/adapters/server.ts";
import { ZoteroSession } from "#z/app/session.ts";
import { STATE_URI, URIS, type HostFacts, type SessionState, type ZoteroInstall } from "#z/contract.ts";
import { findZotero } from "#z/zotero/install.ts";

const FACTS: HostFacts = { os: "macos", osName: "macOS 15.4", arch: "Apple silicon", tools: [{ name: "Homebrew", version: "4.5.2", path: "/opt/homebrew/bin/brew" }] };

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => done(port));
    });
  });

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function setup(app: () => ZoteroInstall) {
  const port = await freePort();
  const launched: string[] = [];
  const session = new ZoteroSession({
    baseUrl: `http://127.0.0.1:${port}`,
    workspaceRoot: await mkdtemp(join(tmpdir(), "zotero-setup-")),
    pdfjsDataDir: null,
    facts: async () => FACTS,
    findApp: async () => app(),
    launchApp: async () => {
      launched.push("Zotero");
      return "/Applications/Zotero.app";
    },
  });
  const server = createZoteroMcpServer({ session, assetRoot: tmpdir(), pdfjsDataDir: null });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  cleanup.push(async () => {
    session.close();
    await client.close();
  });
  const read = async (uri: string): Promise<SessionState> => JSON.parse(((await client.readResource({ uri })).contents[0] as { text: string }).text);
  const call = async (name: string) => (await client.callTool({ name, arguments: {} })) as { isError?: boolean; content: { text: string }[]; structuredContent?: any };
  return { port, session, client, read, call, launched };
}

describe("setup page", () => {
  it("tells a missing Zotero from a closed one, and the agent learns which", async () => {
    let app: ZoteroInstall = { state: "missing", searched: ["/Applications", "~/Applications"] };
    const t = await setup(() => app);
    const state = await t.read(STATE_URI);
    expect(state.status.state).toBe("not_running");
    await expect.poll(async () => (await t.read(STATE_URI)).setup).toMatchObject({ app, facts: FACTS, handoffAt: null, address: `127.0.0.1:${t.port}` });
    const missing = await t.call("search_library");
    expect(missing.structuredContent.error.code).toBe("zotero_not_installed");
    expect(missing.content[0]!.text).toMatch(/not installed on this computer \(looked in \/Applications, ~\/Applications\)/);

    app = { state: "found", path: "/Applications/Zotero.app", version: "7.0.15", searched: [] };
    expect((await t.read(URIS.setup("check", "a"))).setup.app).toEqual(app);
    expect((await t.call("search_library")).structuredContent.error.code).toBe("zotero_not_running");
    expect((await t.call("panel_launch_zotero")).isError).toBeFalsy();
    expect(t.launched).toEqual(["Zotero"]);
  });

  it("records the hand-off to the agent and clears it once Zotero answers", async () => {
    const t = await setup(() => ({ state: "missing", searched: ["/Applications"] }));
    await t.read(STATE_URI);
    expect((await t.read(URIS.setup("handoff", "b"))).setup.handoffAt).toEqual(expect.any(Number));
    await expect(t.read(URIS.setup("nope" as "check", "c"))).rejects.toThrow();
    // Agent 装好并打开了 Zotero：本地 API 在同一端口上应答。
    const fake = await startFakeZotero({ port: t.port });
    cleanup.push(() => fake.close());
    const state = await t.read(URIS.setup("check", "d"));
    expect(state.status.state).toBe("ready");
    expect(state.setup.handoffAt).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")("finding the Zotero app", () => {
  it("reads the version next to the program and lists where it looked", async () => {
    const home = await mkdtemp(join(tmpdir(), "zotero-home-"));
    expect(await findZotero({ platform: "linux", home, env: { PATH: "" } })).toMatchObject({ state: "missing", searched: expect.arrayContaining(["PATH"]) });
    const dir = join(home, "Zotero_linux-x86_64");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "zotero"), "#!/bin/sh\n");
    await chmod(join(dir, "zotero"), 0o755);
    await writeFile(join(dir, "application.ini"), "[App]\nName=Zotero\nVersion=7.0.15\n");
    expect(await findZotero({ platform: "linux", home, env: { PATH: "" } })).toMatchObject({ state: "found", path: "~/Zotero_linux-x86_64/zotero", version: "7.0.15" });
  });

  it("reads the version of a Windows install", async () => {
    const root = await mkdtemp(join(tmpdir(), "zotero-win-"));
    await mkdir(join(root, "Zotero"), { recursive: true });
    await writeFile(join(root, "Zotero", "zotero.exe"), "");
    await writeFile(join(root, "Zotero", "application.ini"), "Version=6.0.30\n");
    expect(await findZotero({ platform: "win32", home: join(root, "home"), env: { ProgramFiles: root } })).toMatchObject({ state: "found", version: "6.0.30" });
  });
});
