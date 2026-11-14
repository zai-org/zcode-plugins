import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  commitExperiment,
  commitFoundingState,
  rollbackWorkingTree,
  isDirty,
  dirtyFiles,
  shortHash,
  currentBranch,
  resolveGit,
  ensureSessionStateIgnored,
} from "../mcp/lib/git.ts";

function gitInit(cwd: string): void {
  for (const a of [
    ["init", "-q"],
    ["config", "user.email", "t@t"],
    ["config", "user.name", "t"],
    // Developers on Windows often have core.autocrlf=true globally; checkout
    // would then smudge LF back to CRLF and break the exact-content assertions.
    ["config", "core.autocrlf", "false"],
  ])
    execFileSync("git", a, { cwd, stdio: "ignore" });
}

function git(cwd: string, args: string[]): string {
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

test("commitFoundingState folds pre-existing dirty work into a segment commit", () => {
  const cwd = tempRepo();
  writeFileSync(join(cwd, "founding.toml"), "founding\n");
  const hash = commitFoundingState(cwd, "adult-auprc");
  assert.ok(hash && hash.length === 7);
  const msg = git(cwd, ["log", "-1", "--format=%s"]);
  assert.ok(msg.startsWith("segment: adult-auprc founding state"));
  assert.equal(isDirty(cwd), false);
  // tracked content survives verbatim (rollback now restores to a HEAD that
  // contains it)
  assert.equal(readFileSync(join(cwd, "founding.toml"), "utf8"), "founding\n");
});

test("commitFoundingState returns null on a clean tree", () => {
  const cwd = tempRepo();
  assert.equal(commitFoundingState(cwd, "t"), null);
});

test("commitFoundingState skips gitignored-only dirtiness", () => {
  const cwd = tempRepo();
  writeFileSync(join(cwd, ".gitignore"), "ignored.log\n");
  execFileSync(
    "git",
    ["add", ".gitignore", "&&", "git", "commit", "-qm", "gitignore"],
    { cwd, shell: true, stdio: "ignore" },
  );
  // untracked AND gitignored → invisible to add -A -- . → nothing to fold
  writeFileSync(join(cwd, "ignored.log"), "noise\n");
  assert.equal(commitFoundingState(cwd, "t"), null);
});

test("founding commit: keeps no longer ride along and discards spare it", () => {
  // The full invariant (worth-fix repro, real-world evidence: a keep commit
  // carried 8 lines under a 1-line message; a discard orphaned the baseline
  // row attesting the founding state).
  const cwd = tempRepo();
  writeFileSync(join(cwd, "founding.toml"), "founding\n");
  assert.ok(commitFoundingState(cwd, "seg"));
  writeFileSync(join(cwd, "main.js"), "v2\n");
  const keep = commitExperiment(cwd, {
    description: "experiment change only",
    result: { metric: 42 },
  });
  assert.ok(keep);
  const files = git(cwd, ["show", "--name-only", "--format=", "HEAD"]);
  assert.ok(files.includes("main.js"));
  assert.ok(
    !files.includes("founding.toml"),
    `keep commit must not contain founding files, got: ${files}`,
  );
  rollbackWorkingTree(cwd);
  assert.equal(readFileSync(join(cwd, "main.js"), "utf8"), "v2\n");
  assert.equal(
    readFileSync(join(cwd, "founding.toml"), "utf8"),
    "founding\n",
    "founding content must survive the discard (HEAD contains it)",
  );
});

test("commitExperiment excludes the .auto session dir from staging", () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  // session files only (no code change) → nothing to commit
  writeFileSync(join(cwd, ".auto", "log.jsonl"), '{"type":"config"}\n');
  writeFileSync(join(cwd, ".auto", "config.json"), "{}");
  assert.equal(
    commitExperiment(cwd, { description: "ledger only", result: {} }),
    null,
  );
  // a real code change commits, but without any .auto noise
  writeFileSync(join(cwd, "main.js"), "v2\n");
  const hash = commitExperiment(cwd, {
    description: "real change",
    result: { metric: 1 },
  });
  assert.ok(hash);
  const files = git(cwd, ["show", "--name-only", "--format=", "HEAD"]);
  assert.ok(files.includes("main.js"));
  assert.ok(
    !files.split("\n").some((f) => f.startsWith(".auto/") || f === ".auto"),
    `commit must not contain .auto files, got: ${files}`,
  );
  // .auto files stay on disk and untracked-pending (not committed)
  assert.ok(existsSync(join(cwd, ".auto", "log.jsonl")));
});

