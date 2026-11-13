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
  tolerated for CJK writing).
- Task lines: `- [ ] N.M text` / `- [x] N.M text`. Bullets `-`/`*`/`+` and
  checkbox states `[ ]`/`[x]`/`[X]` are all tolerated.
- A task line only counts inside a section; stray checkboxes before the
  first `## N.` header are ignored.
- Lines inside a fenced code block (``` fences) are never tasks: example
  checkboxes quoted from this document stay examples (no ghost tickets, no
  phantom misfiled/duplicate ids).
- A checkbox with a task id but no description text (``- [ ] 1.2``) is a
  validation error, not a silently dropped ticket.

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

### Write-back

When a task's sealed receipt is integrated, `check_task` flips its checkbox
`[ ]` → `[x]` in place (atomic tmp+rename, idempotent). The write-back matches
exactly the task lines `parse_tasks_md` accepts (any bullet, any whitespace
inside the brackets) and preserves every other byte of the file — including
CRLF line endings, so a Windows checkout does not turn one flip into a
whole-file diff. There is no in-progress projection: live attempt state lives
in the durable store (`queue.db`), not in the plan face.

### Validation of ids

An id outside the supported range (`## 100.`, `1.100`) is a
`TasksMarkdownError` too — like every other malformed-tasks.md case, it is
reported as one error line, never as a traceback.

## Live edits

Editing tasks.md at runtime (adding tasks/sections, reordering, manual
checkbox flips) is the live-plan mechanism: the next `actions()` call
re-reads the file, records a **new plan revision**, and the frontier is
recomputed. In-flight assignments keep their immutable packets.
