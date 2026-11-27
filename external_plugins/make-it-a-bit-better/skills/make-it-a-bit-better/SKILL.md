---
name: make-it-a-bit-better
description: Autonomous product-polish loop. Every round MUST open a fresh brainstorm, pick ONE small angle that makes the product a bit better, implement, verify and commit it, then log the round in a per-project ledger. Use when the user says "mabb", "make it a bit better", "polish it", "iterate a few rounds", "打磨", "好一点点", "让它好一点", "持续改进", "再优化几轮", or asks to iteratively improve a product or feature one small step at a time.
metadata:
  short-description: One small brainstormed improvement per round, committed and logged
---

# Make It a Bit Better (mabb)

An incremental product-polish loop. Each round: **brainstorm → pick ONE small angle → implement → verify → commit → log**. No rewrites, no big-bang redesigns — a product gets better one small, felt improvement at a time, round after round.

## Inputs

- **target** — repo path (default: current working directory). Git mode needs the repository root.
- **rounds N** — how many rounds to run (default 1; the user may say "N rounds" or "keep going").
- **focus** — optional feature/path to examine (e.g. a just-shipped feature).
- **no-git** — off by default. Only when the user asks for it in this run ("no-git", "非 git") may the target be a non-git directory or a single file.

## Round protocol — run every step, in order, every round

### 1. Ground

