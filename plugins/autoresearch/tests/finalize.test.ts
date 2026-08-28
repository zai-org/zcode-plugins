// finalize.sh behavior tests (basic grouping, overlap rejection, rollback).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FINALIZE = join(ROOT, "scripts", "finalize.sh");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "ar-fin-"));
  // -b main: groups.json references the base branch by name; CI runners
  // default `git init` to master, so pin it instead of relying on the default
  for (const a of [
    ["init", "-q", "-b", "main"],
    ["config", "user.email", "t@t"],
    ["config", "user.name", "t"],
  ]) {
    execFileSync("git", a, { cwd, stdio: "ignore" });
  }
  writeFileSync(join(cwd, "a.js"), "v1\n");
  writeFileSync(join(cwd, "b.js"), "v1\n");
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-qm", "base"], { cwd, stdio: "ignore" });
  const base = git(cwd, ["rev-parse", "HEAD"]);
  // experiment branch with two kept commits touching a.js and b.js separately
  execFileSync("git", ["checkout", "-qb", "autoresearch/exp"], {
    cwd,
    stdio: "ignore",
  });
  writeFileSync(join(cwd, "a.js"), "v2\n");
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-qm", "experiment: a"], {
    cwd,
    stdio: "ignore",
  });
  const c1 = git(cwd, ["rev-parse", "HEAD"]).trim();
  writeFileSync(join(cwd, "b.js"), "v2\n");
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-qm", "experiment: b"], {
    cwd,
    stdio: "ignore",
  });
  const c2 = git(cwd, ["rev-parse", "HEAD"]).trim();
  return { cwd, base, c1, c2 };
}

function groups(cwd: string, goal: string, arr: unknown): string {
  const f = join(cwd, "groups.json");
  writeFileSync(f, JSON.stringify({ base: "main", goal, groups: arr }));
  return f;
}

test("finalize splits two non-overlapping kept commits into branches", () => {
  const { cwd, c1, c2 } = setup();
  const g = groups(cwd, "opt", [
    { title: "t1", last_commit: c1, slug: "a" },
    { title: "t2", last_commit: c2, slug: "b" },
  ]);
  const out = execFileSync("bash", [FINALIZE, cwd, g], { encoding: "utf8" });
  assert.match(out, /autoresearch\/opt\/01-a/);
  assert.match(out, /autoresearch\/opt\/02-b/);
  // each branch has exactly its own file change
  assert.equal(git(cwd, ["show", "autoresearch/opt/01-a:a.js"]), "v2\n");
  assert.equal(git(cwd, ["show", "autoresearch/opt/02-b:b.js"]), "v2\n");
  // union verification passed, original branch untouched
  assert.equal(
    git(cwd, ["branch", "--show-current"]).trim(),
    "autoresearch/exp",
  );
});

test("finalize rejects overlapping files across groups and rolls back", () => {
  const { cwd, c1, c2 } = setup();
  // both groups claim the same file set (a.js) → overlap
  groups(cwd, "opt", [
    { title: "t1", last_commit: c1, slug: "a" },
    { title: "t2", last_commit: c2, slug: "a-again" }, // c2 touches a.js? no — c2 touches b.js
  ]);
  // force an overlap: point both groups at c2 (b.js) via two commits touching b
  writeFileSync(join(cwd, "b.js"), "v3\n");
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-qm", "experiment: b2"], {
    cwd,
    stdio: "ignore",
  });
  const c3 = git(cwd, ["rev-parse", "HEAD"]).trim();
  const g2 = groups(cwd, "opt", [
    { title: "t1", last_commit: c2, slug: "b1" },
    { title: "t2", last_commit: c3, slug: "b2" },
  ]);
  let threw = false;
  try {
    execFileSync("bash", [FINALIZE, cwd, g2], { encoding: "utf8" });
  } catch (e) {
    threw = true;
    assert.match(
      String((e as { stderr?: unknown }).stderr ?? ""),
      /multiple groups|FATAL/,
    );
  }
  assert.equal(threw, true, "overlapping groups must fail");
  // rolled back: back on original branch, no stray branches
  assert.equal(
    git(cwd, ["branch", "--show-current"]).trim(),
    "autoresearch/exp",
  );
  const branches = git(cwd, ["branch", "--list", "autoresearch/opt/*"]).trim();
  assert.equal(branches, "", "no leftover finalize branches");
});
