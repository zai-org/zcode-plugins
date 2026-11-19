# Changelog

## 0.9.5 — 2026-11-19

- **apply/plan safety hardening**: plans are validated for schema
  equivalence before execution, path boundaries keep every operation inside
  its intended root (paths are resolved first, so a symlink cannot smuggle
  a write past the boundary into the allowed roots), the legacy `pointer`
  operation is removed from the executor, backups can no longer be
  overwritten by a later plan, and a failed `mkdir` rolls back with the
  rest of the plan.
- **Drift baseline fixed**: the machine↔disk drift check compares against
  the registry captured *before* this scan overwrites it (the old code read
  the file back after its own write, so write-path runs never saw drift);
  a corrupt baseline is a visible finding instead of a silent skip.
- **Crash fix**: `sk-`-shaped tokens no longer crash the scan.
- **Index shape recognition**: llms.txt-style index forms are recognized for
  index coverage.
- **Removed command surface** (breaking): the `upgrade` subcommand, the
  `plan init` subcommand, the explicit `--dry-run` flag and the `--home`
  flag are gone. DRY-run-by-default and `--yes` semantics are unchanged;
  `guster init --project <path>` replaces `plan init` for scaffolding.
- **`hub init` preflight exits 4**: a plan refused at preflight (non-empty
  target, bad type) now returns exit code 4, aligned with `apply`/`init`.
- **CLI polish**: `score --fail-under` failures emit a JSON error envelope
  under `--json` (exit 2 unchanged); `init` refuses an existing broken
  `config.json` instead of returning a success-shaped no-op;
  credential-registry warnings no longer echo the broken row's text.
- **Documentation alignment and skill simplification**: the docs describe
  the current architecture only (hub schema 2 declarative paths, five FRS
  state prefixes, scaffold-shaped placement tree, CTX-09 date-key list,
  credential-registry precondition); legacy directory names are marked as
  compat-scan-only; the `guster` skill is compressed to 150 lines and the
  reformat playbook to 75 without dropping commands, workflow, gates, exit
  codes or rule IDs.

## 0.9.4 — 2026-11-19

The hub contract catches up with the reference hub's 2026-11-19 restructure,
and the format spec gains its first structured-knowledge contract. The plugin
still ships no organization policy — it discovers what exists and validates
what files declare.

- **Root README.md is optional** (relaxation): required root files are now
  `AGENTS.md` + `hub.yaml`; an existing root README.md stays untouched (no
  check depends on it), and `hub init` still scaffolds one. +1 test.
- **Hub scan alias `output/`** joins `Human Output/` (kept as the legacy
  alias) for evidence/deliverables directories.
- **Knowledge subzones are discovered, not enumerated**: the scanner no
  longer hardcodes `general/` + `projects/` + `workgroups/` under the
  knowledge root. Every first-level directory (`machines/`, or anything) is
  scanned as knowledge and index-checked against `knowledge/README.md`.
  Strict validation now index-checks `.yaml`/`.yml` notes, not only `.md`,
  and only requires the knowledge root plus its README — no specific subzone
  names.
- **CTX-10 becomes register/v1** (breaking, spec_version 2): the hub's human
  project table moves from `projects/_registry.md` (markdown table) to
  `register/projects.yaml` — a `schema: register/v1` + `kind: projects` +
  `updated:` header with one row per project (`id`, `status`, `as_of`,
  `name`, `spec.path`). `hub init` scaffolds it; validation requires it; the
  three-way drift diff (machine table ↔ register ↔ disk) and the entry
  counter follow. New `registry-format` finding: wrong `schema`/`kind`, duplicate ids,
  missing `spec.path` or non-date `as_of`/`status` (a missing `updated`
  date is caught by strict `hub validate`, not by the finding).
- **register/v1 shape errors fail loud**: a register whose body carries
  column-0 `id:`/`name:` mapping keys but parses zero `- id:` rows (the flat
  single-project map) now raises `registry-format` instead of silently
  validating nothing. `hub validate`'s `updated:` check is strict ISO at the
  same time — `2026/1/5` no longer passes, only `2026-01-05`.
- **register/v1 vocabulary clarified**: `status` adds `on-hold`; `as_of` is
  optional (checked when present); `name` is optional and never validated;
  `spec.path: ./` is the legal placeholder for a row that owns no directory
  of its own; unknown row keys and `spec` subkeys are ignored and never
  validated — the vocabulary only grows, semantics change only on a
  spec_version bump. Another register/ YAML declaring register/v1 with a
  foreign `kind:` gets an info finding: accepted as register data, never
  validated.
