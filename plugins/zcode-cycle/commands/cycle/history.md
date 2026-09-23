---
description: Query the project audit ledger; `history verify` checks the hash chain
argument-hint: "[verify] | [query <limit>]"
---

Handle ledger queries with arguments: $ARGUMENTS

`verify`: run the `cycle_history` tool with operation `{ "type": "verify" }`
and report whether the hash chain and signed checkpoints are intact.

`query <limit>` (or no arguments, limit 50): run `cycle_history` with
operation `{ "type": "query", "after_sequence": null, "limit": <n> }` and
report entries as `sequence timestamp actor action tool workflow`.

Anything else: explain the two forms and stop.
