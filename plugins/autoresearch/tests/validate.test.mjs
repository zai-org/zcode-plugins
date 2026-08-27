// Audit invariant tests: adversarial ledgers must be flagged, legal ones pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLedger } from "../mcp/lib/validate.mjs";

const cfg = { segment: 1, direction: "lower", metricName: "time_ms" };
const run = (n, over = {}) => ({
  type: "run",
  run: n,
  segment: 1,
  status: "keep",
  metric: 100,
  commit: "abc1234",
  ...over,
});

test("legal ledger: baseline keep, improvement keep, guarded discard", () => {
  const runs = [
    run(1, { status: "keep", metric: 100, commit: "a" }),
    run(2, { status: "keep", metric: 90, commit: "b" }),
    run(3, { status: "discard", metric: 95, commit: null }),
    run(4, { status: "checks_failed", metric: 80, commit: null }), // improves but guard failed → legal
    run(5, { status: "noop", metric: 80, commit: null }),
  ];
  assert.deepEqual(validateLedger(runs, cfg), []);
});

test("keep without improvement is flagged", () => {
  const runs = [
    run(1, { metric: 100, commit: "a" }),
    run(2, { metric: 100, commit: "b" }), // equal → not better (lower direction)
  ];
  const v = validateLedger(runs, cfg);
  assert.equal(v.length, 1);
  assert.equal(v[0].code, "keep_without_improvement");
  assert.equal(v[0].run, 2);
});

test("discarded improvement without failed guard is flagged", () => {
  const runs = [
    run(1, { metric: 100, commit: "a" }),
    run(2, { status: "discard", metric: 90, commit: null }), // improves, discard, no guard
  ];
  const v = validateLedger(runs, cfg);
  assert.equal(v.length, 1);
  assert.equal(v[0].code, "discarded_improvement");
});

test("event order: run numbers must be contiguous, segment must match", () => {
  const runs = [run(1, { commit: "a" }), run(3, { metric: 90, commit: "b" })]; // skips 2
  assert.ok(validateLedger(runs, cfg).some((v) => v.code === "event_order"));

  const badSeg = [
    run(1, { commit: "a" }),
    run(2, { segment: 2, metric: 90, commit: "b" }),
  ];
  assert.ok(validateLedger(badSeg, cfg).some((v) => v.code === "event_order"));
});

test("missing baseline is flagged (no config, or config.segment mismatch)", () => {
  // no config → segment undefined ≠ 1
  const v = validateLedger([run(1, { commit: "a" })], null);
  assert.ok(v.some((x) => x.code === "event_order"));
});

test("commit field consistency", () => {
  // non-keep with a commit is flagged; keep without commit is a tool-layer concern
  const discardWithCommit = [
    run(1, { commit: "a" }),
    run(2, { status: "discard", metric: 95, commit: "x" }),
  ];
  assert.ok(
    validateLedger(discardWithCommit, cfg).some(
      (v) => v.code === "commit_field",
    ),
  );
  const keepNoCommit = [run(1, { commit: null })];
  assert.deepEqual(validateLedger(keepNoCommit, cfg), []);
});

test("higher direction: improvement means larger", () => {
  const higher = { segment: 1, direction: "higher", metricName: "score" };
  const runs = [
    run(1, { metric: 10, commit: "a" }),
    run(2, { metric: 10, commit: "b" }), // equal → not better (higher)
  ];
  assert.ok(
    validateLedger(runs, higher).some(
      (v) => v.code === "keep_without_improvement",
    ),
  );
  const ok = [
    run(1, { metric: 10, commit: "a" }),
    run(2, { metric: 12, commit: "b" }),
  ];
  assert.deepEqual(validateLedger(ok, higher), []);
});
