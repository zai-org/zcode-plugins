# Guster

Guster is a distributable agent plugin that audits and evolves the context of a whole machine: projects, instruction files, skills, tools, knowledge, project state, evidence and credential references. It can also scaffold a lightweight Hub for durable knowledge and project state.

It is the **control plane** for agent context. A Guster Hub is the optional **data plane**: the local repository that holds project cards, knowledge, tools and reports. The plugin does not replace the hub; it discovers it, validates it, and helps keep it coherent.

## Prior art

The ideas are borrowed with credit; the implementation is guster's own.

- **Cline Memory Bank** — inspired the layered responsibilities of the files (project cards, knowledge, state) and the banking rhythm of refreshing them per working session; both banks are plain markdown.
- **Claude Code memory tool** — inspired the one-fact-per-file note shape and front-matter metadata; guster's note headers spell the keys `name`, `description`, `type`.
- **Letta (MemGPT)** — inspired the label/limit abstraction of memory blocks behind guster's resident budgets.
- **Mem0** — inspired the decide-first stance (ADD/UPDATE/DELETE/NOOP, soft invalidation by marking instead of deleting) behind plan/apply/waiver; a waiver greens the gate, not the score.
- **Zep/Graphiti** — inspired the dual-timeline fact model (`valid_at`/`invalid_at`); `superseded_by` is its one-file simplification.
- The framing vocabulary — structured note-taking (agentic memory), 'just in time' context, context rot, compaction — is inspired by Anthropic's "Effective context engineering for AI agents" (2025-09-29).

## What it does

- **Discovers** Git roots, `AGENTS.md` / `CLAUDE.md`, `.agents/` directories, skills, tools, knowledge, state, evidence and credential locations.
- **Diagnoses** resident budgets, skill metadata budgets, copy drift, duplicate canonical sources, orphan knowledge, broken pointers, misplaced task folders, stale state, inline tokens and credentials outside the canonical root.
- **Scores** context health with seven dimensions and a CHI dashboard.
- **Plans** structural changes as reviewable JSON plans.
- **Applies** only with `--yes`, backing up every touched path and rolling back
  automatically when an operation fails.
- **Initializes** a standard `.agents/` layout for a new project or a new machine.
- **Scaffolds** a lite Guster Hub when the user does not have a data plane yet.

## Quick start

```bash
cd <checkout>
./bin/guster init --yes
./bin/guster hub init --path <hub> --yes
./bin/guster scan
./bin/guster doctor
./bin/guster score
```

`guster check` runs the scan → doctor → score (with trend) pass as one command
when you want the whole picture at once.

The CLI is Python 3.9+ and has no third-party Python dependencies.

Install a stable command on your `PATH`:

```bash
ln -s "$(pwd)/bin/guster" ~/.local/bin/guster
```

## Commands

| Command | Purpose |
|---|---|
| `guster status` | Show plugin version, registry and health summary |
| `guster scan` | Discover context assets and write `registry.json` |
| `guster doctor` | Run policy checks and write `findings.json` |
| `guster score` | Compute metrics and CHI; append `metrics.jsonl`. `--fail-under N` turns it into a gate (exit 2) |
| `guster check` | `scan` + `doctor` + `score --trend` in one pass; exit code carries the doctor semantics |
| `guster zones list/add/remove` | Manage the machine zones in `config.json` |
| `guster plan findings` | Turn findings into a review checklist |
| `guster plan move` | Plan a move with backup and pointer |
| `guster plan init` | Plan a standard `.agents/` layout |
| `guster apply <plan>` | Dry-run by default; `--yes` writes with backup |
| `guster init` | Initialize the state home or a project |
| `guster hub init` | Create a lite Hub and attach it to the local config |
| `guster hub attach` | Attach an existing Hub without copying its content |
| `guster hub status` | Show the Hub manifest and contract checks |
| `guster hub validate` | Validate the lite Hub contract |
| `guster link` | Check context pointers |
| `guster export` | Export a redacted Markdown/JSON report |
| `guster credentials` | List registered credentials by scope (company / personal) |
| `guster upgrade` | Check Codex/ZCode/package manifest versions |

## Configuration: roots and zones

`~/.agents/guster/config.json` declares where your context lives:

```json
{
  "version": 1,
  "roots": ["/home/me/Projects"],
  "zones": [{ "path": "/home/me/tools", "profile": "light" }],
  "scan_max_depth": 5
}
```

