#!/usr/bin/env bash
# anti-thrash: after N consecutive discards/crashes, suggest a structural rethink.
# before hook. Reads the ledger tail via stdin payload (.cwd). Silent otherwise.
#
# Contract fields used: event, cwd, last_run, session.run_count
set -euo pipefail

readonly STREAK_THRESHOLD=3

payload="$(cat)"

node - "$payload" <<'NODE'
const p = JSON.parse(process.argv[2]);
const fs = require('fs');
const log = `${p.cwd}/.auto/log.jsonl`;
if (!fs.existsSync(log)) process.exit(0);

const tail = fs.readFileSync(log, 'utf8')
  .split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
  .filter(e => e && e.type === 'run')
  .slice(-5);

// Consecutive-failure semantics match the guardrails spec: only real failures
// count; keep AND noop both break the chain.
let streak = 0;
for (const r of [...tail].reverse()) {
  if (r.status === 'keep' || r.status === 'noop') break;
  streak += 1;
}
if (streak < 3) process.exit(0);

console.log(`⚠️ ${streak} consecutive failed results. Consider:`);
console.log('  - re-reading .auto/prompt.md and the benchmark script');
console.log('  - something structurally different, not another variation of the same idea');
console.log('  - measuring where time/space is actually spent before the next change');
NODE
