#!/usr/bin/env bash
# hypothesis-reflection: before each run, remind the agent to state a clear
# hypothesis when the previous run recorded none (asi.hypothesis missing).
# before hook. Silent when the last run already had one.
set -euo pipefail

payload="$(cat)"

node - "$payload" <<'NODE'
const p = JSON.parse(process.argv[2]);
const last = p.last_run;
if (!last) process.exit(0);
if (last.asi && last.asi.hypothesis) process.exit(0);

console.log('🧪 The last run had no recorded hypothesis (asi.hypothesis).');
console.log('  Before this run, state in one line what you are testing and why it should help,');
console.log('  then pass it as asi.hypothesis in log_experiment.');
NODE
