#!/usr/bin/env bash
# idea-rotator: pick the next untried idea from .auto/ideas.md (one idea per
# line, lines starting with '#' are ignored) and steer the agent to try it.
# Also checks the ledger for a shallow streak: when the recent tagged
# hypotheses (asi.hypothesis tier prefixes) are all [tune]/[ensemble] with no
# [struct], nudge the agent back to the ideation list.
# before hook. Silent when there is no ideas file or no untried ideas left.
set -euo pipefail

payload="$(cat)"

node - "$payload" <<'NODE'
const p = JSON.parse(process.argv[2]);
const fs = require('fs');
const ideasFile = `${p.cwd}/.auto/ideas.md`;
if (fs.existsSync(ideasFile)) {
  const lines = fs.readFileSync(ideasFile, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  if (lines.length > 0) {
    // Rotate using the run counter so each experiment surfaces a different idea.
    const idx = (p.session?.run_count ?? 0) % lines.length;
    console.log(`💡 untried idea to consider: ${lines[idx]}`);
    console.log('  (add/remove lines in .auto/ideas.md to control the pool)');
  }
}

// Shallow-streak check over the ledger's last (up to 6) run rows.
// Only tagged hypotheses count; untagged ones stay invisible (backward
// compatible with older ledgers). Advisory: this is a nudge, not a gate.
try {
  const ledger = `${p.cwd}/.auto/log.jsonl`;
  if (!fs.existsSync(ledger)) process.exit(0);
  const rows = fs.readFileSync(ledger, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(e => e && e.type === 'run')
    .slice(-6);
  const tagged = rows
    .map(r => String(r?.asi?.hypothesis || ''))
    .filter(h => /^\[(struct|tune|ensemble)\]/.test(h));
  if (tagged.length < 3) process.exit(0);
  const shallow = tagged.filter(h => !h.startsWith('[struct]'));
  if (shallow.length === tagged.length) {
    console.log(' ⚠️ shallow streak: the recent tagged hypotheses are all [tune]/[ensemble].');
    console.log('  Rebalance before burning more runs: pick or invent one [struct] direction');
    console.log('  (see the cold-start list in .auto/ideas.md).');
  }
} catch {
  // fail open: never block the loop over ledger-reading trouble
}
NODE
