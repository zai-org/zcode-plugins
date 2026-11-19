// Regression: the write guard compared the raw relative path against POSIX
// keys. On Windows path.relative() returns ".auto\\goal.md" and the filesystem
// is case-insensitive, so every frozen file passed the guard. These assertions
// call the same key function the hook uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { win32 } from "node:path";
import { FROZEN_FILES, FROZEN_REASONS, frozenKey } from "../mcp/lib/frozen.ts";

test("frozenKey maps win32 relative paths onto the frozen key set", () => {
  const cwd = "C:\\work\\repo";
  for (const target of ["measure.sh", "checks.sh", "goal.md", "scope.md"]) {
    for (const fp of [
      `${cwd}\\.auto\\${target}`, // canonical win32
      `${cwd}\\.auto/${target}`, // mixed separators
      `${cwd}\\.auto\\${target.toUpperCase()}`, // case-insensitive filesystem
    ]) {
      const rel = win32.relative(cwd, win32.resolve(cwd, fp));
      const key = frozenKey(rel, "win32");
      assert.ok(FROZEN_FILES.has(key), `${fp} -> ${rel} -> ${key}`);
      assert.ok(FROZEN_REASONS[key], `missing deny reason for ${key}`);
    }
  }
});

test("frozenKey leaves POSIX paths case-sensitive and verbatim", () => {
  assert.equal(frozenKey(".auto/goal.md", "linux"), ".auto/goal.md");
  assert.equal(frozenKey(".auto/Goal.md", "linux"), ".auto/Goal.md");
  assert.ok(!FROZEN_FILES.has(frozenKey(".auto/Goal.md", "linux")));
});

test("frozenKey normalizes case on macOS (case-insensitive APFS)", () => {
  // macOS is POSIX but its default filesystem is case-insensitive; without
  // this normalization, writing .auto/MEASURE.SH bypasses the guard.
  for (const target of ["measure.sh", "checks.sh", "goal.md", "scope.md"]) {
    const upper = `.auto/${target.toUpperCase()}`;
    assert.equal(frozenKey(upper, "darwin"), `.auto/${target}`);
    assert.ok(FROZEN_FILES.has(frozenKey(upper, "darwin")));
  }
});
