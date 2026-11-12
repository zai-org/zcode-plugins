import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendLedgerEntry,
  readLedger,
  rebuildHistory,
  rebuildState,
  readSessionConfig,
  LOG_FILE,
} from "../mcp/lib/ledger.ts";
import { validateLedger } from "../mcp/lib/validate.ts";

function tempCwd() {
  return mkdtempSync(join(tmpdir(), "ar-ledger-"));
}

// Regression (evidence 2026-11-04): a write killed mid-line left the ledger
// without a trailing newline; the next append spliced two records into one
// line, corrupting BOTH, and readLedger dropped the result silently — later
// run numbers shifted and the audit rejected every write with an error that
// could not point at the real cause.
test("append heals a missing trailing newline; corrupt lines are diagnosed on read", () => {
  const cwd = tempCwd();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  const truncated = '{"type":"run","ts":"2026-01-01T00:00:00.000Z","run":1';
  writeFileSync(join(cwd, LOG_FILE), truncated); // no trailing \n

  appendLedgerEntry(cwd, {
    type: "run",
    ts: "2026-01-01T00:00:01.000Z",
    run: 2,
    status: "keep",
    metric: 1,
    description: "d",
  } as never);

  // the new entry is its own line, not spliced onto the truncated one
  const raw = readFileSync(join(cwd, LOG_FILE), "utf8");
  assert.equal(
    raw.split("\n").filter((l) => l.trim()).length,
    2,
    "appended entry must not be concatenated onto the truncated line",
  );

  // reading diagnoses the corrupt line (line number + content snippet) and
  // returns every parseable entry
  const origWrite = process.stderr.write;
  let diag = "";
  process.stderr.write = ((chunk: string) => {
    diag += chunk;
    return true;
  }) as typeof process.stderr.write;
  let entries;
  try {
    entries = readLedger(cwd);
  } finally {
    process.stderr.write = origWrite;
  }
  assert.equal(entries.length, 1);
  assert.equal((entries[0] as { run?: number }).run, 2);
  assert.match(diag, /line 1 is corrupt/);
});

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

test("checks_failed counts toward the consecutive-failure streak", () => {
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
  assert.equal(state.consecutiveFailures, 1);
});

