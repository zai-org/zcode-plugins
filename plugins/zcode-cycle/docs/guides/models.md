# Per-Role Model Configuration

ZCode Cycle remains model-agnostic while roles inherit the active session
model. An explicit per-role override names a model the host must resolve;
Cycle checks the reference's shape, writes it into the managed project
profile, and probes the role before any workflow starts. Assignments are
constrained edits to the managed project profiles and never leave the project.

## Read assignments

`/cycle:models` prints each role's effective model (explicit or
inherit) and reasoning effort.

## Assign a model

`/cycle:models <role> <model-ref|inherit> [thought-level]` where role is one
of `architect`, `executor`, `functional-reviewer`, `security-reviewer`,
`arbiter`. Use `inherit` to follow the primary Agent; omit its thought level,
because ZCode applies `thoughtLevel` only when a specific model is set.

For an explicit assignment the reference is `custom:<provider-id>:<model>`,
with the provider id URI-encoded exactly as ZCode encodes it. ZCode splits the
reference at the first colon after `custom:`, so a provider id that itself
contains a colon must write it as `%3A`; left bare, it silently names a
different provider.

| Provider as ZCode shows it | Reference |
| --- | --- |
| `account:zai-individual-coding-plan`, model `GLM-5.3` | `custom:account%3Azai-individual-coding-plan:GLM-5.3` |
| `builtin:zai-coding-plan`, model `GLM-5.3` | `custom:builtin:zai-coding-plan:GLM-5.3` |

Which one works depends on the host, not on Cycle. The 1.0.9 certification host
resolves the Z.ai coding plan under `account:zai-individual-coding-plan`; there
every `builtin:` reference fails at dispatch with `provider-not-found`, and the
encoded `account` reference runs. A plugin cannot enumerate a host's providers,
so it does not try: every explicit pin is reported `dispatch_unverified`, and
the run protocol dispatches a throwaway probe of each pinned role before
`cycle_start`, so a wrong provider costs seconds rather than a workflow.

Thought levels: the tool enforces exact pairs for the three
`custom:builtin:zai-coding-plan:*` references - `GLM-5.3` and `GLM-5.3-Flash`
take `low`, `high` or `max`; `GLM-5-Turbo` takes `enabled` or `off`. Any other
reference accepts `low`, `high`, `max`, `enabled` or `off` and the host
decides, so use the same pairs for the same models under another provider id.
`nothink` and `medium` are never accepted. The tool preserves the
security-critical prompt and tool list; an override applies in a new session.

## Third-party models

A model you have added to ZCode from another provider is assigned the same
way: name it as `custom:<encoded provider id>:<model>` - for a MiniMax provider
ZCode registers as `minimax`, `custom:minimax:MiniMax-M3`. Use the thought level
that provider understands, not the Z.ai one: ZCode gives MiniMax models
`enabled`/`disabled`, and `high` fails at dispatch with
`reasoning-level-not-supported`. Cycle accepts both, so `disabled` runs a
MiniMax role with thinking off. The 1.0.9 certification ran the
arbiter on `custom:minimax:MiniMax-M3` at `enabled` while every other role ran
on the session's Z.ai model. Cycle does not keep a
list of acceptable providers, and it cannot verify the capabilities of a model
it does not know - so read the ledger's model field as a record of the
assignment, which is what it is (see below), and let the pre-start probe tell
you whether the host can reach it.

Use `/cycle:models` rather than editing a profile by hand. A hand edit to
anything other than the `model:` and `thoughtLevel:` lines is reported as
`managed-drift` by `/cycle:setup status`. A hand edit to the `model:` line
alone, with a well-formed reference, reads as `current` - but no assignment is
recorded for it, so if something later rewrites the profile the pin vanishes
without the warning described below.

## What the ledger records

Every event a role produces records the model pinned in its profile, read from
that profile when the event is written. `inherit` is recorded as `inherit`: the
session's model is a weaker claim than a pinned one, and the record does not
flatten the difference.

Read what that claim is, exactly. Cycle cannot see ZCode's dispatch, so the
ledger attests **the model the role was assigned**, not the model that answered.
`/cycle:history` and an exported receipt therefore answer *which model this role
was pinned to when it approved your candidate* — and, because a profile edited
away from its managed baseline is reported as drift and blocks a run, that
assignment is one the control plane has checked. It is not an observation of the
inference itself, and no audit trail written outside the host can make it one.

## A pin that goes missing says so

An assignment is recorded apart from the profile it was written into, outside
the project tree, and the two are compared every time you run `/cycle:setup`.
When a profile no longer carries the model it was assigned, the result names the
role, what was asked for and what is actually on disk, and the command reports
that before anything else.

This exists because the profile's `model:` line used to be both the request and
its resolution. Anything that rewrote the profile from its managed template
erased the request without trace, and the run went ahead on the session model
with the ledger faithfully recording `inherit` — accurate about what it saw, and
silent about what you had asked for. A profile rewritten from its own template
is structurally perfect, so `repair` no longer waits for damage: a pin missing
from the file it was set on is itself the thing to repair.

`/cycle:models <role> inherit` withdraws a pin deliberately, and is not drift.

## Verified and claimed gate results are not the same entry

A gate the control plane ran and a gate a session reported are distinguishable
in the record: a reported one carries `declared`. Only the caller-facing audit
path can set it, and it always does, so a claimed pass cannot be mistaken for a
verified one by anything reading the entry. Entries written before this field
existed carry their original bytes and read as what they were — produced by the
control plane.

## Choosing models

- The **architect** and **arbiter** benefit from the strongest reasoning
  you have: decomposition quality and final judgment dominate their
  outcomes.
- The **executor** benefits from a strong coding model; its work is
  independently verified regardless, so a mismatch surfaces as repair
  cycles, not silent defects.
- Reviewers should differ from the executor where possible — correlated
  blind spots are the failure mode separation of roles exists to prevent.

A cost-conscious assignment (strong architect and arbiter, cheaper
executor and reviewers) is legitimate: the gates, not the models, carry
the correctness guarantee.