- **`roots`** — the workspace roots scanned for git repositories. Must be a
  list of existing absolute paths; a bare string, an empty list, a relative
  path or a missing directory fails loud instead of being reinterpreted.
- **`hub`** — the attached Guster Hub path (written by `hub init`/`hub attach`).
- **`scan_max_depth`** — how deep under each root the scanner walks looking
  for git repositories (default 5). Raise it for deeply nested layouts, lower
  it to speed up huge trees.
- **`zones`** — tool areas that are not repositories: a tools directory you
  want governed without pretending each tool is a project. A zone is scanned
  light-style: its `AGENTS.md`/`README.md` entry docs join the pointer and
  freshness checks, its `.env` files join the secret scan, and `.agents/`
  slot compliance never applies. `profile` is recorded and must be
  `light` or `full`; the scan itself is light for every zone today.

Manage zones with the `zones` subcommand (`list`, `add <dir> --profile`,
`remove <dir>`); it writes `config.json` and applies the same validation.

**First run without a config**: guster probes the conventional directories
`~/Projects`, `~/code`, `~/dev` and `~/src`. Hits are scanned with an
"Unconfigured" banner telling you to run `guster init` to pin them; if none
exists the command fails loud (exit 1) pointing at
`guster init --root <path>`. Guster never silently scans your home directory.

## Lite Hub

The plugin can create a deliberately small data plane:

```text
Guster/
├── AGENTS.md
├── README.md
├── hub.yaml
├── knowledge/
│   ├── README.md
│   └── general/start-here.md
├── projects/
│   └── _registry.md
└── tools/
    └── README.md
```

`tools/` is present as an index and contract, with no tool preinstalled. `handoff/` and `reports/` are optional and are not created by the lite profile. The scanner skips missing optional directories.

`guster hub init` refuses a non-empty target, writes a reviewable plan, and attaches the new Hub to `~/.agents/guster/config.json`. Use `guster hub attach --path <hub>` for an existing Hub.

The three core roots can be chosen at creation time:

```bash
guster hub init --path <hub> --knowledge notes --projects work --tools scripts --yes
```

They are recorded in `hub.yaml` under `paths` and can be changed later. Paths must be relative to the Hub and must stay inside it.

Scanning follows the directories that exist, not a mode: `profile` in `hub.yaml` is only a label. A hub is scanned across its knowledge root (`general/`, `projects/` and `workgroups/` under it), the configured project state root, `handoff/`, `provision/`, `reports/`, `Human Output/`, `manuals/`, `cron-tasks/`, `openspec/`, `archive/`, `.agents/plans/` and `strategy.md` whenever those exist. Generated or runtime areas such as `out/`, `.manual-site/`, `.playwright-mcp/` and `.codegraph/` are not treated as knowledge sources. `--scope hub` is Hub-only; local wiki and machine-level secrets belong to the machine scope.

## Health model

```text
CHI = 0.20 SSR + 0.15 RBR + 0.15 PCR + 0.15 ICR
    + 0.15 FRS + 0.10 PHR + 0.10 SIR
```

- **SSR** single-source rate
- **RBR** resident budget ratio
- **PCR** placement compliance rate: share of `.agents/` dirs with all six
  standard slots, a non-empty index and no unknown top-level entry. The
  denominator is `.agents/` dirs only — a repository that never adopted the
  layout is not scored, and a directory that holds other scanned projects (a
  workspace or group root) is not a project. The report prints the failure
  breakdown, so a low number says why instead of just being low.
- **ICR** index coverage rate
- **FRS** state freshness rate: share of state documents under the hub's
  project root (`projects/`), `handoff/`, `provision/` and `.agents/plans/`
  that were verified within the 90-day SLA. The denominator is those four
  prefixes only — a hub `reports/` file or a machine-level note is not state.
  The date comes from a declared key — `verified_at` (canonical), the Chinese
  `最后更新` family or the English `Last updated:`/`updated:` — in the first 40
  lines, or a date that opens the filename (`2026-11-05-…`, `20261105-…`);
  without one, the ladder falls back to the owning repository's last git
  commit, then to file mtime (labeled as such in the raw column). A date
  buried in prose or a ticket number inside the name is not a freshness claim.
- **PHR** pointer health rate
- **SIR** secret isolation rate: credential files plus literal tokens in host
  configuration. Guster does not scan arbitrary file content for token shapes —
  that is the release gate's job; SIR only claims what it actually looked at.

