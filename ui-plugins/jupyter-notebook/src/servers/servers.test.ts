import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "#nb/jupyter/rest.ts";
import { discoverServers, parseRuntimeFile, runtimeDirs } from "#nb/servers/discover.ts";
import { findJupyterPython, pythonCandidates } from "#nb/servers/launch.ts";
import { createServerRegistry, serverIdFor, toServerPath } from "#nb/servers/registry.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jnb-unit-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("normalizeBaseUrl", () => {
  it("extracts the token and strips UI paths", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:8888/lab/tree/a.ipynb?token=abc")).toEqual({
      baseUrl: "http://127.0.0.1:8888/",
      token: "abc",
    });
    expect(normalizeBaseUrl("https://hub.example.org/user/me/tree")).toEqual({
      baseUrl: "https://hub.example.org/user/me/",
      token: null,
    });
    expect(normalizeBaseUrl("http://localhost:9999")).toEqual({ baseUrl: "http://localhost:9999/", token: null });
    expect(() => normalizeBaseUrl("ftp://x")).toThrow(/http or https/);
    expect(() => normalizeBaseUrl("not a url")).toThrow(/valid URL/);
  });
  it("derives readable server ids", () => {
    expect(serverIdFor("http://127.0.0.1:8888/")).toBe("127.0.0.1:8888");
    expect(serverIdFor("https://hub.example.org/user/me/")).toBe("hub.example.org/user/me");
  });
});

describe("runtime discovery", () => {
  it("follows Jupyter's runtime dir rules", () => {
    expect(runtimeDirs({ JUPYTER_RUNTIME_DIR: "/r" })).toEqual(["/r"]);
    expect(runtimeDirs({ JUPYTER_DATA_DIR: "/d" })).toEqual(["/d/runtime"]);
    expect(runtimeDirs({ HOME: "/h" }, "darwin")).toEqual(["/h/Library/Jupyter/runtime"]);
    expect(runtimeDirs({ HOME: "/h" }, "linux")).toEqual(["/h/.local/share/jupyter/runtime"]);
    expect(runtimeDirs({ HOME: "/h", XDG_DATA_HOME: "/x" }, "linux")).toEqual(["/x/jupyter/runtime"]);
  });

  it("parses server and classic notebook runtime files", () => {
    expect(
      parseRuntimeFile(
        JSON.stringify({ url: "http://127.0.0.1:8888/", token: "t", root_dir: "/w", pid: 5, version: "2.1" }),
        "f",
      ),
    ).toEqual({ baseUrl: "http://127.0.0.1:8888/", token: "t", rootDir: "/w", pid: 5, version: "2.1", file: "f" });
    expect(parseRuntimeFile(JSON.stringify({ url: "http://h:1/", pid: 1, notebook_dir: "/n", token: "" }), "f")).toMatchObject({
      rootDir: "/n",
      token: null,
    });
    expect(parseRuntimeFile("{", "f")).toBeNull();
    expect(parseRuntimeFile(JSON.stringify({ url: 1 }), "f")).toBeNull();
  });

  it("skips dead servers, other files and duplicates", async () => {
    const write = (name: string, body: unknown) => writeFile(join(dir, name), JSON.stringify(body));
    await write("jpserver-1.json", { url: "http://127.0.0.1:1/", pid: 1, token: "a" });
    await write("jpserver-2.json", { url: "http://127.0.0.1:2/", pid: 2, token: "b" });
    await write("jpserver-3.json", { url: "http://127.0.0.1:1/", pid: 3, token: "c" });
    await write("kernel-1.json", { url: "http://x/", pid: 1 });
    await writeFile(join(dir, "jpserver-1-open.html"), "");
    const found = await discoverServers([dir, join(dir, "missing")], (pid) => pid !== 2);
    expect(found.map((server) => [server.baseUrl, server.pid])).toEqual([["http://127.0.0.1:1/", 1]]);
  });
});

