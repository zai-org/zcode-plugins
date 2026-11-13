# Changelog

Notable changes. Earlier history is in `git log`.

## 0.7.4 — 2026-11-12

- **CTX-09 opt-in now wins over malformedness** (`parse_note_header`): a
  header that never declares `type:` can no longer report
  `note-header-malformed`. Previously the parser bailed out as malformed
  before reaching the `type:` gate, so legacy prose notes that merely open
  with `---` (unclosed fence, prose inside the fence, a `----` opener, plain
  non key:value lines) were flagged against the documented contract. The
  opening fence is now strictly `---` (the same rule `parse_frontmatter`
  applies), and only headers that opted in can be malformed.
- Note headers parse literal/folded block scalars (`updated: |` with an
  indented block, `>` folded), aligning `parse_note_header` with
  `parse_frontmatter` — a legal block-scalar date was previously reported
  as a malformed line.
- **Apply rollback leaves no lying artifacts**: a `move` with a `.moved.md`
  pointer now registers the pointer write in the undo list — a pre-existing
  pointer is backed up and restored, a freshly written one is deleted — and
  fresh `write` targets register an undo entry too. A failed batch now
  restores sources, removes destinations, pointers and fresh writes, matching
  the documented "backs up every touched path and rolls back on failure".

## 0.7.3 — 2026-11-11

- **Legacy context reformat playbook** (`skills/guster/reference/reformat.md`):
  step-by-step guidance for bringing a scattered, pre-spec context site under
  the format contract — the piece the 0.7.0 spec lacked. Four passes:
  inventory and classify (doctor findings as the worklist, one destination
  class per artifact, duplicates pick a canonical copy), placement first
  (`plan init` for the slots, `plan move` or one hand-written batch plan —
  apply backs up every path and rolls back), content second (the CTX symptom
  → transform table: index lines, naked paths to links, date lines, duplicate
  to pointer card), then verify (`doctor` zero new findings, `score --trend`
  before/after). Principles are explicit: meaning-preserving (no invented
  facts), classify-before-touch (garbage is proposed for deletion, not
  formatted), placement before content (paths final before pointers are
  written). Deletions and distillations ride the classification table for
  user approval; company-tracked files are never migration targets.
  Field-tested on two real projects (a migrated repo with a stale cross-repo
  link and a stray root state doc): the lessons — search referencers by stem
  before moving, override shape-based slot suggestions by classification,
  delete `.moved.md` transition pointers after referencers update — are
  folded back into the playbook.
- SKILL.md wiring: trigger phrases for scattered/legacy context, a
  "Reformatting legacy context" section, and the reference entry.

## 0.7.2 — 2026-11-09

- **CTX-09 structured note headers** (opt-in): knowledge notes may carry YAML
  front-matter following the Obsidian properties convention — the interchange
  format Foam/Quartz/Logseq also accept, so guster defines no schema of its
  own. A header that declares `type:` is machine-checked (`note-header-malformed`):
  it must parse and carry a machine-readable date (`updated`/`date`/`lastmod`/
  `created`, YYYY-MM-DD), and the note's body then joins the CTX-03 pointer
  scan so a pointer card's truth links are verified. Truth sources live in the
  body as ordinary links, never as invented header keys. Legacy prose notes
  without `type:` are unaffected.

## 0.7.1 — 2026-11-09

- Fixed the placement tree in `reference/framework.md`: the three arrows for
  status/proof/durable-understanding questions pointed at the wrong plane
  numbers (4/5/6 instead of 5/6/4), contradicting the plane definitions in the
  same file.
