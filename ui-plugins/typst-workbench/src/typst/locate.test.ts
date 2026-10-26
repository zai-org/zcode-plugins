import { describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { chooseMain, scanTypFiles } from "#t/domain/project.ts";
import { atLeast, locateTypst, parseVersion, searchedDirs } from "#t/typst/locate.ts";

async function fakeTypst(dir: string, version: string) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, "typst");
  await writeFile(path, `#!/bin/sh\necho "typst ${version} (test)"\n`);
  await chmod(path, 0o755);
  return path;
}

describe("versions", () => {
  it("parses typst --version output", () => {
    expect(parseVersion("typst 0.14.2 (unknown hash)")).toEqual([0, 14, 2]);
    expect(parseVersion("typst 0.13.0-rc1 (abc)")).toEqual([0, 13, 0]);
    expect(parseVersion("nothing")).toBeNull();
    expect(atLeast("0.14.0", [0, 14, 0])).toBe(true);
    expect(atLeast("0.13.1", [0, 14, 0])).toBe(false);
    expect(atLeast("1.0.0", [0, 14, 0])).toBe(true);
  });
});

describe("searched locations shown on the setup page", () => {
  it("puts the package manager and cargo first and abbreviates the home folder", () => {
    expect(searchedDirs("darwin", {}, "/Users/me", "arm64").slice(0, 2)).toEqual(["/opt/homebrew/bin", "~/.cargo/bin"]);
    expect(searchedDirs("darwin", {}, "/Users/me", "x64").slice(0, 2)).toEqual(["/usr/local/bin", "~/.cargo/bin"]);
    expect(searchedDirs("linux", {}, "/home/me").slice(0, 2)).toEqual(["~/.cargo/bin", "~/.local/bin"]);
    const dirs = searchedDirs("darwin", {}, "/Users/me", "arm64");
    expect(new Set(dirs).size).toBe(dirs.length);
  });
});

describe.skipIf(process.platform === "win32")("locateTypst", () => {
  const base = { shell: false, common: [] as string[], home: "/nonexistent" };

  it("prefers the setting, then PATH, then common locations", async () => {
    const root = await mkdtemp(join(tmpdir(), "typst-locate-"));
    const onPath = await fakeTypst(join(root, "path"), "0.14.2");
    const common = await fakeTypst(join(root, "common"), "0.13.1");
    const setting = await fakeTypst(join(root, "setting"), "0.12.0");
    expect(await locateTypst({ ...base, setting, env: { PATH: join(root, "path") } })).toEqual({ state: "ready", path: setting, source: "setting", version: "0.12.0" });
    expect(await locateTypst({ ...base, env: { PATH: [join(root, "missing"), join(root, "path")].join(delimiter) } })).toEqual({
      state: "ready",
      path: onPath,
      source: "path",
      version: "0.14.2",
    });
    expect(await locateTypst({ ...base, common: [join(root, "common")], env: { PATH: "" } })).toMatchObject({ state: "ready", path: common, source: "common" });
  });

  it("reports missing, too old and broken installations", async () => {
    const root = await mkdtemp(join(tmpdir(), "typst-locate-"));
    expect(await locateTypst({ ...base, env: { PATH: join(root, "nothing") } })).toEqual({ state: "missing" });
    const old = await fakeTypst(join(root, "old"), "0.11.1");
    expect(await locateTypst({ ...base, setting: old, env: {} })).toMatchObject({ state: "too_old", version: "0.11.1" });
    expect(await locateTypst({ ...base, setting: join(root, "nope"), env: {} })).toMatchObject({ state: "error", error: expect.stringContaining("not an executable file") });
    const broken = join(root, "broken", "typst");
    await mkdir(join(root, "broken"));
    await writeFile(broken, "#!/bin/sh\necho oops >&2\nexit 1\n");
    await chmod(broken, 0o755);
    expect(await locateTypst({ ...base, setting: broken, env: {} })).toMatchObject({ state: "error", error: expect.stringContaining("oops") });
  });
});

describe("main file", () => {
  it("chooses the main file like a person would", () => {
    expect(chooseMain(["main.typ", "a.typ"])).toBe("main.typ");
    expect(chooseMain(["paper.typ", "sections/a.typ"])).toBe("paper.typ");
    expect(chooseMain(["a.typ", "b.typ"])).toBeNull();
    expect(chooseMain(["a.typ", "b.typ"], "b.typ")).toBe("b.typ");
    expect(chooseMain(["a.typ", "b.typ"], "gone.typ")).toBeNull();
    expect(chooseMain(["thesis/main.typ", "thesis/ch1.typ", "slides/talk.typ", "x/y/main.typ"])).toBe("thesis/main.typ");
    expect(chooseMain(["a/main.typ", "b/main.typ"])).toBeNull();
    expect(chooseMain(["deep/only.typ"])).toBe("deep/only.typ");
    expect(chooseMain([])).toBeNull();
  });

  it("scans .typ files, skipping hidden and dependency folders", async () => {
    const root = await mkdtemp(join(tmpdir(), "typst-scan-"));
    for (const file of ["main.typ", "ch/one.typ", "ch/notes.md", ".git/x.typ", "node_modules/p/lib.typ", "a/b/c/d/too-deep.typ"]) {
      await mkdir(join(root, file, ".."), { recursive: true });
      await writeFile(join(root, file), "");
    }
    expect(await scanTypFiles(root)).toEqual(["main.typ", "ch/one.typ"]);
  });
});
