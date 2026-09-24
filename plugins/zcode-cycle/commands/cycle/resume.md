---
description: Reconcile paused, interrupted or blocked work and continue it
---

Run recovery for this project via the `cycle_control` tool (operation
`recovery`), then report the reconciled state and, if work is runnable,
continue it following the standard workflow procedure. If nothing is
recoverable, say so plainly with the daemon's reason.

When the reconciled state is `delivery`, read `deliveryBegan` before acting;
the two cases it separates need opposite responses.

- `deliveryBegan: false` — the promotion never started. In a non-interactive
  session the workflow dies with the session, so this is how an approved cycle
  ordinarily ends. Run the promotion through the normal path, which re-verifies
  every approved byte before committing.
- `deliveryBegan: true` — a promotion started and stopped, leaving a
  reservation or a bound journal behind. Do not retry it. Report the candidate
  digest, the reservation and the journal digest, and leave the decision to the
  user: finishing a half-written delivery is not a thing to guess at.
