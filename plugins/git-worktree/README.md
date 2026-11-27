# git-worktree

Git worktree management for parallel ZCode sessions — a Claude-Code-style `/worktree` experience: list, create, open, remove, and prune isolated working copies, with guardrails against the two classic accidents (deleting uncommitted work, and fighting over a branch two worktrees cannot share).

Addresses the UX gaps tracked in [zai-org/feedback#132](https://github.com/zai-org/feedback/issues/132) and [#220](https://github.com/zai-org/feedback/issues/220).

## Why

ZCode has no built-in worktree switcher, so users who want two conversations on one repository — one per feature — either collide in the same folder or hand-roll git commands and hit cryptic errors like `branch is already used by worktree`. This plugin makes the workflow first-class:

- **Isolation**: each conversation gets its own worktree (directory + branch), so parallel sessions never overwrite each other's uncommitted changes.
- **Clarity**: `list` shows every worktree with its branch and dirty state; errors are translated into what to do next.
- **Safety**: dirty worktrees are never removed without explicit confirmation; the main worktree and merged-branch checks protect against the two easiest ways to lose work.

## Install

Settings → Plugin Management → Discover → search `git-worktree` → Install. Requires git 2.20 or newer on your `PATH`.

## Usage

| Invocation | What it does |
|---|---|
| `/git-worktree:worktree` | Default: **create** — ensures an isolated worktree for a new session (auto-named branch off the default branch, sibling folder); prints the File → Open Folder path, since the current conversation stays in its own workspace |
| `… create <name> [base]` | Same, with an explicit worktree/branch `<name>` and base (`origin/HEAD`, else `main`/`master`, else `HEAD`); never occupies a default branch |
| `… list` | Table of every worktree: name, branch, uncommitted file count, path; main worktree marked |
| `… open <name>` | Resolves the worktree and prints the exact File → Open Folder path |
| `… remove <name>` | Refuses the main worktree; summarizes uncommitted changes and requires confirmation before `--force`; offers merged-only branch cleanup afterwards |
| `… prune` | Shows stale entries first, prunes the registry, reports (never silently deletes) orphan directories |

The bundled `git-worktrees` skill auto-triggers on worktree questions and carries the same rules for ad-hoc chat ("can I run three sessions on this repo?").

## Three ways to invoke

1. **Command** — `/git-worktree:worktree` (bare = create with safe defaults; or `list`, `create`, `open`, `remove`, `prune`). The deterministic path: a fixed procedure with the guardrails built in.
2. **Mention** — type `@Git-Worktree` in the composer to attach the bundled skill to your message. Ask in natural language ("work on the export fix in isolation") and the worktree discipline — default-branch protection, dirty-state checks, one conversation per worktree — applies to whatever you asked.
3. **Auto-trigger** — the skill also loads by itself when a conversation turns to worktrees or parallel-session isolation, as a safety net when you didn't think to ask.

## Side effects, permissions, dependencies

- Runs local `git` commands only: `worktree add/remove/list/prune`, `status`, `diff --stat`, `branch -d/-D`. No other binaries, no scripts, no hooks, no MCP servers.
- Creates directories (default: siblings of your repository root) and deletes worktree directories — every destructive step requires explicit confirmation first.
- No network access, no credentials, no data leaves the machine.
- Cross-platform: plain git invocations, no shell-specific syntax; tested path handling on Windows and POSIX.

## Versioning and license

`0.1.0` — manifest and marketplace entry kept in lockstep. Apache-2.0, same license as the [zcode-plugins](https://github.com/zai-org/zcode-plugins) repository. No third-party code or assets.
