import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPILL_FILE_PREFIX, sweepStaleSpillFiles } from "../mcp/lib/spill.ts";

test("sweepStaleSpillFiles removes stale spill logs, keeps fresh and foreign files", () => {
  const dir = mkdtempSync(join(tmpdir(), "ar-spill-"));
  const now = 1_000_000_000_000;
  const week = 7 * 24 * 3600 * 1000;
  const stale = join(dir, `${SPILL_FILE_PREFIX}123-456.log`);
  const fresh = join(dir, `${SPILL_FILE_PREFIX}123-457.log`);
  const foreign = join(dir, "unrelated.log");
  for (const f of [stale, fresh, foreign]) writeFileSync(f, "x");
  const staleDate = new Date(now - week - 3_600_000);
  utimesSync(stale, staleDate, staleDate);
  utimesSync(fresh, new Date(now), new Date(now));
  // Exactly at the boundary is not stale (strictly older than maxAge).
  const boundary = join(dir, `${SPILL_FILE_PREFIX}123-458.log`);
  writeFileSync(boundary, "x");
  const boundaryDate = new Date(now - week);
  utimesSync(boundary, boundaryDate, boundaryDate);

  const removed = sweepStaleSpillFiles(dir, week, now);
  assert.equal(removed, 1);
  assert.deepEqual(readdirSync(dir).sort(), [
    `${SPILL_FILE_PREFIX}123-457.log`,
    `${SPILL_FILE_PREFIX}123-458.log`,
    "unrelated.log",
  ]);
});

test("sweepStaleSpillFiles swallows an unreadable dir (best-effort)", () => {
  assert.equal(
    sweepStaleSpillFiles(join(tmpdir(), "ar-spill-missing-zz"), 1, 1),
    0,
  );
});
