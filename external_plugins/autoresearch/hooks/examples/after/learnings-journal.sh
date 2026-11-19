#!/usr/bin/env bash
# learnings-journal: append one markdown line per experiment to
# .auto/learnings.md — a human-readable diary that survives the loop.
# after hook. Pure side effect, no steer.
set -euo pipefail

payload="$(cat)"

node - "$payload" <<'NODE'
const p = JSON.parse(process.argv[2]);
const fs = require('fs');
const path = require('path');
const run = p.run_entry;
const journal = `${p.cwd}/.auto/learnings.md`;
fs.mkdirSync(path.dirname(journal), { recursive: true });
// One markdown line per experiment: fold newlines in model-written
// descriptions, or the entry spans lines and breaks the diary format
const desc = (run.description ?? '').replace(/\r?\n/g, ' ');
const line = `- run ${run.run} [${run.status}] metric=${run.metric ?? '—'}: ${desc}`;
fs.appendFileSync(journal, line + '\n');
NODE
