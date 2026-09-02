import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendLedgerEntry,
  rebuildState,
  readSessionConfig,
  LOG_FILE,
} from "../mcp/lib/ledger.ts";

function tempCwd() {
  return mkdtempSync(join(tmpdir(), "ar-ledger-"));
}

test("ledger appends and rebuilds segment state", () => {
  const cwd = tempCwd();
  appendLedgerEntry(cwd, {
    type: "config",
    segment: 1,
    name: "s1",
    metricName: "time_ms",
    direction: "lower",
  });
  appendLedgerEntry(cwd, {
    type: "run",
    run: 1,
    status: "keep",
    metric: 42,
    description: "baseline",
  });
  appendLedgerEntry(cwd, {
    type: "run",
    run: 2,
    status: "keep",
    metric: 40,
    description: "improved",
  });
  appendLedgerEntry(cwd, {
    type: "config",
    segment: 2,
    name: "s2",
    metricName: "size",
    direction: "lower",
  });
  appendLedgerEntry(cwd, {
    type: "run",
    run: 1,
    status: "discard",
    metric: 99,
    description: "worse",
  });

  const state = rebuildState(cwd, { maxIterations: 20 });
  assert.equal(state.segment, 2);
  assert.equal(state.runs.length, 1); // only segment 2's run
  assert.equal(state.runs[0].status, "discard");
  assert.equal(state.baseline, 99);
  assert.equal(state.best, null); // best only counts kept runs
  assert.equal(state.consecutiveFailures, 1);
  assert.equal(state.maxIterations, 20);
});

test("best tracks direction and only kept runs", () => {
  const cwd = tempCwd();
  appendLedgerEntry(cwd, {
    type: "config",
    segment: 1,
    name: "s",
    metricName: "m",
    direction: "lower",
  });
  appendLedgerEntry(cwd, { type: "run", run: 1, status: "keep", metric: 10 });
  appendLedgerEntry(cwd, { type: "run", run: 2, status: "discard", metric: 5 }); // better but reverted
  appendLedgerEntry(cwd, { type: "run", run: 3, status: "keep", metric: 8 });

  const state = rebuildState(cwd);
  assert.equal(state.baseline, 10);
  assert.equal(state.best, 8); // 5 was discarded, not counted
});

test("lastRunChecksFailed is set by a failed check", () => {
  const cwd = tempCwd();
  appendLedgerEntry(cwd, {
    type: "config",
    segment: 1,
    name: "s",
    metricName: "m",
    direction: "lower",
  });
  appendLedgerEntry(cwd, {
    type: "run",
    run: 1,
    status: "checks_failed",
    metric: 42,
    checksFailed: true,
  });
  const state = rebuildState(cwd);
  assert.equal(state.lastRunChecksFailed, true);
  assert.equal(state.consecutiveFailures, 1);
});

test("lastRunChecksFailed follows the latest run (no one-way latch)", () => {
  const cwd = tempCwd();
  appendLedgerEntry(cwd, {
    type: "config",
    segment: 1,
    name: "s",
    metricName: "m",
    direction: "lower",
  });
  // status alone marks checks failure (no checksFailed field needed)
  appendLedgerEntry(cwd, {
    type: "run",
    run: 1,
    status: "checks_failed",
    metric: 42,
  });
  assert.equal(rebuildState(cwd).lastRunChecksFailed, true);
  // a subsequent checks-passing run resets the flag (overwrite, not latch)
  appendLedgerEntry(cwd, {
    type: "run",
    run: 2,
    status: "keep",
    metric: 40,
    commit: "abc1234",
  });
  assert.equal(rebuildState(cwd).lastRunChecksFailed, false);
});

test("session config file is read", () => {
  const cwd = tempCwd();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto/config.json"),
    JSON.stringify({ maxIterations: 5 }),
  );
  assert.equal(readSessionConfig(cwd).maxIterations, 5);
  assert.deepEqual(readSessionConfig(tempCwd()), {});
});

test("rebuild from empty cwd yields empty state", () => {
  const state = rebuildState(tempCwd(), { maxIterations: 20 });
  assert.equal(state.segment, 0);
  assert.equal(state.runs.length, 0);
  assert.equal(state.config, null);
  assert.ok(!existsSync(join(tempCwd(), LOG_FILE)));
});

test("rebuildState: noop resets the consecutive-failure streak without counting", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ar-ledger-"));
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  appendLedgerEntry(cwd, {
    type: "config",
    segment: 1,
    name: "t",
    metricName: "time_ms",
    direction: "lower",
  });
  appendLedgerEntry(cwd, {
    type: "run",
    run: 1,
    status: "discard",
    metric: 99,
  });
  appendLedgerEntry(cwd, {
    type: "run",
    run: 2,
    status: "crash",
    metric: null,
  });
  let state = rebuildState(cwd);
  assert.equal(state.consecutiveFailures, 2);
  appendLedgerEntry(cwd, { type: "run", run: 3, status: "noop", metric: null });
  state = rebuildState(cwd);
  assert.equal(state.consecutiveFailures, 0); // noop breaks the chain
  appendLedgerEntry(cwd, {
    type: "run",
    run: 4,
    status: "discard",
    metric: 98,
  });
  state = rebuildState(cwd);
  assert.equal(state.consecutiveFailures, 1); // restarts from zero
});
