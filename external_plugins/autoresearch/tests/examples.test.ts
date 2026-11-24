// Example hook contract tests: each example must work with a mock payload
// (copy-and-run contract), staying silent when there is nothing to say.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { RunLike } from "../mcp/lib/types.ts";
import { resolveBash } from "../mcp/lib/bash.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EX = join(ROOT, "hooks", "examples");

function runExample(name: string, cwd: string, stdin: string): string {
  return execFileSync(resolveBash(), [join(EX, name)], {
    input: stdin,
    encoding: "utf8",
  });
}

function tempCwd(): string {
  return mkdtempSync(join(tmpdir(), "ar-ex-"));
}

function seedLedger(cwd: string, runs: RunLike[]): void {
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "log.jsonl"),
    runs.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}

const beforePayload = (cwd: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    event: "before",
    cwd,
    next_run: 1,
    last_run: null,
    session: { run_count: 0 },
    ...extra,
  });
const afterPayload = (
  cwd: string,
  run: unknown,
  session: Record<string, unknown> = {},
) => JSON.stringify({ event: "after", cwd, run_entry: run, session });

test("anti-thrash: suggests a rethink after 3 consecutive failures, silent otherwise", () => {
  const cwd = tempCwd();
  seedLedger(
    cwd,
    ["discard", "crash", "discard"].map((s) => ({
      type: "run",
      run: 1,
      status: s,
      metric: 1,
    })),
  );
  const out = runExample("before/anti-thrash.sh", cwd, beforePayload(cwd));
  assert.match(out, /consecutive failed results/);
  // single failure → silent
  seedLedger(cwd, [{ type: "run", run: 1, status: "discard", metric: 1 }]);
  assert.equal(
    runExample("before/anti-thrash.sh", cwd, beforePayload(cwd)),
    "",
  );
  // noop breaks the failure chain (guardrails spec: noop is not a failure)
  seedLedger(
    cwd,
    ["discard", "crash", "noop", "discard", "crash"].map((s) => ({
      type: "run",
      run: 1,
      status: s,
      metric: 1,
    })),
  );
  assert.equal(
    runExample("before/anti-thrash.sh", cwd, beforePayload(cwd)),
    "",
    "noop must break the streak: tail is only 2 consecutive failures",
  );
});

test("idea-rotator: surfaces one untried idea, silent without an ideas file", () => {
  const cwd = tempCwd();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  writeFileSync(
    join(cwd, ".auto", "ideas.md"),
    "# pool\nsieve with wheel\nodd-only array\n",
  );
  const out = runExample(
    "before/idea-rotator.sh",
    cwd,
    beforePayload(cwd, { session: { run_count: 1 } }),
  );
  assert.match(out, /odd-only array/);
  // no ideas file → silent
  const bare = tempCwd();
  assert.equal(
    runExample("before/idea-rotator.sh", bare, beforePayload(bare)),
    "",
  );
});

test("hypothesis-reflection: reminds when last run lacked a hypothesis", () => {
  const cwd = tempCwd();
  const noHyp = beforePayload(cwd, {
    last_run: { run: 1, status: "keep", metric: 5, description: "x" },
  });
  assert.match(
    runExample("before/hypothesis-reflection.sh", cwd, noHyp),
    /no recorded hypothesis/,
  );
  const withHyp = beforePayload(cwd, {
    last_run: { run: 1, status: "keep", metric: 5, asi: { hypothesis: "h" } },
  });
  assert.equal(runExample("before/hypothesis-reflection.sh", cwd, withHyp), "");
  assert.equal(
    runExample("before/hypothesis-reflection.sh", cwd, beforePayload(cwd)),
    "",
  ); // no last run
});

test("learnings-journal: appends one markdown line per run", () => {
  const cwd = tempCwd();
  runExample(
    "after/learnings-journal.sh",
    cwd,
    afterPayload(cwd, {
      run: 1,
      status: "keep",
      metric: 42,
      description: "first",
    }),
  );
  const journal = readFileSync(join(cwd, ".auto", "learnings.md"), "utf8");
  assert.match(journal, /run 1 \[keep\] metric=42: first/);
});

