---
description: Cancel authorized work safely (requires --confirm)
argument-hint: "--confirm"
---

Handle cancellation with arguments: $ARGUMENTS

If `--confirm` is absent: state what will be cancelled (the active workflow
and its role sessions), that the worktree is preserved, and that this
command requires explicit `--confirm` after user approval. Stop.

With `--confirm`: cancel via the `cycle_control` tool (operation `cancel`),
revoke every registered role session of this workflow
(`cycle_role_list`, then `cycle_role_revoke` for each), and report the
final state.
