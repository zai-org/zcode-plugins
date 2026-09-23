---
description: Consult the final arbiter alone (advisory verdict, never final approval outside a workflow)
argument-hint: "[question]"
---

Ask the arbiter role for an advisory verdict on $ARGUMENTS. Generate a fresh
UUID role token, register it as `arbiter`, dispatch the `zcode-cycle:arbiter`
agent with the material and token, revoke that token when it returns, and present
its reasoning. State clearly that this is advisory: final candidate
approval exists only inside a complete governed workflow.
