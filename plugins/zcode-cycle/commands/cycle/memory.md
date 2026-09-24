---
description: Insert, search, explain or remove reusable project knowledge
argument-hint: "<insert|search|explain|remove> [arguments]"
---

Handle project memory with arguments: $ARGUMENTS

`search <text>`: run the `cycle_memory` tool with a search operation
(limit 10) and report results with their confidence level (inferred,
user_asserted, verified). `insert <title> | <summary> | <detail>`: cite
one or more ledger event ids (from `/cycle:history query`) as provenance
and insert with confidence `user_asserted` and a fitting kind
(convention, constraint, architecture_decision, command, bug_fix,
failed_approach, approval). `explain <id>` and `remove <id>` (ask the
user to confirm removal first). Unknown subcommand: list the four and
stop.
