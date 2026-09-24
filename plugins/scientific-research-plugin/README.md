# Scientific Research Plugin

**English** | [简体中文](README.zh-CN.md)

![License](https://img.shields.io/badge/license-MIT-green)
![Skills](https://img.shields.io/badge/skills-9_+_1_subagent-blue)
![Harnesses](https://img.shields.io/badge/harnesses-16-orange)

Every task is a piece of research — not just papers. A discipline layer (`research-before-build`) brings prior-art surveying to any project; the paper pipeline — literature acquisition → structured reading → paper figures → writing polish → reference verification → pre-submission review → rebuttal → conference presentation — is its fullest instantiation. Built for OR / ML+OR / supply-chain researchers.

One `skills/` source of truth, distributed to multiple frontends: the Claude Code / ZCode / Codex plugins, the assistants that read `~/.agents/skills` natively (Gemini CLI, Goose, opencode, Kimi Code, pi), and the harness-specific directories that `install.sh` fans out to (Cursor, Crush, Copilot, Amp, Grok Build, Qwen Code, Droid, Kiro).

## Highlights

- **Full lifecycle in one pack.** From a raw reference list to the conference talk: Zotero intake → structured reading notes → journal-grade figures → LaTeX polishing → citation audit → adversarial pre-submission review → point-by-point rebuttal → timed Beamer deck. 9 skills + 1 subagent designed as one pipeline, not nine loose utilities.
- **Facts over model recall.** `reference-verify` fetches citation facts from official APIs (CrossRef / arXiv / PMLR / OpenReview / ACL Anthology / NeurIPS) — commands, not memory. Undecidable entries get web checks whose evidence must carry accessible URLs, and every adverse finding is independently re-checked.
- **Outsider audits, not self-grading.** `paper-review` runs three mutually isolated reviewers (methodology rigor / domain contribution / adversarial attack) plus author-defense arbitration — the failure mode it targets is a model grading its own output. `jargon-check` goes further: an isolated subagent on an independent model reads the polished text as a stranger would.
- **A discipline layer, not just paper tools.** `research-before-build` fires on any non-trivial task — coding, architecture, deployment — and grades the prior-art survey by risk (L0–L3). The paper pipeline is its fullest instantiation, not its boundary.
- **Skills that hand off.** `paper-review`'s C/M/N issue list feeds `rebuttal` directly; `paper-polish` ships a jargon-audit follow-up; `research-before-build` hands the decided reading list to `zotero-paper-fetch`. The chain is designed, not incidental.
- **One source of truth, 16 frontends.** A single `skills/` tree serves three plugin marketplaces (Claude Code, ZCode, Codex), five harnesses reading `~/.agents/skills` natively (Gemini CLI, Goose, opencode, Kimi Code, pi), and eight more via idempotent fan-out (Cursor, Crush, Copilot, Amp, Grok Build, Qwen Code, Droid, Kiro). Symlinks only; `$HOME` stays clean.
- **OR / ML+OR depth, domain-agnostic engine.** Built by a supply-chain-resilience researcher: `figure-plot` ships recipes for Pareto fronts, network topologies and convergence curves with embedded-font verification; `paper-review` detects domain gates per manuscript (OR families, ML+OR, LLM/agents) and composes freely beyond them.

## Research Pipeline

| Skill / Agent | Form | In one sentence |
|---|---|---|
| ⓪ `research-before-build` | skill | Discipline layer, fires on **any** non-trivial task: L0–L3 graded trigger — check human prior art (official docs / mature libraries / GitHub issues / literature) before building; decides *whether and what* to research |
| ① `zotero-paper-fetch` | skill | Reference list → CrossRef enrichment → Zotero intake → tiered PDF download (OA direct links / repository anti-crawler / campus-VPN paywalls) |
| ② `zotero-paper-note` | skill | Zotero item → deep read → structured notes written back to Zotero + `literature.jsonl` |
| ③ `figure-plot` | skill | Figure contract → Times New Roman / colorblind-safe palette → vector PDF with embedded-font verification; data plots + schematic diagrams |
| ④ `paper-polish` | skill | LaTeX language polishing that preserves all markup; ships with a jargon-audit follow-up |
| ④ `jargon-check` | **subagent** | Isolated-context, independent-model jargon audit — a stranger-reviewer perspective that avoids same-model blind spots |
| ⑤ `paper-review` | skill | Three-blind adversarial panel: 3 isolated reviewers (methodology rigor / domain contribution / adversarial attack) → author-defense arbitration → cross-review synthesis; claim-evidence anchoring, journal-profile axes, C/M/N issue list feeds `rebuttal`. Domain-agnostic engine with gates detected per manuscript and composed freely (built-in: OR families, ML+OR, LLM/agents; extensible) |
| ⑤ `reference-verify` | skill | Reference audit: official-API machine check (CrossRef / arXiv / PMLR / OpenReview / ACL Anthology / NeurIPS — facts fetched by commands, zero model recall) → web verification of undecidable entries (evidence must carry accessible URLs) → independent re-check of adverse findings; field-level table, severity grading, preprint-upgrade suggestions |
| ⑥ `rebuttal` | skill | Locate each reviewer comment → confirm the revision plan → `\changed{}` markup → compile the PDF → update the response letter |
| ⑦ `academic-ppt` | skill | Paper (LaTeX/PDF) → Beamer deck with a visual design system (official-template extraction or self-built) → time-budgeted talk script → compliant pptx packaging with speaker notes |

### Discipline Layer vs. Pipeline Layer

- **Discipline layer (⓪)**: `research-before-build` fires on any non-trivial task — coding, deployment, architecture selection — not only papers. It is the pack's worldview: prior art before building, search graded by risk, sources accepted by trust, verified by decision impact.
- **Pipeline layer (①–⑦)**: the paper lifecycle, the discipline's most complete instantiation — from a reference list to the conference talk.

⓪ → ① is a hand-off, not containment: `research-before-build` decides *whether and what* to survey; `zotero-paper-fetch` acquires the decided references into Zotero.

### Skill vs. Subagent

- **skill**: triggered automatically by its description, runs in the main conversation — suited to workflow orchestration (retrieval, polishing, review, rebuttal).
- **subagent**: invoked explicitly by name, runs in an isolated session — suited to audits that need an outsider's perspective (the core value of `jargon-check`: a different model in a different context, built to catch the writing model's wording blind spots).

## Usage: Just Say It

Skills auto-trigger from their descriptions — no slash commands to memorize. The one exception is `jargon-check`, a subagent you invoke by name so the audit runs outside the conversation that wrote the text. And for anything non-trivial you build, `research-before-build` surveys prior art before you start — no invitation needed.

| You say | What fires | What you get |
|---|---|---|
| "Add these 30 references to Zotero and download the PDFs" | `zotero-paper-fetch` | metadata-enriched Zotero items, PDFs filed by publisher |
| "Read this paper and take structured notes" | `zotero-paper-note` | note written back to the Zotero item + `literature.jsonl` |
| "Plot the Pareto front / the supply-network topology" | `figure-plot` | vector PDF, Times New Roman, embedded fonts |
| "Polish the Introduction" | `paper-polish` | edited LaTeX, all markup untouched |
| "Audit the wording" (after polishing) | `jargon-check` — by name | outsider-perspective jargon audit |
| "Verify every reference before I submit" | `reference-verify` | field-level audit table with severity grades |
| "Review this manuscript the way reviewers would" | `paper-review` | 3-reviewer panel report + C/M/N issue list |
| "Draft point-by-point responses to the reviews" | `rebuttal` | `\changed{}` markup, compiled PDF, updated letter |
| "Turn this paper into a 15-minute talk" | `academic-ppt` | Beamer deck, timed script, speaker notes |

## Installation

**Pick the path by where you work:**

- You use **Claude Code, Codex, or ZCode** → Option 1, the plugin — installed and managed by your plugin client.
- You use **any other Agent Skills-compatible harness**, or several at once → Option 2, `install.sh` — one symlink hub plus per-harness fan-out; `$HOME` stays clean.
- **Gemini CLI, Goose, opencode, Kimi Code, pi** read `~/.agents/skills` natively, so Option 2 alone covers them.

### Option 1: Plugin (Claude Code / Codex / ZCode)

Claude Code — this repo doubles as its own marketplace, so add it first, then install:

```bash
claude plugin marketplace add pengkangzhen/scientific-research-plugin
claude plugin install scientific-research-plugin@scientific-research-plugin
```

Codex — add the marketplace, then enable in `~/.codex/config.toml`:

```bash
codex plugin marketplace add pengkangzhen/scientific-research-plugin
```

```toml
[plugins."scientific-research-plugin@scientific-research-plugin"]
enabled = true
```

ZCode — this repository doubles as its own plugin marketplace (`.claude-plugin/marketplace.json`, source resolves to the repo root):

1. Clone the repo locally and take its root path.
2. Plugin Marketplace → Add → Add Plugin Marketplace, paste the repo root directory.
3. Personal → scientific-research-plugin → Scientific Research Plugin → Install.

The `jargon-check` subagent is not part of the ZCode plugin package (ZCode plugin manifests currently declare skills / commands / hooks / MCP servers, not subagents) — run `./install.sh` if you need it there.

### Option 2: Skills install (any Agent Skills-compatible harness)

```bash
git clone https://github.com/pengkangzhen/scientific-research-plugin.git
cd scientific-research-plugin
./install.sh          # idempotent: ~/.agents/{skills,agents} + per-harness fan-out
```

Verify:

```bash
ls ~/.agents/skills    # the 9 skills
ls ~/.agents/agents    # the jargon-check subagent
```

`install.sh` links everything into `~/.agents/skills` — the Agent Skills open-standard location (the format Anthropic open-sourced in Dec 2025, now adopted by 40+ tools) — and fans out to harnesses that use their own directory. Fan-out only touches harnesses detected as installed, so `$HOME` stays clean; after installing a new harness, re-run `./install.sh`.

| Harness | Skills location | Picked up via |
|---|---|---|
| Gemini CLI | `~/.agents/skills` (alias of `~/.gemini/skills`) | native; or `gemini skills install <repo> --path skills` |
| Goose | `~/.agents/skills` | native |
| opencode | `~/.agents/skills` (also reads `~/.claude/skills`) | native |
| Kimi Code | `~/.agents/skills` or `~/.config/agents/skills` (also reads `~/.kimi`, `~/.claude`, `~/.codex`) | native |
| pi | `~/.agents/skills` (project: `.agents/skills`) | native |
| Cursor | `~/.cursor/skills` | fan-out |
| Crush | `~/.config/crush/skills` | fan-out |
| GitHub Copilot CLI | `~/.copilot/skills` | fan-out; `gh skill` (preview) installs from GitHub |
| Amp | `~/.config/agents/skills` (project: `.agents/skills`) | fan-out, detects `~/.config/amp` |
| Grok Build | `~/.grok/skills` (project: `.grok/skills`) | fan-out |
| Qwen Code | `~/.qwen/skills` | fan-out |
| Droid | `~/.factory/skills` (project: `.factory/skills`) | fan-out |
| Kiro | `~/.kiro/skills` (workspace: `.kiro/skills`) | fan-out |

Not covered: iFlow CLI (project-scoped `.iflow/` layout with its own skill marketplace — no user-level skills directory to fan out to).

`halter sync --apply` remains available for assistants outside this list. The `jargon-check` subagent has no equivalent in the fan-out targets (they have no subagent mechanism) — it reaches Claude-ecosystem harnesses via `~/.agents/agents`.

## Repository Layout

```
├── skills/                      # 9 auto-triggered skills (single source of truth)
│   ├── research-before-build/
│   ├── zotero-paper-fetch/
│   ├── zotero-paper-note/
│   ├── figure-plot/
│   ├── paper-polish/
│   ├── paper-review/
│   ├── reference-verify/
│   ├── rebuttal/
│   └── academic-ppt/
├── attic/                       # retired skills, kept for provenance
│   └── academic-paper-review/   # 7-agent journal-review simulation (upstream: academic-research-skills)
├── agents/
│   └── jargon-check.md          # isolated-audit subagent
├── .claude-plugin/
│   ├── plugin.json              # Claude Code plugin manifest
│   └── marketplace.json         # Claude Code / ZCode marketplace catalog (source ./)
├── .zcode-plugin/plugin.json    # ZCode plugin manifest
├── .codex-plugin/plugin.json    # Codex plugin manifest
├── .agents/plugins/marketplace.json  # Codex (~/.agents) marketplace catalog
└── install.sh                   # bare install: ~/.agents hub + per-harness fan-out
```

## Maintenance Conventions

- Edit skills in this repo only; `install.sh` creates symlinks — local changes take effect immediately, and pushing publishes them.
- Version bumps touch all three plugin manifests (`.claude-plugin/`, `.zcode-plugin/`, `.codex-plugin/`) and the `.claude-plugin/marketplace.json` entry in lockstep.
- Every release must be synced to the official ZCode marketplace (zai-org/zcode-plugins, `plugins/scientific-research-plugin/`) via PR, with `version` and `description_i18n` kept identical (their `validate.py` enforces it); confirm their `marketplace.json` actually lists the new version before announcing.
- `academic-paper-review` is retired into `attic/` (upstream: academic-research-skills); its useful mechanisms (fatal-flaw criteria, red flags, Devil's-Advocate attack dimensions) live on inside `paper-review`. See `skills/paper-review/references/source-basis.md` for full provenance.
- This repo is v5: v1 contained only 4 writing skills; v2 expanded to a research pipeline and evolved `language-polish` into `paper-polish`; v3 added the discipline layer `research-before-build` (⓪) and `academic-ppt` (⑦) and renamed `scientific-review` to `paper-review`; v4 rebuilds `paper-review` as a three-blind adversarial panel (nature-reviewer-style architecture, OR/ML+OR domain gates, author-defense arbitration) and retires `academic-paper-review`; v5 adds `reference-verify` (⑤ pre-submission reference audit, three-layer verification distilled from a full-manuscript citation check) — 9 skills + 1 subagent.

## License

MIT
