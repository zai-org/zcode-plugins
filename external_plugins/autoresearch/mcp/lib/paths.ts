// Resolve the effective research directory. `.auto/config.json` in the project
// dir may set `workingDir` (relative to the project or absolute); when it
// exists, all experiment operations happen there (config stays in the project).
//
// Three outcomes, deliberately different:
// - no workingDir configured → silent fallback to the project dir (normal);
// - config.json unparseable → stderr diagnostic, then fallback (a corrupt
//   config must not brick hooks, but must not be invisible either);
// - workingDir set but the target is missing / not a directory → THROW.
//   Silently falling back here would repoint the destructive paths
//   (`rollbackWorkingTree`: checkout HEAD + clean -fd) at the project root and
//   destroy uncommitted work outside the research dir. Failing loud is the
//   only safe direction: better no experiment than a rollback in the wrong tree.
//   Hooks wrap this call and fail open with a diagnostic (hook discipline);
//   the MCP server lets it throw at startup so the misconfiguration surfaces
//   as a clear error instead of misdirected git operations.
import { readFileSync, statSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";

export function resolveWorkCwd(projectCwd: string): string {
  let raw: string;
  try {
    raw = readFileSync(join(projectCwd, ".auto", "config.json"), "utf8");
  } catch {
    return projectCwd; // no config → project dir
  }
  let cfg: { workingDir?: unknown };
  try {
    cfg = JSON.parse(raw) as { workingDir?: unknown };
  } catch {
    process.stderr.write(
      "[autoresearch] warning: .auto/config.json is not valid JSON; falling back to the project directory\n",
    );
    return projectCwd;
  }
  const wd = cfg.workingDir;
  if (typeof wd === "string" && wd.trim()) {
    const target = isAbsolute(wd) ? wd : resolve(projectCwd, wd);
    let isDir = false;
    try {
      isDir = statSync(target).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      throw new Error(
        `.auto/config.json workingDir "${wd}" (resolved: ${target}) is missing or not a directory; fix or remove workingDir before running experiments`,
      );
    }
    return target;
  }
  return projectCwd;
}