- Documentation now teaches bare commands instead of the no-op flags
  `score --write` and `init --home`: the flags are still accepted for existing
  scripts, but writing metrics and initializing the state home are the defaults
  with or without them (README, README_CN, AGENTS.md, SKILL.md, doctor's
  next-action hint.

## 0.7.0 — 2026-11-09

- **Context format spec v1** (`skills/guster/reference/spec.md`): the format
  contract behind the metrics, written down and versioned — eight rules
  (`CTX-01..08`, markdownlint-style stable IDs) covering instruction files,
  indexes, pointers, dates, slots, single-source, skill metadata and
  credentials, each naming the finding that enforces it. Follows open
  conventions: `AGENTS.md` (agents.md) for instruction files, llms.txt-shaped
  link indexes, stable rule IDs. The skill cites it when writing or moving
  context assets; project and hub scaffolds now state the pointer rule.
- **New finding `naked-pointer` (medium)**: file paths left outside a markdown
  link or code span in an instruction or index document are reported — until
  now such paths were invisible to the pointer check, so a broken link written
  in prose never fired. Directory references in prose are deliberately not
  flagged. Advisory only: no CHI dimension changes, scores stay comparable.
- `metrics.raw.naked_pointers` counts the new finding; the guster skill
  workflow adds a post-apply `doctor` pass and triggers on 上下文格式/格式规范.

## 0.6.1 — 2026-11-05

- **Workspace and group roots are no longer scored as projects.** A directory
  that holds other scanned projects (a per-user workspace root, a per-group
  checkout root) carries group-level `AGENTS.md` files but is not a project: counting it
  inflated `Projects:` and turned one container's partial `.agents/` into a
  permanent placement failure. `registry.json` marks `container`, PCR/ICR skip
  them, and the report reads `Projects: 62 (workspace containers: 2)`.
- **PCR explains itself.** The raw column breaks a shortfall into extra
  top-level entries / missing slots / missing index. "9/41 · 25 extra entries"
  is actionable; "21.4%" alone reads like a crisis.
- Two boundaries are now written down instead of being implicit, so they stop
  coming back as "bugs": PCR's denominator is adopters only (a repo whose sole
  context asset is one well-placed `AGENTS.md` has nothing to place — demanding
  six empty slot directories there would be structure theater, and
  `<repo>/skills/` is product source in a skill repository, not unplaced
  context), and SIR does not scan arbitrary file content for token shapes (the
  release gate owns that; SIR only claims host configuration it actually read).

## 0.6.0 — 2026-11-05

Measurement honesty pass. Every change below removes a case where the score
claimed knowledge it did not have.