- **CTX-11: the knowledge/v1 contract** (new, opt-in): a YAML knowledge file
  that declares `schema: knowledge/v1` gets strict checks — required metadata
  (`id` = file stem, `type` required with vocabulary, optional in-vocabulary
  `status`, non-empty `topic`,
  YYYY-MM-DD `as_of`/`updated` with `updated` ≥ `as_of`), `see_also` bare-id
  cross-references resolved against the knowledge root, one-id-one-file, and
  a 90-day freshness SLA for active `state`/`index` files. Plain notes are
  never touched. Findings: `knowledge-format`, `see-also-broken`,
  `duplicate-knowledge-id`, `knowledge-stale`.
- **knowledge/v1 typos stay visible**: a knowledge file that declares a
  `knowledge/*` or `register/*` schema other than knowledge/v1 reports an
  info finding instead of silently opting out of every check, and a
  `see-also-broken` reference whose file exists without the v1 header says
  so in the finding. CTX-02 accepts an equivalent two-column markdown index
  (backticked path + topic). The hub scaffold gains an all-commented
  knowledge/v1 skeleton (`knowledge/general/knowledge-v1-skeleton.txt`) and
  the register template a commented example row.
- **Dependency-free metadata parsing**: `parse_yaml_head` /
  `parse_register_rows` read only the column-0 metadata face of YAML files
  (scalars, one inline list, nested `spec.path`); the prose body is never
  parsed, so the plugin still runs on a stock Python install.
- All CTX-11/registry-format findings stay outside CHI (the registry-drift
  discipline), so health scores remain comparable across the upgrade.
- **`plan move` stops writing pointers** (breaking for plan outputs): the
  plan is mkdir + move with a backup; the automatic `<name>.moved.md`
  transition pointer at the old location is gone. It outlived its
  referencers, re-triggered `misplaced-artifact`, and read as reversible
  after the source was gone — update the referencers in the same pass
  instead.
- **`guster link` removed**: the standalone pointer listing duplicated what
  `doctor`'s `broken-pointer` finding already reports. The command, its
  exit-code row and the report hint are gone.
- **Zone and hub `profile` retired**: `zones add --profile` is gone and
  `config.json` zone entries are `{path}` only (a legacy `profile` key is
  tolerated and ignored); `hub.yaml` loses `profile` (a leftover key is
  ignored, and unknown top-level manifest keys no longer fail the JSON
  Schema — local extensions validate too).
- **GCR leaves every output**: after 0.9.3 made it reported-only, the
  governance metric is deleted — no `metrics.gcr`, no report footnote. The
  `hub.yaml` `governance_docs` declaration and the `governance-overlap`
  finding (more than 4 framework docs) stay.
- **Score output says what it measured**: a CHI that cannot be computed
  prints how many dimensions were (`n/a / 100 (5/7 dims scored)`), trend
  lines render `n/a` instead of `None`, and the output points at
  `skills/guster/reference/metrics.md` for definitions and targets. The
  machine-scope summary labels its skills line "(user-level roots only)",
  `guster init`'s dry run lists the files it would create, and finding
  paths resolve to one spelling (`/private/tmp` vs `/tmp` no longer mix).
- **Templates and both SKILL playbooks rewritten for the register (the
  new-project onboarding step now drafts a register/v1 row); `project cards`
  vocabulary retired across docs.
- **Migration from 0.9.3**: create `register/projects.yaml` (header:
  `schema: register/v1`, `kind: projects`, `updated:` date; then one row per
  project), delete the old `projects/_registry.md`, and re-run
  `guster hub validate`. Until then `hub attach`/`hub status` refuse the hub
  and doctor reports `registry-drift: Hub has no register/projects.yaml`.
  192 py + 2 node tests green (+26 over 0.9.3, covering dynamic subzones, yaml
  index checks, register drift/format/shape and vocabulary, knowledge/v1
  typo visibility, the pointer/link/profile/GCR retirements and the score
  output).

## 0.9.3 — 2026-11-18

The honest-third-party release: no measurement ships with a built-in list of
the author's own documents, no version drift can hide between the CLI and the
manifests, and no flag pretends to do something it does not.

