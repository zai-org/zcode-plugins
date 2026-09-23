---
description: Manage persistent goals (create, list, status, amend, control, link, plan)
argument-hint: "<subcommand> [arguments]"
---

Handle goal management with arguments: $ARGUMENTS

Route by subcommand to the `cycle_goal` tool for this project: `list`,
`status [id]`, `create` (collect objective, constraints, non-goals, success
criteria, then create), `amend <id> <text>`, `focus <id>`, `plan <id>`
(save a versioned plan), `link <goal> <milestone> <workflow>`, `control
<action> <id>` (start_planning, mark_ready, activate, pause, resume,
block, resume_blocked, continue, request_completion, approve_completion,
reject_completion, abort). A goal cannot complete while a linked workflow
is incomplete. Unknown subcommand: list the valid ones and stop.
