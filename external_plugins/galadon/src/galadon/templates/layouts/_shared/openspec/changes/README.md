# Changes

One directory per change: `openspec/changes/<change-id>/` with `proposal.md`,
`tasks.md`, and `design.md` when a decision needs recording.

A change is a construction ticket, not the source of truth: product behaviour is
written in `spec/spec.md`. When a change ships, fold the durable part into
`spec/` and `wiki/knowledge/`, and the state into `wiki/progress/`.