test("auto-tag-winners: tags a new best, silent otherwise", () => {
  const cwd = tempCwd();
  execFileSync("git", ["init", "-q"], { cwd, stdio: "ignore" });
  // CI runners have no global git identity — commits need a local one — and
  // Windows runners default core.autocrlf=true, which checkout would apply
  for (const a of [
    ["config", "core.autocrlf", "false"],
    ["config", "user.email", "t@t"],
    ["config", "user.name", "t"],
  ]) {
    execFileSync("git", a, { cwd, stdio: "ignore" });
  }
  writeFileSync(join(cwd, "f.js"), "x\n");
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-qm", "init"], { cwd, stdio: "ignore" });
  // new best → tag created
  runExample(
    "after/auto-tag-winners.sh",
    cwd,
    afterPayload(
      cwd,
      { run: 3, status: "keep", metric: 10 },
      { best_metric: 10 },
    ),
  );
  const tags = execFileSync("git", ["-C", cwd, "tag", "--list"], {
    encoding: "utf8",
  });
  assert.match(tags, /autoresearch\/best-run-3-10/);
  // not a new best → no tag
  const before = tags;
  runExample(
    "after/auto-tag-winners.sh",
    cwd,
    afterPayload(
      cwd,
      { run: 4, status: "keep", metric: 12 },
      { best_metric: 10 },
    ),
  );
  assert.equal(
    execFileSync("git", ["-C", cwd, "tag", "--list"], { encoding: "utf8" }),
    before,
  );
});

test("macos-notify: silent side effect (no steer output)", () => {
  const out = runExample(
    "after/macos-notify.sh",
    tempCwd(),
    afterPayload(
      tempCwd(),
      { run: 1, status: "keep", metric: 1 },
      { best_metric: 1 },
    ),
  );
  assert.equal(out, "");
});

test("idea-rotator: warns on a shallow streak (recent tagged hypotheses all tune/ensemble)", () => {
  const cwd = tempCwd();
  seedLedger(cwd, [
    {
      type: "run",
      run: 1,
      status: "keep",
      metric: 1,
      asi: { hypothesis: "[tune] raise lr" },
    },
    {
      type: "run",
      run: 2,
      status: "discard",
      metric: 2,
      asi: { hypothesis: "[ensemble] seed sweep" },
    },
    {
      type: "run",
      run: 3,
      status: "keep",
      metric: 3,
      asi: { hypothesis: "[tune] weight decay 0.05" },
    },
  ] as RunLike[]);
  assert.match(
    runExample("before/idea-rotator.sh", cwd, beforePayload(cwd)),
    /shallow streak/,
  );
  // a [struct] hypothesis in the window → no warning (rotation advice unaffected)
  seedLedger(cwd, [
    {
      type: "run",
      run: 1,
      status: "keep",
      metric: 1,
      asi: { hypothesis: "[struct] replace scheduler with early stopping" },
    },
    {
      type: "run",
      run: 2,
      status: "keep",
      metric: 2,
      asi: { hypothesis: "[tune] raise lr" },
    },
    {
      type: "run",
      run: 3,
      status: "keep",
      metric: 3,
      asi: { hypothesis: "[ensemble] seed sweep" },
    },
  ] as RunLike[]);
  assert.doesNotMatch(
    runExample("before/idea-rotator.sh", cwd, beforePayload(cwd)),
    /shallow streak/,
  );
  // fewer than 3 tagged hypotheses in the window → silent
  seedLedger(cwd, [
    {
      type: "run",
      run: 1,
      status: "keep",
      metric: 1,
      asi: { hypothesis: "[tune] raise lr" },
    },
  ] as RunLike[]);
  assert.equal(
    runExample("before/idea-rotator.sh", cwd, beforePayload(cwd)),
    "",
  );
});

test("self-check: hourly checklist on the wall clock, silent within the interval", () => {
  const cwd = tempCwd();
  mkdirSync(join(cwd, ".auto"), { recursive: true });
  const epoch = Math.floor(Date.now() / 1000);
  const out = runExample(
    "before/self-check.sh",
    cwd,
    beforePayload(cwd, { session: { run_count: 0, started_at_epoch: epoch } }),
  );
  assert.match(out, /self-check/);
  assert.match(out, /structural work/);
  // the check is recorded so the next run within the interval stays silent
  assert.ok(
    Number(readFileSync(join(cwd, ".auto", "selfcheck.state"), "utf8")) > 0,
  );
  assert.equal(
    runExample(
      "before/self-check.sh",
      cwd,
      beforePayload(cwd, {
        session: { run_count: 1, started_at_epoch: epoch },
      }),
    ),
    "",
  );
  // no started_at_epoch (older ledger) → silent, no state file
  const bare = tempCwd();
  mkdirSync(join(bare, ".auto"), { recursive: true });
  assert.equal(
    runExample("before/self-check.sh", bare, beforePayload(bare)),
    "",
  );
  assert.equal(existsSync(join(bare, ".auto", "selfcheck.state")), false);
});
