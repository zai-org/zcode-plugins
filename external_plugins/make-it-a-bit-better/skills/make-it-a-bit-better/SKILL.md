---
name: make-it-a-bit-better
description: Autonomous product-polish loop. Every round MUST open a fresh brainstorm, pick ONE small angle that makes the product a bit better, implement, verify and commit it, then log the round in a per-project ledger. Use when the user says "make it a bit better", "polish it", "iterate a few rounds", "打磨", "好一点点", "让它好一点", "持续改进", "再优化几轮", or asks to iteratively improve a product or feature one small step at a time.
metadata:
  short-description: One small brainstormed improvement per round, committed and logged
---

# Make It a Bit Better (mabb)

An incremental product-polish loop. Each round: **brainstorm → pick ONE small angle → implement → verify → commit → log**. No rewrites, no big-bang redesigns — a product gets better one small, felt improvement at a time, round after round.

## Inputs

- **target** — repo path (default: current working directory)
- **rounds N** — how many rounds to run (default 1; the user may say "N rounds" or "keep going")
- **focus** — optional feature/path to examine (e.g. a just-shipped feature)

## Round protocol — run every step, in order, every round

### 1. Ground

- Read the product's README/docs entry, `git log --oneline -15`, and a quick tree overview. With `focus` given, ground mainly on that area.
- No README/docs entry at all (scripts, small tools — common)? Degrade grounding to the entry-point code (main/module entry) plus the directory tree, and say so in that round's report — grounding degrades honestly; a product summary improvised from nothing is fabrication, not grounding.
- Read the ledger at `<target>/.agents/mabb/ledger.md` if it exists; its `Dimensions touched` line and `Next round` hint (either may be absent in older ledgers — reconcile from the table then) steer this round, and dimensions never touched get brainstorm priority. No ledger yet → this is round 1; otherwise the round number is the ledger's max `#` + 1.
- Repo gate (fail-loud): confirm `<target>` is the root of a git repository — `git -C <target> rev-parse --show-toplevel` must resolve to `<target>` itself, not to a parent. A target nested inside someone else's repo fails the gate: stop before any work, report both paths (`<target>` and the resolved top level), and ask which one the round should run in. mabb records rounds as commits, so a non-git target cannot be recorded; never `git init` on the user's behalf or drift to a nearby directory that does have `.git`.
- Repo safety: if the target is a shared/team repo (protected main, MR flow), propose a branch and get the user's confirmation before the first commit. Never commit to main directly in such repos.

### 2. Brainstorm (mandatory — never skip, never thin)

- Draw **3 lenses** from the lens pool below; exclude lenses used in the previous round (the ledger records them).
- Spawn **3 fresh subagents in parallel**, one per lens. Each receives: a 5–10 line product grounding summary, the ledger's past angles, the dimension seeds, and its lens. Each returns **3–5 candidates**, one line each:
  `angle — who feels it (persona + moment) — one-line rationale — cost S/M/L`
- Merge in-session; drop anything already in the ledger or icebox; you may add your own candidates.
- With `focus` given: spotlight that area in each lens's grounding summary, and ask every lens for ≥1 in-focus candidate — focus must shape generation, not just Ground.
- If the client has no subagent tool: still brainstorm — write three separate passes, one per lens, each yielding ≥3 candidates. Perspective-forced fresh generation every round is the point.
- Fewer than 6 distinct surviving candidates → widen the lenses and go again. Never select from a thin list. Still thin after widening → before heading for the early stop, check the ledger's icebox for a good idea that slices into the round cap (≤3 files / ≈100 lines); promoting a slice keeps the round real, and nothing slice-able leaves the honest stop standing.

### 3. Select ONE

- Rank by felt-impact × freshness ÷ cost. Take the top.
- With `focus` given, rank in-focus candidates first; pick out-of-focus only when no in-focus candidate survived, and say so in the round report.
- **"A bit better" cap**: one round changes ≤3 files or ≈100 lines, whichever binds first (docs/copy-only rounds may exceed with one stated sentence of reason). If the top candidate exceeds the cap, move it to the ledger's **icebox** and take the next.
- The chosen angle must name a concrete "who feels it". If it can't, it is probably a refactor in disguise — icebox it.

### 4. Implement

- Follow the target repo's conventions and instruction files (AGENTS.md / CLAUDE.md / CONTRIBUTING).
- Read every file before editing. Complete changes only — no TODO, mock, placeholder or "temporary path".

### 5. Verify

- Use the repo's own verification surface: tests, build, lint, type-check, or a real smoke run. At least one real check must pass.
- If the toolchain is unavailable, report "verification pending" honestly in the round report — never claim verified.
- No verification surface at all (the repo simply has no tests/build/lint — distinct from a missing toolchain)? Smoke the changed path by hand: run the real command and record it plus the observed output as evidence. Nothing runnable (e.g. a pure docs/copy change) → log `verification pending (no runnable surface)` and say so — still never claim verified.
- Check failed after implementing? Fix it within the round's ≤3-file/≈100-line cap. Still failing: ship nothing — commit the round's change as `mabb #N: <angle>`, then a second commit `mabb #N: revert` reversing it (at this point nothing is committed yet, so an uncommitted change gives a "reversing commit" nothing to reverse and discarding is forbidden — commit-then-revert keeps the failed diff and its failing check in history for the fix workflow; a failed round is exactly two commits). Log a normal ledger row citing the revert commit, change = `failed, reverted`, evidence = the failing check, and say so in the round report — shipping nothing beats shipping unverified.