- **An empty denominator is now `n/a`, not 1.0.** A dimension with no evidence
  is dropped and the remaining weights are renormalized; a scope with no
  evidence reports `CHI: n/a`. This reverses the 0.5.5 behavior ("empty
  denominators still print `0/0` and score 1.0"), which let a scope with fewer
  artifacts outrank a measured one. `project`/`group` CHI therefore drops when
  their denominators are empty, and scores are no longer comparable across
  scopes with different coverage. RBR follows the same rule per component: a
  missing entry file is not a perfect budget.
- **Git probe failures are loud instead of clean.** `git ls-files` and
  `git log` returning an error used to look like "no tracked files" and "no
  commit dates": credentials read as isolated and state documents read as
  undated. Both now return `None`, surface as a new `git-unavailable` finding,
  and SIR counts the affected credentials as unverified. `registry.json`
  records `git_state` per project.
- **SIR stops punishing registered credentials.** The numerator is now
  unregistered-outside + tracked + unverified + inline, so a file declared in
  `~/.agents/credentials/registry.md` no longer costs points; previously 30 of
  31 in-place company `.env` files were counted as failures while the matching
  finding was suppressed. The `secret-outside-root` finding and SIR finally
  share one definition.
- **Dates are read where a freshness claim actually lives.** A filename date
  must open the name (`2026-11-05-x`, `20261105-x`); `ticket-20261105-notes.md`
  no longer counts as today's work. `最后更新` is matched in the first 40 lines
  only, so prose mentioning another file cannot date this one.
- **PHR sees directory pointers** (`knowledge/general/`) and resolves paths
  against the enclosing repository root, so `.claude/CLAUDE.md` and
  `.agents/README.md` stop reporting root-relative links as broken. The report
  states when the 200-file pointer cap narrowed the scan.
- **RBR probes the host that is actually installed.** It used to read
  `~/.zcode/AGENTS.md` only; a DSH-only machine measured 0 bytes and scored
  full marks. It now sums the entry files that exist, deduplicated by real path.
- **Wider credential detection, same read-only boundary.** `.env` discovery
  goes two levels deep instead of one, and inline detection covers `api_key`,
  `secret_key`, `auth_token` and `sk-…` shapes besides `Bearer`. Values stay
  redacted and are never printed.
- **ICR requires a non-empty index**: an empty `README.md` no longer counts as
  indexing `.agents/`.
- **`status` reports a snapshot instead of mixing two scans.** It used to run
  fresh policy against a cached registry; it now prints the cached registry plus
  the last `metrics.jsonl` entry, and says so.
- **`score --fail-under N`** turns CHI into an opt-in gate (exit 2). `score`
  still exits 0 by default.
- **`metrics.jsonl` records the scope and both value sets** (raw `metrics` and
  capped `scores`), so a trend line no longer mixes a budget ratio with a score.
- Knowledge files up to 8 MB are hashed (was 2 MB); oversized ones are counted
  in `knowledge_unhashed` instead of silently skipping single-source checks.
- The report now prints how many projects have no `.agents/` directory, which
  dimension had no evidence, and when the pointer scan was truncated.

## 0.5.5 — 2026-11-05

- FRS now counts state documents under the hub project root (`projects/`),
  `handoff/`, `provision/` and `.agents/plans/`, not only `kind: state`.
  Project `.agents/plans/*` therefore enters the FRS denominator, so a project
  or group with a stale plan loses freshness points instead of reporting
  `100.0 (0/0)`. Plans use the existing 90-day rule: a declared
  `verified_at`/`最后更新` or filename date, otherwise the last git commit of the
  repository that owns them. Stale-state findings now point at the offending
  in-scope document, so a project/group report explains the lost points instead
  of filtering the finding out as hub-level. Empty denominators still print
  `0/0` and score 1.0.
- `doctor --scope hub` reports the project cards known to the hub
  (`Projects: 3 (scanned roots: 0)`) instead of the number of scanned roots, and
  omits the empty `Workspaces:` header line when the scope has no workspaces.

## 0.5.4 — 2026-11-04

- Removed three skill sub-pages that nothing pointed at: `init/SETUP.md`,
  `use/OPERATE.md`, `test/SELFTEST.md`. `SKILL.md` carries the workflow itself;
  the sub-pages had drifted and were never loaded.

## 0.5.3 — 2026-11-04

- `doctor` reports exactly the dimensions that enter CHI for the run's scope.
  `--scope hub` no longer prints RBR/PCR/SIR rows it never scores, and the
  always-informational GCR value is labeled `Not counted in CHI`.
- `project` and `group` runs now apply one boundary to artifacts and findings:
  hub knowledge, hub state documents and the machine-level local wiki no longer
  sit in ICR/FRS/PHR denominators while their findings are filtered out. A
  denominator now only contains documents that can raise an in-scope finding,
  so those scopes no longer inherit a score from out-of-scope health.
- Removed the unused `templates/` file skeletons and `schema/*.json`: nothing
  read them, and the project `AGENTS.md` / `.agents/README.md` text already
  lives in `planner.py`. `templates/hub/` is the only shipped template set and
  `package.json` no longer ships `schema/`.

## 0.5.2 — 2026-11-04

- Bad plan files no longer crash: a non-object plan, a malformed operation, or an
  unreadable plan path fails through the `[guster] ...` / plan-error output and a
  non-zero exit.
- `guster apply --dry-run` is accepted as the documented explicit dry run and is
  rejected when combined with `--yes`.
- A missing `--root` workspace and an unreadable or non-object Guster config now
  fail loud instead of silently scanning defaults.
- Pointer health counts each target once per file, so a link whose text is also
  inline code is no longer double-counted.
- Project `.agents/README.md` and hub knowledge indexes are now actually
  pointer-checked; the filter listed them but they were never scanned.
- A refused `apply`, `init` or `hub init` prints `FAILED` instead of `APPLIED`.
- The home directory is no longer classified as a project just because it holds
  the user-level `~/.agents/`; a fresh `init --home` setup scores clean.
- The setup skill points at the shipped `skills/` directory.

## 0.5.1 — 2026-11-03

- Added reasoned `doctor.waivers` and precise pointer checks.
- Fixed double-counting of linked wiki files and OpenSpec state.
- Added `GUSTER_EXTRA_SKILL_ROOTS` for additional skill hosts.
