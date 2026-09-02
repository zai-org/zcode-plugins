// Git operations for the experiment loop (ADR-2 semantics):
// keep → commit with `experiment:` prefix + structured Result JSON.
// discard/crash/checks_failed → drop working-tree changes, exempt `.auto/`.
import { execFileSync } from "node:child_process";

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the working tree has real (non-`.auto/`) changes. Session-file
 * writes (ledger, config) must not count: e.g. the crash-unresolved gate
 * would otherwise block forever right after logging the crash itself.
 */
export function isDirty(cwd: string): boolean {
  try {
    return (
      git(cwd, ["status", "--porcelain", "--", ".", ":(exclude).auto"]).length >
      0
    );
  } catch {
    return false;
  }
}

export function shortHash(cwd: string): string {
  return git(cwd, ["rev-parse", "--short=7", "HEAD"]);
}

/**
 * Commit all tracked+untracked changes as one experiment, excluding the
 * `.auto/` session dir (ledger noise must not ride along, and a keep with
 * only session-file changes must hit the "nothing to commit" path).
 * Returns the short hash, or null when there is nothing to commit.
 */
export function commitExperiment(
  cwd: string,
  { description, result }: { description: string; result: unknown },
): string | null {
  git(cwd, ["add", "-A", "--", ".", ":(exclude).auto"]);
  // git diff --cached --quiet exits 0 when there are no staged changes.
  const hasStaged = (() => {
    try {
      execFileSync("git", ["diff", "--cached", "--quiet"], {
        cwd,
        stdio: "ignore",
      });
      return false;
    } catch {
      return true;
    }
  })();
  if (!hasStaged) return null;
  const body = `experiment: ${description}\n\nResult: ${JSON.stringify(result)}`;
  execFileSync("git", ["commit", "-m", body], { cwd, stdio: "ignore" });
  return shortHash(cwd);
}

/**
 * Discard every working-tree + index change while keeping the `.auto/`
 * session directory intact. Uses `checkout HEAD` (not `checkout --`) so
 * staged-but-uncommitted experiment changes are reverted to HEAD too.
 */
export function rollbackWorkingTree(cwd: string): void {
  execFileSync(
    "git",
    ["checkout", "HEAD", "--", ".", ":(exclude,glob)**/.auto/**"],
    { cwd, stdio: "ignore" },
  );
  // Unstage anything (e.g. accidentally staged .auto content) without touching files.
  execFileSync("git", ["reset", "-q"], { cwd, stdio: "ignore" });
  execFileSync(
    "git",
    [
      "clean",
      "-fd",
      "-e",
      ".auto",
      "-e",
      ".auto/",
      "-e",
      "autoresearch-dashboard.html",
    ],
    { cwd, stdio: "ignore" },
  );
}

export function currentBranch(cwd: string): string {
  try {
    return git(cwd, ["branch", "--show-current"]);
  } catch {
    return "";
  }
}
