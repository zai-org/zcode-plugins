// Static guards for platform-sensitive call sites. Behavior tests can only
// exercise the platform they run on: a new `spawn("bash")` or a hardcoded
// frozen path stays green on Linux and fails only on a contributor's Windows
// box. These scans make the bypass visible everywhere, including CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) {
      sourceFiles(file, out);
    } else if (name.endsWith(".ts")) {
      out.push(file);
    }
  }
  return out;
}

// Executable lines with comments removed; line numbers stay true to the file.
function codeLines(file: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let inBlock = false;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((raw, i) => {
      const trimmed = raw.trim();
      if (inBlock) {
        if (trimmed.includes("*/")) inBlock = false;
        return;
      }
      if (trimmed.startsWith("/*")) {
        inBlock = !trimmed.includes("*/");
        return;
      }
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      out.push({ line: i + 1, text: raw });
    });
  return out;
}

function scan(pattern: RegExp, skip: string[] = []): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (skip.includes(rel)) continue;
    for (const { line, text } of codeLines(file)) {
      if (pattern.test(text)) found.push(`${rel}:${line}: ${text.trim()}`);
    }
  }
  return found;
}

const LITERAL_BASH =
  /(?:spawn|spawnSync|execFile|execFileSync)\(\s*["'`]bash(?:\.exe)?["'`]/;

test("bash is spawned only through resolveBash()", () => {
  // lib/bash.ts is the one place that resolves the platform binary.
  const hits = scan(LITERAL_BASH, ["mcp/lib/bash.ts"]);
  assert.deepEqual(
    hits,
    [],
    `literal bash spawn bypasses resolveBash():\n${hits.join("\n")}`,
  );
});

test("git is spawned only through resolveGit()", () => {
  // lib/git.ts is the one place that resolves the binary: a GUI-launched
  // server can have a PATH that hides git entirely (macOS 2026-10-29 check),
  // so every spawn must go through the fallback-resolving helper. Tests are
  // exempt — they run from a developer shell with git on PATH.
  const hits = scan(/(?:execFile|execFileSync|spawn)\(\s*["'`]git["'`]/).filter(
    (hit) => !hit.startsWith("tests/"),
  );
  assert.deepEqual(
    hits,
    [],
    `literal git spawn bypasses resolveGit():\n${hits.join("\n")}`,
  );
});

test("the MCP server is spawned via process.execPath, never a bare `node`", () => {
  const hits = scan(/spawn\(\s*["'`]node["'`]/);
  assert.deepEqual(
    hits,
    [],
    `bare node spawn is PATH-dependent:\n${hits.join("\n")}`,
  );
});

test("every .sh in the plugin tree is LF-only (no CR bytes)", () => {
  // CRLF .sh dies on real POSIX bash (`set: pipefail\r: invalid option
  // name`) while Git Bash tolerates it, so behavior tests stay green on
  // Windows and the breakage only surfaces on WSL2/Linux/macOS. Worktree
  // residue from before .gitattributes landed did exactly that: 13 WSL2
  // test failures (2026-10-29). This guard keeps the bytes machine-checked.
  const shFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) {
        walk(file);
      } else if (name.endsWith(".sh")) {
        shFiles.push(file);
      }
    }
  };
  walk(ROOT);
  assert.ok(shFiles.length > 0, "expected .sh fixtures to exist");
  const offenders = shFiles
    .filter((file) => readFileSync(file, "utf8").includes("\r"))
    .map((file) => relative(ROOT, file).replaceAll("\\", "/"));
  assert.deepEqual(
    offenders,
    [],
    `CRLF .sh files (fatal under POSIX bash, tolerated by Git Bash):\n${offenders.join("\n")}`,
  );
});

test("every test that git-inits a temp repo pins core.autocrlf=false", () => {
  // The root .gitattributes only governs THIS repo's worktree. Temp fixture
  // repos are git-init'ed at runtime outside it, so they inherit the runner's
  // global core.autocrlf=true on Windows: rollback's `git checkout` then
  // rewrites LF fixtures to CRLF (CI 2026-11-02: rolled_back asserted
  // 'v1\r\n' !== 'v1\n' only on windows-latest). git.test.ts patched itself
  // locally; this guard keeps the other files from repeating the miss.
  const offenders: string[] = [];
  for (const name of readdirSync(join(ROOT, "tests"))) {
    if (!name.endsWith(".test.ts")) continue;
    const src = readFileSync(join(ROOT, "tests", name), "utf8");
    if (/"init",\s*"-q"/.test(src) && !src.includes('"core.autocrlf"')) {
      offenders.push(name);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `test files with a git-init temp repo but no core.autocrlf=false:\n${offenders.join("\n")}`,
  );
});

test("the frozen write guard reads its file set from lib/frozen.ts", () => {
  const guard = codeLines(join(ROOT, "hooks", "guard-frozen.ts"))
    .map((entry) => entry.text)
    .join("\n");
  assert.match(
    guard,
    /frozenKey\(/,
    "guard must normalize paths via frozenKey()",
  );
  assert.match(guard, /FROZEN_FILES/, "guard must use the shared frozen set");
  assert.doesNotMatch(
    guard,
    /["'`]\.auto\//,
    "guard must not hardcode .auto paths; frozen.ts is the single source",
  );
});
