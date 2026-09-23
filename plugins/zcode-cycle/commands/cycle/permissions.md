---
description: Inspect the immutable role boundaries and the enforcement layers
---

Report the ZCode Cycle role boundaries as fixed facts: read-only roles
(architect, functional-reviewer, security-reviewer, arbiter) never receive
edit, write or shell tools; the executor never approves; the arbiter
approves only through the control plane inside a governed workflow; every
role session's tool use is audited to the ledger by the PreToolUse and
PostToolUse hooks.
