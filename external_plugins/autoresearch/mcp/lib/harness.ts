// Editable harness surfaces and the mandatory ledger trace for them.
//
// The harness-edit step's discipline (edit rows, verdicts, experience.md) is
// advisory; the FACT of a surface change is not. The server hashes the
// editable files at the accounting checkpoints (run_experiment /
// log_experiment / export_dashboard) and appends {type:"harness_edit"} rows
// for anything that moved — including changes made by hand, which no tool
// hook could see. config.json is deliberately excluded: server-managed keys
// (pendingChecksFailed, benchmarkHashes, harnessHashes itself) rewrite it
// constantly and would self-trigger noise rows.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** `.auto/`-relative keys, same key style as frozen.ts. */
export const EDITABLE_SURFACE_FILES: readonly string[] = [
  ".auto/prompt.md",
  ".auto/ideas.md",
  ".auto/experience.md",
  ".auto/hooks/before.sh",
  ".auto/hooks/after.sh",
];

export function sha256File(file: string): string | null {
  if (!existsSync(file)) return null;
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Current digests for the editable surface, keyed by `.auto/`-relative path. */
export function currentHarnessHashes(
  cwd: string,
): Record<string, string | null> {
  const hashes: Record<string, string | null> = {};
  for (const file of EDITABLE_SURFACE_FILES) {
    hashes[file] = sha256File(join(cwd, file));
  }
  return hashes;
}

/** Files whose digest moved from baseline to current. Pure, for tests. */
export function diffHarnessEdits(
  baseline: Record<string, string | null>,
  current: Record<string, string | null>,
): string[] {
  return Object.keys(current).filter((f) => baseline[f] !== current[f]);
}
