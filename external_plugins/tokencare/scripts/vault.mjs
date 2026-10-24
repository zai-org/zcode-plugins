#!/usr/bin/env node
// TokenCare vault: ledger + reversible spill store for tool outputs.
// Subcommands:
//   record posttooluse   read a PostToolUse hook payload from stdin, append a ledger line,
//                        emit a nudge when the output is very large
//   record sessionstart  read a SessionStart(compact) payload from stdin, point at the vault
//   spill [FILE|--stdin] [--label L] [--chars N] [--kind auto|error|json|csv|text]
//                        store the original verbatim in the vault, print a compact digest
//   stats [--json]       aggregate token statistics from the ledger
//   search QUERY [-n N]  case-insensitive search over vault originals and labels
//   index                list vault entries
//   get ID               print the full original for a vault entry
// Data lives in <project>/.zcode/tokencare/ (ledger/ and vault/).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Token estimation: GLM-family tokenizers encode CJK at roughly 1 token per
// character while ASCII averages ~4 chars/token, so a plain chars/4 estimate
// badly undercounts Chinese-heavy sessions. All figures remain estimates.
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g;

function estimateTokensFromText(text) {
  if (!text) return 0;
  // count via replace-length, not match(): a match() array on a large CJK
  // document would allocate millions of string entries on this hot path
  const asciiOnly = text.replace(/[^\x00-\x7F]/g, "");
  const withoutCjk = text.replace(CJK_RE, "");
  const nonAscii = text.length - asciiOnly.length; // CJK + other non-ASCII
  const other = withoutCjk.length - asciiOnly.length; // non-ASCII, non-CJK
  const cjk = nonAscii - other;
  return cjk + Math.ceil(other / 2) + Math.ceil(asciiOnly.length / 4);
}

// Profiles: a Flash-class model (compact, low-latency window) rewards early
// hygiene; a Max-class model tolerates far more live context. Select with
// TOKENCARE_PROFILE=flash|balanced|max, or a model id in TOKENCARE_MODEL /
// ZCODE_MODEL / ANTHROPIC_MODEL (also read from the hook payload when present).
const PROFILES = {
  flash: {
    nudgeChars: 20000,
    label: "flash (compact window)",
    advice: "spill early (nudge at 20k chars), compress at ~35-40% pressure",
  },
  balanced: {
    nudgeChars: 30000,
    label: "balanced",
    advice: "nudge at 30k chars, compress at ~45% pressure",
  },
  max: {
    nudgeChars: 40000,
    label: "max (large window)",
    advice: "large window tolerates live context (nudge at 40k chars); defer compression to ~55% and spend effort on duplicate reads and giant outputs",
  },
};

function activeProfile(hint) {
  const explicit = (process.env.TOKENCARE_PROFILE || "").toLowerCase();
  if (PROFILES[explicit]) return explicit;
  const m =
    `${hint || ""} ${process.env.TOKENCARE_MODEL || ""} ${process.env.ZCODE_MODEL || ""} ${process.env.ANTHROPIC_MODEL || ""}`
      .toLowerCase();
  if (m.includes("flash")) return "flash";
  if (m.includes("max")) return "max";
  return "balanced";
}

function nudgeThreshold(profile) {
  if (Number(process.env.TOKENCARE_NUDGE_CHARS) > 0) return Number(process.env.TOKENCARE_NUDGE_CHARS);
  return PROFILES[profile || activeProfile()].nudgeChars;
}

function estTokens(chars) {
  return Math.ceil(chars / 4);
}

const SPILL_DEFAULT_CHARS = 1000; // below this, spilling saves nothing meaningful

function projectDir() {
  return (
    process.env.ZCODE_PROJECT_DIR ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd()
  );
}

function dataDir() {
  return path.join(projectDir(), ".zcode", "tokencare");
}

