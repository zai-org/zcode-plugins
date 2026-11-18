# Wiki

Three directories, three lifetimes:

- `knowledge/` — durable decisions, constraints and pitfalls that carry a why.
- `progress/` — current state: active branch, released version, what is in
  flight, and `retro.md` at the end of a loop.
- `runbook/` — operations: how to run, package, release and roll back.

Rule: branch or release state changes touch `progress/` only. The knowledge
layer does not move when the release does.
