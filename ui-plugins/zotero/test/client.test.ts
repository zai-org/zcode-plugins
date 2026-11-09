import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeZotero } from "#test/fake-zotero.mjs";
import { ZoteroClient } from "#z/zotero/client.ts";

type Fake = Awaited<ReturnType<typeof startFakeZotero>>;
let fake: Fake | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

const freePort = () =>
  new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => done(port));
    });
  });

describe("ZoteroClient status", () => {
  it("reports not_running when nothing listens", async () => {
    const client = new ZoteroClient({ baseUrl: `http://127.0.0.1:${await freePort()}` });
    expect((await client.probe()).state).toBe("not_running");
    await expect(client.ensureReady()).rejects.toMatchObject({ code: "zotero_not_running" });
  });

  it("reports api_disabled when the local API is off", async () => {
    fake = await startFakeZotero({ apiEnabled: false });
    const client = new ZoteroClient({ baseUrl: fake.url });
    expect((await client.probe()).state).toBe("api_disabled");
    await expect(client.ensureReady()).rejects.toMatchObject({ code: "local_api_disabled" });
  });

  it("detects write support without side effects", async () => {
    fake = await startFakeZotero();
    const client = new ZoteroClient({ baseUrl: fake.url });
    const status = await client.probe();
    expect(status).toMatchObject({ state: "ready", writes: "available", serverId: "FAKESERVER01", version: "11.0-test" });
    expect(fake.state.authorizeRequests).toBe(0);
  });

  it("treats Zotero 7 (read-only local API) as unsupported for writes", async () => {
    fake = await startFakeZotero({ writes: false, version: "7.0.11" });
    const client = new ZoteroClient({ baseUrl: fake.url });
    expect((await client.probe()).writes).toBe("unsupported");
    await expect(client.write("POST", "/api/users/0/items", { body: "[]" })).rejects.toMatchObject({ code: "writes_unsupported" });
    expect(fake.state.authorizeRequests).toBe(0);
  });
});

describe("ZoteroClient writes", () => {
  const post = (client: ZoteroClient) =>
    client.write("POST", "/api/users/0/items", {
      body: JSON.stringify([{ itemType: "book", title: "New", creators: [] }]),
      contentType: "application/json",
    });

  it("asks once with Always Allow, stores the key with private permissions and reuses it", async () => {
    fake = await startFakeZotero({ authorize: "always" });
    const keyFile = join(await mkdtemp(join(tmpdir(), "zkeys-")), "nested", "keys.json");
    const client = new ZoteroClient({ baseUrl: fake.url, keyFile });
    expect((await post(client)).status).toBe(200);
    expect((await post(client)).status).toBe(200);
    expect(fake.state.authorizeRequests).toBe(1);
    expect(client.status.auth).toBe("remembered");
    const stored = JSON.parse(await readFile(keyFile, "utf8"));
    expect(Object.keys(stored)).toEqual(["FAKESERVER01"]);
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    // 新进程（新 client）读取保存的 key，不再询问。
    const again = new ZoteroClient({ baseUrl: fake.url, keyFile });
    await again.probe();
    expect(again.status.auth).toBe("remembered");
    expect((await post(again)).status).toBe(200);
    expect(fake.state.authorizeRequests).toBe(1);
  });

  it("asks again for every write with a one-time Allow", async () => {
    fake = await startFakeZotero({ authorize: "once" });
    const client = new ZoteroClient({ baseUrl: fake.url });
    expect((await post(client)).status).toBe(200);
    expect((await post(client)).status).toBe(200);
    expect(fake.state.authorizeRequests).toBe(2);
    expect(client.status.auth).toBe("none");
  });

  it("re-authorizes once when a remembered key was revoked", async () => {
    fake = await startFakeZotero({ authorize: "always" });
    const client = new ZoteroClient({ baseUrl: fake.url });
    await post(client);
    fake.state.keys.clear(); // 用户在 Zotero 里撤销了 key。
    expect((await post(client)).status).toBe(200);
    expect(fake.state.authorizeRequests).toBe(2);
  });

  it("surfaces a denial without retrying", async () => {
    fake = await startFakeZotero({ authorize: "deny" });
    const client = new ZoteroClient({ baseUrl: fake.url });
    await expect(post(client)).rejects.toMatchObject({ code: "write_denied" });
    expect(client.status.auth).toBe("denied");
    expect(fake.state.authorizeRequests).toBe(1);
  });

  it("gives up when nobody answers the dialog", async () => {
    fake = await startFakeZotero({ authorize: "hang" });
    const client = new ZoteroClient({ baseUrl: fake.url, authorizeTimeoutMs: 300 });
    const pending = post(client);
    await new Promise((done) => setTimeout(done, 50));
    // 等待期间状态显示“正在等待批准”（面板据此显示提示）。
    expect(client.isAuthorizing).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: "write_denied" });
    expect(client.isAuthorizing).toBe(false);
  });

  it("shares one dialog between concurrent writes", async () => {
    fake = await startFakeZotero({ authorize: "always" });
    const client = new ZoteroClient({ baseUrl: fake.url });
    await Promise.all([post(client), post(client), post(client)]);
    expect(fake.state.authorizeRequests).toBe(1);
  });

  it("only uploads to Zotero's own upload URLs", async () => {
    fake = await startFakeZotero();
    const client = new ZoteroClient({ baseUrl: fake.url });
    await expect(client.upload("http://evil.test/api/local/uploads/abc", new Uint8Array(1), "application/pdf")).rejects.toThrow(/Unexpected upload URL/);
    await expect(client.upload(`${fake.url}/api/users/0/items`, new Uint8Array(1), "application/pdf")).rejects.toThrow(/Unexpected upload URL/);
  });
});
