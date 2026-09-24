---
description: Export workflow state, ledger or evidence (requires --confirm)
argument-hint: "--confirm"
---

Handle export with arguments: $ARGUMENTS

If `--confirm` is absent: state that export writes project data outside
the repository and requires explicit `--confirm` after user approval.
Stop.

With `--confirm`: run the `cycle_history` tool with operation
`{ "type": "export" }`, save the result to the file the user named (or
`cycle-export-<date>.json` in the current directory), and report the
absolute path and entry count.
