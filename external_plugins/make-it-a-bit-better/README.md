<p align="center"><img src="assets/make-it-a-bit-better/icon.png" width="88" height="88" alt="make-it-a-bit-better icon"></p>

<h1 align="center">make-it-a-bit-better</h1>

<p align="center"><strong>A bit better, round after round.</strong></p>

A skill plugin that runs an autonomous product-polish loop. Every round opens a **mandatory fresh brainstorm** (3 perspective-forced subagents), picks **one small angle**, implements, verifies and commits it, and logs the round in a per-project ledger. Good ideas that are too big for one round go to an **icebox** instead of being forced in. The philosophy is the name: no rewrites — a bit better, accumulated round after round.

## Why not just ask an agent to "improve it"?

An ad-hoc prompt can produce a change; it can't produce this loop's three structural guarantees:

- **A fresh brainstorm every round** — 3 forced perspectives look for what earlier rounds missed, deduped against the ledger. An ad-hoc prompt re-cooks whatever the model already said.
- **One small, verified change** — ≤3 files / ≈100 lines, a real check must pass, and a red check is reverted rather than shipped. An ad-hoc prompt optimizes for looking done.
- **Memory across rounds, and a checker on it** — a ledger remembers what landed and what is still worth doing, and a bundled validator keeps it honest. An ad-hoc prompt restarts from zero every time.

## Inputs

| input | default | what it does |
|-------|---------|--------------|
| `target` | current working directory | repo to polish, at its repository root. A non-git target, or one nested inside another repo, is rejected before any work starts. |
| `rounds N` | 1 | how many rounds to run ("N rounds" or "keep going"). With N given, all N run without asking; after two consecutive thin brainstorms the loop stops itself early. |
| `focus` | none | a feature/path to spotlight (e.g. a just-shipped feature). Shapes generation in every lens and ranks in-focus candidates first. |
| `no-git` | off | lets the target be a non-git directory or a single file. Off unless you ask for it by name; rounds are then backed up instead of committed. |

## What a round looks like

1. **Ground** — read the product, the recent commits and the ledger; settle whatever the ledger check reports before touching anything.
2. **Brainstorm** — three fresh subagents, one lens each, return only net-new candidates; what earlier rounds found but did not pick waits in the ledger's backlog.
3. **Select one** — felt-impact × freshness ÷ cost, capped at ≤3 files / ≈100 lines per round. A backlog entry passed over for three rounds is settled, never left to starve.
4. **Implement** — target-repo conventions, complete changes only, no TODO/mock leftovers.
5. **Verify** — the repo's own tests / build / lint / smoke; a red check is fixed within the cap or the round ships nothing. Never claimed verified when it isn't.
6. **Record** — one commit (`mabb #N: <angle>`) plus one ledger row, validated by the bundled checker.
7. **Loop** — ask-to-continue by default, N rounds on request; stops itself after two consecutive thin brainstorms rather than forcing weak changes.

The protocol itself — every gate, the ledger format, the failed-round path — lives in [`SKILL.md`](skills/make-it-a-bit-better/SKILL.md). This page is a summary; where the two differ, the skill text wins.

Every round ends with the same six-field report — `angle:` / `who feels it:` / `what changed:` / `evidence:` / `icebox additions:` / `next-round hint:` — and every run with a four-field summary: `rounds:` / `changes:` / `icebox added:` / `leftovers:`. Empty fields say `none`.

## The ledger

`.agents/mabb/ledger.md` in the target repo is the loop's memory:

- **Rows** — one per round: dimension, angle, commit, files, evidence, each a single short line. Old rows fold into an archive once the ledger passes its budget, so it stays a few kilobytes as rounds accumulate.
- **Backlog** — good, small candidates that were not picked, ranked, at most eight (`B-1` is the top). The next brainstorm starts from them and asks its lenses only for what is new.
- **Icebox** — good ideas too big for one round. An entry leaves only once the whole idea has landed; a partial landing rewrites it into what remains.
- **Check, don't trust** — `scripts/ledger.mjs check` runs at the start of every round and again after each ledger write. It validates the format and ids, and reports a row whose commit the repository no longer holds instead of letting a rewritten history break the trail silently.

## Side effects (disclosed for review)

- **Model calls**: each round spawns 3 short-lived brainstorm subagents (three in-session passes when the client has no subagent tool) — N rounds means ≈3N such calls.
- **Files**: writes the improvement itself in the target repo, plus the local ledger under `<target>/.agents/mabb/`. No-git mode also keeps one backup there, and before/after copies of a failed round.
- **Git**: one local commit per round in the target repo (exactly two when a round fails: the round's commit, then its revert — the failed diff stays in history, nothing ships unverified). Other people's uncommitted changes are never staged. Shared/team repos get a branch proposal first. **Never pushes** to any remote unless you explicitly say push.
- **Ledger privacy**: when the ledger is not ignored yet, one line — `.agents/mabb/`, never the whole `.agents/` — is added to the repo's `.gitignore` and committed on its own as `mabb: ignore the ledger` (written to `.git/info/exclude` instead when `.gitignore` carries someone else's change). A ledger the team already tracks gets one more small commit per round (`mabb #N: ledger`).
- **Network**: none beyond the model API.
- **Runtime**: Node 18.13 or newer for the bundled checker (zero dependencies); the loop stops before any work when it cannot run.
- **Context**: the skill text is capped at 16,000 characters, with body lines of 400 or fewer, by a contract test, keeping rounds loadable for small-context agents.

## Install

```bash
# DeepSeek Harness
dsh plugin add /path/to/make-it-a-bit-better   # or: dsh plugin add make-it-a-bit-better

# ZCode
zcode plugins install make-it-a-bit-better@<marketplace>

# Codex
codex plugin add make-it-a-bit-better@<marketplace>
```

The DSH form requires DSH `>=0.2.1-rc.2 <0.3.0`.

## Quick start

With the plugin installed:

> Run 3 rounds of make it a bit better on /path/to/repo

Or with the steering wheel: point it at a repo, ask for N rounds, spotlight one area:

> Run 5 rounds of make it a bit better on /path/to/repo, focusing on the checkout flow

Expect: a ledger row per round and up to N committed small improvements — *up to*, because the loop self-stops after two consecutive thin brainstorms and a red check it can't fix is reverted. Fewer commits than N is the loop being honest, not broken.

## What's new

This section keeps the two most recent entries; the full history lives in [CHANGELOG.md](CHANGELOG.md).

**0.3.0** — The ledger grows a backlog (good small candidates get a ranked home and can no longer starve) and a checker that validates it every round, including whether each row's commit still exists. Gates tightened: other people's uncommitted changes are never staged, a shared `.agents/` is no longer ignored wholesale, a pre-existing red check is not blamed on the round. Plus an opt-in no-git mode, the `mabb` trigger word, tests, and a leaner README.

**0.2.8** — Docs only: the window line above is new — an older entry leaving this section is the window rolling, not a lost line (0.2.5 left it when 0.2.7 rolled the news forward, by design).

## License

MIT © Lumos-789
