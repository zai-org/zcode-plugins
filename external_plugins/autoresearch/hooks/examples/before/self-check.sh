#!/usr/bin/env bash
# self-check: wall-clock self-assessment for long sessions. When more than
# CHECK_INTERVAL seconds have passed since the last self-check (tracked in
# .auto/selfcheck.state, created on demand), inject a short diagnostic
# checklist — am I still doing structural work, or drifting into shallow
# tuning? Most useful in unattended/overnight runs; harmless otherwise.
# before hook. Silent when the interval has not elapsed or the session has
# no started_at epoch (older ledgers).
set -euo pipefail

payload="$(cat)"

CHECK_INTERVAL="${AUTORESEARCH_SELF_CHECK_INTERVAL:-3600}"

node - "$payload" "$CHECK_INTERVAL" <<'NODE'
const p = JSON.parse(process.argv[2]);
const interval = Number(process.argv[3]) || 3600;
const fs = require('fs');

const started = p.session?.started_at_epoch;
if (!started) process.exit(0); // older ledger: no segment clock, stay silent

const stateFile = `${p.cwd}/.auto/selfcheck.state`;
let last = 0;
try { last = Number(fs.readFileSync(stateFile, 'utf8').trim()) || 0; } catch {}

const now = Math.floor(Date.now() / 1000);
if (now - last < interval) process.exit(0);

try { fs.writeFileSync(stateFile, String(now)); } catch {}

console.log('🕐 hourly self-check — answer these briefly before the next run:');
console.log('  1. Is my current direction structural work, or shallow tuning in disguise?');
console.log('  2. Did recent failures get a root-cause analysis, or did I just reach for the safest next move?');
console.log('  3. Is there an insight in the ledger (a near-miss, an unexplained delta) I have not acted on?');
console.log('  4. Given the time left: is my frontrunner truly my best candidate, or just the most familiar one?');
console.log('  If any answer points at drift, course-correct now (cold-start list in .auto/ideas.md).');
NODE
