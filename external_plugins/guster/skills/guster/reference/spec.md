# Context Format Spec

spec_version: 1. The format contract for context assets — the shapes that let
both an agent and `guster doctor` verify a document without reading minds.
Each rule carries a stable ID (markdownlint style) and names the finding that
mechanically enforces it. What no finding enforces is guidance for the agent
that writes the document.

## Open conventions this spec follows

- **AGENTS.md** (agents.md) — the open format for the tool-agnostic
  instruction file. Discovery is nested: hosts collect `AGENTS.md` files
  walking outward from the working directory and the nearest one wins. On
  that precedence CTX-01 stacks a stricter discipline: a nested file narrows
  the parent, never contradicts it. Guster reads `AGENTS.md` (and legacy
  `CLAUDE.md`) wherever a host reads them and does not invent a competing
  instruction format; a host that only knows `CLAUDE.md` is served with
  `ln -s AGENTS.md CLAUDE.md`.
- **llms.txt** (llmstxt.org) — index files as curated link lists. A knowledge
  index is an H1, a one-line blockquote summary, then one markdown link per
  file with a one-line description. Same shape, local files instead of URLs.
- **YAML front-matter** — the `---`-delimited metadata block; the de-facto
  standard Jekyll, Hugo and Gray Matter share. CTX-09 rides it rather than
  inventing a note format.
- **Stable rule IDs** (markdownlint) — rules are numbered, cited by findings
  and waivers, and only change meaning on a spec_version bump.

## Rules

| ID | Rule | Enforced by |
|---|---|---|
| CTX-01 | `AGENTS.md` is the instruction file; nested ones narrow, never contradict. Budgets: hub ≤50 lines, user entry ≤150 lines, resident total ≤20 KB. | `resident-budget` |
| CTX-02 | Every knowledge scope has a README index in llms.txt shape; every knowledge file appears there verbatim, as `- [title](path): one-line description`. An index that names nothing is empty. | `orphan-knowledge` |
| CTX-03 | Any file path in an instruction or index document is machine-verifiable: a markdown link or inline code, never naked in prose. A pointer also states when to read the target. | `broken-pointer`, `naked-pointer` |
| CTX-04 | State documents carry a machine-readable date. The canonical key is `verified_at: YYYY-MM-DD`; the Chinese prose keys (`最后更新`/`更新时间`/`更新于`/`最近核实`/`最后核实`/`已核实`) and the English prose keys (`Last updated:`/`updated:`) are accepted equivalents within the first 40 lines, as is a date that opens the filename. Without a declared date the ladder falls back to the repository's last git commit, then to file mtime; no signal at all means stale. | `stale-state` |
| CTX-05 | `.agents/` has exactly the six slots — `plans/`, `wiki/`, `evidence/`, `skills/`, `tmp/`, `archive/` — plus `README.md`/`AGENTS.md`. Task bundles live in a slot, never at the top level. | `misplaced-artifact` |
| CTX-06 | One home per fact. Same topic, same filename stem; the second home becomes a pointer to the first. Copies are either byte-identical or a mistake. | `duplicate-canonical`, `skill-copy-drift` |
| CTX-07 | Skill frontmatter carries `name` and `description` only; one trigger sentence, ≤500 chars each, ≤6,000 chars across the library. | `skill-budget` |
| CTX-08 | Credentials appear by reference — a path in the registry under the canonical root — never as a value in a document, a config or git. | `secret-in-git`, `secret-outside-root`, `secret-inline`, `secret-undeclared`, `secret-missing` |
| CTX-09 | A knowledge note may carry YAML front-matter following the Obsidian properties convention (the interchange format Foam/Quartz/Logseq also accept). The header is opt-in: it is machine-checked only when it declares `type:`. A checked header must parse and carry a machine-readable date (`updated`/`date`/`lastmod`/`created` as YYYY-MM-DD), and the note's body then joins the CTX-03 pointer scan — truth sources go in the body as links, never as invented header keys. Optional keys: `name` and `description` state what the note is (the one-fact-per-file shape inspired by the Claude Code memory tool), and `superseded_by` names the path or stem of the note that replaced this one; that key is metadata about the note, not a truth source, so it never joins the pointer scan and never raises a finding. | `note-header-malformed`, `broken-pointer`, `naked-pointer` |
| CTX-10 | The hub's project registry (`projects/_registry.md`) is a machine-readable table. The header row names the columns; whichever column header contains `path` or `路径` is the path column, and each row's cell there holds one project location — `~/...`, absolute, or relative to the hub root. The slug column (first column) never counts as a path. Remote forms (`host:/path`, URLs) and placeholder cells (`-`, `—`) are skipped, not resolved. | `registry-drift` |

### CTX-10 in detail

The registry table is read through its path column, so a row is only as good
as its path cell. Conventions that keep the three-way diff (machine table
`registry.json` ↔ this human table ↔ git roots on disk) meaningful:

- Header row first: the parser finds the path column by header name
  (`path` / `路径`, case-insensitive) and never guesses by position.
- One project per row; the path cell names the project **directory**, not a
  file inside it. Trailing `/` and wrapping backticks are tolerated.
- `~/`-relative paths resolve against the user's home; bare relative paths
  resolve against the **hub root**; absolute paths resolve as-is.
- A row whose path does not exist on disk is a dead row (`registry-drift`,
  medium); a row that exists but is never scanned points outside the
  configured roots (medium); a scanned project with no row is unregistered
  (low). Remote references are counted apart instead of drifting forever.

### Credential registry table

CTX-08's registry (`~/.agents/credentials/registry.md`) is a markdown table
with a fixed column order; only paths and variable **names** live here,
never values:

| # | Column | Required |
|---|---|---|
| 1 | ID | yes |
| 2 | scope (`company`/`personal`) | yes |
| 3 | site | yes |
| 4 | account | yes |
| 5 | kind | yes |
| 6 | locations | yes |
| 7 | keys (variable names) | no |
| 8 | used_by | no |
| 9 | status | no |

A pipe row with fewer than the six required columns is a parse warning, not
silence; `guster credentials` prints it.

## Why a format contract

The metrics are static: filename stems, content hashes, path resolution, git
dates. A document that ignores the contract is not scored lower — it is
invisible. A naked path in prose never reaches the pointer check; a date
written as "last week" falls back to git; an index without filenames counts as
missing. The contract is what makes measurement possible, and the score is
what keeps the contract from drifting. Both directions are load-bearing.

## Writing guide (no finding enforces this)

When creating or moving a context asset:

1. Pick the home by CTX-06, the slot by CTX-05, the index entry by CTX-02; a
   new project gets its registry row by CTX-10.
2. Write pointers as `[label](relative/path.md)` in indexes and `` `path` ``
   in prose; add when-to-read in the same sentence.
3. Add the date line before saving a state document; run `guster doctor`
   after edits — a new finding names the rule you just broke.
4. A note that summarizes knowledge whose truth lives elsewhere (a pointer
   card) opts into CTX-09: standard front-matter (`type: pointer`, a date
   key, `tags` if useful) plus a truth section of ordinary markdown links.
   `name` and `description` are optional metadata; so is `superseded_by`,
   which marks the note a better one replaced — the chain is for readers;
   the scanner never resolves it. Volatile values (latest numbers, current
   picks) stay out of the card and are read from the truth sources instead.

## Versioning

Additive changes keep spec_version; a rule that changes meaning bumps it and
gets a CHANGELOG entry. Findings cite rule IDs, waivers accept them, so a
spec change never silently re-targets an existing waiver.
