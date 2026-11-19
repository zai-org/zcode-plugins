# Legacy Context Reformat

The playbook for bringing a scattered, pre-spec context site under the format
contract (`spec.md`) — essay-style instructions, unindexed knowledge, naked
paths, undated state, duplicates, top-level task folders. The agent judges;
this page fixes the order of operations.

Principles: **meaning-preserving** (never invent facts or rewrite for style);
**classify before touching** (formatting garbage launders it); **placement
before content** (a pointer written before its target moves is rewritten
after); **one scope, one pass** (leave it internally consistent).

## Pass 1 — Inventory and classify

1. `guster doctor --root <project>` (add `--json`): the findings list is the
   worklist, each naming the CTX rule it broke; `guster scan` adds the assets.
2. Classify every artifact — flagged or not — into exactly one class:

   | Class | Destination |
   |---|---|
   | instruction | root `AGENTS.md`, narrowed per CTX-01 |
   | durable knowledge | hub `knowledge/` or `.agents/wiki/` (project-local) |
   | plan / task bundle | `.agents/plans/` |
   | evidence | `.agents/evidence/` |
   | skill | `.agents/skills/` or `~/.agents/skills/` |
   | scratch | `.agents/tmp/` — or delete |
   | retired | `.agents/archive/` — or distill, then delete |
   | code or config | the repository itself, not context |
   | no future reader | propose deletion, never format |

3. Duplicate stems (CTX-06): pick the canonical copy by freshness and
   completeness; the rest become pointer cards in pass 3. A credential value
   found anywhere stops structural work: report critical (CTX-08).

## Pass 2 — Placement

- No `.agents/` yet: `guster init --project <path>` gives the six slots, README and a minimal `AGENTS.md`.
- Before any move, search the repo for the artifact's path stem: every
  referencer found now is a pointer you update in pass 3 (doctor after the
  move catches the rest). The slot a `misplaced-artifact` finding suggests
  is shape-based — classification can override it.
- One artifact: `guster plan move --from <src> --to <dst>` (backup on apply; referencers updated in pass 3, no pointer written).
- A batch: hand-write one plan JSON — `version: 1`, an `operations` list of
  `mkdir`/`move`/`write` objects, same shape `plan move` emits — then
  dry-run, read it with the user, `--yes`. Apply backs up every touched path
  and rolls back on failure.

## Pass 3 — Content (per scope, table order)

| Symptom | Transform | Rule |
|---|---|---|
| Scope has files but no index | Write the llms.txt-shaped README: H1, one-line blockquote, one link per file | CTX-02 |
| Knowledge file missing from its index | Add `- [title](path): one-line description` — the description says when to read it | CTX-02 |
| Naked path in prose or index | Markdown link in indexes, `` `code span` `` in prose, when-to-read in the same sentence | CTX-03 |
| State document without a machine-readable date | Add `verified_at: YYYY-MM-DD` / `最后更新: YYYY-MM-DD` — today only if you re-verified, otherwise the git date | CTX-04 |
| Task bundle at `.agents/` top level | Move into its slot (pass 2) | CTX-05 |
| Non-canonical duplicate | Replace with a pointer card: front-matter `type: pointer` plus a date key, truth links in the body; volatile values are deleted, not copied | CTX-06, CTX-09 |
| Instruction file over budget or contradicting a narrower one | Cut or split — nesting narrows, never contradicts | CTX-01 |
| Referencer still pointing at a pre-move path | Update it to the new path (doctor reports each as `broken-pointer`); `~`-prefixed links resolve against home, so cross-repo pointers to a hub stay verifiable | CTX-03 |
| Leftover `<name>.moved.md` transition pointer (older guster versions wrote them on apply) | Delete once every referencer is updated — a transition pointer nobody reads re-triggers `misplaced-artifact`; keep it only for referencers outside your control | CTX-05 |

Content edits are ordinary file edits by the agent; plans are for moves.

## Pass 4 — Verify

1. `guster doctor` — the pass kept the contract iff zero new findings appear.
2. `guster score --trend` for the before/after number; committing stays the
   user's workflow — guster never auto-commits.

## Scale and review

For a large legacy site, deliver the pass-1 classification table (artifact →
class → keep/merge/delete) to the user before pass 2 — one approval for the
map, not one per file; deletions never execute silently. A company-tracked
file is never a migration target: report it, waive it, move on.