### 6. Record

- Commit the change alone: `mabb #N: <angle>`, body line = who feels it + evidence. (A failed round commits nothing here — its round + revert commits were made in Verify; this step only writes its ledger row.)
- Update `<target>/.agents/mabb/ledger.md` (create on first record):

```markdown
# mabb ledger — <project>

| # | date | dimension | angle | who feels it | change | commit | evidence |
|---|------|-----------|-------|--------------|--------|--------|----------|
| 1 | 2026-11-03 | error-messages | ... | ... | ... | abc1234 | pytest 41 green |

## Dimensions touched
- error-messages, microcopy — steer the next brainstorm toward untouched ones (accessibility, cost, …)

## Next round
- <one line — replaced every round by that round's report hint>

## Icebox (good, too big for one round; a round that lands an entry deletes it)
- IB-1 (dimension) idea — why it matters — rough size M/L

## Lenses used
- #1: first-time-user, auditor, automation-caller
```

- While recording, append this round's dimension to `Dimensions touched` and overwrite `Next round` with the current round report's hint — both are what the next round's Ground reads.
- A round that lands a promoted icebox idea deletes that entry in the same ledger update: the icebox is a pending list, and a landed idea's permanent record is its ledger row — an entry left behind reads as still-to-do and invites a duplicate round later.
- Icebox entries carry short ids: `IB-1`, `IB-2`, … — a new entry takes the next free id (current max + 1); ids are stable once assigned (never renumbered, never reused), and the round report, `Next round` hint and a promotion's ledger row cite entries by id instead of describing them. Ledgers started before ids keep working: id-less entries stay valid until they are edited or landed.
- Before writing the ledger, make sure it cannot leak into git history: `git -C <target> check-ignore .agents/mabb/ledger.md` must exit 0 — if not, append a `.agents/` line to the target's `.gitignore` within this round (counts toward the ≤3-file cap). Never let a repo-convention `git add -A` sweep the untracked ledger into the round commit.
- The ledger is local working state by default; a team that wants shared history can deliberately un-ignore it — say so to the user once.

### 7. Loop

- End every round with a one-block round report of exactly six labeled fields, always this order, one per line: `angle:` / `who feels it:` / `what changed:` / `evidence:` / `icebox additions:` / `next-round hint:` — an empty field is written `none`, never dropped; `icebox additions:` lists each new entry as `IB-N (dimension) short name`. The fixed shape keeps reports comparable across rounds and repos, and lets an outer orchestrator parse them.
- Default: ask once "continue?". With N given: run all N. Stop early when 2 consecutive brainstorms yield no qualifying candidate — report "nothing worth a round right now" instead of forcing a weak change. That self-stop is itself recorded: overwrite the ledger's `## Next round` with a dated line `- stalled <date>: two consecutive thin brainstorms, icebox held no slice — <what to widen next>` (no round row — nothing shipped), so a later Ground reads a stalled run as stalled instead of re-running the same doomed brainstorm.
- When a run ends — all N rounds done, the user declines to continue, or the loop self-stops after two consecutive thin brainstorms — close the whole run with a one-block run summary of exactly four labeled fields, always this order, one per line: `rounds:` (e.g. `3 run`, or `2 of 5 run, stopped after two consecutive thin brainstorms`) / `changes:` (commits and files across the run, e.g. `3 commits, 7 files`; a reverted round shows as `1 failed, reverted`) / `icebox added:` (count plus short names, or `none`) / `leftovers:` (the strongest thread worth a future round, or `none`). Empty fields are written `none`, never dropped. Same fixed-shape rationale as the round report: run totals stay comparable across runs and parseable by an outer orchestrator.
- Never push to any remote unless the user explicitly said push in this run.

## Lens pool (draw 3, rotate)

first-time user (day one) · picky daily user · maintainer in six months · competitor migrant · constrained user (weak network / old device / small screen) · auditor (security, privacy, compliance) · accessibility user · automation/script caller

## Dimension seeds (ammunition, not a checklist)

first-run & empty states · error messages & failure paths · microcopy (labels, buttons, tooltips) · defaults · speed, felt and real · feedback (loading, progress, confirmation) · consistency (terms, visuals, interactions) · discoverability · edge cases & input boundaries · undo & safety nets · docs & examples · trust & transparency (logs, observability) · cost (time, tokens, API calls) · accessibility · keyboard & power users · install & onboarding

Free-form candidates that fit no seed are welcome — seeds steer coverage, they do not fence it.

## Red lines

- A rewrite or big refactor is not mabb — icebox it.
- Fixing an already-reported bug belongs to a fix workflow, not a round (an unreported rough edge is fair game).
- Pure reformatting / renames never count as a round.
- Every round must answer: **who feels this bit of better?**
- Shared/team repos: no direct commits to main; confirm branch strategy first.
- No unbounded loops: N rounds or an explicit "keep going" only.
- The skill text stays lean — executors load SKILL.md whole every round. Past the soft cap (150 lines), added lines must pay for themselves: distill or merge existing ones in the same commit, or the addition waits in the icebox.

## Trial

Suggested first prompt: *对 /path/to/repo 跑 2 轮 make it a bit better*, or in English *run 2 rounds of make it a bit better on /path/to/repo* — expect up to two brainstormed, small, verified, committed improvements and a ledger row per round (self-stop or a reverted round yields fewer).
