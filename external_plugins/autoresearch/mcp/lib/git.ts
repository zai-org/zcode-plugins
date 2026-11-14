// Git operations for the experiment loop (ADR-2 semantics):
// keep → commit with `experiment:` prefix + structured Result JSON.
// discard/crash/checks_failed → drop working-tree changes, exempt session state
// (`.auto/`, the host session dir `.zcode/` and the generated dashboard).
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DASHBOARD_FILE } from "./ledger.ts";

// Session state dirs exempt from every git consumption site (keep staging,
// dirty check, rollback restore/clean). Single source of truth: the sites
// speak different pathspec dialects, and per-site enumeration missed `.zcode`
// the same way `.auto` once did (evidence 2026-11-05: rollback clean -fd
// deleted the host's .zcode/plans on every discard, and dirtyFiles counted
// session files as tree changes, deadlocking the crash gate).
const SESSION_STATE_DIRS = [".auto", ".zcode"];

// Standard install locations a slim GUI PATH can hide. On macOS the
// launchd-default PATH still contains /usr/bin, whose git (the CLT shim)
// covers most GUI launches — but homebrew-only machines without the CLT are
// left with git at /opt/homebrew/bin, invisible to a GUI-launched server.
// On Windows a GUI PATH can miss Git for Windows entirely; its installer
// default is the cmd\git.exe shim under Program Files.
const GIT_CANDIDATES =
  process.platform === "win32"
    ? [
        "C:\\Program Files\\Git\\cmd\\git.exe",
        "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
      ]
    : [
        "/opt/homebrew/bin/git",
        "/usr/local/bin/git",
        "/usr/bin/git",
        "/bin/git",
      ];

