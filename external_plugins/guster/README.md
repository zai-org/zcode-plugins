# Guster

Guster is a distributable agent plugin that audits and evolves the context of a whole machine: projects, instruction files, skills, tools, knowledge, project state, evidence and credential references. It can also scaffold a lightweight Hub for durable knowledge and project state.

It is the **control plane** for agent context. A Guster Hub is the optional **data plane**: the local repository that holds project cards, knowledge, tools and reports. The plugin does not replace the hub; it discovers it, validates it, and helps keep it coherent.

## What it does

- **Discovers** Git roots, `AGENTS.md` / `CLAUDE.md`, `.agents/` directories, skills, tools, knowledge, state, evidence and credential locations.
- **Diagnoses** resident budgets, skill metadata budgets, copy drift, duplicate canonical sources, orphan knowledge, broken pointers, misplaced task folders, stale state, inline tokens and credentials outside the canonical root.
- **Scores** context health with seven dimensions and a CHI dashboard.
- **Plans** structural changes as reviewable JSON plans.
- **Applies** only with `--yes`, with a backup and rollback path.
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
  The date comes from `verified_at`, a `最后更新` line in the first 40 lines, a
  date that opens the filename (`2026-11-05-…`, `20261105-…`), or the last git
  commit of the repository that owns the document. A date buried in prose or a
  ticket number inside the name is not a freshness claim.
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
(spec_version 1, rules `CTX-01..08` plus `CTX-09` structured note header in 0.7.2, markdownlint-style stable IDs). It follows
open conventions instead of inventing new ones: `AGENTS.md` for instruction
files ([agents.md](https://agents.md)), llms.txt-shaped link indexes
([llmstxt.org](https://llmstxt.org)), stable rule IDs like markdownlint.

A document that ignores the contract is not scored lower — it is invisible: a
naked path in prose never reaches the pointer check, a date written as "last
week" falls back to git, an index without filenames counts as missing. Since
0.7.0 the `naked-pointer` finding closes that gap from the other side: file
paths left outside a link or code span in an instruction or index document are
reported, so the unwritable form is also the flagged form.

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
It never holds values. `guster credentials` prints the split.

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

- Read-only on your workspace by default. `apply --yes`, `init --yes`, `hub init --yes` and `hub attach` are the only commands that change workspace files or Guster config on their own; `export --out <path>` writes the report path you name.
- Guster keeps three state files under its state directory (`~/.agents/guster/`, or `scoped/<hash>/`): `registry.json`, which every scanning command rewrites (`status` included, when no registry exists yet), plus `findings.json` from `doctor` and `metrics.jsonl` from `score`. `--no-write` suppresses the state file of `scan`, `doctor` and `score` only.
- Credential values are never persisted or printed; scans keep only paths and redacted shapes.
- No automatic `git add`, `commit`, `push` or deploy.
- Company/public repository tracked files are not ordinary migration targets.
- Plans are written to `~/.agents/guster/plans/`; backups to `~/.agents/guster/backups/`.

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
tests/                fixture and plugin tests
```

## Test

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_plugin.mjs
```

## License

MIT © Lumos-789
