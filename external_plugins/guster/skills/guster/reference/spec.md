# Context Format Spec

spec_version: 1. The format contract for context assets — the shapes that let
both an agent and `guster doctor` verify a document without reading minds.
Each rule carries a stable ID (markdownlint style) and names the finding that
mechanically enforces it. What no finding enforces is guidance for the agent
that writes the document.

## Open conventions this spec follows

- **AGENTS.md** (agents.md) — the tool-agnostic instruction file. Guster reads
  `AGENTS.md` (and legacy `CLAUDE.md`) wherever a host reads them; it does not
  invent a competing instruction format.
- **llms.txt** (llmstxt.org) — index files as curated link lists. A knowledge
  index is an H1, a one-line blockquote summary, then one markdown link per
  file with a one-line description. Same shape, local files instead of URLs.
- **Stable rule IDs** (markdownlint) — rules are numbered, cited by findings
  and waivers, and only change meaning on a spec_version bump.

## Rules

| ID | Rule | Enforced by |
|---|---|---|
| CTX-01 | `AGENTS.md` is the instruction file; nested ones narrow, never contradict. Budgets: hub ≤50 lines, user entry ≤150 lines, resident total ≤20 KB. | `resident-budget` |
| CTX-02 | Every knowledge scope has a README index in llms.txt shape; every knowledge file appears there verbatim, as `- [title](path): one-line description`. An index that names nothing is empty. | `orphan-knowledge` |
| CTX-03 | Any file path in an instruction or index document is machine-verifiable: a markdown link or inline code, never naked in prose. A pointer also states when to read the target. | `broken-pointer`, `naked-pointer` |
| CTX-04 | State documents carry a machine-readable date — `verified_at` or `最后更新: YYYY-MM-DD` within the first 40 lines, or a `YYYYMMDD` in the filename; otherwise git history is the fallback, and no signal means stale. | `stale-state` |
| CTX-05 | `.agents/` has exactly the six slots — `plans/`, `wiki/`, `evidence/`, `skills/`, `tmp/`, `archive/` — plus `README.md`/`AGENTS.md`. Task bundles live in a slot, never at the top level. | `misplaced-artifact` |
| CTX-06 | One home per fact. Same topic, same filename stem; the second home becomes a pointer to the first. Copies are either byte-identical or a mistake. | `duplicate-canonical`, `skill-copy-drift` |
| CTX-07 | Skill frontmatter carries `name` and `description` only; one trigger sentence, ≤500 chars each, ≤6,000 chars across the library. | `skill-budget` |
| CTX-08 | Credentials appear by reference — a path in the registry under the canonical root — never as a value in a document, a config or git. | `secret-in-git`, `secret-outside-root`, `secret-inline`, `secret-undeclared`, `secret-missing` |
| CTX-09 | A knowledge note may carry YAML front-matter following the Obsidian properties convention (the interchange format Foam/Quartz/Logseq also accept). The header is opt-in: it is machine-checked only when it declares `type:`. A checked header must parse and carry a machine-readable date (`updated`/`date`/`lastmod`/`created` as YYYY-MM-DD), and the note's body then joins the CTX-03 pointer scan — truth sources go in the body as links, never as invented header keys. | `note-header-malformed`, `broken-pointer`, `naked-pointer` |

## Why a format contract

The metrics are static: filename stems, content hashes, path resolution, git
dates. A document that ignores the contract is not scored lower — it is
invisible. A naked path in prose never reaches the pointer check; a date
written as "last week" falls back to git; an index without filenames counts as
missing. The contract is what makes measurement possible, and the score is
what keeps the contract from drifting. Both directions are load-bearing.

## Writing guide (no finding enforces this)

When creating or moving a context asset:

1. Pick the home by CTX-06, the slot by CTX-05, the index entry by CTX-02.
2. Write pointers as `[label](relative/path.md)` in indexes and `` `path` ``
   in prose; add when-to-read in the same sentence.
3. Add the date line before saving a state document; run `guster doctor`
   after edits — a new finding names the rule you just broke.
4. A note that summarizes knowledge whose truth lives elsewhere (a pointer
   card) opts into CTX-09: standard front-matter (`type: pointer`, a date
   key, `tags` if useful) plus a truth section of ordinary markdown links.
   Volatile values (latest numbers, current picks) stay out of the card and
   are read from the truth sources instead.

## Versioning

Additive changes keep spec_version; a rule that changes meaning bumps it and
gets a CHANGELOG entry. Findings cite rule IDs, waivers accept them, so a
spec change never silently re-targets an existing waiver.
