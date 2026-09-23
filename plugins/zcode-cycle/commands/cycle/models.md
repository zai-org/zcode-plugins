---
description: Inspect or safely configure a managed project role profile
argument-hint: "[role] [inherit|model-ref] [low|high|max|enabled|disabled|off]"
---

Handle model assignment with arguments: $ARGUMENTS

No arguments: call `cycle_role_profiles` with operation `status` and report
each role's effective model and thought level. Refuse configuration until all
five profiles are `current`.

With `role model-ref [thought-level]`: call `cycle_role_profiles` with
operation `configure`, the exact role/model, the thought level and
confirmation `CONFIGURE_ZCODE_CYCLE_ROLE_PROFILE`. Pass the model reference
through exactly as given - never shorten, rewrite or substitute it. The tool
is the authority on what it accepts: it validates the reference's shape and
refuses anything malformed, so do not pre-refuse a reference yourself. The
tool preserves the security-critical prompt and tool list.

A reference is `inherit` or `custom:<provider-id>:<model>`, where
`<provider-id>` is URI-encoded exactly as ZCode encodes it: a provider id that
contains a colon writes it as `%3A`. ZCode splits the reference at the first
colon after `custom:`, so an unencoded colon silently names a different
provider. Examples:

| Provider as ZCode shows it | Reference |
| --- | --- |
| `account:zai-individual-coding-plan`, model `GLM-5.3` | `custom:account%3Azai-individual-coding-plan:GLM-5.3` |
| `builtin:zai-coding-plan`, model `GLM-5.3` | `custom:builtin:zai-coding-plan:GLM-5.3` |

Which providers exist is the host's answer, not the plugin's: the same model
can live under different provider ids on different hosts, and a reference to a
provider this host does not have fails at dispatch with `provider-not-found`.
The tool reports every explicit pin as `dispatch_unverified`, and the run
protocol probes each pinned role before a workflow starts, so a wrong
provider costs seconds. Say so when you report the change.

Thought levels: `inherit` takes none (ZCode applies a thought level only with
a specific model). The tool enforces exact pairs only for the three
`custom:builtin:zai-coding-plan:*` references - `GLM-5.3` and
`GLM-5.3-Flash`: `low`, `high`, `max`; `GLM-5-Turbo`: `enabled`, `off`. For
any other reference, including the same models under another provider id, it
accepts `low`, `high`, `max`, `enabled`, `disabled` or `off` and the host
decides; use the same pairs there, and for a third-party provider the level that
provider takes (MiniMax models take `enabled` or `disabled`; `high` fails at
dispatch). Never offer `nothink`
or `medium`.

Report the project profile changed and that a new session is required.

With input the tool refuses: report its message verbatim, explain the
reference format above, and stop.
