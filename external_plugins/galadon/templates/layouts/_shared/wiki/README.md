# Wiki

Three directories, three lifetimes:

- `knowledge/` — durable decisions, constraints and pitfalls that carry a why.
- `progress/` — current state: active branch, deployed version, what is in
  flight, and `retro.md` at the end of a loop.
- `runbook/` — operations: how to run, deploy, roll back and read logs.

Rule: branch or deploy state changes touch `progress/` only. The knowledge layer
does not move when the deployment does.
