# Changelog

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
