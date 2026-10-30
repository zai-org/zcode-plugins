---
description: Show token usage statistics and savings opportunities for this project's sessions.
argument-hint: "[--json]"
skills: tokencare
---

Use the `tokencare` skill for this request. Run the vault statistics tool:

```
node "<tokencare skill base dir>/../../scripts/vault.mjs" stats $ARGUMENTS
```

Present the report to the user in a readable form (per-tool estimated tokens, largest outputs, duplicate unchanged re-reads, oversized outputs, vault totals). Then act on what it flags: offer `/digest` for oversized outputs, point out duplicate reads with the exact wasted-token estimates, and remind about unused MCP servers if MCP tools appear. Token figures are chars÷4 estimates — label them as such.