test("commitExperiment excludes the .zcode host session dir from staging", () => {
  // 2026-11-05, ml-auto: .zcode/plans/plan-sess_*.md (untracked, not
  // gitignored) landed in an experiment keep commit — the host session dir
  // must be unstaged just like .auto.
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".zcode", "plans"), { recursive: true });
  writeFileSync(join(cwd, ".zcode", "plans", "plan-sess_x.md"), "# plan\n");
  writeFileSync(join(cwd, "main.js"), "v2\n");
  const hash = commitExperiment(cwd, {
    description: "real change",
    result: { metric: 1 },
  });
  assert.ok(hash);
  const files = git(cwd, ["show", "--name-only", "--format=", "HEAD"]);
  assert.ok(files.includes("main.js"));
  assert.ok(
    !files.split("\n").some((f) => f.startsWith(".zcode/")),
    `commit must not contain .zcode files, got: ${files}`,
  );
  // session state stays on disk untouched
  assert.ok(existsSync(join(cwd, ".zcode", "plans", "plan-sess_x.md")));
});

test("session dashboard is neither committed nor counted as dirty", () => {
  const cwd = tempRepo();
  writeFileSync(
    join(cwd, "autoresearch-dashboard.html"),
    "<html>dash</html>\n",
  );

  assert.equal(isDirty(cwd), false);
  assert.equal(
    commitExperiment(cwd, { description: "dashboard only", result: {} }),
    null,
  );
  const files = git(cwd, ["show", "--name-only", "--format=", "HEAD"]);
  assert.ok(!files.includes("autoresearch-dashboard.html"));

  // A real code change still commits, without the dashboard riding along.
  writeFileSync(join(cwd, "main.js"), "v2\n");
  const hash = commitExperiment(cwd, {
    description: "real change",
    result: {},
  });
  assert.ok(hash);
  assert.ok(
    !git(cwd, ["show", "--name-only", "--format=", "HEAD"]).includes(
      "autoresearch-dashboard.html",
    ),
  );
});

