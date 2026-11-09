import { afterEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { createJupyterMcpServer } from "#nb/adapters/server.ts";
import { createNotebookOwner } from "#nb/app/notebooks.ts";
import { STATE_URI, setupUri, type JupyterEnvironment, type SessionState } from "#nb/contract.ts";
import { createServerRegistry } from "#nb/servers/registry.ts";

const MISSING: JupyterEnvironment = {
  state: "missing",
  python: { executable: ".venv/bin/python", source: "workspace .venv", version: "3.12.4", venv: ".venv", uv: true },
  packages: [
    { name: "jupyter-server", version: null },
    { name: "ipykernel", version: null },
  ],
  checked: [".venv/bin/python", "python3"],
  installCommand: "uv add --dev jupyter-server ipykernel",
  uv: { path: "~/.local/bin/uv", version: "0.8.3" },
  checkedAt: 1,
};

const open: Client[] = [];
afterEach(async () => {
  for (const client of open.splice(0)) await client.close();
});

async function setup(check: () => JupyterEnvironment) {
  let checks = 0;
  const registry = createServerRegistry({
    workspaceRoot: tmpdir(),
    pythonPath: null,
    discover: async () => [],
    checkEnvironment: async () => {
      checks += 1;
      return { ...check(), checkedAt: Date.now() };
    },
  });
  const owner = createNotebookOwner({ resolveServer: (server) => registry.resolve(server) });
  const server = createJupyterMcpServer({ owner, registry, assetRoot: tmpdir() });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  const updates: string[] = [];
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => void updates.push(notification.params.uri));
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  open.push(client);
  const read = async (uri: string): Promise<SessionState> => JSON.parse(((await client.readResource({ uri })).contents[0] as { text: string }).text);
  return { client, read, updates, checks: () => checks };
}

describe("setup page", () => {
  it("checks the environment before the first read, so the panel never shows Start first", async () => {
    const t = await setup(() => MISSING);
    const state = await t.read(STATE_URI);
    expect(state.environment).toMatchObject({ ...MISSING, checkedAt: expect.any(Number) });
    expect(state.setup.handoffAt).toBeNull();
  });

  it("records the hand-off and clears it when the packages appear", async () => {
    let env = MISSING;
    const t = await setup(() => env);
    await t.read(STATE_URI);
    expect((await t.read(setupUri("handoff", "a"))).setup.handoffAt).toEqual(expect.any(Number));
    env = { ...MISSING, state: "ready", installCommand: null, packages: MISSING.packages.map((pkg) => ({ ...pkg, version: "1.0" })) };
    const state = await t.read(setupUri("check", "b"));
    expect(state.environment.state).toBe("ready");
    expect(state.setup.handoffAt).toBeNull();
    await expect(t.read(setupUri("nope" as "check", "c"))).rejects.toThrow();
  });

  it("keeps checking while the panel is subscribed and notifies when the result changes", async () => {
    let env = MISSING;
    const t = await setup(() => env);
    await t.client.subscribeResource({ uri: STATE_URI });
    await expect.poll(() => t.checks()).toBeGreaterThan(0);
    env = { ...MISSING, state: "ready", installCommand: null };
    await expect.poll(async () => (await t.read(STATE_URI)).environment.state, { timeout: 10_000, interval: 500 }).toBe("ready");
    expect(t.updates).toContain(STATE_URI);
    await t.client.unsubscribeResource({ uri: STATE_URI });
  });
});