test("keep resets the consecutive-failure streak (no one-way latch)", () => {
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
  assert.equal(rebuildState(cwd).consecutiveFailures, 1);
  // a subsequent keep breaks the streak (overwrite, not latch)
  appendLedgerEntry(cwd, {
    type: "run",
    run: 2,
    status: "keep",
    metric: 40,
    commit: "abc1234",
  });
  assert.equal(rebuildState(cwd).consecutiveFailures, 0);
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

test("legacy rows without a confidence field replay through rebuildState and the audit", () => {
  const cwd = tempCwd();
  appendLedgerEntry(cwd, {
    type: "config",
    segment: 1,
    name: "s",
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
  const state = rebuildState(cwd, { maxIterations: 20 });
  assert.equal(state.runs.length, 2);
  assert.equal(state.runs[0].confidence, undefined); // legacy row: absent, tolerated
  assert.equal(state.baseline, 42);
  assert.equal(state.best, 40);
  assert.deepEqual(validateLedger(state.runs, state.config), []);
});

test("config boundary resets the failure streak and last run", () => {
  const cwd = tempCwd();
  appendLedgerEntry(cwd, {
    type: "config",
    segment: 1,
    name: "s1",
    metricName: "m",
    direction: "lower",
  });
  appendLedgerEntry(cwd, {
    type: "run",
    run: 1,
    status: "discard",
    metric: 10,
  });
  appendLedgerEntry(cwd, {
    type: "run",
    run: 2,
    status: "crash",
    metric: null,
  });
  appendLedgerEntry(cwd, {
    type: "config",
    segment: 2,
    name: "s2",
    metricName: "m",
    direction: "lower",
  });
  appendLedgerEntry(cwd, {
    type: "run",
    run: 1,
    status: "discard",
    metric: 20,
  });

  const state = rebuildState(cwd, {
    maxIterations: 20,
    consecutiveFailures: 3,
  });
  assert.equal(state.segment, 2);
  assert.equal(state.runs.length, 1);
  assert.equal(state.consecutiveFailures, 1); // not 3 from segment 1
  assert.equal(state.lastRun?.run, 1);
  assert.equal(state.lastRun?.status, "discard");
});

// Regression (worth-fix 2026-11-07): pre-ADR-10 ledgers record crash rows with
// a 0 placeholder. The metric collectors only looked at `metric != null`, so
// the placeholder became the baseline (0) and skewed confidence, while
// validateLedger (which already skipped crash rows) disagreed with the same
// ledger. Replay excludes crash rows everywhere; the append-only file itself
// is never rewritten.
test("legacy crash placeholder rows stay out of baseline/confidence/history", () => {
  const cwd = tempCwd();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(
    join(cwd, LOG_FILE),
    [
      JSON.stringify({
        type: "config",
        segment: 1,
        name: "t",
        metricName: "time_ms",
        direction: "lower",
      }),
      JSON.stringify({ type: "run", run: 1, status: "crash", metric: 0 }),
      JSON.stringify({ type: "run", run: 2, status: "keep", metric: 42 }),
      JSON.stringify({ type: "run", run: 3, status: "keep", metric: 40 }),
    ].join("\n") + "\n",
  );

  const state = rebuildState(cwd);
  assert.equal(
    state.baseline,
    42,
    "crash placeholder 0 must not become the baseline",
  );
  // The value set excludes the placeholder: 2 finite values remain, below the
  // 3-value confidence floor — null instead of a 0-skewed number.
  assert.equal(state.confidence, null);

  const history = rebuildHistory(readLedger(cwd));
  assert.equal(history.firstMetric, 42);
  assert.equal(history.confidence, null);
});

test("crash rows still count toward the failure streak (exclusion is metric-scoped)", () => {
  const cwd = tempCwd();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(
    join(cwd, LOG_FILE),
    [
      JSON.stringify({
        type: "config",
        segment: 1,
        name: "t",
        metricName: "m",
        direction: "lower",
      }),
      JSON.stringify({ type: "run", run: 1, status: "crash", metric: 0 }),
      JSON.stringify({ type: "run", run: 2, status: "crash", metric: null }),
      JSON.stringify({ type: "run", run: 3, status: "crash", metric: null }),
    ].join("\n") + "\n",
  );
  const state = rebuildState(cwd);
  assert.equal(state.consecutiveFailures, 3);
  assert.equal(state.baseline, null); // nothing was measured
});

// Regression (worth-fix 2026-11-11, segment dota2-logloss run 6): a
// deterministic benchmark (bitwise reproducible) has a single-point noise
// band — the pooled outcome spread across experiments is effect size, not
// noise, so rebuildState must not report a confidence ratio for it.
test("rebuildState suppresses confidence for a deterministic benchmark", () => {
  const cwd = tempCwd();
  appendLedgerEntry(cwd, {
    type: "config",
    segment: 1,
    name: "s",
    metricName: "time_ms",
    direction: "lower",
  });
  appendLedgerEntry(cwd, {
    type: "run",
    run: 1,
    status: "noop",
    metric: 42,
    description: "baseline",
  });
  appendLedgerEntry(cwd, {
    type: "run",
    run: 2,
    status: "discard",
    metric: 44,
    description: "worse",
  });
  appendLedgerEntry(cwd, {
    type: "run",
    run: 3,
    status: "keep",
    metric: 41,
    description: "improved",
  });
  const noisy = rebuildState(cwd, {});
  assert.ok(noisy.confidence);
  const exact = rebuildState(cwd, { deterministic: true });
  assert.equal(exact.confidence, null);
});
