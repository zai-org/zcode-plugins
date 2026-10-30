# TokenCare

Layered context compression and token optimization for [ZCode](https://z.ai). One plugin that unifies the ideas of [billion-context](https://github.com/ranxianglei/billion-context) (incremental, reversible context compression) and [dsh-token-optimizer](https://github.com/Zoria-Lind/dsh-token-optimizer) (tool-output triage, read-dedup, monitoring) — with their overlapping parts merged instead of duplicated.

Long sessions accumulate huge tool outputs, re-read the same unchanged files, and blow past context limits. TokenCare cuts that waste in three layers and keeps **everything reversible** through an on-disk vault.

## How it works

| Layer | What it does | Origin |
|---|---|---|
| **L0 — Observe** (automatic) | A `PostToolUse` hook records every tool result's size, hash, and file path to a per-session ledger. Very large outputs (> 30k chars) get a one-line nudge toward `/digest`. After ZCode compacts the session, a `SessionStart(compact)` hook points back at the vault so details are recovered, never guessed. | dsh `monitor` + billion-context session stats & growth nudges, merged into one ledger |
| **L1 — Lossless spill & read-dedup** | `/digest` stores the original verbatim in the vault and emits a structure-aware digest: errors → 300-char excerpt, JSON → shape summary, CSV → header + row count + first/last row, text → head/tail. Duplicate unchanged file reads are detected from the ledger and called out with wasted-token estimates. | dsh `outputLadder` + `fileDiff`, made reversible à la billion-context |
| **L2 — Model-driven compression** | `/compress` writes a structured summary of the settled conversation into the vault, registers it in the index, then anchors ZCode's built-in `/compact` on it. Suggested at ~45% context pressure instead of waiting for an emergency. | billion-context `compress`/`decompress` + dsh `compactionDriver`, unified |
| **Recovery** | `/context-search` greps vault originals and summaries; originals come back whole. | billion-context `search_context` |
| **Statistics** | `/token-status` reports per-tool token estimates, largest outputs, duplicate reads, recoverable savings, vault totals, and MCP-server trimming advice. | dsh `/token-status` + `monitor` + billion-context `acp_status`, unified |

## Commands

- `/token-status` — token statistics and savings opportunities
- `/digest <file | "last output">` — spill a large output, keep only its digest
- `/compress [scope]` — compress settled history into a reversible summary
- `/context-search <query>` — recover details from the vault

## Install / requirements

- ZCode with plugins enabled. Install from a marketplace that lists this plugin.
- **Node.js ≥ 16 on PATH** for the hooks and vault CLI (zero npm dependencies, stdlib only). The skill and commands degrade gracefully without it — only automatic ledger recording and the CLI stop working; no session is ever blocked by a failed hook.

All data lives in `<project>/.zcode/tokencare/` (ledger + vault) and is self-gitignored.

## Design decisions

- **Tuned for GLM-5.3 Max and Flash Max.** Token estimation is GLM-aware (CJK ≈ 1 token/char, ASCII ≈ 4 chars/token) instead of the usual chars÷4, which undercounts Chinese-heavy sessions. A profile system shifts strategy per tier — `TOKENCARE_PROFILE=flash|balanced|max` (auto-detected from `TOKENCARE_MODEL` / `ZCODE_MODEL` / `ANTHROPIC_MODEL` or the hook payload): Flash-class nudges at 20k chars and compresses at ~35–40% pressure; balanced (default) 30k / ~45%; Max-class nudges at 40k chars, defers compression to ~55% and focuses on duplicate reads and giant outputs. `/token-status` shows the active profile and its advice.

- **No proxy.** billion-context works as a stream-rewriting proxy between agent and model API. A marketplace plugin cannot (and should not) intercept model traffic, so TokenCare achieves the same savings with hooks + skills + commands, and deliberately cooperates with ZCode's built-in compaction instead of replacing it.
- **One status surface, one ledger.** Both source projects ship overlapping compaction-drivers and monitors; here they are a single ledger and a single `/token-status`.
- **text2img (dsh) is intentionally not ported.** Rendering text to images to save tokens needs a vision model, an API key, and per-platform text rendering, while `/digest` achieves the same token saving losslessly with no dependencies.
- **toolTrim is advisory.** A plugin cannot remove MCP tool schemas from requests, so `/token-status` surfaces MCP usage and advises disabling unused servers in Settings.

## Credits & license

MIT. Design inspired by and indebted to [billion-context](https://github.com/ranxianglei/billion-context) (MIT + attribution) and [dsh-token-optimizer](https://github.com/Zoria-Lind/dsh-token-optimizer) (MIT). No code was copied; both projects are worth a look in their own right.
