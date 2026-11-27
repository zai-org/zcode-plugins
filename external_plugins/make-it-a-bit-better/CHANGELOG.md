# Changelog

## 0.3.0

Ledger 2.0. The bookkeeping had been text-only conventions; after 47 real
rounds across five target repos every long-running ledger had drifted
somewhere, and nothing checked.

- **Backlog**: small candidates that were not picked get a ranked home (the
  top 8; ids follow rank, `B-1` first) instead of being re-derived by every
  brainstorm and squeezed into the one-line next-round hint. Lenses are
  asked for net-new candidates only; carried entries are checked against
  the product before they count. Cost is defined against the round cap: S
  fits it, M and L go straight to the Icebox.
- **Aging**: a backlog entry three or more rounds past its `since` is taken
  this round (the best one; other aged ones are iced or dropped), and aged
  entries are never dropped by the cap. One docs candidate had been
  re-proposed and skipped six rounds running.
- **Ledger validator** — `scripts/ledger.mjs check`, zero dependencies, run
  before every round and after every ledger write. It enforces the format
  (cell caps, section order, ids, seed dimensions, pool lenses, a 12 KB
  budget with an `Archive` for old rows and range lines for old archives)
  and what prose could not hold:
  - commit integrity: a row's commit must still be reachable from a branch
    (a dangling object counts as gone), cite its round by whole number, and
    contain the listed files (non-ASCII paths included); a
    round commit without a row is reported on any branch, and a round whose
    commit was rewritten is pointed at its new hash. A `failed, reverted`
    row must cite a real `mabb #N: revert` commit. Publishing had squashed
    three repos' histories and left 44 of 44 ledger commit references
    unreachable, silently.
  - a `lost` row is a record, not proof: when its change is gone from the
    tree as well, the check says so and the angle returns to the Backlog,
    so a real rough edge is never blocked as "already done".
  - ledger privacy: the ledger must be ignored or tracked before the first
    commit can sweep it in.
  - icebox lifecycle: `[lands IB-n]` requires the entry gone; `[slices IB-n]`
    requires a `— remainder after #k` entry at the end of the line. An idea
    may be sliced more than once and its remainder landed later; a partial
    landing no longer deletes the rest of the idea.
- **Legacy ledgers** (no v2 marker) exit 3 with the conversion spelled out
  and one line per row saying what its commit became (`lost`, `v1 <hash>`
  or keep); they are converted at Ground, before any round work, and the
  old file is kept as `ledger.v1.md`.
- **Gates moved and narrowed**:
  - the ledger-ignore rule appends `.agents/mabb/` — not the whole
    `.agents/`, which silently ignored the shared skills a target repo kept
    there — and commits that line on its own as `mabb: ignore the ledger`,
    so a failed round's revert cannot undo it. A `.gitignore` carrying
    someone else's change is never touched (`.git/info/exclude` instead); a
    ledger the team already tracks is left alone and committed per round as
    `mabb #N: ledger`.
  - working-tree gate: other people's uncommitted changes are never staged
    or edited; a check that was already red at the baseline is not blamed
    on (or reverted for) the round.
  - "team repo" has explicit criteria, including repo instructions that
    reserve main for merges.
- **no-git mode** (opt-in, by name): a non-git directory or a single file
  can be polished; `backup` and `fail` keep one backup and the before/after
  copies of a failed round instead of commits. The file list is declared
  once per round, symlinks are refused, and `fail` checks everything before
  it restores anything.
- **Skill text**: capped by characters (16,000) and line length (400)
  instead of by lines — the line count had stayed at 117 while lines grew to
  764 characters. Long bullets split; the ledger's limits are stated in the
  text, not only in the validator. The `speed` dimension seed is now
  `speed (felt and real)`: its comma broke the comma-separated list of
  dimensions touched.
- **Brainstorm**: lenses are drawn at random from those the previous round
  did not use; a lens that cannot return three candidates may be swapped;
  widening uses 3 unused lenses; a thin brainstorm's lenses are recorded at
  once so the retry never redraws them; an in-session fallback brainstorm is
  noted in the round report.
- **Trigger word** `mabb` added to the skill description.
- **README** is a summary again: the seven protocol steps went from 459
  words to about 235 that defer to `SKILL.md` (stated: where the two
  differ, the skill text wins).
- **Tests** — `npm test`, 69 of them: 26 on the ledger format, 29 on the
  helper (20 `check`, 9 `backup`/`fail`), 14 contract tests over versions,
  vocabulary, the ledger template, report fields and the bilingual mirror.
  This repo had none while five of its previous seven releases were drift
  fixes.