function ensureDataDirs() {
  const root = dataDir();
  // fast path for the hook (runs on every tool call): one stat instead of
  // two mkdirs plus a gitignore check once the tree exists
  if (fs.existsSync(path.join(root, "ledger")) && fs.existsSync(path.join(root, "vault"))) return root;
  fs.mkdirSync(path.join(root, "ledger"), { recursive: true });
  fs.mkdirSync(path.join(root, "vault"), { recursive: true });
  const gi = path.join(root, ".gitignore");
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, "*\n!.gitignore\n");
  return root;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    setTimeout(() => resolve(data), 8000).unref();
  });
}

function responseText(r) {
  if (r == null) return "";
  if (typeof r === "string") return r;
  if (Array.isArray(r)) return r.map(responseText).join("\n");
  if (typeof r === "object") {
    if (typeof r.stdout === "string" || typeof r.stderr === "string") {
      return [r.stdout || "", r.stderr || ""].filter(Boolean).join("\n");
    }
    for (const k of ["content", "output", "text", "result"]) {
      if (r[k] != null) return responseText(r[k]);
    }
    try {
      return JSON.stringify(r);
    } catch {
      return String(r);
    }
  }
  return String(r);
}

function sha1(s) {
  if (s.length > 10 * 1024 * 1024) return "(too-large)";
  try {
    return crypto.createHash("sha1").update(s, "utf8").digest("hex").slice(0, 16);
  } catch {
    return "(unhashable)";
  }
}

function ledgerFile(sessionId) {
  const safe = String(sessionId || "default").replace(/[^\w.-]/g, "_");
  return path.join(dataDir(), "ledger", `${safe}.jsonl`);
}

function appendLedger(entry) {
  ensureDataDirs();
  const file = ledgerFile(entry.session);
  fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
}

function readLedger() {
  const dir = path.join(dataDir(), "ledger");
  if (!fs.existsSync(dir)) return [];
  const lines = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        lines.push(JSON.parse(t));
      } catch {
        /* skip malformed line */
      }
    }
  }
  return lines;
}

// ---- vault ----

function vaultIndexFile() {
  return path.join(dataDir(), "vault", "index.json");
}

function readVaultIndex() {
  try {
    return JSON.parse(fs.readFileSync(vaultIndexFile(), "utf8"));
  } catch {
    return [];
  }
}

function writeVaultIndex(entries) {
  ensureDataDirs();
  fs.writeFileSync(vaultIndexFile(), JSON.stringify(entries, null, 2), "utf8");
}

function looksLikeError(text) {
  const head = text.slice(0, 2000);
  return /\b(error|failed|exception|traceback|fatal|panic)\b/i.test(head);
}

function digestOf(text, kind, vaultRel) {
  const lines = text.split("\n");
  if (kind === "error") {
    const first = text.slice(0, 300).trim();
    const last = text.slice(-300).trim();
    return `[error output — first 300 chars]\n${first}\n[…]\n[last 300 chars]\n${last}\n[full original: ${vaultRel}]`;
  }
  if (kind === "json") {
    let shape = "(unparseable)";
    try {
      const v = JSON.parse(text);
      if (Array.isArray(v)) {
        shape =
          `array of ${v.length} item(s)` +
          (v.length ? `; first item: ${JSON.stringify(v[0]).slice(0, 400)}` : "");
      } else if (v && typeof v === "object") {
        const keys = Object.keys(v)
          .slice(0, 30)
          .map((k) => `${k}: ${Array.isArray(v[k]) ? `array(${v[k].length})` : typeof v[k]}`)
          .join(", ");
        shape = `object keys — ${keys}`;
      } else {
        shape = `${typeof v}: ${String(v).slice(0, 200)}`;
      }
    } catch {
      return digestOf(text, "text", vaultRel);
    }
    return `[JSON — ${shape}]\n[full original: ${vaultRel}]`;
  }
  if (kind === "csv") {
    const header = lines[0] || "";
    const first = lines[1] || "";
    const last = lines[lines.length - 1] || "";
    return `[CSV — ${lines.length - 1} data row(s), ${header.split(",").length} column(s)]\nheader: ${header}\nfirst: ${first}\nlast:  ${last}\n[full original: ${vaultRel}]`;
  }
  // text: head/tail, clamped so they never overlap or drop lines on short inputs
  const head = lines.slice(0, 15);
  const tail = lines.length > 25 ? lines.slice(-10) : [];
  const omitted = lines.length - head.length - tail.length;
  const parts = [head.join("\n")];
  if (omitted > 0) {
    parts.push(`[… ${omitted} line(s) omitted — full original: ${vaultRel} …]`);
  }
  parts.push(tail.join("\n"));
  return parts.filter(Boolean).join("\n");
}