- **GCR is configured, not hardcoded** (breaking for the metric): the
  governance complexity ratio counted five fixed framework doc names that only
  exist in the original author's hub, so every third-party install measured
  `0` and still looked scored. The list is now the hub's own `governance_docs`
  key in `hub.yaml` (added to `schemas/hub.schema.json`); a hub that declares
  no list reports GCR as `n/a` through the same empty-evidence rule as every
  other dimension. `scores.gcr` no longer exists in any output — GCR was
  documented as "reported, never scored", and now the JSON agrees. The
  `governance-overlap` finding (more than 4 framework docs) still fires when
  the list is declared.
- **`upgrade` compares the CLI too**: the command only diffed the three
  manifests against each other, so a CLI that drifted from all of them stayed
  green. The CLI `__version__` is now part of the comparison set and any
  disagreement exits 2; `--json` reports a `versions` object (`cli`, `codex`,
  `zcode`, `package`) instead of the old `manifests` map.
- **`export --format json` writes only the JSON report** (behavior change):
  it used to write the Markdown report unconditionally and add a `.json`
  sibling; with `--format json` the Markdown file is no longer produced.
  `--format md` (the default) is unchanged.
- **Removed the dead `score --write` flag**: `cmd_score` never read it —
  writing metrics is the default and `--no-write` is the real opt-out.
- **`.release-gate.json` left public tracking**: the local release-gate
  allowlist now lives in the gitignored `.agents/` directory; the gate tool
  reads it from either location.
- All five version sources (CLI, `pyproject.toml`, both plugin manifests,
  `package.json`) realigned at 0.9.3; `test_manifest_versions_match` is green
  again.

Notable changes. Earlier history is in `git log`.

## 0.9.2 — 2026-11-18

- New icon: a 1-bit pixel directory-tree base patrolled by four glowing
  sparks — the audited-order home with agents shuttling between levels.
  Part of the shared pixel family across the six plugins; no code changes.

Notable changes. Earlier history is in `git log`.

## 0.9.1 — 2026-11-14

The format-spec release: the context format contract is now externally
deliverable — schema-checked in the editor, sourced to open conventions, and
stated in attributable vocabulary.

- **JSON Schema contracts**: `schemas/hub.schema.json` and
  `schemas/plan.schema.json` (draft 2020-12, derived from the code that
  reads and writes each format) pin the `hub.yaml` manifest and the plan
  JSON. The scaffolded `hub.yaml` ships a yaml-language-server modeline on
  its first line, so the VS Code YAML extension validates it with zero
  configuration, and an agent hand-writing a batch plan has the exact field
  contract to check against before the `apply` dry-run. `tests/test_schemas.py`
  keeps both contracts honest with a stdlib-only mini validator.
- **CTX-09 optional keys**: a note header may carry `name` and `description`
  (the one-fact-per-file shape inspired by the Claude Code memory tool) and
  `superseded_by`, the path or stem of the note that replaced this one — pure
  metadata, never part of the pointer scan, no new finding. The naked-pointer
  scan now skips front-matter, so `superseded_by` values are not misread as
  naked pointers. `spec_version` stays 1.
- **Open conventions, sourced**: the spec's conventions section now states
  AGENTS.md as an open format (nearest-wins nested discovery, the same
  narrow-never-contradict discipline as CTX-01, plus the
  `ln -s AGENTS.md CLAUDE.md` recipe) and YAML front-matter as the de-facto
  standard Jekyll, Hugo and Gray Matter share.
- **README positioning**: both READMEs gain a schema-contracts chapter, the
  conventions sourcing, a compact prior-art section (Cline Memory Bank,
  Claude Code memory tool, Letta, Mem0, Zep — inspired-by wording
  throughout), and the Anthropic vocabulary (structured note-taking,
  'just in time' context, context rot, compaction); the project tree lists
  `schemas/`. English and Chinese stay semantically aligned.

## 0.9.0 — 2026-11-14

The "installed and fully usable" release: the new-user journey is closed end
to end — first run, configuration, onboarding a project, and the patrol loop.

- **First run without a config**: guster probes the conventional roots
  (`~/Projects`, `~/code`, `~/dev`, `~/src`), scans hits under an
  "Unconfigured" banner telling you to run `guster init`, and fails loud
  (exit 1, pointing at `init --root`) when none exists. The silent fallback
  to scanning the whole home directory is gone. `init` now writes the
  detected roots instead of hardcoding `~/`; a bare `init` with no candidates
  requires `--root`.
