#!/usr/bin/env bash
# macos-notify: post a macOS notification when an experiment completes.
# after hook. macOS only (osascript); silently no-ops elsewhere.
# Pure side effect — no steer output.
set -euo pipefail

payload="$(cat)"

node - "$payload" <<'NODE'
const { execFileSync } = require('child_process');
const p = JSON.parse(process.argv[2]);
const run = p.run_entry;
const session = p.session;
const title = `autoresearch run ${run.run}: ${run.status}`;
const body = `metric=${run.metric ?? '—'} (best=${session?.best_metric ?? '—'}) ${run.description ?? ''}`;
// AppleScript string literal: escape backslashes FIRST (else the quote escape
// itself gets escaped), then quotes; fold newlines — a literal newline inside
// an AppleScript string is a syntax error.
const esc = (s) =>
  s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
try {
  execFileSync('osascript', ['-e', `display notification "${esc(body)}" with title "${esc(title)}"`], { stdio: 'ignore' });
} catch {
  /* no osascript (non-macOS) → silent */
}
NODE
