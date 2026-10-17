---
description: Manage git worktrees — create an isolated working copy for a new session, or list, open, remove, and prune them
argument-hint: [create [name]] | list | open <name> | remove <name> | prune
---

Manage git worktrees for the current repository. The subcommand comes from `$ARGUMENTS`. With no subcommand at all, behave as `create` — the common case is a user starting a conversation who wants isolation from other sessions. Reply in the user's language.

## Ground rules (every subcommand)

1. Resolve the repository first with `git rev-parse --show-toplevel`. If the workspace is not inside a git repository, say so and stop.
2. The first entry of `git worktree list` is the main worktree. Never remove or prune it.
3. A branch can be checked out in only ONE worktree at a time. If git answers `fatal: '<branch>' is already used by worktree at <path>`, that is NOT a stuck git operation — the branch is owned by another worktree. Name the owning worktree and offer two options: open that worktree instead, or use a different branch here.
4. One ZCode conversation works in one working copy. Creating a worktree from this conversation does NOT move this conversation into it — say this plainly every time you create. To work in the worktree, the user opens it via File → Open Folder and converses there.
5. Run plain git commands only. Do not assume bash syntax; the user may be on Windows.

## create [name] [base]

This is the default when no subcommand is given.

1. If the CURRENT workspace already sits in a linked worktree (its `.git` is a `gitdir:` pointer into `/.git/worktrees/`), it is already isolated: report its branch and path, and stop.
2. Pick `<name>`: use the one given; else derive it from the task or topic at hand (kebab-case, no slashes, no path separators); else fall back to `session-<YYYYMMDD>`. If branch `<name>` already exists, append `-2`, `-3`, … until free.
3. Base: the `origin/HEAD` target if it exists, else `main` or `master` if either exists, else current `HEAD`. NEVER check the default branch itself out into the worktree — occupying it blocks every other session that wants it.
4. Path: a sibling of the repository root, `<repo-dirname>-<name>`. If the user asks for an in-repo location such as `.worktrees/<name>`, honor it and append that directory to `.git/info/exclude` (never a tracked `.gitignore`).
5. Create with `git worktree add -b <name> <path> <base>` (drop `-b` and append the existing branch name instead if it already exists). Interpret failures per ground rule 3.
6. Finish with: the worktree path and branch; ground rule 4's reminder verbatim; and the note that untracked files (dependencies, build output) do not exist in the fresh worktree — install or link them per the project's own setup instructions.

## list

Run `git worktree list --porcelain`. For each worktree also run `git -C <path> status --porcelain` to count uncommitted files. Present a table: name (directory basename), branch (`refs/heads/` stripped; `(detached)` kept), uncommitted file count, path. Mark the main worktree.

## open <name>

Resolve `<name>` against `git worktree list --porcelain` by directory basename, branch name, or path prefix; refuse an ambiguous name by listing the candidates. A command cannot switch the ZCode workspace itself, so print the absolute path and the exact click path: File → Open Folder → select that directory. Repeat ground rule 4's reminder in one sentence.

## remove <name>

1. Resolve the worktree as in `open`. Refuse the main worktree.
2. Check `git -C <path> status --porcelain`. If there are uncommitted changes, STOP: summarize them (file list plus `git -C <path> diff --stat`), and ask whether to discard them. Only after an explicit confirmation run `git worktree remove --force <path>`; otherwise suggest committing or stashing first and stop.
3. Clean worktree: `git worktree remove <path>`. On Windows this can fail if another process (editor, terminal, antivirus) holds the directory — say so, and suggest closing it before retrying rather than jumping to `--force`.
4. After removal, offer branch cleanup: `git branch -d <branch>` when the branch is merged; never run `git branch -D` without an explicit confirmation that unmerged work will be lost.

## prune

1. Show what is stale first: `git worktree prune --dry-run --verbose` plus `git worktree list --porcelain`.
2. Run `git worktree prune`.
3. Orphan directories (a worktree directory on disk that no longer appears in `git worktree list`) are only ever reported with their paths and sizes — never deleted without an explicit confirmation, because the same look can hide uncommitted work the registry simply forgot.