- **`guster check`**: `scan` → `doctor` → `score --trend` in one pass, one
  report; the exit code carries the doctor semantics (2 high, 3 critical).
  Human-driven patrol only — no scheduled runs.
- **`guster zones list|add|remove`**: manage the machine zones in
  `config.json` with the same fail-loud validation as the rest of the config.
- **Config validation is uniform**: `roots` must be a list of existing
  absolute paths (a bare string is a type error, never a list of characters),
  `roots: []` is rejected, as are relative paths, missing zone directories
  and a `hub` that is not a directory.
- **Default hub de-privatized**: nothing defaults to a private layout anymore;
  without a config there is no hub and the banner says so. `hub status`
  prints "no hub attached" and exits 0; `--hub` pointing at a non-hub
  directory is a `hub-manifest-missing` finding instead of a silent clean
  report. Hub wording: "missing" → "absent".
- **Registry drift (CTX-10)**: the machine table (`registry.json`), the hub's
  human table (`projects/_registry.md`, read through its path column) and the
  git roots on disk are three-way diffed; dead rows, unscanned rows and
  unregistered projects are findings, never a CHI dimension. `host:/path`
  remote rows are counted apart.
- **Data safety**: state writes are atomic (tmp + `os.replace`) and serialized
  by an flock on `<state_dir>/.lock`; `--no-write` genuinely suppresses the
  state file of `scan`, `doctor`, `score` and `check`; a corrupt registry
  warns and rescans instead of silently self-healing.
- **Freshness and dates**: `verified_at` is the canonical date key; English
  prose keys (`Last updated:`/`updated:`) join the Chinese family; without a
  declared date the ladder falls back to the last git commit and then to file
  mtime (labeled in the raw column). Index matching requires the backtick
  form, so `a.md` no longer hits `data.md`.
- **Credentials**: rows with too few columns raise parse warnings instead of
  vanishing; `guster credentials` prints bilingual scope labels; the fixed
  9-column order is documented with a copyable sample (README and spec).
- **Plans and recovery**: a bad plan reports the expected schema shape;
  `.moved.md` pointers carry a `verified_at` date; only the newest 10 plan
  backup directories are kept; a failed apply rolls back automatically, and
  if the rollback itself fails the error names the backup directory for
  manual recovery (there is no separate rollback command — the README now
  says exactly this).
- **Skill**: new "New project onboarding" playbook (inventory roots/zones →
  propose placement → user confirms → create + `init --project` → draft the
  CTX-10 registry row → `scan`/`doctor` close the loop; git operations follow
  the user's own git conventions). Waivers now state explicitly that a waiver
  greens the gate, not the score. "Company repository" wording is replaced by
  the mechanism: tracked files you do not own or have no authority over.
  Private skill references are gone.
- **Docs**: README/README_CN gain a roots-and-zones configuration chapter
  (including `scan_max_depth`), the `check` command, a full exit-code table
  (0–4, shared with the skill), and the four fixed inaccuracies (backups
  manual recovery, five state files, `export`'s default output path, the
  credential sample row). Hub templates emit `verified_at` dates. The main
  `guster --help` carries a one-line epilog about state writes and exit codes.

## 0.8.0 — 2026-11-14

- **Declarative hub contract (schema 2)**: `hub.yaml` sections are now
  declared, not prescribed. A schema-2 hub declares what it has — only
  `knowledge` and `projects` are mandatory — so a hub without a `tools`
  section validates instead of failing. Declared sections may point outside
  the hub with an absolute or `~/` path (validated for existence, not
  containment). Schema-1 manifests behave exactly as before.
- **Machine zones with governance profiles** (`config.json` `zones`):
  `{path, profile}` entries describe tool areas that are not repositories.
  The `light` profile scans AGENTS.md/README.md entry docs (pointer health,
  freshness) and `.env` secrets without demanding `.agents/` slots — a
  non-git tool layer is governed without pretending each tool is a project.
  Registry and `status` carry the zone summary; bad zone config fails loud.
- **Tool entry docs join pointer checks**: artifacts of kind `tool` (hub
  tools sections and machine zones) are now pointer-scanned like other entry
  documents; previously only their AGENTS.md was seen.
- Pointer scan cap raised from 200 to 500 files per run.
- `status` warns when the cached registry was written by a different CLI
  version, and prints declared zones.
- Default workspace roots no longer include the private `~/ZCodeProject`;
  candidates are `~/IdeaProjects` and `~/Projects` (config overrides).
- `hub init` template now emits a schema-2 manifest.

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
