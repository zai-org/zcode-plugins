---
name: tokencare
description: Layered context compression and token saving for long ZCode sessions. Use when the user wants to reduce token usage or context size, compress or summarize conversation history, spill or digest large tool outputs, stop re-reading unchanged files, check token statistics (/token-status), or recover details lost after context compaction (/context-search). Maintains a reversible vault of original outputs under .zcode/tokencare/.
---

# TokenCare — layered context compression

Long sessions die from token bloat: huge tool outputs, repeated reads of unchanged files, and context that only grows. TokenCare applies three layers, cheapest first. **Nothing is ever lost** — every compression is reversible through the vault on disk.

The vault CLI is `node "<this skill's base directory>/../../scripts/vault.mjs"` (below: `vault.mjs`). All data lives in `<project>/.zcode/tokencare/` (ledger + vault), which is self-gitignored.

## L0 — Observe (automatic, hooks)

A PostToolUse hook records every tool result's size, content hash, and file path to a per-session ledger. You do nothing for L0, except:

- When a nudge appears (`[tokencare] Bash returned 48,231 chars …`), act on it: offer `/digest` on that output instead of carrying it.
- After ZCode compacts the conversation, a reminder points at the vault — recover details with `/context-search`, never by re-reading files blindly.

## L1 — Lossless spill and read-dedup (`/digest`)

For any tool output or file larger than ~1,000 chars that will not be needed verbatim in future turns:

1. Save the original to the vault and print a structure-aware digest:
   `node vault.mjs spill <file>` (or pipe content via `--stdin`, optional `--label`, `--kind error|json|csv|text`).
   Errors collapse to a 300-char excerpt, JSON to a shape summary (keys, array counts, first item), CSV to header + row count + first/last row, text to head/tail.
2. Use the digest block in your reasoning and replies. The original stays on disk, recoverable via `/context-search` or `vault.mjs get <id>`.

Read-dedup (fileDiff): before reading a file again, check whether an earlier read of the same path is already in the conversation. If the file is unchanged (same hash in `/token-status` duplicate report), reference the earlier read instead of re-reading; if only a small part is needed, grep the vault. Only re-read when the ledger shows the file changed or the earlier content is no longer in context.

## L2 — Model-driven compression (`/compress`)

Trigger: the user asks for it, context feels heavy (many large tool outputs accumulated), or `/token-status` shows large totals. Rough guidance: compress at ~35–40% of the usable context on a Flash-class model, ~45% balanced, ~55% on a Max-class model (see Model profiles) — never wait for an emergency at 80%+.

1. Write a structured summary of the **older, settled** part of the conversation to the vault as `vault/summary-<n>.md` (create the file with the Write tool), covering: goals and current state, decisions and their reasons, files touched and their outcome, key commands and results, open threads and next steps, and pointers to relevant spill ids.
2. Register it: append an entry to `vault/index.json` (`{"id": "summary-<n>", "kind": "summary", "label": "<one line>", "created": "<iso>"}`).
3. Tell the user the summary is the anchor and suggest ZCode's built-in compaction (`/compact`) now — TokenCare deliberately does not fight the host's compaction; it makes it lossless by guaranteeing recovery through the vault.

## Recovery (`/context-search`)

`node vault.mjs search "<query>"` greps vault originals and summaries; `vault.mjs get <id>` prints a full original; `vault.mjs index` lists entries. After any compaction, prefer searching the vault over re-running tools — it is free.

## Statistics (`/token-status`)

`node vault.mjs stats` reports per-tool output tokens, largest outputs, duplicate unchanged re-reads, oversized-output count, recoverable savings, and vault totals. Present the human report, act on what it flags. If MCP tools appear, remind the user that every enabled MCP server re-sends its tool schemas on each request — disable unused servers in Settings (TokenCare can only advise; it cannot trim schemas).

## Model profiles (GLM-5.3 Max / Flash Max)

Token pressure behaves differently per tier: a Flash-class window (e.g. GLM-5.3 Flash Max) rewards early hygiene, while a Max-class window (e.g. GLM-5.3 Max) tolerates far more live context. Select with `TOKENCARE_PROFILE=flash|balanced|max` or a model id in `TOKENCARE_MODEL` / `ZCODE_MODEL` / `ANTHROPIC_MODEL` (the hook also reads the model from the payload when provided; `/token-status` prints the active profile and its advice).

- **flash** — nudge at 20k chars, compress at ~35–40% pressure.
- **balanced** (default) — nudge at 30k chars, compress at ~45%.
- **max** — nudge at 40k chars, defer compression to ~55%; prioritize duplicate-read elimination and digesting giant outputs over compressing early.

Token figures use GLM-aware estimation (CJK ≈ 1 token/char, ASCII ≈ 4 chars/token) — still estimates; label them as such.

## Rules

- Never delete or rewrite vault originals; only add.
- Do not spill outputs under ~1,000 chars — the digest costs more than it saves.
- Ledger and hooks must stay silent: if a vault command fails, say so and continue; never block work.
- Token estimates are chars÷4 approximations — label them as estimates.
