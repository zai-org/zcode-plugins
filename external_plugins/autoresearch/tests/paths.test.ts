// resolveWorkCwd contract: silent fallback only when no workingDir is
// configured; loud failure when a configured target is unusable. Regression
// (evidence 2026-11-04, reproduced): a missing/typo'd workingDir silently
// repointed every operation — including rollback's `checkout HEAD -- .` and
// `clean -fd` — at the project root, the one real data-loss path in the
// rollback review.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkCwd } from "../mcp/lib/paths.ts";

function tempProject(): string {
  const proj = mkdtempSync(join(tmpdir(), "ar-paths-"));
  mkdirSync(join(proj, ".auto"), { recursive: true });
  return proj;
}

function withCapturedStderr<T>(fn: () => T): { value: T; stderr: string } {
  const orig = process.stderr.write;
  let stderr = "";
  process.stderr.write = ((chunk: string) => {
    stderr += chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    return { value: fn(), stderr };
  } finally {
    process.stderr.write = orig;
  }
}

test("resolveWorkCwd: no config → silent fallback to the project dir", () => {
  const proj = tempProject();
  const { value, stderr } = withCapturedStderr(() => resolveWorkCwd(proj));
  assert.equal(value, proj);
  assert.equal(stderr, "", "absent config is the normal case: no noise");
});

test("resolveWorkCwd: valid workingDir → resolved target", () => {
  const proj = tempProject();
  mkdirSync(join(proj, "bench"));
  writeFileSync(
    join(proj, ".auto", "config.json"),
    JSON.stringify({ workingDir: "bench" }),
  );
  assert.equal(resolveWorkCwd(proj), join(proj, "bench"));
});

test("resolveWorkCwd: configured but missing target → throws with the path", () => {
  const proj = tempProject();
  writeFileSync(
    join(proj, ".auto", "config.json"),
    JSON.stringify({ workingDir: "nonexistent-subdir" }),
  );
  assert.throws(
    () => resolveWorkCwd(proj),
    (err: Error) =>
      /nonexistent-subdir/.test(err.message) &&
      /missing or not a directory/.test(err.message),
  );
});

test("resolveWorkCwd: corrupt config.json → fallback + stderr diagnostic", () => {
  const proj = tempProject();
  // unescaped Windows-style path: JSON.parse fails
  writeFileSync(join(proj, ".auto", "config.json"), '{"workingDir": "C:\\w"}');
  const { value, stderr } = withCapturedStderr(() => resolveWorkCwd(proj));
  assert.equal(value, proj);
  assert.match(stderr, /not valid JSON/);
});
