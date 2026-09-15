---
name: git-worktrees
description: Safe git worktree usage for parallel ZCode sessions. Use when the user mentions worktrees, wants to run several conversations or agents on one repository in parallel, hits "branch is already used by worktree", asks how to create/list/remove worktrees, or wonders which folder a session should work in.
---

# Git worktrees for parallel sessions

A worktree is its own directory holding one checked-out branch. The directory — not the branch — is the unit of isolation: two sessions sharing a directory collide no matter which branches they name, because each `git checkout` rewrites the shared files under the other session's feet. Two sessions in two worktrees cannot collide.

## The three rules

1. **One branch, one worktree.** Git refuses to check out a branch that another worktree already holds. `fatal: '<branch>' is already used by worktree at <path>` means exactly that — not a locked or crashed git operation. Free the branch by removing the other worktree, or work on a different branch.
2. **One conversation, one worktree.** To parallelize work, give each conversation its own worktree opened as its own project (File → Open Folder). Two conversations in the same directory overwrite each other's uncommitted changes.
3. **Keep the default branch free.** Base task branches on `main` (or `master`), but do not check out the default branch itself in a session worktree — it blocks the next session that wants it, which surfaces as rule 1's error.

## Operating safely

- Match the intent: when the user signals wanting isolation for new work ("create a worktree", "work in parallel without collisions"), ensure a worktree exists with the safe defaults below. When asked about state, list. Creating is additive and safe; removing is not — never remove without an explicit request, and never put a session worktree on the default branch.
- Create: `git worktree add -b <branch> <path> <base>` — default path as a sibling of the repository root so nothing untracked appears inside the checkout. Say plainly that the current conversation stays in its own workspace: to work in the worktree, open it as its own project.
- Before removing, check `git -C <path> status --porcelain`; show the user what would be lost and require confirmation for `--force`.
- Delete a branch with `-d` only (merged check); `-D` destroys unmerged work and needs explicit user sign-off.
- A fresh worktree has no untracked dependencies or build output — install or link them per the project's own instructions before building.
- If this plugin's `/git-worktree:worktree` command is available, prefer it: it walks these steps with the guardrails built in.