function detectKind(text, requested) {
  if (requested && requested !== "auto") return requested;
  if (looksLikeError(text)) return "error";
  const t = text.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      /* fall through */
    }
  }
  const lines = t.split("\n").filter(Boolean);
  if (
    lines.length >= 3 &&
    (lines[0].match(/,/g) || []).length >= 2 &&
    lines.slice(0, 10).every((l) => (l.match(/,/g) || []).length === (lines[0].match(/,/g) || []).length)
  ) {
    return "csv";
  }
  return "text";
}

function parseArgs(argv, flagDefs) {
  // flagDefs: { "--flag": "value" | true } — returns { flags: {...}, positionals: [...] }
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const def = flagDefs[argv[i]];
    if (def === true) flags[argv[i]] = true;
    else if (def === "value") flags[argv[i]] = argv[++i];
    else positionals.push(argv[i]);
  }
  return { flags, positionals };
}

async function cmdSpill(args) {
  const { flags, positionals } = parseArgs(args, {
    "--stdin": true,
    "--chars": "value",
    "--kind": "value",
    "--label": "value",
  });
  const useStdin = "--stdin" in flags;
  const threshold = Number(flags["--chars"]) > 0 ? Number(flags["--chars"]) : SPILL_DEFAULT_CHARS;
  const requestedKind = flags["--kind"] || "auto";
  const label = flags["--label"] || "";
  const file = positionals[0];
  if (!useStdin && !file) {
    console.error("usage: vault.mjs spill [FILE|--stdin] [--label L] [--chars N] [--kind auto|error|json|csv|text]");
    process.exit(1);
  }

  const text = useStdin ? await readStdin() : fs.readFileSync(file, "utf8");
  const kind = detectKind(text, requestedKind);
  const now = new Date();
  const digits = now.toISOString().replace(/\D/g, "").slice(0, 14); // yyyymmddhhmmss
  const id = `spill-${digits.slice(0, 8)}-${digits.slice(8)}-${crypto.randomBytes(2).toString("hex")}`;
  ensureDataDirs();
  const vaultFile = path.join(dataDir(), "vault", `${id}.txt`);
  fs.writeFileSync(vaultFile, text, "utf8");
  const vaultRel = path.join(".zcode", "tokencare", "vault", `${id}.txt`).replace(/\\/g, "/");

  const entries = readVaultIndex();
  entries.push({
    id,
    label: label || (file ? path.basename(file) : "stdin"),
    source: file || "stdin",
    kind,
    chars: text.length,
    est_tokens: estimateTokensFromText(text),
    created: now.toISOString(),
  });
  writeVaultIndex(entries);
  appendLedger({
    ts: now.toISOString(),
    session: process.env.CLAUDE_SESSION_ID || "default",
    tool: "(vault)",
    event: "spill",
    chars: text.length,
    est_tokens: estimateTokensFromText(text),
    vault_id: id,
  });

  const digest = digestOf(text, kind, vaultRel);
  const saved = Math.max(0, text.length - digest.length);
  console.log(`[digest id=${id} label=${label || (file ? path.basename(file) : "stdin")} kind=${kind} chars=${text.length}]`);
  console.log(digest);
  if (text.length < threshold) {
    console.log(`(note: only ${text.length} chars — below the ${threshold}-char spilling threshold; no meaningful saving)`);
  } else {
    console.log(`(saved ~${estTokens(saved)} tokens vs. keeping the original in context; recover with: /context-search or vault get ${id})`);
  }
}

