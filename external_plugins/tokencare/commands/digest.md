---
description: Spill a large tool output or file to the vault and replace it with a compact digest.
argument-hint: "<file path | 'last output'>"
skills: tokencare
---

Use the `tokencare` skill (L1) for this request.

Target: $ARGUMENTS

If the argument is a file path, spill it directly:

```
node "<tokencare skill base dir>/../../scripts/vault.mjs" spill "<file>"
```

If it is "last output" or similar, the most recent large tool output is still in the conversation: save it to a temporary file (or pipe via `--stdin`), then spill that. Use the printed digest block in place of the original from now on, and mention the spill id so the user can recover the original later with `/context-search`.
