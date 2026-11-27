# OpenSpec Change → Ticket Mapping (authoritative source of the parser)

> The parsing rules of `_ticket.py` (`parse_tasks_md` / `check_task`) are
> governed by this document. Changing the mapping requires updating the
> parser + tests in sync.

## Source of Truth

The plan face is an **OpenSpec change**:

```
<project>/openspec/changes/<change-id>/
├── proposal.md   ← why/what — the human-approved plan (baton never writes it)
└── tasks.md      ← task checklist — baton's ticket source + [x] write-back
```

There is no baton-specific ticket file format anymore. A change is the
feature; a task is a ticket.

## tasks.md Format

```markdown
# Tasks: <change-id>

## 1. First phase

- [x] 1.1 already-done task (resolved seed)
- [ ] 1.2 another task

## 2. Second phase

- [ ] 2.1 independent task A
- [ ] 2.2 independent task B
```

### Parsing rules

- `## N. Section title` starts section N (a `。` after the number is
  tolerated for CJK writing). The next top-level heading (`#` or `##`) that is
  not a numbered section ends it; deeper headings (`###`) belong to it.
- A UTF-8 byte-order mark is tolerated: it does not hide the first section.
- Task lines: `- [ ] N.M text` / `- [x] N.M text`. Bullets `-`/`*`/`+` and
  checkbox states `[ ]`/`[x]`/`[X]` are all tolerated.
- A task line only counts inside a section; stray checkboxes before the
  first `## N.` header are ignored.
- Lines inside a fenced code block (``` fences) are never tasks: example
  checkboxes quoted from this document stay examples (no ghost tickets, no
  phantom misfiled/duplicate ids).
- A checkbox with a task id but no description text (``- [ ] 1.2``) is a
  validation error, not a silently dropped ticket.
- **Every top-level checkbox in a section is a ticket.** One without an
  `N.M` id (``- [ ] write the docs``) is a validation error naming the line —
  it used to vanish without a word. Indented checkboxes are sub-steps (the
  usual OpenSpec `verify:` nesting) and are ignored, unless they carry an
  `N.M` id: an indented ``  - [ ] 1.2 …`` is an error too, because it looks
  exactly like a task that never ran.

### Mapping

| OpenSpec | baton |
|---|---|
| change `<change-id>` | feature (job) |
| task `N.M` | ticket, num = `N*100+M` (1.2 → 102, 3.4 → 304; reversible for display) |
| `[ ]` unchecked | status `ready` |
| `[x]` checked | status `resolved` |
| task text | title / what-to-build / single acceptance criterion |
| (none) | draft — an unapproved change is simply not run |
| (none) | per-task `Verify:` override — verification is change-wide via the CLI `--verify` flag, persisted with the run on the first claim (no implicit default; an unconfigured run fails loud) |

### Dependency semantics (section-order DAG)

Task `N.M` is blocked by **every task in every section that appears before
section N** in the file; tasks within one section are independent and form
the parallel frontier. Sections are phases in real-world tasks.md files, so
file order is the safe dependency order. Consequences:

- Section 1 tasks have no blockers.
- A later section only starts once all earlier sections are fully checked.
- Keep independent work in the same section; keep gating work in an earlier
  section.

### Validation errors (`TasksMarkdownError`)

- tasks.md missing → error with the "create the change first" hint
- no `## N.` sections / no task lines
- duplicate task id (e.g. two `2.1`)
- task id filed under the wrong section (e.g. `1.2` under `## 2.`)
- checkbox with a task id but no description text (e.g. `- [ ] 1.2`) → error
  naming the line number
- top-level checkbox with no task id (e.g. `- [ ] write the docs`) → error
  naming the line number
- indented checkbox that carries a task id (e.g. `  - [ ] 1.2 …`) → error
  naming the line number

### Write-back

When a task's sealed receipt is integrated, `check_task` flips its checkbox
`[ ]` → `[x]` in place (atomic tmp+rename, idempotent). The write-back matches
exactly the task lines `parse_tasks_md` accepts (any bullet, any whitespace
inside the brackets) and preserves every other byte of the file — including
CRLF line endings, so a Windows checkout does not turn one flip into a
whole-file diff. There is no in-progress projection: live attempt state lives
in the durable store (`queue.db`), not in the plan face.

The flip is an **uncommitted edit in the project's main working tree** — baton
never commits to the base branch — and the integration branch does not carry
it. Commit `tasks.md` together with merging `baton/<change-id>`.

### A finished ticket stays finished

A succeeded receipt resolves a ticket for good. Unchecking it by hand does not
re-run it: baton reports the mismatch (`resolved_but_unchecked` in `status`,
a `resolved-but-unchecked` warning on every batch) instead of quietly
overriding the edit. `reopen <N.M>` is the explicit way to re-run one: it
voids the receipt, unchecks the task and restarts the ticket's retry budget.

## Live edits

Editing tasks.md at runtime (adding tasks/sections, reordering, manual
checkbox flips) is the live-plan mechanism: the next `actions()` call
re-reads the file, records a **new plan revision**, and the frontier is
recomputed. In-flight assignments keep their immutable packets.

Changing the **text** of a task that is still in flight is different: the
subagent is implementing the old wording, so the attempt is parked
(`blocked-review`, `blocked: ticket-redefined`) with both texts shown.
Restore the original text to let it resume, or `abandon` the attempt so the
ticket is re-claimed under the new definition. A receipt sealed under the old
text is never integrated against the new one. Removing an in-flight task
parks its attempt the same way (`blocked: ticket-removed`).
