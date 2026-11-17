# Legacy Context Reformat

The playbook for bringing a scattered, pre-spec context site under the format
contract (`spec.md`). Reach for it when inheriting a project or hub whose
context predates the spec: instruction files written as essays, knowledge with
no index, naked paths in prose, undated state documents, duplicated copies,
task folders sitting at the top level. The agent supplies the judgment; this
page fixes the order of operations so the deterministic tools stay useful
from the first inventory to the final verify.

## Principles

- **Meaning-preserving.** Reformat moves and links what is already there; it
  never invents facts, fills gaps with guesses or rewrites wording for style.
  A claim that cannot be verified keeps its text, flagged for the user.
- **Classify before touching.** Formatting garbage launders it. Every
  artifact gets a destination class first; what has no future reader is
  proposed for deletion or distillation, not formatted.
- **Placement before content.** A pointer written before its target moves is
  a pointer rewritten after. Moves and deletions land first, content edits
  second, so paths are final when pointers get written.
- **One scope, one pass.** Leave the scope internally consistent — indexed,
  pointed, dated — even if the pass ends at its boundary.

## Pass 1 — Inventory and classify

1. `guster doctor --root <project>` (add `--json`): the findings list is the
   worklist and each finding names the CTX rule it broke. `guster scan` adds
   the asset inventory behind the findings.
2. Classify every artifact — flagged or not — into exactly one class:

   | Class | Destination |
   |---|---|
   | instruction | root `AGENTS.md`, narrowed per CTX-01 |
   | durable knowledge | hub `knowledge/` (cross-project) or `.agents/wiki/` (project-local) |
   | plan / task bundle | `.agents/plans/` |
   | evidence | `.agents/evidence/` |
   | skill | `.agents/skills/` (project) or `~/.agents/skills/` (machine) |
   | scratch | `.agents/tmp/` — or delete |
   | retired | `.agents/archive/` — or distill into wiki, then delete |
   | code or config | the repository itself, not context |
   | no future reader | propose deletion, never format |

3. Duplicate stems (CTX-06): pick the canonical copy by freshness and
   completeness; mark the rest to become pointer cards in pass 3.
4. A credential value found anywhere stops structural work: report critical,
   then continue with references only (CTX-08).

## Pass 2 — Placement

- No `.agents/` yet: `guster plan init --project <path>` gives the six slots,
  README and a minimal `AGENTS.md`.
- Before any move, search the repo for the artifact's path stem: every
  referencer found now is a pointer you update in pass 3; doctor after the
  move confirms none were missed (it catches what the search missed).
- The slot a `misplaced-artifact` finding suggests is shape-based —
  classification can override it (a finished review report is a wiki
  conclusion, not a live plan).
- One artifact: `guster plan move --from <src> --to <dst>` (backup plus a
  pointer at the old location on apply).
- A batch: hand-write one plan JSON — `version: 1`, an `operations` list of
  `mkdir`/`move`/`write` objects, same shape `plan move` emits — covering the
  whole destination slot, then `guster apply <plan>` dry-run, read it with the
  user, `--yes`. Apply backs up every touched path and rolls back on failure.
- Nothing inside a moved file is rewritten in this pass.

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
| Referencer still pointing at a pre-move path | Update it to the new path (doctor reports each as `broken-pointer`); `~`-prefixed links are resolved against home, so cross-repo pointers to a hub stay verifiable | CTX-03 |
| `<name>.moved.md` left by an applied move | Delete once every referencer is updated — a transition pointer nobody reads re-triggers `misplaced-artifact`; keep it only for referencers outside your control | CTX-05 |

Content edits are ordinary file edits by the agent; plans are for moves.

## Pass 4 — Verify

1. `guster doctor` — the pass kept the contract iff zero new findings appear.
2. `guster link` for a pointer-only check; `guster score --trend` for the
   before/after number to hand the user.
3. Committing is the user's workflow; guster never auto-commits.

## Scale and review

Batch by directory or topic. For a large legacy site, deliver the pass-1
classification table (artifact → class → keep/merge/delete) to the user
before pass 2 — one approval for the map, not one per file. Deletion and
distillation proposals live in that table, never execute silently. A
company-tracked file is never a migration target: report it, waive it with a
reason if the user accepts, move on.
