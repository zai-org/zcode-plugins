# expert-panel — Expert Panel Consensus Review (ZCode Plugin)

Put an important decision in front of a panel of experts with distinct lenses: **independent answering → truly anonymous cross-critique → arbitration (consensus rate computed deterministically by script, extra debate round when below threshold) → chair synthesis → fact verification**. The output separates **stable agreed conclusions from explicitly stated disagreements**. Zero configuration — every role runs on your current session model.

## Why

The failure modes of a single model answer: conformity (anchoring on the first framing), authority bias (deferring to whoever sounds senior), and forced synthesis (mushing disagreement into "generally feasible"). This workflow counters each one:

| Problem | Countermeasure |
|---|---|
| Conformity | Every expert **answers independently first**, before seeing anyone else's position |
| Authority bias | Critique inputs contain only anonymous labels (Expert A/B/C) + position + key points — **no lens name, no model** |
| False consensus | Consensus rate = agreed/(agreed+disputed), **computed deterministically by script — never self-reported by a model** |
| Splitting the difference | Below threshold → one extra debate round; still below → **disagreements are stated explicitly for human adjudication, never force-merged** |
| Fabricated facts | Objectively verifiable agreed items are checked by a fact verifier (it reads files / runs commands when it can); failures are dropped |

A single expert failing is tolerated; the conclusion is annotated with sample completeness (absent lenses / valid expert count).

## Installation

**Local directory marketplace** (put this repo anywhere on your machine):

1. ZCode → Plugin Marketplace → Add → Add Plugin Marketplace, paste the repo **directory** path
2. Personal → the marketplace → expert-panel → Install
3. Takes effect in a new session

**CLI** (after the marketplace is added):

```bash
zcode plugins install expert-panel@<marketplace-name>
```

Requirements: ZCode desktop (the dynamic-workflows runtime is bundled). The run ledger uses `python3` if present (missing python3 does not block conclusions; the run is just not logged).

## Usage

Three ways to trigger it once installed:

- Natural language: "use the expert panel to evaluate X", "have the expert panel settle this", "give this decision a multi-perspective check"
- Slash command: `/expert-panel <your question>`
- Direct call: `CreateWorkflow(path=<the plugin's workflows/expert-panel.dwf.ts>, args={...})`

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| question | string | required | The question/decision the panel should settle |
| profile | string | standard | quick (3 experts/1 round, minutes) \| standard (2 rounds) \| deep (auto-adds contrarian + synthesizer lenses, 2 rounds) |
| experts | json | [务实工程师, 风险与边界审查, 产品价值] | Expert lens names (no duplicates) |
| threshold | number | 0.6 | Consensus-rate threshold; below it one extra debate round runs |
| max_rounds | number | quick=1, else 2 | Max rounds including the first |
| evidence | json | empty | Evidence pack: texts or file paths (experts/verifier read files with their own tools) |
| basis | json | empty | Review rubric: file paths or entries; when given, verdicts must cite the rubric item by item |
| ledger_path | string | ~/.expert-panel/ledger.jsonl | Run ledger JSONL path |
| simulate_failures | json | empty | Test-only: indexes of experts to simulate as failed |

### Model selection

By default every role uses the session default model — this is deliberate: **zero config, runs on any ZCode environment**. To switch models uniformly, pass `subagent_model` on the `CreateWorkflow` call (look up ids with `ListModels` on the current provider). Per-role model routing is intentionally unsupported by the host: a subagent's model must be known before the run starts.

### Interpreting results

- `agreementRate ≥ threshold`: consensus reached. `agreed` holds verified stable conclusions; `unverifiable` holds value judgements (cannot be objectively verified — they are the panel's opinion only).
- `< threshold`: `disputed` lists each side's arguments for human adjudication — **this is a feature, not a failure**.
- `absent` non-empty or fewer than 2 valid experts: the conclusion is annotated with sample completeness; mind the caveat when quoting.

Each run appends one ledger line (`ledger_path`): question digest / profile / expert counts / rounds / consensus rate / agreed·disputed·rejected counts / stable flag.

### 30-second verification

In a new session, send:

```
Use the expert panel, quick profile, to evaluate: Markdown files vs a notes app for a personal knowledge base?
```

Expected (within minutes): an "Expert Panel Conclusion" card with a consensus rate (e.g. 74%), agreed items (with verification marks), disputed items (if any), an executive summary and a final recommendation; while running, the expert board advances from "independent answering" to "converged". A rate below 60% triggers an extra debate round and explicit disagreements — that is also normal behavior.

## Data behavior & uninstall

- Each run appends one JSONL line to `~/.expert-panel/ledger.jsonl` (relocate via `ledger_path`); beyond that it **writes nothing** — no hooks, no MCP server, no outbound network requests (review subagents only use your current session's own model channel).
- Uninstall: Settings → Plugins → expert-panel → Uninstall. The only residue is `~/.expert-panel/` (the ledger dir); delete it to remove everything.

## Design notes

- **Anonymity protocol**: critique inputs carry only anonymous labels/positions/key points; lens names exist only inside each expert's own system prompt during independent answering.
- **Deterministic consensus rate**: the script computes `agreed/(agreed+disputed)`; round gating keys off that value alone — a model cannot shade the arithmetic.
- **Deep-profile guardrail**: a contrarian lens is mandatory (to counter "debate amplifying biased consensus"); a synthesizer is added when headcount is short.
- **Origins**: the mechanism draws on the anonymous cross-critique and chair ideas of karpathy/llm-council, plus the author's own expert-panel workflow iterated in production on ZCode (v2.1: rubric injection, single-expert fault tolerance, sample-completeness annotation). No code was copied from llm-council (which currently ships no license); this plugin is an independent implementation, MIT-licensed.

## Changelog

Version is whatever the marketplace shows (the source of truth is plugin.json).

- 0.1.2: ledger schema v2 — dual consensus rates (rate_pre at arbitration time / rate_post recomputed after verification, fixing the old unrecomputable-rate bug), per-round convergence series, and threshold/question_id fields logged in full.
- 0.1.1: fix ledger write for bare-filename custom paths; pre-release cleanup (neutral git identity).
- 0.1.0: first releasable version, full six-stage mechanism.

## License

MIT — see [LICENSE](LICENSE)
