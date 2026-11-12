#!/usr/bin/env node
// PreToolUse hook: deny writes to frozen session files — the benchmark
// scripts (.auto/measure.sh, .auto/checks.sh), the deep-goal record
// (.auto/goal.md) and the user-agreed scope boundary (.auto/scope.md).
// The matcher limits this to Write|Edit|ApplyPatch; path filtering happens
// here, per zcode docs. Write/Edit carry file_path/path; ApplyPatch carries
// only patch_text, so its per-file target lines are parsed here — otherwise
// the patch tool would bypass the guard entirely (evidence 2026-11-04:
// ApplyPatch on a frozen file exited 0 with no deny and no frozen_attempt).
import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import { resolveWorkCwd } from "../mcp/lib/paths.ts";
import { FROZEN_FILES, FROZEN_REASONS, frozenKey } from "../mcp/lib/frozen.ts";
import { appendLedgerEntry } from "../mcp/lib/ledger.ts";

interface PreToolUseInput {
  tool_name?: string;
  tool_input?: { file_path?: string; path?: string; patch_text?: string };
  toolInput?: { file_path?: string; path?: string; patch_text?: string };
}

const projectCwd = process.argv[2] || process.cwd();
let cwd: string;
try {
  cwd = resolveWorkCwd(projectCwd);
} catch (err) {
  // Hook discipline: fail open, but never silently — an invalid workingDir is
  // a misconfiguration the user must see (stderr is the diagnostic channel).
  process.stderr.write(
    `[autoresearch] ${err instanceof Error ? err.message : String(err)}\n`,
  );
  cwd = projectCwd;
}

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin as AsyncIterable<string>) raw += chunk;

let input: PreToolUseInput = {};
try {
  input = raw.trim() ? (JSON.parse(raw) as PreToolUseInput) : {};
} catch {
  process.exit(0); // fail open
}

const ti = input.tool_input || input.toolInput || {};

// Target paths of an ApplyPatch payload: the *** <op> File: headers plus the
// *** Move to: destination. Best-effort by design — an unparseable patch falls
// through to "no candidates" and is allowed (fail-open discipline unchanged).
function patchTargets(patchText: string): string[] {
  const out: string[] = [];
  for (const line of patchText.split(/\r?\n/)) {
    const m =
      /^\*\*\* (?:Update|Add|Delete|Move) File: (.+)$/.exec(line) ??
      /^\*\*\* Move to: (.+)$/.exec(line);
    if (m) out.push(m[1].trim());
  }
  return out;
}

const direct = ti.file_path || ti.path;
const candidates: string[] = direct
  ? [String(direct)]
  : typeof ti.patch_text === "string"
    ? patchTargets(ti.patch_text)
    : [];
if (candidates.length === 0) process.exit(0);

// Frozen means "immutable once recorded", not "never written": setup creates
// these files (goal/scope verbatim from the user) before any segment exists.
// What the guard blocks is rewriting a record already on disk.
const hits: string[] = [];
for (const fp of candidates) {
  let rel: string;
  try {
    rel = frozenKey(relative(cwd, resolve(cwd, fp)));
  } catch {
    continue;
  }
  if (!FROZEN_FILES.has(rel)) continue;
  if (!existsSync(resolve(cwd, rel))) continue;
  if (!hits.includes(rel)) hits.push(rel);
}
if (hits.length === 0) process.exit(0);

// The attempt itself is a fact: a denied rewrite of a frozen record goes to
// the ledger, so goalpost-moving shows up in the archive instead of vanishing
// with the denied tool call. Bookkeeping must never gate the guard — a failed
// ledger write still denies.
let traced = true;
for (const rel of hits) {
  try {
    appendLedgerEntry(cwd, {
      type: "frozen_attempt",
      ts: new Date().toISOString(),
      file: rel,
      tool: input.tool_name ?? null,
    });
  } catch {
    traced = false;
  }
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `[autoresearch] ${hits.join(", ")} ${
        hits.length === 1 ? "is" : "are"
      } frozen: ${hits
        .map((rel) => FROZEN_REASONS[rel] ?? "frozen session file.")
        .join("; ")}${traced ? " (attempt recorded to the ledger.)" : ""}`,
    },
  }),
);