describe("paths", () => {
  it("maps workspace paths to server paths", async () => {
    await mkdir(join(dir, "sub"));
    expect(toServerPath("./sub//a.ipynb", null)).toBe("sub/a.ipynb");
    expect(toServerPath(join(dir, "sub/new/b.ipynb"), dir)).toBe("sub/new/b.ipynb");
    expect(() => toServerPath("../a.ipynb", dir)).toThrow(/\.\./);
    expect(() => toServerPath("/elsewhere/a.ipynb", dir)).toThrow(/outside/);
    expect(() => toServerPath("/a.ipynb", null)).toThrow(/root directory is unknown/);
    expect(() => toServerPath("  ", dir)).toThrow(/empty/);
  });
});

describe("python discovery", () => {
  it("orders candidates: setting, workspace venvs, active env, PATH", async () => {
    await mkdir(join(dir, ".venv/bin"), { recursive: true });
    await writeFile(join(dir, ".venv/bin/python"), "");
    const list = pythonCandidates(dir, "/opt/py", { VIRTUAL_ENV: "/v", CONDA_PREFIX: "/c" }, "darwin");
    expect(list.map((item) => item.command)).toEqual([
      "/opt/py",
      join(dir, ".venv/bin/python"),
      "/v/bin/python",
      "/c/bin/python",
      "python3",
      "python",
    ]);
  });

  it("picks the first interpreter with both packages and explains failures", async () => {
    const probes: Record<string, { jupyterServer: string | null; ipykernel: string | null } | null> = {
      a: null,
      b: { jupyterServer: null, ipykernel: "6" },
      c: { jupyterServer: "2", ipykernel: "6" },
    };
    const probe = async (command: string) =>
      probes[command] ? { executable: `/bin/${command}`, version: "3.12", ...probes[command]! } : null;
    const found = await findJupyterPython(
      ["a", "b", "c"].map((command) => ({ command, source: "test" })),
      probe,
    );
    expect(found.command).toBe("c");
    const error = await findJupyterPython([{ command: "a", source: "PATH" }, { command: "b", source: "venv" }], probe).catch(
      (caught) => caught,
    );
    expect(error.code).toBe("jupyter_not_installed");
    expect(error.message).toContain("/bin/b (venv, Python 3.12): missing jupyter-server");
    expect(error.message).toContain("useUv");
    expect(error.details.pythons).toEqual([
      { executable: "a", source: "PATH", version: null, missing: [] },
      { executable: "b", source: "venv", version: "3.12", missing: ["jupyter-server"] },
    ]);
    expect(error.details.installCommand).toBe("b -m pip install jupyter-server ipykernel");
  });
});

describe("registry", () => {
  it("requires a server before resolving and reports it clearly", () => {
    const registry = createServerRegistry({ workspaceRoot: dir, pythonPath: null, discover: async () => [] });
    expect(() => registry.resolve()).toThrow(expect.objectContaining({ code: "no_server" }));
    expect(() => registry.resolve("nope")).toThrow(expect.objectContaining({ code: "server_not_found" }));
  });

  it("uses the discovered token when attaching without one, and never exposes it", async () => {
    const seen: (string | null)[] = [];
    const registry = createServerRegistry({
      workspaceRoot: dir,
      pythonPath: null,
      discover: async () => [
        { baseUrl: "http://127.0.0.1:9/", token: "secret", rootDir: "/r", pid: 1, version: "2", file: "f" },
      ],
      clientFactory: ((endpoint: { baseUrl: string; token: string | null }) => {
        seen.push(endpoint.token);
        return { status: async () => ({}), version: async () => ({ version: "2.9" }) };
      }) as never,
    });
    const info = await registry.attach({ url: "http://127.0.0.1:9/tree" });
    expect(seen).toEqual(["secret"]);
    expect(info).toMatchObject({ id: "127.0.0.1:9", rootDir: "/r", version: "2.9", kind: "attached" });
    expect(JSON.stringify(registry.list())).not.toContain("secret");
    expect(registry.resolve("http://127.0.0.1:9/").info.id).toBe("127.0.0.1:9");
    await expect(registry.stop(info.id)).rejects.toMatchObject({ code: "not_launched" });
  });
});