function probeGit(path: string): boolean {
  try {
    execFileSync(path, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let cachedGit: string | null = null;

/**
 * Resolve the git binary: PATH first (one probe, then cached), falling back
 * to the standard install locations. Injected candidates (tests) bypass the
 * PATH probe and the cache. Throws with a loud message when nothing
 * resolves — every spawn in this module goes through here, so a missing git
 * surfaces as one clear error instead of per-call ENOENT.
 */
export function resolveGit(candidates?: string[]): string {
  if (candidates === undefined) {
    if (cachedGit) return cachedGit;
    if (probeGit("git")) {
      cachedGit = "git";
      return "git";
    }
    for (const path of GIT_CANDIDATES) {
      if (existsSync(path) && probeGit(path)) {
        cachedGit = path;
        return path;
      }
    }
  } else {
    for (const path of candidates) {
      if (probeGit(path)) return path;
    }
  }
  throw new Error(
    "no usable git on PATH or standard install locations; install git or make sure it is on the server's PATH",
  );
}

export function git(cwd: string, args: string[]): string {
  return execFileSync(resolveGit(), args, { cwd, encoding: "utf8" }).trim();
}

export function isGitRepo(cwd: string): boolean {
  // resolveGit() throws when no git exists at all — that is a different
  // failure from "this directory is not a repository" and callers must be
  // able to tell them apart. Only the rev-parse failure maps to false.
  const gitBin = resolveGit();
  try {
    execFileSync(gitBin, ["rev-parse", "--git-dir"], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** Whether the repository has at least one commit (HEAD resolves). */
export function hasCommit(cwd: string): boolean {
  try {
    execFileSync(resolveGit(), ["rev-parse", "--verify", "HEAD"], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The real changes behind isDirty, named: one porcelain line per path
 * (session state excluded, untracked included). Unlike isDirty this lets a
 * status failure throw — a post-rollback verification must never mistake an
 * unreadable status for a clean tree.
 */
export function dirtyFiles(cwd: string): string[] {
  return git(cwd, [
    "status",
    "--porcelain",
    "--",
    ".",
    ...SESSION_STATE_DIRS.map((d) => `:(exclude)${d}`),
    `:(exclude)${DASHBOARD_FILE}`,
  ])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Whether the working tree has real changes (session state excluded). Ledger,
 * config and dashboard writes must not count: e.g. the crash-unresolved gate
 * would otherwise block forever right after logging the crash itself.
 */
export function isDirty(cwd: string): boolean {
  try {
    return dirtyFiles(cwd).length > 0;
  } catch {
    return false;
  }
}

export function shortHash(cwd: string): string {
  return git(cwd, ["rev-parse", "--short=7", "HEAD"]);
}

/** Short HEAD hash for the dashboard footer pin; null outside a repo / on failure. */
export function safeShortHash(cwd: string): string | null {
  try {
    return isGitRepo(cwd) ? shortHash(cwd) : null;
  } catch {
    return null;
  }
}

/** Full HEAD sha, or null on an unborn branch / git failure. */
export function headSha(cwd: string): string | null {
  if (!hasCommit(cwd)) return null;
  try {
    return git(cwd, ["rev-parse", "HEAD"]).trim();
  } catch {
    return null;
  }
}

/**
 * Undo the experiment keep commit: move the branch back to `sha` and reset
 * the index to it, leaving the working tree untouched — the committed changes
 * return to the tree as unstaged modifications, i.e. exactly the pre-keep
 * state. Used when the ledger append fails after a successful commit: a
 * commit without its ledger row would silently diverge from the audit chain
 * (after the undo, the retry looks exactly like the first attempt).
 */
export function undoCommitTo(cwd: string, sha: string): void {
  git(cwd, ["reset", "-q", "--mixed", sha]);
}

/**
 * Shared staging discipline for every loop commit (keep and founding alike):
 * index reset, stage the research dir, then unstage session state again.
 * Returns whether anything is staged afterwards. Two constraints meet here:
 * - No exclude pathspec: an exclude that covers a gitignored path makes add
 *   exit 1 ("paths are ignored"), which aborted every keep in repos with
 *   gitignored session state (evidence 2026-11-01: ml-auto; reproduced on
 *   git 2.55.0 with the exact quoted argv). Plain `-- .` skips ignored
 *   files instead of failing on them.
 * - Keep the pathspec: it scopes the commit to the research dir. A bare
 *   `git add -A` is repo-wide, so under `workingDir: work/` it also staged
 *   the project's own `.auto/` (the post-add reset is cwd-relative and
 *   cannot reach it) and unrelated files elsewhere in the repo.
 * The post-add reset removes session paths even when they are tracked or
 * pre-staged. `.zcode` is the host's session-state dir (plans, session
 * files) and often NOT gitignored — left in, `add -A -- .` sweeps it into
 * the commit (evidence 2026-11-05, ml-auto: .zcode/plans/plan-sess_*.md
 * landed in an experiment commit). Non-existent pathspecs here are a silent
 * no-op (git reset exit 0).
 */
function stageResearchTree(cwd: string): boolean {
  // Unstage the whole index first (working tree untouched): the commit below
  // must describe its own purpose and nothing else. Excluding paths from add
  // does not remove files already in the index, so pre-staged state from
  // outside the research dir would otherwise ride into the commit — and,
  // when the research dir itself has no changes, would fake a non-empty
  // experiment (a keep whose commit contains none of the experiment).
  git(cwd, ["reset", "-q", "HEAD"]);
  git(cwd, ["add", "-A", "--", "."]);
  git(cwd, [
    "reset",
    "-q",
    "HEAD",
    "--",
    ...SESSION_STATE_DIRS,
    DASHBOARD_FILE,
  ]);
  // git diff --cached --quiet exits 0 when there are no staged changes.
  try {
    execFileSync(resolveGit(), ["diff", "--cached", "--quiet"], {
      cwd,
      stdio: "ignore",
    });
    return false;
  } catch {
    return true;
  }
}

/**
 * Commit all tracked+untracked changes as one experiment, excluding session
 * state (`.auto/`, `.zcode/` and the generated dashboard): a keep with only
 * session-file changes must hit the "nothing to commit" path.
 * Returns the short hash, or null when there is nothing to commit.
 */
export function commitExperiment(
  cwd: string,
  { description, result }: { description: string; result: unknown },
): string | null {
  const hasStaged = stageResearchTree(cwd);
  if (!hasStaged) return null;
  const body = `experiment: ${description}\n\nResult: ${JSON.stringify(result)}`;
  // --no-verify isolates the experiment commit from the target repo's own git
  // hooks: a husky/lint-staged style pre-commit would rewrite staged content
  // (breaking "the commit describes exactly this experiment") or fail the
  // commit for reasons unrelated to the research. stderr is captured so a
  // failing commit surfaces git's actual diagnostics instead of a bare
  // "Command failed" (evidence 2026-11-04: hook-modified content committed,
  // and hook-failure error with zero diagnostics, both reproduced).
  try {
    execFileSync(resolveGit(), ["commit", "--no-verify", "-m", body], {
      cwd,
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    });
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr).trim()
        : "";
    throw new Error(
      `git commit failed: ${stderr || (err instanceof Error ? err.message : String(err))}. The experiment changes remain staged in the index (pre-staged entries elsewhere were unstaged while attempting the keep).`,
    );
  }
  return shortHash(cwd);
}

/**
 * Segment founding commit (opt-in via init_experiment foundingCommit): fold
 * pre-existing uncommitted work into HEAD before the loop starts. keep and
 * discard git semantics both assume "after init, tree == HEAD" — keep's
 * staging sweeps the whole research dir (a founding config left uncommitted
 * rides into the keep commit under an experiment-only message) and discard's
 * `checkout HEAD -- .` restores it away (a baseline row attesting the
 * founding state becomes unreproducible). Committing at init re-establishes
 * the invariant at the only moment it can be established, so neither
 * downstream needs its own guard. Shares stageResearchTree with keeps —
 * one code path owns "what counts as session state". --no-verify for the
 * same hook-isolation reason as keeps. Empty staging (all dirty content
 * gitignored) means nothing to fold: return null instead of failing on an
 * empty commit.
 */
export function commitFoundingState(cwd: string, name: string): string | null {
  const hasStaged = stageResearchTree(cwd);
  if (!hasStaged) return null;
  const body = `segment: ${name} founding state (pre-existing uncommitted work folded in before the loop starts)`;
  try {
    execFileSync(resolveGit(), ["commit", "--no-verify", "-m", body], {
      cwd,
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    });
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr).trim()
        : "";
    throw new Error(
      `git commit failed: ${stderr || (err instanceof Error ? err.message : String(err))}. The founding changes remain staged in the index.`,
    );
  }
  return shortHash(cwd);
}

/**
 * Declare `.zcode` in the repo's local exclude file (`.git/info/exclude`) so
 * untracked host session files are invisible to `add -A`, `status` and
 * `clean -fd` alike — git-native ignore instead of per-site enumeration.
 * Per-session-file evidence (2026-11-05, ml-auto): the enumeration layer alone
 * shipped three gaps in one day (keep staging swept .zcode/plans into a
 * commit; clean -fd deleted the host session dir on every discard; dirtyFiles
 * deadlocked the crash gate). Skipped when the path is already ignored
 * (project `.gitignore` covers it); idempotent when the declaration is already
 * present; any failure is swallowed — the SESSION_STATE_DIRS enumeration is
 * the correctness backstop, this layer is recurrence prevention.
 * Returns whether the declaration was newly written.
 */
export function ensureSessionStateIgnored(cwd: string): boolean {
  try {
    execFileSync(resolveGit(), ["check-ignore", "-q", ".zcode"], {
      cwd,
      stdio: "ignore",
    });
    return false; // exit 0: already ignored, nothing to declare
  } catch {
    // exit 1 = not ignored (the expected path); any other failure falls
    // through and attempts the write anyway — the append is harmless.
  }
  try {
    const gitDir = git(cwd, ["rev-parse", "--git-dir"]);
    const excludeFile = resolve(cwd, gitDir, "info", "exclude");
    let current = "";
    try {
      current = readFileSync(excludeFile, "utf8");
    } catch {
      // missing or unreadable → created by the append below (info/ may not
      // exist on bare or sparsely provisioned repos)
    }
    if (current.split(/\r?\n/).includes(".zcode")) return false;
    mkdirSync(dirname(excludeFile), { recursive: true });
    appendFileSync(excludeFile, ".zcode\n");
    return true;
  } catch {
    return false;
  }
}

/**
 * Discard every working-tree + index change while keeping session state
 * (`.auto/`, `.zcode/` and the generated dashboard) intact. Uses `checkout
 * HEAD` (not `checkout --`) so staged-but-uncommitted experiment changes are
 * reverted too.
 *
 * Returns what the rollback did: `rolledBack` = the working-tree files the
 * restore disposed of (pre-restore dirtyFiles — tracked reverts and untracked
 * removes alike), `restoredTo` = the HEAD short hash the tree was restored to,
 * `residual` = the post-rollback dirtyFiles so the caller can surface them
 * instead of assuming the restore happened. Evidence 2026-10-29 (nano-jev
 * V1 run 6): a discard once returned ok while the challenger stayed in the
 * working tree — git exited 0 without restoring, intermittently (runs 2–5
 * rolled back fine; Windows file-lock or pathspec race suspected, root cause
 * unconfirmed). stdio-ignored with no post-check made that silent, and every
 * later read would sit on un-rolled-back inputs. So: restore with stderr
 * captured (retry once — transient locks clear between attempts), then
 * verify. Verification is root-cause-agnostic: any way the restore can
 * silently fail ends up as a loud, named residual.
 */
export function rollbackWorkingTree(cwd: string): {
  rolledBack: string[];
  restoredTo: string | null;
  residual: string[];
} {
  const rolledBack = dirtyFiles(cwd);
  const restore = () =>
    execFileSync(
      resolveGit(),
      [
        "checkout",
        "HEAD",
        "--",
        ".",
        ...SESSION_STATE_DIRS.map((d) => `:(exclude,glob)**/${d}/**`),
        `:(exclude)${DASHBOARD_FILE}`,
      ],
      { cwd, encoding: "utf8" },
    );
  try {
    restore();
  } catch {
    try {
      restore();
    } catch (retryError) {
      const stderr =
        retryError && typeof retryError === "object" && "stderr" in retryError
          ? String((retryError as { stderr?: unknown }).stderr)
          : String(retryError);
      throw new Error(`rollback restore failed twice: ${stderr.trim()}`);
    }
  }
  // Unstage anything (e.g. accidentally staged .auto content) without touching files.
  execFileSync(resolveGit(), ["reset", "-q"], { cwd, stdio: "ignore" });
  execFileSync(
    resolveGit(),
    [
      "clean",
      "-fd",
      ...SESSION_STATE_DIRS.flatMap((d) => ["-e", d, "-e", `${d}/`]),
      "-e",
      DASHBOARD_FILE,
    ],
    { cwd, stdio: "ignore" },
  );
  return {
    rolledBack,
    restoredTo: safeShortHash(cwd),
    residual: dirtyFiles(cwd),
  };
}

export function currentBranch(cwd: string): string {
  try {
    return git(cwd, ["branch", "--show-current"]);
  } catch {
    return "";
  }
}