// ---- record (hook mode) ----

async function cmdRecordPostToolUse() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // never break the session over a malformed payload
  }
  const session = payload.session_id || process.env.CLAUDE_SESSION_ID || "default";
  const tool = payload.tool_name || "(unknown)";
  const text = responseText(payload.tool_response ?? payload.tool_result);
  const input = payload.tool_input || {};
  const filePath =
    input.file_path || input.path || input.notebook_path || input.pathname || "";
  const profile = activeProfile(payload.model || payload.modelInfo?.displayName);
  const est = estimateTokensFromText(text);

  appendLedger({
    ts: new Date().toISOString(),
    session,
    tool,
    event: "posttooluse",
    chars: text.length,
    est_tokens: est,
    file_path: typeof filePath === "string" ? filePath.replace(/\\/g, "/") : "",
    hash: sha1(text),
    profile,
  });

  if (text.length > nudgeThreshold(profile)) {
    // exitCode (not process.exit) so the piped stdout write always flushes
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `[tokencare] ${tool} returned ${text.length.toLocaleString()} chars (~${est.toLocaleString()} tokens). Consider /digest to spill it to the vault and keep only a summary in context.`,
        },
      })
    );
  }
  process.exitCode = 0;
}

async function cmdRecordSessionStart() {
  const raw = await readStdin();
  try {
    JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const entries = readVaultIndex();
  if (!entries.length) {
    process.exitCode = 0;
    return;
  }
  const totalChars = entries.reduce((a, e) => a + (e.chars || 0), 0);
  // exitCode (not process.exit) so the piped stdout write always flushes
  process.stdout.write(
    JSON.stringify({
      additionalContext: `[tokencare] Context was just compacted. ${entries.length} spilled original(s) (~${estTokens(totalChars).toLocaleString()} tokens worth) are preserved in .zcode/tokencare/vault/. Use /context-search <query> to recover exact details instead of re-reading files or guessing.`,
    })
  );
  process.exitCode = 0;
}

// ---- stats ----

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

function cmdStats(asJson) {
  const ledger = readLedger();
  const entries = readVaultIndex();
  const perTool = new Map();
  const outputs = [];
  const readGroups = new Map(); // path+hash -> count, chars, tokens
  let totalChars = 0;
  let totalTokens = 0;

  for (const e of ledger) {
    if (e.event !== "posttooluse") continue;
    totalChars += e.chars || 0;
    totalTokens += e.est_tokens || estTokens(e.chars || 0);
    const t = perTool.get(e.tool) || { calls: 0, chars: 0, tokens: 0, max_chars: 0 };
    t.calls += 1;
    t.chars += e.chars || 0;
    t.tokens += e.est_tokens || estTokens(e.chars || 0);
    t.max_chars = Math.max(t.max_chars, e.chars || 0);
    perTool.set(e.tool, t);
    outputs.push(e);
    if (e.tool === "Read" && e.file_path && e.hash) {
      const k = `${e.file_path}|${e.hash}`;
      const g = readGroups.get(k) || { path: e.file_path, count: 0, chars: 0, tokens: 0 };
      g.count += 1;
      g.chars += e.chars || 0;
      g.tokens += e.est_tokens || estTokens(e.chars || 0);
      readGroups.set(k, g);
    }
  }

  const dups = [...readGroups.values()].filter((g) => g.count > 1);
  const oversized = outputs.filter((e) => e.chars > SPILL_DEFAULT_CHARS);
  const spillChars = entries.reduce((a, e) => a + (e.chars || 0), 0);

  const sessions = new Set(ledger.map((e) => e.session));
  const profile = activeProfile();
  const result = {
    project: projectDir(),
    profile,
    profile_advice: PROFILES[profile].advice,
    sessions: sessions.size,
    tool_calls: outputs.length,
    total_output_chars: totalChars,
    est_output_tokens: totalTokens,
    per_tool: Object.fromEntries(
      [...perTool.entries()].sort((a, b) => b[1].chars - a[1].chars).map(([k, v]) => [k, { calls: v.calls, chars: v.chars, est_tokens: v.tokens, max_chars: v.max_chars }])
    ),
    largest_outputs: outputs
      .slice()
      .sort((a, b) => b.chars - a.chars)
      .slice(0, 5)
      .map((e) => ({ tool: e.tool, file_path: e.file_path || "", chars: e.chars, est_tokens: e.est_tokens || estTokens(e.chars) })),
    duplicate_reads: dups
      .sort((a, b) => b.chars * b.count - a.chars * a.count)
      .slice(0, 10)
      .map((g) => ({ path: g.path, unchanged_rereads: g.count - 1, chars_each: g.chars, wasted_est_tokens: Math.ceil((g.tokens / g.count) * (g.count - 1)) })),
    duplicate_waste_est_tokens: dups.reduce((a, g) => a + Math.ceil((g.tokens / g.count) * (g.count - 1)), 0),
    oversized_outputs: oversized.length,
    spill_candidates_est_tokens: oversized.reduce((a, e) => a + Math.max(0, (e.est_tokens || estTokens(e.chars)) - 250), 0),
    vault_entries: entries.length,
    vault_chars: spillChars,
    vault_est_tokens: entries.reduce((a, e) => a + (e.est_tokens || estTokens(e.chars || 0)), 0),
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`TokenCare — token statistics for ${result.project}`);
  console.log(`Sessions tracked: ${result.sessions} | tool calls: ${fmt(result.tool_calls)} | est. tool-output tokens: ~${fmt(result.est_output_tokens)}`);
  console.log(`Profile: ${PROFILES[profile].label} — ${PROFILES[profile].advice}`);
  console.log(`\nPer tool (est. tokens of output):`);
  for (const [tool, t] of Object.entries(result.per_tool)) {
    console.log(`  ${tool.padEnd(24)} ${String(t.calls).padStart(4)} calls  ~${fmt(t.est_tokens).padStart(9)} tok  (largest ~${fmt(estTokens(t.max_chars))} tok)`);
  }
  console.log(`\nLargest outputs:`);
  result.largest_outputs.forEach((o, i) => {
    console.log(`  ${i + 1}. ${o.tool} ${o.file_path || "(no file)"} — ${fmt(o.chars)} chars (~${fmt(o.est_tokens)} tok)`);
  });
  if (result.duplicate_reads.length) {
    console.log(`\nDuplicate reads (same file, unchanged content):`);
    result.duplicate_reads.forEach((d) => {
      console.log(`  ${d.path} re-read unchanged x${d.unchanged_rereads} — ~${fmt(d.wasted_est_tokens)} wasted tokens`);
    });
    console.log(`  → Have the model reference earlier reads instead of re-reading, or use /digest markers.`);
  } else {
    console.log(`\nDuplicate reads: none detected.`);
  }
  console.log(`\nOversized outputs (>${SPILL_DEFAULT_CHARS} chars): ${result.oversized_outputs} — ~${fmt(result.spill_candidates_est_tokens)} tokens recoverable via /digest`);
  console.log(`Vault: ${result.vault_entries} original(s), ~${fmt(result.vault_est_tokens)} tokens preserved on disk, recoverable via /context-search`);
  const mcpCalls = Object.keys(result.per_tool).filter((k) => k.startsWith("mcp__"));
  if (mcpCalls.length) {
    console.log(`\nMCP tools used: ${mcpCalls.join(", ")}`);
    console.log(`  → Every enabled MCP server re-sends its tool schemas each request; disable unused servers in Settings.`);
  }
}

// ---- search / index / get ----

function cmdSearch(args) {
  const query = args.find((a) => !a.startsWith("-"));
  const nIdx = args.indexOf("-n");
  const limit = nIdx !== -1 ? Number(args[nIdx + 1]) || 30 : 30;
  if (!query) {
    console.error("usage: vault.mjs search QUERY [-n LIMIT]");
    process.exit(1);
  }
  const q = query.toLowerCase();
  let matches = 0;
  // labels first: tiny, high-signal, and immune to being crowded out of the
  // limit by long content matches
  for (const e of readVaultIndex()) {
    if (matches >= limit) break;
    if (String(e.label || "").toLowerCase().includes(q)) {
      matches += 1;
      console.log(`index: ${e.id} label=${e.label} kind=${e.kind} chars=${e.chars}`);
    }
  }
  const vdir = path.join(dataDir(), "vault");
  if (fs.existsSync(vdir) && matches < limit) {
    for (const f of fs.readdirSync(vdir).filter((f) => f.endsWith(".txt"))) {
      const lines = fs.readFileSync(path.join(vdir, f), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (matches >= limit) return;
        if (line.toLowerCase().includes(q)) {
          matches += 1;
          console.log(`${f}:${i + 1}: ${line.slice(0, 200)}`);
        }
      });
      if (matches >= limit) break;
    }
  }
  if (!matches) console.log(`No matches for "${query}" in the vault.`);
  else console.log(`\n(${matches} match(es); open with: vault.mjs get <id>)`);
}