for (const mode of ["new", "modified", "deleted"]) {
  for (const withCode of [false, true]) {
    test(`keep excludes pre-staged ${mode} session files (code=${withCode})`, () => {
      const cwd = tempRepo();
      try {
        const files = ["autoresearch-dashboard.html", ".auto/log.jsonl"];
        mkdirSync(join(cwd, ".auto"));
        if (mode !== "new") {
          for (const file of files) writeFileSync(join(cwd, file), "old\n");
          git(cwd, ["add", "-A"]);
          git(cwd, ["commit", "-qm", "tracked session baseline"]);
        }
        for (const file of files) {
          if (mode === "deleted") rmSync(join(cwd, file));
          else writeFileSync(join(cwd, file), "session change\n");
        }
        git(cwd, ["add", "-A"]);
        const before = shortHash(cwd);
        assert.equal(isDirty(cwd), false);
        if (withCode) writeFileSync(join(cwd, "main.js"), "v2\n");
        const hash = commitExperiment(cwd, {
          description: "staged session",
          result: {},
        });
        if (withCode) {
          assert.ok(hash);
          assert.equal(
            git(cwd, ["show", "--name-only", "--format=", "HEAD"]),
            "main.js",
          );
        } else {
          assert.equal(hash, null);
          assert.equal(shortHash(cwd), before);
        }
        assert.equal(git(cwd, ["diff", "--cached", "--name-only"]), "");
        for (const file of files) {
          if (mode === "deleted")
            assert.equal(existsSync(join(cwd, file)), false);
          else
            assert.equal(
              readFileSync(join(cwd, file), "utf8"),
              "session change\n",
            );
        }
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
}

test("keep excludes a tracked-but-unstaged .auto modification", () => {
  const cwd = tempRepo();
  try {
    // .auto/log.jsonl is tracked from a previous session and modified in the
    // worktree with the index untouched. The staging is a plain `git add -A`
    // (no pathspec: git >= 2.55 rejects exclude pathspecs over ignored
    // paths), and add stages tracked files regardless of .gitignore — so the
    // post-add reset is what keeps the modification out of the commit.
    mkdirSync(join(cwd, ".auto"));
    writeFileSync(join(cwd, ".auto", "log.jsonl"), "old\n");
    git(cwd, ["add", "-A"]);
    git(cwd, ["commit", "-qm", "tracked session baseline"]);
    writeFileSync(join(cwd, ".auto", "log.jsonl"), "session change\n");
    writeFileSync(join(cwd, "main.js"), "v2\n");
    const hash = commitExperiment(cwd, {
      description: "real change",
      result: {},
    });
    assert.ok(hash);
    assert.equal(
      git(cwd, ["show", "--name-only", "--format=", "HEAD"]),
      "main.js",
    );
    // content stays on disk, index back to HEAD
    assert.equal(
      readFileSync(join(cwd, ".auto", "log.jsonl"), "utf8"),
      "session change\n",
    );
    assert.equal(git(cwd, ["diff", "--cached", "--name-only"]), "");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("keep stages only the research dir when cwd is a workingDir subdir", () => {
  const root = tempRepo();
  const work = join(root, "work");
  mkdirSync(join(work, ".auto"), { recursive: true });
  mkdirSync(join(root, ".auto"), { recursive: true });
  // The project-level config is untracked and NOT gitignored here — the same
  // layout the workingDir integration test uses. A repo-wide add would stage
  // it, and the post-add reset (cwd-relative) could not reach it.
  writeFileSync(
    join(root, ".auto", "config.json"),
    JSON.stringify({ workingDir: "work" }),
  );
  writeFileSync(join(work, "code.js"), "v2\n");
  writeFileSync(join(root, "main.js"), "v2\n");
  writeFileSync(join(root, "scratch.md"), "draft\n");
  const hash = commitExperiment(work, { description: "scoped", result: {} });
  assert.ok(hash);
  const files = git(work, ["show", "--name-only", "--format=", "HEAD"])
    .split("\n")
    .filter(Boolean)
    .sort();
  assert.deepEqual(files, ["work/code.js"]);
  // Project-level session state and stray root files stay out and stay on disk.
  assert.ok(existsSync(join(root, ".auto", "config.json")));
  assert.ok(existsSync(join(root, "scratch.md")));
  assert.match(git(work, ["status", "--porcelain"]), /scratch\.md/);
});

test("keep succeeds when the research dir's .auto is gitignored", () => {
  // git >= 2.55 exits 1 from add when an exclude pathspec covers a gitignored
  // path, which once killed every keep in repos that gitignore .auto/, and an
  // unrelated change later re-shaped the add argv in exactly that vicinity.
  // So: the pathspec-less exclude must stay gone, and add must stage the code
  // while silently skipping the ignored session dir.
  const cwd = tempRepo();
  writeFileSync(join(cwd, ".gitignore"), ".auto/\n");
  mkdirSync(join(cwd, ".auto"));
  writeFileSync(join(cwd, ".auto", "config.json"), "{}\n");
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-qm", "gitignore session state"]);
  writeFileSync(join(cwd, "main.js"), "v2\n");
  writeFileSync(join(cwd, ".auto", "config.json"), '{"workingDir":"."}\n');
  const hash = commitExperiment(cwd, {
    description: "ignored session dir",
    result: {},
  });
  assert.ok(hash, "keep must not abort on a gitignored .auto");
  assert.equal(
    git(cwd, ["show", "--name-only", "--format=", "HEAD"]),
    "main.js",
  );
  // Session content stays on disk, untouched by the staging round-trip.
  assert.equal(
    readFileSync(join(cwd, ".auto", "config.json"), "utf8"),
    '{"workingDir":"."}\n',
  );
});

test("out-of-scope staged files neither fake nor join a keep", () => {
  const root = tempRepo();
  const work = join(root, "work");
  mkdirSync(work);
  writeFileSync(join(work, "code.js"), "v1\n");
  git(work, ["add", "-A"]);
  git(work, ["commit", "-qm", "research baseline"]);
  // The user staged an unrelated root file before asking for a keep.
  writeFileSync(join(root, "main.js"), "v2\n");
  git(root, ["add", "main.js"]);
  // No research-dir change: that staged file must not masquerade as an
  // experiment. keep relies on the cached diff meaning "this experiment".
  assert.equal(
    commitExperiment(work, { description: "noop", result: {} }),
    null,
  );
  // With a real research-dir change, only that change is committed.
  writeFileSync(join(work, "code.js"), "v2\n");
  git(root, ["add", "main.js"]);
  const hash = commitExperiment(work, { description: "scoped", result: {} });
  assert.ok(hash);
  assert.equal(
    git(work, ["show", "--name-only", "--format=", "HEAD"]),
    "work/code.js",
  );
  // The out-of-scope file survives in the worktree (unstaged, still edited).
  assert.equal(readFileSync(join(root, "main.js"), "utf8"), "v2\n");
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
  assert.equal(
    isDirty(cwd),
    false, // .auto/log.jsonl untracked but excluded — session files are not real changes
  );
});

test("rollbackWorkingTree keeps .zcode/ host session files", () => {
  // 2026-11-05 (ml-auto shape): clean -fd deleted the whole host session dir
  // on every discard — .zcode is session state, exempt like .auto.
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".zcode", "plans"), { recursive: true });
  writeFileSync(join(cwd, ".zcode", "plans", "plan-sess_x.md"), "# plan\n");
  writeFileSync(join(cwd, "main.js"), "v2\n");
  writeFileSync(join(cwd, "scratch.txt"), "junk\n");
  const r = rollbackWorkingTree(cwd);
  assert.equal(readFileSync(join(cwd, "main.js"), "utf8"), "v1\n");
  assert.ok(!existsSync(join(cwd, "scratch.txt")), "untracked junk cleaned");
  assert.ok(
    existsSync(join(cwd, ".zcode", "plans", "plan-sess_x.md")),
    ".zcode session files survive clean",
  );
  // the disposal list names experiment files only, never session state
  assert.ok(!r.rolledBack.some((f) => f.includes(".zcode")));
  assert.deepEqual(r.residual, []);
});

test("rollbackWorkingTree keeps tracked .zcode modifications too", () => {
  // checkout excludes session state from the restore, tracked or not —
  // reverting a tracked .zcode file would destroy non-experiment host work.
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".zcode"), { recursive: true });
  writeFileSync(join(cwd, ".zcode", "skills.md"), "v1\n");
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-qm", "track session dir"], {
    cwd,
    stdio: "ignore",
  });
  writeFileSync(join(cwd, ".zcode", "skills.md"), "v2-host-edit\n");
  writeFileSync(join(cwd, "main.js"), "v2\n");
  rollbackWorkingTree(cwd);
  assert.equal(readFileSync(join(cwd, "main.js"), "utf8"), "v1\n");
  assert.equal(
    readFileSync(join(cwd, ".zcode", "skills.md"), "utf8"),
    "v2-host-edit\n",
    "tracked .zcode edit survives the restore",
  );
});

test("isDirty ignores .auto-only changes but sees real ones", () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(join(cwd, ".auto", "log.jsonl"), '{"type":"config"}\n');
  assert.equal(isDirty(cwd), false); // session files alone are not dirty
  writeFileSync(join(cwd, "main.js"), "v2\n");
  assert.equal(isDirty(cwd), true); // a real change still counts
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

test("rollbackWorkingTree reports an empty residual when the tree is restored", () => {
  // Verification-aware rollback (2026-10-29, nano-jev V1 run 6): a discard
  // once returned ok while the challenger stayed in the tree — git exited 0
  // without restoring. The residual return value turns any repeat of that
  // into a loud, named failure the caller surfaces, instead of a silent one
  // every later read would sit on.
  const cwd = tempRepo();
  writeFileSync(join(cwd, "main.js"), "v2\n");
  writeFileSync(join(cwd, "scratch.txt"), "junk\n");
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(join(cwd, ".auto", "log.jsonl"), '{"type":"run"}\n');
  const r = rollbackWorkingTree(cwd);
  // clean restore: no residual, and the disposal list names both files with
  // the HEAD the tree was restored to (spec: 回滚显式回报)
  assert.deepEqual(r.residual, []);
  assert.equal(r.rolledBack.length, 2);
  assert.match(r.rolledBack.join("\n"), /main\.js/);
  assert.match(r.rolledBack.join("\n"), /scratch\.txt/);
  assert.ok(/^[0-9a-f]{7}$/.test(r.restoredTo ?? ""));
  assert.equal(readFileSync(join(cwd, "main.js"), "utf8"), "v1\n");
});

test("dirtyFiles names real changes and stays silent on session files", () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(join(cwd, ".auto", "log.jsonl"), '{"type":"run"}\n');
  writeFileSync(join(cwd, "autoresearch-dashboard.html"), "<html></html>\n");
  assert.deepEqual(dirtyFiles(cwd), []);
  writeFileSync(join(cwd, "main.js"), "v2\n");
  const residual = dirtyFiles(cwd);
  assert.equal(residual.length, 1);
  assert.match(residual[0], /main\.js/);
});

test("isDirty ignores .zcode-only changes but sees real ones", () => {
  // 2026-11-05: session files kept the crash gate's isDirty true forever —
  // the tree was never dirty, only the host was writing.
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".zcode", "plans"), { recursive: true });
  writeFileSync(join(cwd, ".zcode", "plans", "plan-sess_x.md"), "# plan\n");
  assert.equal(isDirty(cwd), false); // host session files alone are not dirty
  assert.deepEqual(dirtyFiles(cwd), []);
  writeFileSync(join(cwd, "main.js"), "v2\n");
  assert.equal(isDirty(cwd), true); // a real change still counts
});

