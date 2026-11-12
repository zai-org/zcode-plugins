// Frozen session files and the path key the write guard compares.
//
// Keys are POSIX-style because that is how .auto/ paths are written
// everywhere else. path.relative() yields backslashes on Windows; Windows and
// macOS default to case-insensitive filesystems, so comparing the raw relative
// path against these keys would silently allow rewrites there.

export const FROZEN_FILES: ReadonlySet<string> = new Set([
  ".auto/measure.sh",
  ".auto/checks.sh",
  ".auto/goal.md",
  ".auto/scope.md",
]);

export const FROZEN_REASONS: Record<string, string> = {
  ".auto/measure.sh":
    "the benchmark metric must not change during the loop. If you really need a new metric, the recorded file must go first: have the user delete it (or delete it with an explicitly user-approved command) — this guard only protects a file that exists — then set up the new benchmark and start a new segment with init_experiment.",
  ".auto/checks.sh": "the correctness gate must not change during the loop.",
  ".auto/goal.md":
    "the deep goal is the root the loop serves; it was recorded verbatim from the user and cannot be rewritten. Surface-goal wording is revisable via the harness-edit step's editable surfaces, or a new segment via init_experiment.",
  ".auto/scope.md":
    "the scope boundary was agreed with the user and cannot be changed by the loop — widening or narrowing it is the user's call: ask them to edit this file, or init_experiment for a new segment.",
};

/**
 * Normalize a relative path to the key form used by FROZEN_FILES.
 * Windows: forward slashes + lowercase (the filesystem is case-insensitive).
 * POSIX: verbatim, so case-sensitive names stay distinct.
 */
export function frozenKey(
  rel: string,
  platform: NodeJS.Platform = process.platform,
): string {
  // Windows and macOS default to case-insensitive filesystems. Treating a
  // case variant as a different path would let .auto/MEASURE.SH slip past
  // the write guard while opening the same file; lowercasing is the safe
  // direction (a rare case-sensitive macOS volume only gets a false deny).
  if (platform !== "win32" && platform !== "darwin") return rel;
  return rel.replace(/\\/g, "/").toLowerCase();
}
