// Spill-file hygiene for run_experiment's output overflow (server.ts).
// A spilled benchmark log is read at most until the tool call returns its
// tail — afterwards it only lingers in the OS temp dir (which Windows in
// particular never cleans) holding disk space and whatever the benchmark
// printed. Sweeping stale files at spill time bounds the accumulation
// without touching the file the current call is about to write.
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const SPILL_FILE_PREFIX = "autoresearch-experiment-";

/**
 * Delete spilled experiment logs older than maxAgeMs. Best-effort: an
 * unreadable temp dir or a file racing with another sweeper must never fail
 * the benchmark run the sweep rides on. Returns how many files were removed.
 */
export function sweepStaleSpillFiles(
  dir: string,
  maxAgeMs: number,
  now: number,
): number {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith(SPILL_FILE_PREFIX) || !name.endsWith(".log")) continue;
    const file = join(dir, name);
    try {
      if (now - statSync(file).mtimeMs > maxAgeMs) {
        unlinkSync(file);
        removed += 1;
      }
    } catch {
      /* gone or locked — leave it for the next sweep */
    }
  }
  return removed;
}
