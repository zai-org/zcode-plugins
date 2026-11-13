<p align="center"><img src="assets/make-it-a-bit-better/icon.png" width="88" height="88" alt="make-it-a-bit-better icon"></p>

<h1 align="center">make-it-a-bit-better</h1>

<p align="center"><strong>A bit better, round after round.</strong></p>

A skill plugin that runs an autonomous product-polish loop. Every round opens a **mandatory fresh brainstorm** (3 perspective-forced subagents), picks **one small angle**, implements, verifies and commits it, and logs the round in a per-project ledger. Good ideas that are too big for one round go to an **icebox** instead of being forced in. The philosophy is the name: no rewrites — a bit better, accumulated round after round.

## Why not just ask an agent to "improve it"?

An ad-hoc prompt can produce a change; it can't produce this loop's three structural guarantees:

- **A fresh brainstorm every round** — 3 forced perspectives regenerate candidates outside the last round's frame, deduped against the ledger. An ad-hoc prompt re-cooks whatever the model already said.
- **One small, verified change** — ≤3 files / ≈100 lines, a real check must pass, and a red check is reverted rather than shipped. An ad-hoc prompt optimizes for looking done.
- **Memory across rounds** — the ledger records dimensions touched and parks oversized ideas in the icebox, so round 17 doesn't repeat round 3. An ad-hoc prompt restarts from zero every time.

## Inputs

| input | default | what it does |
|-------|---------|--------------|
| `target` | current working directory | repo path to polish. Must be the root of a git repository: a non-git target, or one nested inside another repo, is rejected before any work starts. |
| `rounds N` | 1 | how many rounds to run ("N rounds" or "keep going"). With N given, all N run without asking; after two consecutive thin brainstorms the loop stops itself early. |
| `focus` | none | a feature/path to spotlight (e.g. a just-shipped feature). Shapes generation in every lens and ranks in-focus candidates first — not just where the round grounds. |

## What a round looks like

1. **Ground** — read the product, recent commits and the ledger; dimensions never touched get priority. A non-git target is rejected up front, before any work is done. A repo with no README/docs grounds on entry-point code + tree instead — and says so in the round report, never improvising a product summary.
2. **Brainstorm (mandatory)** — 3 fresh subagents, each wearing a different lens (first-time user, picky daily user, maintainer-in-six-months, auditor, automation caller, …), each returning candidate angles; deduped against the ledger so nothing gets re-cooked. Without a subagent tool it falls back to three in-session, lens-forced passes. A run with `focus` spotlights that area in every lens's grounding. Still thin after widening the lenses? A good icebox idea that slices into the round cap gets promoted instead of letting the run stop early.
3. **Select one** — felt-impact × freshness ÷ cost, capped at ≤3 files / ≈100 lines per round. Bigger ideas → icebox. With `focus`, in-focus candidates rank first.
4. **Implement** — target-repo conventions, complete changes only, no TODO/mock leftovers.
5. **Verify** — the repo's own tests / build / lint / smoke; honest "verification pending" if the toolchain is missing; a repo with no verification surface at all gets a minimal manual smoke of the changed path (real command + observed output as evidence), or an honest `verification pending (no runnable surface)` when nothing can run; a red check gets fixed within the round cap or the round ships nothing: it is committed as `mabb #N: <angle>` and immediately reversed by a second `mabb #N: revert` commit (never discarded — the failed diff stays in history), logged as failed — never shipped unverified.
6. **Record** — one commit per round (`mabb #N: <angle>`) plus a ledger entry (dimension, angle, who feels it, evidence). Before writing the ledger, its `.agents/` home is verified gitignored (`git check-ignore`; a missing rule is appended within the round), so agent working state never leaks into the commit.
7. **Loop** — ask-to-continue by default, N rounds on request; stops itself after two consecutive thin brainstorms rather than forcing weak changes. Every round closes with the same six-field report (angle / who feels it / what changed / evidence / icebox additions / next-round hint; empty fields say `none`), so rounds and repos stay comparable. When a run ends — N done, declined, or self-stopped — a four-field run summary closes it (`rounds:` / `changes:` / `icebox added:` / `leftovers:`), so a 5-round batch ends with totals instead of trailing off. A self-stop also overwrites the ledger's next-round hint with a dated `stalled` line (why it went thin, what to widen next) — the stop survives the conversation, and a later session can tell a stalled run from a finished one.

## The ledger

`.agents/mabb/ledger.md` in the target repo is the loop's memory. It prevents repeating old angles and carries a coverage view that keeps steering the brainstorm toward untouched dimensions. The icebox holds good-but-too-big ideas until you promote them to real projects — a round that lands one deletes its entry, so the icebox always lists what is still pending. Icebox entries carry short ids (`IB-1`, `IB-2`, …, stable once assigned), so reports, next-round hints and promotions cite an entry exactly instead of describing it.

## Side effects (disclosed for review)

- **Model calls**: each round spawns 3 short-lived brainstorm subagents (falls back to three in-session passes when the client has no subagent tool) — N rounds means ≈3N such calls.
- **Files**: writes the improvement itself in the target repo, plus the local ledger under `<target>/.agents/mabb/`.
- **Git**: one local commit per round in the target repo (exactly two when a round fails: the round's commit, then its revert — the failed diff stays in history, nothing ships unverified). Shared/team repos get a branch proposal first — never a direct main commit. **Never pushes** to any remote unless you explicitly say push.
- **Network**: none beyond the model API.
- **Context**: the skill text is loaded whole by the executor every round, so it carries a soft cap (150 lines) — growth past the cap pays for itself by distilling existing lines, keeping rounds loadable for small-context agents.

## Install

**DSH** — this repo is a DSH bundle: one package mounts the `make-it-a-bit-better` skill (pure skill — no MCP server, no runtime dependencies). Requires DSH `>=0.2.1-rc.2 <0.3.0`.

```bash
# From a checkout
dsh plugin add /path/to/make-it-a-bit-better

# Once published
dsh plugin add make-it-a-bit-better
```

**ZCode** — the same repo doubles as a ZCode plugin (`.zcode-plugin/plugin.json` + `skills/`): install it from any marketplace that lists it — for a local tryout, a dev marketplace pointing at a checkout works.

## Quick start

With the plugin installed:

> Run 3 rounds of make it a bit better on /path/to/repo

Or with the steering wheel: point it at a repo, ask for N rounds, spotlight one area:

> Run 5 rounds of make it a bit better on /path/to/repo, focusing on the checkout flow

Expect: a ledger row per round and up to N committed small improvements — *up to*, because the loop self-stops after two consecutive thin brainstorms (the ledger gets a dated `stalled` line) and a red check it can't fix is reverted (a `failed, reverted` row, nothing shipped). Fewer commits than N is the loop being honest, not broken. An icebox appears only when the brainstorm produced ideas too big for one round.

## What's new

**0.2.5** — Trial expectation aligned to "up to two committed improvements" (self-stop or a reverted round yields fewer). Full history: [CHANGELOG.md](CHANGELOG.md).

## License

MIT © Lumos-789