function cmdIndex() {
  const entries = readVaultIndex();
  if (!entries.length) {
    console.log("Vault is empty. Use /digest to spill a large tool output into it.");
    return;
  }
  for (const e of entries) {
    console.log(`${e.id}  ${String(e.chars).padStart(8)} chars  ${e.kind.padEnd(5)}  ${e.created}  ${e.label}`);
  }
}

function cmdGet(id) {
  if (!id || !/^[\w.-]+$/.test(id)) {
    console.error("usage: vault.mjs get <spill-id>");
    process.exit(1);
  }
  const f = path.join(dataDir(), "vault", `${id}.txt`);
  if (!fs.existsSync(f)) {
    console.error(`No vault entry "${id}". Use: vault.mjs index`);
    process.exit(1);
  }
  process.stdout.write(fs.readFileSync(f, "utf8"));
}

// ---- main ----

const [cmd, sub, ...rest] = process.argv.slice(2);
const tail = process.argv.slice(3); // everything after "<cmd> <sub>" — flags and positionals
try {
  if (cmd === "record" && sub === "posttooluse") await cmdRecordPostToolUse();
  else if (cmd === "record" && sub === "sessionstart") await cmdRecordSessionStart();
  else if (cmd === "spill") await cmdSpill(tail);
  else if (cmd === "stats") cmdStats(tail.includes("--json"));
  else if (cmd === "search") cmdSearch(tail);
  else if (cmd === "index") cmdIndex();
  else if (cmd === "get") cmdGet(sub);
  else {
    console.error(
      [
        "TokenCare vault",
        "usage:",
        "  vault.mjs record posttooluse | record sessionstart   (hook mode, reads stdin)",
        "  vault.mjs spill [FILE|--stdin] [--label L] [--chars N] [--kind auto|error|json|csv|text]",
        "  vault.mjs stats [--json]",
        "  vault.mjs search QUERY [-n LIMIT]",
        "  vault.mjs index",
        "  vault.mjs get <spill-id>",
      ].join("\n")
    );
    process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  // Hook mode must never surface errors into the session; CLI mode may.
  if (cmd === "record") process.exit(0);
  console.error(`tokencare: ${err && err.message ? err.message : err}`);
  process.exit(1);
}