- **Helper gate (before any write):** `<mabb-root>` is the plugin directory two levels above this `SKILL.md`, the one that holds `scripts/`. Run `node <mabb-root>/scripts/ledger.mjs check --target <target>` (no-git: add `--no-git`); it prints the next round number and everything wrong with the ledger.
- Exit 0 → go on. Exit 1 → repair what it lists (two repairs below, the rest in Record) and rerun until it passes. Exit 3 → a legacy ledger: convert it as `check` spells out, once the gates below have passed, keeping the old file as `ledger.v1.md`.
- Anything else — no Node, no helper, exit 4 → stop before any work and report it; bookkeeping is never kept by hand.
- **Repo gate (git mode):** `git -C <target> rev-parse --show-toplevel` must resolve to `<target>` itself (compare real paths — `/tmp` is `/private/tmp` on macOS). A target nested inside another repository fails: stop, report both paths, ask which repository.
- A non-git target without the user's explicit no-git request fails the same way; never `git init` on the user's behalf or drift to a nearby directory that does have `.git`.
- Read the product: README/docs entry, `git log --oneline -15`, a quick tree. With `focus`, ground mainly on that area.
- No README/docs at all (scripts, small tools)? Ground on the entry-point code plus the directory tree and say so in the round report — an improvised summary is fabrication, not grounding.
- Read the ledger at `<target>/.agents/mabb/ledger.md` (no-git: in the target file's directory). Its `Backlog`, `Icebox`, `Dimensions touched` and `Next round` steer this round; dimensions never touched get brainstorm priority.
- Two repairs `check` may list:
  - a row's commit is no longer reachable → history was rewritten: `check` names the round's new hash when it can and spells out the `lost` cell (a `lost` row is a record, not proof — its change may be gone from the tree too);
  - a round commit with no row → an earlier run stopped before recording: rebuild the row from that commit (angle from its subject, files from its diff, who feels it + evidence from its body).
- **Ledger privacy (git mode):** `git -C <target> check-ignore -q .agents/mabb/ledger.md` exits 0 → nothing to do. Otherwise:
  - tracked (`git -C <target> ls-files --error-unmatch .agents/mabb/ledger.md` exits 0) → the team shares it on purpose (say so once); leave the setup and commit each ledger update on its own as `mabb #N: ledger`;
  - neither → append `.agents/mabb/` to the target's `.gitignore` — never the whole `.agents/`, repos may share skills there — and commit that line alone at once as `mabb: ignore the ledger`; it is not one of the round's files;
  - a `.gitignore` carrying someone else's change is never touched: write the line to `.git/info/exclude` instead (nothing to commit).
- **Working tree (git mode):** list every uncommitted change that is not yours (`git status --porcelain`; the ledger under `.agents/mabb/` is yours). Never stage or edit those files. Stage the round's own files by explicit path — never with `-A`, whatever the repo's convention.
- **Not eligible:** a candidate that needs one of those files, or a decision only the owner can make — name the latter on the `next-round hint:` line.
- **Baseline:** the previous round's verification result. On a round that is first in its run, or that finds the tree changed underneath, run the repo's verification surface once now and remember the result.
- **Team repo** = two or more authors in the last 50 commits, a `CODEOWNERS`, a `CONTRIBUTING.md`, or repo instructions that reserve main for merges. There: propose a branch and get the user's confirmation before the first commit; never commit to main directly. Anywhere else, commit on the current branch.

### 2. Brainstorm (mandatory — never skip, never thin)

- Draw **3 lenses** at random from the pool, skipping the ones the ledger's `Lenses used` line names; when fewer than 3 remain, fill up from those. A lens that cannot return 3 candidates may be swapped for an unused one — keep what it found.
- Spawn **3 fresh subagents in parallel**, one per lens. Each receives: a 5–10 line grounding summary, the ledger's past angles, its `Backlog` and `Icebox` entries, the dimension seeds, and its lens.
- Each returns **3–5 net-new candidates** — nothing already in the ledger, Backlog or Icebox — one line each: `angle — dimension — who feels it (persona + moment) — one-line rationale — cost S/M/L`. S fits the round cap; M and L do not.
- Merge in-session. Carried Backlog entries are candidates already: check each against the product and drop one that no longer applies (say so in the round report).
- Add the net-new S-sized survivors (distinct and eligible). The merged list becomes the next `Backlog`: keep the top 8 including the chosen one, aged entries always kept — the rest are dropped. Net-new M and L candidates go straight to the `Icebox`.
- With `focus`: spotlight that area in each grounding summary and ask every lens for ≥1 in-focus candidate.
- No subagent tool, or none you may start on your own? Still brainstorm — three separate in-session passes, one per lens, ≥3 candidates each, written down in the conversation before the next begins.
- Fewer than 6 distinct survivors (Backlog + net-new) → widen: one more pass with 3 unused lenses. Never select from a thin list.
- Still thin → promote an Icebox slice that fits the round cap. The Icebox holds no slice → go to the self-stop (Loop).

### 3. Select ONE

- Rank by felt-impact × freshness ÷ cost and take the top. With `focus`, rank in-focus candidates first; pick out-of-focus only when no in-focus candidate survived, and say so in the round report.
- **Aging outranks the score:** a Backlog entry whose round number minus `since` is 3 or more can wait no longer — take the best aged one; for each other aged entry, move it to the Icebox if it has grown, or drop it.
- **"A bit better" cap:** one round changes ≤3 files or ≈100 lines, whichever binds first (docs/copy-only rounds may exceed with one stated sentence of reason). A candidate over the cap goes to the ledger's **Icebox**.
- The chosen angle must name a concrete "who feels it". If it can't, it is probably a refactor in disguise — Icebox it.

### 4. Implement

- Follow the target repo's conventions and instruction files (AGENTS.md / CLAUDE.md / CONTRIBUTING).
- Read every file before editing. Complete changes only — no TODO, mock, placeholder or "temporary path".
- **no-git:** before the round's first edit run `node <mabb-root>/scripts/ledger.mjs backup --target <target> --round N -- <files…>` with every file the round will touch or create. The list is final — a file named later is refused: `fail` the round and start it over.

### 5. Verify

- Use the repo's own verification surface: tests, build, lint, type-check, or a real smoke run. At least one real check must pass.
- Toolchain unavailable → report "verification pending" honestly in the round report — never claim verified.
- No verification surface at all (no tests/build/lint — distinct from a missing toolchain)? Smoke the changed path by hand and record the command plus its output as evidence; nothing runnable (a pure docs/copy change) → `verification pending (no runnable surface)`, never claimed verified.
- A check that was already red at the baseline is no evidence either way: don't chase it. The round still needs one real check that passes; when the only surface is the red one, the round ships nothing the failed-round way below, with `verification pending (baseline red)`.
- Red after implementing? Fix it within the round's ≤3-file/≈100-line cap. Still red → ship nothing, and never discard the attempt:
  - git mode: stage the round's files by path and commit them as `mabb #N: <angle>`, then reverse with a second commit `mabb #N: revert` — the failed diff and its failing check stay in history for the fix workflow; a failed round is exactly two commits.
  - no-git: run `node <mabb-root>/scripts/ledger.mjs fail --target <target> --round N` — it keeps before/after copies under `.agents/mabb/failed/N/` and restores the originals.
- Record the row as `failed, reverted — <angle>` citing the revert commit, with the red check as evidence, and say so in the round report.

### 6. Record

- **Commit (git mode):** the round's files alone — `mabb #N: <angle>`, then two body lines: `who feels it: …` and `evidence: …`. A failed round already committed in Verify; here it only writes its row.
- **Ledger:** write it in the current format below, then rerun `check` until it passes:
  - table: one row for the round — `date` is the commit's, `dimension` a seed name (`other` when none fits), `commit` the round's hash (the revert's for a failed round, `no-git` in that mode), `files` as committed, `evidence` one short line;
  - `Backlog`: drop the chosen entry and any the round completed, then rewrite the rest as `B-1, B-2, …` in rank order, each keeping its `since` — the round whose brainstorm produced it;
  - `Icebox`: new entries take the next free `IB-n` and are never renumbered; at 12 entries, land a slice or drop the weakest (say so in the round report). Delete an entry only when the whole idea landed, citing `[lands IB-n]` as the last thing in the angle;
  - a slice that lands rewrites the entry into what remains (same id) and cites `[slices IB-n]`; the entry itself ends with `— remainder after #N`;
  - `Dimensions touched`: one comma-separated bullet — add this round's dimension (a failed round adds none). `Next round`: overwrite with one line. `Lenses used`: replace with this brainstorm's lenses, widening ones included (at most 6);
  - `check` says the ledger is over budget → fold its oldest rows into `Archive` lines (`- #N YYYY-MM-DD dimension: ≤40-char keyword`), keeping the latest 10 full rows; old `Archive` lines may then fold into ranges (`- #a..#b <first date>..<last date>: note`).

### 7. Loop

- End every round with a one-block round report of exactly six labeled fields, always this order, one per line: `angle:` / `who feels it:` / `what changed:` / `evidence:` / `icebox additions:` / `next-round hint:`.
- An empty field is written `none`, never dropped; `icebox additions:` lists each new entry as `IB-N (dimension) short name`. Notes the protocol asks you to "say so" about (degraded grounding, an out-of-focus pick, a shared ledger, an in-session brainstorm, a dropped stale entry) go on the `what changed:` line.
- Default: ask once "continue?". With N given: run all N and stop. Never push to any remote unless the user explicitly said push in this run.
- **Self-stop:** two consecutive thin brainstorms (Icebox included) → report "nothing worth a round right now" instead of forcing a weak change.
- A thin brainstorm is recorded at once: its lenses go on `## Lenses used` (create the ledger if none exists). On the second one, overwrite `## Next round` with `- stalled <date>: two consecutive thin brainstorms, icebox held no slice — <what to widen next>`.
- When a run ends — all N rounds done, the user declines to continue, or the loop self-stops — close it with a one-block run summary of exactly four labeled fields, always this order, one per line: `rounds:` / `changes:` / `icebox added:` / `leftovers:`.
- `rounds:` e.g. `3 run`, or `2 of 5 run, stopped after two consecutive thin brainstorms`. `changes:` e.g. `3 commits, 7 files` (no-git: `3 rounds, 7 files`); a reverted round shows as `1 failed, reverted`. `icebox added:` count plus short names. `leftovers:` the strongest thread worth a future round. Empty fields are `none`.

## Ledger (current format; `check` validates it; omit an empty optional section)

```markdown
<!-- mabb-ledger v2 -->
# mabb ledger — <project>

| # | date | dimension | angle | commit | files | evidence |
|---|------|-----------|-------|--------|-------|----------|
| 1 | 2026-11-03 | error messages & failure paths | wa total line counts unscored failures | 8b72d2ce | backend/scripts/wa.py | pytest 81 green |

## Backlog (ranked; keep the top 8)
- B-1 (microcopy) README says when to use the CLI vs MCP — S — since #1

## Dimensions touched
- error messages & failure paths

## Next round
- steer toward speed; leave the CLI contract alone while PR 48 is open

## Icebox (too big for one round; delete only when fully landed)
- IB-1 (speed) a board flip re-renders everything; needs a diff — M

## Lenses used
- #1: first-time user, picky daily user, auditor
```

Beyond the template, `check` enforces: seed and lens names as listed below, their parenthetical optional; angle and evidence ≤ 80 characters, files ≤ 120, backlog ideas ≤ 120, icebox ideas ≤ 160, the next-round line ≤ 200.
Also: every list comma-separated (more than four files: list three, then `+N`); one bullet each in `Dimensions touched`, `Next round` and `Lenses used`; 12,000 bytes in total.

## Lens pool

first-time user (day one) · picky daily user · maintainer in six months · competitor migrant · constrained user (weak network / old device / small screen) · auditor (security, privacy, compliance) · accessibility user · automation/script caller

## Dimension seeds

first-run & empty states · error messages & failure paths · microcopy (labels, buttons, tooltips) · defaults · speed (felt and real) · feedback (loading, progress, confirmation) · consistency (terms, visuals, interactions) · discoverability
· edge cases & input boundaries · undo & safety nets · docs & examples · trust & transparency (logs, observability) · cost (time, tokens, API calls) · accessibility · keyboard & power users · install & onboarding

Free-form candidates that fit no seed are welcome — seeds steer coverage, they do not fence it. A landed one is recorded under `other`.

## Red lines

- A rewrite or big refactor is not mabb — icebox it.
- Fixing an already-reported bug belongs to a fix workflow, not a round (an unreported rough edge is fair game).
- Pure reformatting / renames never count as a round.
- Every round must answer: **who feels this bit of better?**
- No unbounded loops: N rounds or an explicit "keep going" only.
- The skill text stays lean: the repo's contract test caps it at 16,000 characters and 400 per line (frontmatter excepted). An addition pays for itself — distill or merge existing lines in the same commit, or it waits in the Icebox.

## Trial

Suggested first prompt: *对 /path/to/repo 跑 2 轮 make it a bit better*, or in English *run 2 rounds of make it a bit better on /path/to/repo* — expect up to two brainstormed, small, verified, committed improvements and a ledger row per round (self-stop or a reverted round yields fewer).
