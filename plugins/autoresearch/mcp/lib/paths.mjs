// Resolve the effective research directory. `.auto/config.json` in the project
// dir may set `workingDir` (relative to the project or absolute); when it
// exists, all experiment operations happen there (config stays in the project).
import { readFileSync, statSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";

export function resolveWorkCwd(projectCwd) {
  try {
    const cfg = JSON.parse(
      readFileSync(join(projectCwd, ".auto", "config.json"), "utf8"),
    );
    const wd = cfg.workingDir;
    if (typeof wd === "string" && wd.trim()) {
      const target = isAbsolute(wd) ? wd : resolve(projectCwd, wd);
      if (statSync(target).isDirectory()) return target;
    }
  } catch {
    /* no config or no workingDir → project dir */
  }
  return projectCwd;
}
