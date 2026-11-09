import { describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectFacts, findExecutable, tilde } from "#t/host/facts.ts";

describe.skipIf(process.platform === "win32")("host facts", () => {
  it("finds package managers with their versions, PATH first", async () => {
    const dir = await mkdtemp(join(tmpdir(), "facts-"));
    await mkdir(join(dir, "bin"));
    const brew = join(dir, "bin", "brew");
    await writeFile(brew, '#!/bin/sh\necho "Homebrew 4.5.2-12-gabcdef"\n');
    await chmod(brew, 0o755);
    const facts = await detectFacts([{ name: "cargo", bin: "cargo", dirs: [join(dir, "nowhere")] }], { env: { PATH: join(dir, "bin") }, home: dir });
    expect(facts.tools).toContainEqual({ name: "Homebrew", version: "4.5.2", path: "~/bin/brew" });
    expect(facts.tools.some((tool) => tool.name === "cargo")).toBe(false);
    expect(facts.osName).toBeTruthy();
    expect(facts.arch).toBeTruthy();
    expect(await findExecutable("brew", [], { env: { PATH: join(dir, "bin") } })).toBe(brew);
    expect(await findExecutable("definitely-not-here", [], { env: { PATH: join(dir, "bin") } })).toBeNull();
  });

  it("abbreviates the home folder", () => {
    expect(tilde("/Users/me/.cargo/bin", "/Users/me")).toBe("~/.cargo/bin");
    expect(tilde("/Users/meow/bin", "/Users/me")).toBe("/Users/meow/bin");
    expect(tilde("/opt/homebrew/bin", "/Users/me")).toBe("/opt/homebrew/bin");
  });
});
