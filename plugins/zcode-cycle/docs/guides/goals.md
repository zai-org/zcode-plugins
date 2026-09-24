# Goals and Consultation

Work that spans several sessions belongs to a goal, not a workflow.

## Goal lifecycle

Draft → Planning → Ready → Active → Completing → Completed, with pause,
block and abort side paths. Plans are versioned: every save records a
revision with its digest. The objective is immutable; amendments append.

## Milestones and completion gates

Each implementation milestone is a normal governed workflow, linked with
`link_workflow`. Completion is earned, not declared:

- `request_completion` requires at least one linked workflow;
- every linked milestone must have a COMPLETED workflow — cancelled
  does not count;
- `approve_completion` must cite the arbiter's receipt digest as
  `completion_evidence`, and that digest is resolved against the
  arbitration receipts recorded for this goal's own linked workflows. A
  well-formed digest that names no such receipt is refused, and so is a
  real receipt belonging to work linked elsewhere. No evidence, no
  completion.

Continuations are bounded (default five): a goal can be continued
across sessions without living forever.

## Correcting a link

A workflow belongs to one milestone, so re-pointing it is refused while
it is still linked. Use `unlink_workflow` first, then link it where it
belongs — a link made in error is a mistake to correct, not a fact to
live with.

Once a goal is completed or aborted its links are part of what it
claims, and unlinking is refused: at that point the record stands.

## Consultations without a cycle

`/cycle:architect`, `/cycle:feasibility`,
`/cycle:review-implementation`, `/cycle:review-security` and
`/cycle:arbiter` consult a single role for planning or advisory input.
They are bounded by design: the executor analyzes but never implements
outside a governed workflow; reviewers stay read-only; the arbiter's
outside verdict is advisory — final approval exists only inside a
complete governed workflow, enforced by the control plane's state
machine, not by prompt instructions.
