---
description: Consult the functional reviewer alone (read-only review)
argument-hint: "[scope]"
---

Ask the functional reviewer role to review $ARGUMENTS read-only. Generate a
fresh UUID role token, register it as `functional_reviewer`, dispatch the
`zcode-cycle:functional-reviewer` agent over the named scope (working tree
or a named worktree) with the token, revoke that token when it returns, and present
its verdict. No approval is recorded: an advisory review outside a
governed workflow cannot approve anything.