- **Codex manifest** (`.codex-plugin/plugin.json`); `engines.node >=18.13`.

## 0.2.8

- Docs only: the README news section (both languages) now states its window
  in one line — the two most recent entries stay, the full history lives in
  this file. The rule was real (0.2.2 set "one line of news"; 0.2.7 rolled
  it to two and 0.2.5 left the window) but lived only in this changelog's
  wording, so a rolling exit read as a lost entry — 0.2.7's round report
  even claimed the 0.2.5 line was preserved. The stated window makes the
  next roll self-explaining.

## 0.2.7

- README bilingual news had stalled at 0.2.5: both languages now list 0.2.6
  (the icon round) and this entry, keeping the README one-glance history in
  step with this file.
- The ledger section (both languages) states its boundary in one sentence:
  dedup against old angles, stable `IB-N` ids and the `stalled` overwrite are
  skill-text conventions with no script enforcing them.

## 0.2.6

- New icon: 1-bit monochrome pixel hammer cracking a rough block into a
  polished one. Part of the shared pixel family across the six plugins; no
  code changes.

## 0.2.5

- SKILL Trial section: the 2-round suggested prompt now expects "up to two"
  committed improvements with a ledger row per round and notes that a
  self-stop or a reverted round yields fewer — the fixed "two improvements and
  a ledger with 2 entries" was a promise the protocol itself can break (two
  consecutive thin brainstorms stop the run with no round row), and it had
  missed 0.2.4's "up to N" calibration of the README quick start.

## 0.2.4

- Quick start: the expectation line after the 5-round example says "up to N
  committed small improvements" again (both languages) — it had drifted to
  "up to 3" when the example was added, but each round lands at most one
  improvement, so N rounds yield at most N (0.2.1 already said "up to N").
- `.gitignore` drops `build/`, `__pycache__/` and `*.pyc` — template leftovers
  from the initial commit; this is a pure-JS skill repo with no Python files
  and no build step.

## 0.2.3

- README 双语的 DSH 版本要求补上上界，改为 `>=0.2.1-rc.2 <0.3.0`，与
  `package.json` 的 `engines.dsh` 同口径：原文「0.2.1-rc.2 or newer / 或更新」
  漏了 `<0.3.0` 上限，DSH 0.3.x 用户按文档以为兼容，实际会被安装闸挡下。

## 0.2.2

- The repo gate now requires `target` to be the repository root: a directory
  nested inside another repository fails the gate and reports both paths,
  instead of silently committing rounds into the parent repo.
- This changelog is the single release history: the README keeps one line of
  news and points here (it had drifted — the README listed 0.2.1/0.2.0/0.1.0
  while this file only had 0.2.2).
- `package.json` declares `engines.dsh` and the skill-filesystem peer, so an
  incompatible DSH blocks install and activation instead of failing at runtime.

## 0.2.1 (2026-11-03)

- The skill text carries a soft cap (150 lines): growth past the cap pays for
  itself by distilling existing lines, so every round stays loadable for
  small-context agents.
- README answers "why not just ask an agent to improve it?" up front — the three
  structural guarantees an ad-hoc prompt can't give.
- Quick start expectations calibrated: up to N committed improvements; a
  self-stop (`stalled` ledger line) or a reverted round (`failed, reverted`) is
  the loop being honest, not broken.
- A round whose red check can't be fixed ships nothing, in exactly two commits —
  the round's commit plus its revert; the failed diff and its failing evidence
  stay in git history for the fix workflow.

## 0.2.0 (2026-11-03)

Protocol hardened by 13 self-hosted rounds (mabb polishing itself):

- Verify honesty: a red check is fixed within the round cap or reverted with a
  reversing commit and logged as `failed, reverted`; "verification pending" is
  distinct from a missing toolchain; a repo with no verification surface gets a
  manual smoke, never an invented check.
- Safety gates: non-git targets are rejected before any work; the ledger's
  `.agents/` home is verified gitignored before recording; a repo without docs
  grounds on entry-point code + tree, never an improvised summary.
- `focus` now shapes generation in every lens and ranks in-focus candidates
  first — end to end, not just where the round grounds.
- Fixed-shape reporting: every round ends with the same six-field report, every
  run closes with a four-field summary; the ledger carries a dimensions-coverage
  view and next-round hint, and a self-stopped run leaves a dated `stalled`
  marker.
- Icebox lifecycle: thin brainstorms promote a sliceable icebox idea instead of
  stopping early; entries carry stable short ids (`IB-N`) and are deleted when
  landed.

## 0.1.0

Initial release: the 7-step round protocol, lens pool, ledger and icebox.
