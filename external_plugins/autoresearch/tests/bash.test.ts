// Shell quoting for values interpolated into `bash -c` command strings.
// Round-trips through a real bash so the assertion is shell semantics, not a
// string comparison against our own escaping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  resolveBash,
  pickUsableBash,
  quoteShellArg,
  unixToolsPathEntry,
  spawnEnv,
} from "../mcp/lib/bash.ts";

function expand(value: string): string {
  return execFileSync(
    resolveBash(),
    ["-c", `printf '%s' ${quoteShellArg(value)}`],
    { encoding: "utf8" },
  );
}

test("quoteShellArg round-trips paths literally through bash -c", () => {
  // Relative fixtures only: the quoting semantics do not depend on the path
  // prefix, and the repo keeps absolute-path literals (even /tmp) out of its tree.
  for (const value of [
    "scratch/plain/.auto/checks.sh",
    "project/.auto/checks.sh",
    "scratch/with space/.auto/checks.sh",
    "scratch/Alex's project/.auto/checks.sh",
    "scratch/$HOME/`id`/.auto/checks.sh",
    'scratch/double"quote/.auto/checks.sh',
    "scratch/x'; echo pwned; '/.auto/checks.sh",
  ]) {
    assert.equal(expand(value), value);
  }
});

test("unixToolsPathEntry only trusts the usr/bin bash layout", (t) => {
  if (process.platform !== "win32") return t.skip("win32-only behavior");
  assert.equal(
    unixToolsPathEntry("C:\\Program Files\\Git\\usr\\bin\\bash.exe"),
    "C:\\Program Files\\Git\\usr\\bin",
  );
  // Git's cmd wrapper directory and arbitrary install roots carry no coreutils.
  assert.equal(
    unixToolsPathEntry("C:\\Program Files\\Git\\cmd\\bash.exe"),
    null,
  );
  assert.equal(unixToolsPathEntry("D:\\tools\\bin\\bash.exe"), null);
});

test("spawnEnv restores coreutils a slim GUI PATH takes away", (t) => {
  if (process.platform !== "win32") return t.skip("win32-only behavior");
  const bashPath = resolveBash();
  const entry = unixToolsPathEntry(bashPath);
  assert.ok(entry, `resolved bash ${bashPath} should live under usr\\bin`);
  // Stand-in for a GUI-launched server env: System32 present, Git coreutils not.
  // Build the slim PATH under the env block's real key casing — a literal
  // `PATH:` on a `Path`-keyed env would coexist as a second, distinct key.
  const pathKey =
    Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const slim = { ...process.env, [pathKey]: "C:\\Windows\\System32" };
  const without = execFileSync(bashPath, ["-c", "command -v head || true"], {
    encoding: "utf8",
    env: slim,
  }).trim();
  assert.equal(without, "", "premise: slim PATH cannot resolve head");
  const patched = spawnEnv(bashPath, slim);
  const patchedPath = patched[pathKey] ?? "";
  assert.ok(patchedPath.startsWith(`${entry};`));
  assert.ok(patchedPath.includes("C:\\Windows\\System32"));
  const found = execFileSync(bashPath, ["-c", "command -v head"], {
    encoding: "utf8",
    env: patched,
  }).trim();
  assert.match(found, /head(\.exe)?$/i);
});

test("pickUsableBash rejects WSL launchers and prefers usr\\bin", () => {
  // Regression for the 2026-10-29 nano-jev resume: a GUI-launched server's
  // PATH carried only Git\cmd (git's shim, no bash) plus the WSL launchers,
  // so every run_experiment died with "no usable bash.exe on PATH". The stub
  // filter and the usr\bin preference are the whole decision — keep them a
  // pure function so this holds on every platform without touching env.
  assert.equal(pickUsableBash([]), null);
  assert.equal(
    pickUsableBash([
      "C:\\Windows\\System32\\bash.exe",
      "C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe",
    ]),
    null,
  );
  assert.equal(
    pickUsableBash([
      "C:\\Windows\\System32\\bash.exe",
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    ]),
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  );
  assert.equal(
    pickUsableBash(["C:\\Windows\\System32\\bash.exe", "C:\\tools\\bash.exe"]),
    "C:\\tools\\bash.exe",
  );
});

test("resolveBash falls back to an injected candidate when PATH hides bash", () => {
  // Injected candidates bypass the where.exe probe and the cache (the
  // resolveGit test-shim pattern), so the fallback decision is testable
  // without constructing a slim-PATH environment.
  const standIn =
    process.platform === "win32"
      ? String.raw`C:\Windows\System32\where.exe`
      : "/bin/sh";
  assert.equal(resolveBash([standIn]), standIn);
});

test("resolveBash throws loudly when nothing resolves", () => {
  assert.throws(
    () => resolveBash(["/nonexistent/ar/a", "/nonexistent/ar/b"]),
    /no usable bash\.exe/,
  );
});
