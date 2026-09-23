---
description: Consult the architect alone (read-only planning, no workflow)
argument-hint: "[topic]"
---

Consult the architect role about $ARGUMENTS without starting a workflow.
Generate a fresh UUID role token, register it with `cycle_role_register`
as `architect`, dispatch the `zcode-cycle:architect` agent with the exact
question and token, revoke that token when it returns, and present its task
graph or analysis. Nothing is implemented; no files change; this is
planning only.
