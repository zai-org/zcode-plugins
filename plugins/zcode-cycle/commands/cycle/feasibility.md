---
description: Consult the read-only architect for implementation feasibility
argument-hint: "[question]"
---

Ask the architect role for implementation feasibility analysis of $ARGUMENTS.
Generate a fresh UUID role token, register it as `architect`, dispatch
`zcode-cycle:architect` with the question and token, then revoke that token.
Request analysis, risks, estimated effort and blockers only. Never use the
executor profile for advisory work because it has mutating tools.