Critical findings do not rescale CHI: they make `doctor` exit 3 (any `high`
finding exits 2), and the score stays the weighted sum above. Treat the exit code
as the gate and CHI as the trend.

A dimension with no evidence is reported as `n/a` and dropped from the weighted
sum instead of scoring 1.0: an empty denominator means "not measured", not
"perfect". When every dimension of a scope is empty, CHI itself is `n/a`.

## Context format spec

The metrics are static — filename stems, content hashes, path resolution, git
dates — so they only see documents that keep the format contract. The contract
is written down and versioned: [`skills/guster/reference/spec.md`](skills/guster/reference/spec.md)
(spec_version 1, rules `CTX-01..10` — `CTX-09` structured note header, `CTX-10`
machine-readable project registry — markdownlint-style stable IDs). It follows
open conventions instead of inventing new ones: the open `AGENTS.md` format
([agents.md](https://agents.md)) for instruction files — discovery is nested
and nearest-wins, the same discipline as CTX-01 (a nested `AGENTS.md` narrows
the parent, never contradicts it), and a host that only reads `CLAUDE.md` is
served with `ln -s AGENTS.md CLAUDE.md` — llms.txt-shaped link indexes
([llmstxt.org](https://llmstxt.org)), YAML front-matter for note headers (the
de-facto standard Jekyll, Hugo and Gray Matter share), and stable rule IDs
like markdownlint.

A document that ignores the contract is not scored lower — it is invisible: a
naked path in prose never reaches the pointer check, a date written as "last
week" falls back to git, an index without filenames counts as missing. Since
0.7.0 the `naked-pointer` finding closes that gap from the other side: file
paths left outside a link or code span in an instruction or index document are
reported, so the unwritable form is also the flagged form.

## Schema contracts

The two machine-readable formats carry JSON Schema (draft 2020-12) contracts,
derived from the code that reads and writes them:

- [`schemas/hub.schema.json`](schemas/hub.schema.json) — `hub.yaml`. The
  scaffolded manifest ships with a yaml-language-server modeline on its first
  line, so the VS Code YAML extension (or any editor speaking
  yaml-language-server) validates `hub.yaml` with zero configuration:

  ```yaml
  # yaml-language-server: $schema=https://raw.githubusercontent.com/Lumos-789/guster/main/schemas/hub.schema.json
  ```

- [`schemas/plan.schema.json`](schemas/plan.schema.json) — the plan JSON that
  `plan` writes and `apply` executes. An agent hand-writing a batch plan has
  the exact field contract to check against before the `apply` dry-run.

## Scopes

| Level | Command | Scored dimensions |
|---|---|---|
| machine | `guster doctor` | SSR RBR PCR ICR FRS PHR SIR |
| hub | `guster doctor --scope hub` | SSR ICR FRS PHR |
| group | `guster doctor --root A --root B` | SSR PCR ICR FRS PHR |
| project | `guster doctor --root <repo>` | SSR PCR ICR FRS PHR |

Scoped runs write to `~/.agents/guster/scoped/<hash>/`.

Every scoped run applies one boundary to both sides of the report: an artifact
counts toward a denominator only when a finding about it could also appear in
that scope. `project` and `group` runs therefore drop hub knowledge, hub state
documents and the machine-level local wiki from ICR/FRS/PHR unless they live
under one of the given roots; the report table shows exactly the dimensions that
enter CHI, and any extra value is labeled `Not counted in CHI`. A dimension with
no in-scope artifacts stays vacuous (`0/0` in the raw column, `n/a` score) instead
of borrowing health from out-of-scope files. This changes CHI for `project` and
`group` scopes; hub health keeps being reported by `--scope hub` and the
machine-wide run. Because empty dimensions are dropped and the weights are
renormalized over what remains, CHI is not comparable across scopes with
different coverage.

## Credential registry

Guster reads `~/.agents/credentials/registry.md` and checks it against every credential file it finds:

- `secret-undeclared` - a credential file is not registered.
- `secret-missing` - a registered location no longer exists.
- `git-unavailable` - a repository could not be queried, so tracked state and
  commit dates are unknown. SIR counts those credentials as unverified rather
  than clean.

The registry holds scope (`company` / `personal`), site, account, kind, location and variable names.
It never holds values. `guster credentials` prints the split. A copyable row
(column order is fixed — see the format spec; the first six columns are
required, `keys`/`used_by`/`status` are optional):

```markdown
| ID | scope | site | account | kind | locations | keys | used_by | status |
|---|---|---|---|---|---|---|---|---|
| example-host | personal | example.com | me@example.com | token | `~/.agents/credentials/example-host.env` | `EXAMPLE_HOST_TOKEN` | my-cli | active |
```

## The eight planes

1. **Truth** — code, tests, build and runtime config.
2. **Instruction** — `AGENTS.md` and policies.
3. **Capability** — skills, tools, MCP, plugins, scripts.
4. **Knowledge** — durable principles, methods, business semantics, pitfalls.
5. **State** — project cards, handoffs, environment and port registries.
6. **Evidence** — reports, screenshots, videos, test output.
7. **Runtime** — sessions, caches, logs, temp files, browser profiles.
8. **Secret** — passwords, tokens, keys, cookies; references only.

## Safety

- Read-only on your workspace by default. `apply --yes`, `init --yes`, `hub init --yes` and `hub attach` are the only commands that change workspace files or Guster config on their own; `export` always writes a report file — `<state-dir>/context-health.md` by default, or the path you name with `--out` (plus a `.json` sibling with `--format json`).
- Guster keeps five files under its state directory (`~/.agents/guster/`, or `scoped/<hash>/`): `config.json` (roots/zones/hub, written by `init`, `hub init`/`attach` and `zones`), `registry.json`, which every scanning command rewrites (`status` included, when no registry exists yet), `findings.json` from `doctor`, `metrics.jsonl` from `score`, and the transient `.lock` that serializes concurrent runs. `--no-write` suppresses the state writes of `scan`, `doctor`, `score` and `check` only. (`plans/` and `backups/` are directories, not files.)
- Credential values are never persisted or printed; scans keep only paths and redacted shapes.
- No automatic `git add`, `commit`, `push` or deploy.
- Tracked files you do not own or have no authority over — a shared or employer repository usually qualifies — are not ordinary migration targets.
- Plans are written to `~/.agents/guster/plans/`. `apply` copies every touched path under `~/.agents/guster/backups/<plan-id>/` before changing it, and rolls back automatically when an operation fails; if the rollback itself fails, the error names that backup directory and you restore by copying the pre-change copies back. Only the newest 10 plan backup directories are kept.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | success — clean run, or findings no worse than `medium` |
| `1` | tool/config error: malformed or unreadable plan, an apply that failed mid-operation and was rolled back, missing workspace root, invalid `config.json` (non-list `roots`, a bad root/zone/hub path, empty `roots`, no scan candidates — run `guster init`); `hub status` also returns 1 when the attached hub fails its checks |
| `2` | `doctor`/`check` found `high` (but no `critical`) findings; `score --fail-under` below target or CHI not computable; `hub validate` failed the lite contract; `link` found broken pointers; `upgrade` found disagreeing manifest versions |
| `3` | `doctor`/`check` found `critical` findings |
| `4` | `apply`, `init` or `hub init` refused the plan at preflight — nothing was touched (missing move source, existing destination, bad target type) |

The same table ships in the `guster` skill so agents and humans read one
contract. Treat the exit code as the gate and CHI as the trend.

## Plugin hosts

| Host | Manifest |
|---|---|
| Codex | `.codex-plugin/plugin.json` |
| ZCode | `.zcode-plugin/plugin.json` |
| DSH | `package.json` + `cordis.patch.yml` |

All three point at `skills/` (the `guster` and `guster-hub` skills). Keep their versions synchronized.

```bash
# DSH bundle
dsh plugin add /path/to/guster
```

### Extra skill roots

By default guster scans `~/.agents/skills`, `~/.codex/skills`, `~/.dsh/skills` and
`~/.claude/skills`. Additional hosts stay local and are injected without changing
the published source:

```bash
export GUSTER_EXTRA_SKILL_ROOTS="name=/path/to/skills:other=/another/path"
```

## Project layout

```text
skills/guster/        agent-facing skill
skills/guster-hub/    hub bootstrap and validation skill
src/guster/           Python CLI and policy engine
bin/guster            executable wrapper
templates/hub/        lite Hub scaffold (the only shipped template set)
schemas/              JSON Schema contracts for hub.yaml and plan JSON
tests/                fixture and plugin tests
```

## Test

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_plugin.mjs
```

## License

MIT © Lumos-789
