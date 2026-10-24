---
description: Compress the settled part of this conversation into a reversible vault summary.
argument-hint: "[scope hint, e.g. 'everything before the last hour']"
skills: tokencare
---

Use the `tokencare` skill (L2) for this request.

Scope: $ARGUMENTS (default: the older, settled part of the conversation — recent turns stay intact).

Follow the skill's L2 protocol exactly: write a structured summary (`summary-<n>.md`) into `.zcode/tokencare/vault/` covering goals/state, decisions and reasons, files touched, key commands and results, open threads, and spill-id pointers; register it in `vault/index.json`; then tell the user the summary is the compaction anchor and suggest running ZCode's built-in `/compact` now. Emphasize that nothing is lost — `/context-search` recovers any detail from the vault afterwards.
