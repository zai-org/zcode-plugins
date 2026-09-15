#!/usr/bin/env bash
# idea-rotator: pick the next untried idea from .auto/ideas.md (one idea per
# line, lines starting with '#' are ignored) and steer the agent to try it.
# before hook. Silent when there is no ideas file or no untried ideas left.
set -euo pipefail

payload="$(cat)"

node - "$payload" <<'NODE'
const p = JSON.parse(process.argv[2]);
const fs = require('fs');
const ideasFile = `${p.cwd}/.auto/ideas.md`;
if (!fs.existsSync(ideasFile)) process.exit(0);

const lines = fs.readFileSync(ideasFile, 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

if (lines.length === 0) process.exit(0);

// Rotate using the run counter so each experiment surfaces a different idea.
const idx = (p.session?.run_count ?? 0) % lines.length;
console.log(`💡 untried idea to consider: ${lines[idx]}`);
console.log('  (add/remove lines in .auto/ideas.md to control the pool)');
NODE
