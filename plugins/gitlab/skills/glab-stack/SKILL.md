---
name: glab-stack
description: Manage stacked diffs and merge requests with the GitLab CLI. Use when the user wants to create, save, amend, sync, navigate, or reorder a stack of dependent merge requests. Triggers on tasks involving stacked diffs, stacked MRs, dependent merge requests, or incremental code review workflows using `glab stack`.
---

# glab stack

## Required GitLab CLI preflight

Before any workflow step, read `../../references/gitlab-cli-preflight.md` and
complete it. Do not run stack commands until `glab` installation,
latest-version check, authentication, hostname, and active identity are
verified. Run `glab stack <subcommand> --help` before mutating a stack because
this command family is experimental and may differ between installed versions.

`glab stack` is a feature of the [GitLab CLI](https://gitlab.com/gitlab-org/cli) for managing **stacked diffs** — a series of small, dependent merge requests that build on each other to deliver a larger feature. Each entry in the stack is a separate branch with its own MR. Reviewers see only the diff for their layer; you keep building while earlier changes are in review.

> **Status:** Experiment, released in GitLab CLI v1.42.0. The interface may change.

## How glab stack works

`glab stack` uses a **save-centric model**: `glab stack save` bundles staging, committing, and branch creation into a single step. There are no separate Git operations for creating stack branches — the CLI manages branch creation automatically. Stack metadata lives in `.git/stacked/` in the repo.

Each diff gets its own branch named `{branch_prefix}-{stack-title}-{8-char-hex}`. The branch prefix defaults to the current user's username (from `os/user.Current`), falling back to `glab-stack` if unavailable; it can also be set with `glab config set branch_prefix <value>`. The hash is generated at save time from the message, title, author, and timestamp — branch names are not sequential or predictable in advance. Use `glab stack list` to see the current branch names for each diff.

```text
main (default branch)
 └── karmstrong-add-auth-5b337685  →  MR !1 (targets main)              ← first diff (oldest)
  └── karmstrong-add-auth-74f87791 →  MR !2 (targets karmstrong-add-auth-5b337685)
   └── karmstrong-add-auth-c3a91b02 → MR !3 (targets karmstrong-add-auth-74f87791) ← last diff (newest)
```

Stack names are sanitized on creation: spaces and special characters are replaced with dashes. The name `"add auth feature"` becomes `add-auth-feature`. Always use the sanitized form with `glab stack switch`.

You can have multiple named stacks per repo and switch between them with `glab stack switch`.

## When to use stacks

Stacks work well when:

- A feature is large enough that a single MR would be hard to review
- Changes have a clear dependency order — data layer feeds the API layer feeds the UI
- You want to unblock reviewers on completed layers while you keep building
- Feedback on one layer shouldn't block progress on the layers above it

Each diff should represent a discrete, logical concern that can be reviewed independently. A reviewer reading the MRs in sequence should understand the progression as a cohesive story.

## Agent rules

**These commands launch interactive TUIs or prompt for input — they will hang:**

- ❌ `glab stack move` — fuzzy-finder for selecting a diff; agents cannot interact with it
- ❌ `glab stack reorder` — opens a text editor to reorder diffs; requires user interaction
- ❌ `glab stack save` without `-m` — prompts interactively for a commit message if none is provided
- ❌ `glab stack amend` without `-m` — prompts interactively for a description if none is provided
- ❌ `glab stack create` without a name argument — may prompt

**Always do the following:**

1. **Always pass `-m` to `save` and `amend`.** This is the most common footgun — without it, the CLI prompts interactively and hangs.
2. **Use `glab stack list` to inspect the stack, not `glab stack move`.** `list` is non-interactive; `move` is not usable by agents.
3. **Navigate with `first`, `last`, `prev`, `next`.** These are all non-interactive. Do not use `move` for navigation.
4. **Pass an explicit name to `glab stack switch`.** Stack names are the directory names under `.git/stacked/`. Note: `switch` only changes the active stack in config — it does not check out any branch. After switching, use `glab stack last` (or `first`, `next`, etc.) to move to a diff in the new stack.
5. **If the user needs to reorder diffs**, tell them to run `glab stack reorder` in their terminal directly — agents cannot do this.

## Stack structure

Plan your diff boundaries before writing code. Earlier diffs (closer to main) are the foundation; later diffs depend on them. If code in one diff depends on code in another, the dependency must be in the same diff or an earlier one.

**`save` vs `amend`:**

- `glab stack save` — creates a **new** diff (new commit, new branch). Use when adding a new logical concern on top of what exists.
- `glab stack amend` — modifies the **current** diff. Use when addressing review feedback or fixing a mistake in the current layer.

**Important:** If you navigate to an earlier diff and run `save` instead of `amend`, the CLI will warn you but still proceed — appending the new diff to the **end** of the stack, not inserting it at the current position. Always use `amend` when you've navigated to a specific diff to address feedback. Only use `save` from the last diff in the stack.

For precise control over which files go into a diff, stage with `git add <files>` first, then `glab stack save -m "..."`. For convenience, `-a` stages all tracked/modified files, and passing `.` stages everything including untracked files.

## Quick reference

| Task | Command |
| ---- | ------- |
| Create a new stack | `glab stack create <stack-name>` |
| Save staged changes as a new diff | `glab stack save -m "description"` |
| Stage all tracked files and save | `glab stack save -a -m "description"` |
| Stage all files (incl. untracked) and save | `glab stack save . -m "description"` |
| Amend the current diff | `glab stack amend -m "description"` |
| Amend with all tracked files staged | `glab stack amend -a -m "description"` |
| Push branches and create/update MRs | `glab stack sync` |
| Sync and set reviewer/assignee/label | `glab stack sync --reviewer <user> --assignee <user> --label <label>` |
| Rebase stack onto latest base branch | `glab stack sync --update-base` |
| List all diffs in the current stack | `glab stack list` |
| Go to the oldest diff | `glab stack first` |
| Go to the newest diff | `glab stack last` |
| Step toward main | `glab stack prev` |
| Step away from main | `glab stack next` |
| Switch to a different stack | `glab stack switch <stack-name>` |

## Core workflow

```bash
# 1. Create a stack for a feature
glab stack create add-authentication

# 2. Build the first layer (data model)
git add app/models/user.rb db/migrate/001_create_users.rb
glab stack save -m "Add user model and migration"

# 3. Build the second layer (API) — depends on the model above
git add app/controllers/sessions_controller.rb
glab stack save -m "Add session controller"

# 4. Build the third layer (UI) — depends on the API above
glab stack save . -m "Add login view and assets"

# 5. Push all branches and open MRs on GitLab
glab stack sync
```

After `sync`, each diff has its own MR: !1 targets `main`, !2 targets the !1 branch, and so on. Reviewers see only the delta for their layer.

**`sync` fetches from origin first**, then pushes each branch and creates or updates MRs. If a branch is detected as behind its remote (e.g., a reviewer applied a suggestion through the GitLab web UI), `sync` will pull those changes before pushing. You don't need to manually pull stack branches before syncing in the common case.

**Setting reviewers, assignees, and labels:** Pass `--reviewer`, `--assignee`, and `--label` flags to `sync` to set these on newly created MRs. If no `--assignee` is specified, new MRs are auto-assigned to the current authenticated user. These flags only affect MR creation — they do not update MRs that already exist. To update an existing MR, use `glab mr update <mr-number>`.

**Merged and closed MRs:** During sync, any MR that has been merged has its ref automatically removed from the stack. Closed MRs are flagged in output but not removed — the ref stays in the stack.

**Rebasing onto an updated base branch:** If the base branch (e.g., `main`) has moved forward, run `glab stack sync --update-base` to rebase the entire stack onto the latest base.

**Merge diffs bottom-to-top.** Always merge the first diff (oldest, closest to main) before merging the ones above it. When the first diff merges, `sync` automatically retargets the next MR onto main. If a middle diff is merged out of order, the lower MR will show a combined diff that doesn't belong to its layer — there's no clean automated recovery.

### Responding to review feedback

```bash
# Navigate to the diff that needs changes
glab stack list          # see all diffs and where you are
glab stack first         # or: prev, next, last
# (make edits)
glab stack amend -a -m "Address review: improve null handling"

# Sync rebases all downstream diffs automatically
glab stack sync
```

### Handling sync conflicts

If `sync` hits a conflict during rebase:

```bash
# Resolve conflict markers in affected files, then:
git add <resolved-files>
git rebase --continue

# Re-run sync to push the resolved stack
glab stack sync
```
