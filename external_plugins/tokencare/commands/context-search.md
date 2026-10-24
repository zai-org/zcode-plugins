---
description: Search the context vault for details lost to compaction or spilled from context.
argument-hint: "<query>"
skills: tokencare
---

Use the `tokencare` skill (recovery) for this request.

Query: $ARGUMENTS

Run:

```
node "<tokencare skill base dir>/../../scripts/vault.mjs" search "$ARGUMENTS"
```

Report the matches with their vault ids. If a match looks relevant but truncated, fetch the full original with `vault.mjs get <id>` and answer from it. If there are no matches, say so plainly and fall back to normal tools (re-reading the file, re-running the command) — do not guess at vault contents.
