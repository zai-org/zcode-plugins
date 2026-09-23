---
description: Consult the security reviewer alone (read-only review)
argument-hint: "[scope]"
---

Ask the security reviewer role to review $ARGUMENTS read-only. Generate a
fresh UUID role token, register it as `security_reviewer`, dispatch the
`zcode-cycle:security-reviewer` agent over the named scope with the token,
revoke that token when it returns, and present its verdict. No approval is
recorded: an advisory review outside a governed workflow cannot approve
anything.