test("ensureSessionStateIgnored appends once and skips when already ignored", () => {
  // idempotent: two calls leave exactly one declaration
  const cwd = tempRepo();
  assert.equal(ensureSessionStateIgnored(cwd), true);
  assert.equal(ensureSessionStateIgnored(cwd), false);
  const exclude = readFileSync(join(cwd, ".git", "info", "exclude"), "utf8");
  assert.equal(exclude.split(/\r?\n/).filter((l) => l === ".zcode").length, 1);
  // project .gitignore covers it → no local declaration needed (dir must
  // exist for check-ignore to match a dir-only pattern — the realistic state,
  // the host session dir is present during a session)
  const cwd2 = tempRepo();
  writeFileSync(join(cwd2, ".gitignore"), ".zcode/\n");
  mkdirSync(join(cwd2, ".zcode"), { recursive: true });
  assert.equal(ensureSessionStateIgnored(cwd2), false);
  const excludePath2 = join(cwd2, ".git", "info", "exclude");
  if (existsSync(excludePath2)) {
    assert.ok(
      !readFileSync(excludePath2, "utf8").split(/\r?\n/).includes(".zcode"),
    );
  }
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

test("resolveGit falls back to a candidate when PATH hides git", (t) => {
  // Regression for the 2026-10-29 macOS check: a GUI-launched server can get
  // a launchd-default PATH with no homebrew git, so bare execFileSync("git")
  // died with ENOENT on the first keep even though /opt/homebrew/bin/git
  // existed. Injected candidates bypass the PATH probe and the cache, so the
  // fallback decision is testable without touching the environment.
  if (process.platform === "win32") return t.skip("posix shim");
  const shim = join(mkdtempSync(join(tmpdir(), "ar-git-shim-")), "git");
  writeFileSync(shim, '#!/bin/sh\necho "git version 2.50 (shim)"\n');
  chmodSync(shim, 0o755);
  assert.equal(resolveGit([shim]), shim);
});

test("resolveGit throws loudly when nothing resolves", () => {
  assert.throws(
    () => resolveGit(["/nonexistent/ar/a", "/nonexistent/ar/b"]),
    /no usable git/,
  );
});

// Regression (evidence 2026-11-04, reproduced): a husky/lint-staged style
// pre-commit hook in the target repo rewrote staged content and the rewritten
// bytes rode into the experiment commit — breaking "the commit describes
// exactly this experiment". --no-verify isolates the commit from repo hooks.
test("commitExperiment isolates the experiment commit from repo git hooks", () => {
  const cwd = tempRepo();
  mkdirSync(join(cwd, ".git", "hooks"), { recursive: true });
  const hook = join(cwd, ".git", "hooks", "pre-commit");
  writeFileSync(
    hook,
    '#!/bin/sh\necho "# rewritten by hook" >> main.js\ngit add main.js\nexit 0\n',
  );
  chmodSync(hook, 0o755);
  writeFileSync(join(cwd, "main.js"), "v2\n");
  const hash = commitExperiment(cwd, { description: "d", result: {} });
  assert.ok(hash);
  // the committed blob is exactly the experiment content — hook never ran
  assert.equal(git(cwd, ["show", "HEAD:main.js"]), "v2");
  // working tree also untouched by the hook
  assert.equal(readFileSync(join(cwd, "main.js"), "utf8"), "v2\n");
});

// Regression (evidence 2026-11-04, reproduced): commit failure threw a bare
// "Command failed: git commit -m ..." because stdio:"ignore" swallowed git's
// stderr — zero diagnostics for the user.
test("commitExperiment surfaces git stderr when the commit fails", () => {
  const cwd = tempRepo();
  // strip the local identity and hide global/system config so `git commit`
  // fails with "Author identity unknown" (LC_ALL=C pins the message language)
  git(cwd, ["config", "--unset", "user.email"]);
  git(cwd, ["config", "--unset", "user.name"]);
  git(cwd, ["config", "user.useConfigOnly", "true"]);
  const saved = {
    global: process.env.GIT_CONFIG_GLOBAL,
    system: process.env.GIT_CONFIG_SYSTEM,
    lcAll: process.env.LC_ALL,
  };
  process.env.GIT_CONFIG_GLOBAL = join(cwd, "nonexistent-global-gitconfig");
  process.env.GIT_CONFIG_SYSTEM = join(cwd, "nonexistent-system-gitconfig");
  process.env.LC_ALL = "C";
  writeFileSync(join(cwd, "main.js"), "v2\n");
  try {
    assert.throws(
      () => commitExperiment(cwd, { description: "d", result: {} }),
      /git commit failed: .*identity|git commit failed: .*user\.email/s,
    );
  } finally {
    for (const [k, v] of [
      ["GIT_CONFIG_GLOBAL", saved.global],
      ["GIT_CONFIG_SYSTEM", saved.system],
      ["LC_ALL", saved.lcAll],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
