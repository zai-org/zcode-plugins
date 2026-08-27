import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  commitExperiment,
  rollbackWorkingTree,
  isDirty,
  shortHash,
  currentBranch,
} from "../mcp/lib/git.mjs";

function gitInit(cwd) {
  for (const a of [
    ["init", "-q"],
    ["config", "user.email", "t@t"],
    ["config", "user.name", "t"],
  ])
    execFileSync("git", a, { cwd, stdio: "ignore" });
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function tempRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "ar-git-"));
  gitInit(cwd);
  writeFileSync(join(cwd, "main.js"), "v1\n");
  execFileSync("git", ["add", "-A", "&&", "git", "commit", "-qm", "init"], {
    cwd,
    shell: true,
    stdio: "ignore",
  });
  return cwd;
}

test("commitExperiment commits with experiment: prefix and Result JSON", () => {
  const cwd = tempRepo();
  writeFileSync(join(cwd, "main.js"), "v2\n");
  const hash = commitExperiment(cwd, {
    description: "try faster",
    result: { metric: 42 },
  });
  assert.ok(hash && hash.length === 7);
  const msg = git(cwd, ["log", "-1", "--format=%s%n%b"]);
  assert.ok(msg.startsWith("experiment: try faster"));
  assert.ok(msg.includes('"metric":42'));
  assert.equal(isDirty(cwd), false);
});

test("commitExperiment returns null when nothing changed", () => {
  const cwd = tempRepo();
  const hash = commitExperiment(cwd, { description: "noop", result: {} });
  assert.equal(hash, null);
});

test("rollbackWorkingTree discards changes but keeps .auto/", () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(join(cwd, ".auto", "log.jsonl"), '{"type":"config"}\n');
  writeFileSync(join(cwd, "main.js"), "v2\n");
  writeFileSync(join(cwd, "scratch.txt"), "junk\n");
  rollbackWorkingTree(cwd);
  assert.equal(readFileSync(join(cwd, "main.js"), "utf8"), "v1\n");
  assert.ok(!existsSync(join(cwd, "scratch.txt")), "untracked junk cleaned");
  assert.ok(
    existsSync(join(cwd, ".auto", "log.jsonl")),
    ".auto survives clean",
  );
  assert.equal(isDirty(cwd), true); // .auto/log.jsonl untracked -> still dirty, that's expected
});

test("rollbackWorkingTree leaves staged-but-uncommitted changes reverted too", () => {
  const cwd = tempRepo();
  writeFileSync(join(cwd, "main.js"), "v2\n");
  execFileSync("git", ["add", "main.js"], { cwd, stdio: "ignore" });
  rollbackWorkingTree(cwd);
  assert.equal(readFileSync(join(cwd, "main.js"), "utf8"), "v1\n");
});

test("rollbackWorkingTree keeps the dashboard file too", () => {
  const cwd = tempRepo();
  writeFileSync(
    join(cwd, "autoresearch-dashboard.html"),
    "<html>progress</html>\n",
  );
  writeFileSync(join(cwd, "main.js"), "v2\n");
  rollbackWorkingTree(cwd);
  assert.equal(readFileSync(join(cwd, "main.js"), "utf8"), "v1\n");
  assert.equal(
    readFileSync(join(cwd, "autoresearch-dashboard.html"), "utf8"),
    "<html>progress</html>\n",
  );
});

test("shortHash and currentBranch work", () => {
  const cwd = tempRepo();
  assert.ok(/^[0-9a-f]{7}$/.test(shortHash(cwd)));
  assert.ok(["master", "main"].includes(currentBranch(cwd)));
  execFileSync("git", ["checkout", "-qb", "autoresearch/x"], {
    cwd,
    stdio: "ignore",
  });
  assert.equal(currentBranch(cwd), "autoresearch/x");
});
