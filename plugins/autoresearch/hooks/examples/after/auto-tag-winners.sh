#!/usr/bin/env bash
# auto-tag-winners: tag every new best with a sortable git tag so
# `git log --tags` reads as a progression record. after hook.
# Pure side effect — no steer output.
set -euo pipefail

payload="$(cat)"

node - "$payload" <<'NODE'
const { execFileSync } = require('child_process');
const p = JSON.parse(process.argv[2]);
const run = p.run_entry;
const session = p.session;
if (run.status !== 'keep') process.exit(0);
const best = session?.best_metric;
if (best == null || run.metric == null) process.exit(0);
if (run.metric !== best) process.exit(0); // not a new best
const tag = `autoresearch/best-run-${run.run}-${run.metric}`;
try {
  execFileSync('git', ['-C', p.cwd, 'tag', '-f', tag], { stdio: 'ignore' });
} catch {
  /* not a git repo → silent */
}
NODE
