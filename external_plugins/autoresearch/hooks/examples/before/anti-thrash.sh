#!/usr/bin/env bash
# anti-thrash: after N consecutive discards/crashes, suggest a structural rethink.
# before hook. Reads the ledger tail via stdin payload (.cwd). Silent otherwise.
#
# Contract fields used: event, cwd, last_run, session.run_count
set -euo pipefail

readonly STREAK_THRESHOLD=3
readonly WINDOW=5

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

let streak = 0;
for (const r of [...tail].reverse()) {
  if (r.status === 'keep') break;
  streak += 1;
}
if (streak < 3) process.exit(0);

console.log(`⚠️ ${streak} consecutive non-keep results. Consider:`);
console.log('  - re-reading .auto/prompt.md and the benchmark script');
console.log('  - something structurally different, not another variation of the same idea');
console.log('  - measuring where time/space is actually spent before the next change');
NODE
