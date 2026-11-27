"""worktree.py — git worktree working-area isolation (the technical basis for parallel execution).

Two agents on the same project committing to the **same git working tree**
concurrently = files overwriting each other and commits colliding (cf. the
AGENTS.md red-line section "concurrent editing is the norm" — but that one is
about "editing the same file in turn"; what we avoid here is "two agents
editing the same working tree at the same time").

git worktree is git's native parallel-development mechanism: multiple
independent working trees are attached under the **same repository**, each
checking out its own branch, sharing the ``.git`` object store while the
working trees stay isolated. This is what "N assignments developing the same
project in parallel" needs:

    main repo/                                      ← never checked out/switched
    ├── .git/                                       ← shared object store
    └── ../<project>-baton-<change>-tic-2-a01/      ← one assignment
        └── src/...                                 ← own branch, no stomping

This module provides the primitives the controller drives: one isolated
worktree per assignment (``prepare_assignment_worktree``), the shared
integration worktree (``prepare_integration_worktree`` + ``sync_integration_base``),
and ``cleanup_feature_worktrees`` for disk and branch hygiene once a run
completes. It **never touches** uncommitted changes in the main working tree
(red line: "never discard the worktree") — a worktree is a new checkout, not
an overwrite.

Design decisions:
- Worktrees are attached in a **sibling directory of the project**
  (``../<project>-baton-<change>-...``), not inside the project, to avoid
  polluting ``.gitignore`` and being swept up by ``git add -A``. The runtime
  state that does live inside the project (``.dsh/baton/``) is kept out of
  commits through the repository's ``info/exclude``.
- Assignment branches are ``baton/<change>-tic-<ticket>-a<attempt>``, created
  from the integration branch ``baton/<change>``.
- Worktree creation failure (branch exists, path occupied, not a git repo)
  **raises an exception** rather than failing silently — in parallel execution
  a worktree that did not come up must surface to the caller.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from orchestration.git_run import run_git


class WorktreeError(Exception):
    """Worktree creation/cleanup failure; ``code`` is the CLI error code."""

    code = "worktree"

    def __init__(self, message: str = "", *, code: str | None = None) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code


#: Where baton keeps its runtime state inside the target project.
RUNTIME_DIR = ".dsh/baton/"

_excluded_projects: set[Path] = set()


@dataclass
class WorktreeSlot:
    """Description of one worker's independent working area.

    ``path`` is the worktree's absolute path (the agent edits code here);
    ``branch`` is the branch this worktree checks out;
    ``main_repo`` is the main repository root (where the shared ``.git`` lives);
    ``worker_id`` names the slot owner (``integration-<change>`` or
    ``tic-<ticket>-a<attempt>``).
    """

    path: Path
    branch: str
    main_repo: Path
    worker_id: str


def _run_git(args: list[str], cwd: str | Path):
    """Run a raising git subprocess in ``cwd`` (see :func:`run_git`).

    git unavailable / not a git repo / branch conflict → uniformly raised as
    WorktreeError, so the executor can decide whether to skip this worker or
    abort the whole batch.
    """
    return run_git(args, cwd=cwd, error=WorktreeError)


def _git_quiet(args: list[str], cwd: str | Path):
    """Run git WITHOUT raising on non-zero exit (for tolerant operations).

    Unlike :func:`_run_git`, this does not raise on exit status — used by
    probes and by cleanup where a non-zero exit (e.g. a dirty worktree) is an
    expected, handleable case.
    """
    return run_git(args, cwd=cwd, error=WorktreeError, check=False)


def _tolerant(args: list[str], cwd: Path, fallback: str) -> str:
    """A probe that answers ``fallback`` when git cannot run or fails."""
    try:
        result = _git_quiet(args, cwd)
    except WorktreeError:
        return fallback
    return result.stdout.strip() if result.returncode == 0 else fallback


def _is_git_repo(path: Path) -> bool:
    """Whether ``path`` is a git repo (git rev-parse succeeds)."""
    return _tolerant(["rev-parse", "--is-inside-work-tree"], path, "") == "true"


def _current_branch(path: Path) -> str:
    """Read the current branch name at ``path``; empty for non-repos or detached HEAD."""
    return _tolerant(["rev-parse", "--abbrev-ref", "HEAD"], path, "")


def _repo_root(path: Path) -> str:
    """The working-tree root git reports for ``path`` ('' when not a repo)."""
    return _tolerant(["rev-parse", "--show-toplevel"], path, "")


def _require_repo_root(project: Path) -> None:
    """Refuse a project that merely sits inside a repository.

    Baton creates ``baton/*`` branches and worktrees at the repository root
    and hands the subagent a whole-repository checkout. Pointed at a plain
    directory inside some other repo, it used to adopt that repo silently.
    """
    root = _repo_root(project)
    if not root:
        raise WorktreeError(f"project is not a git repo: {project}")
    if os.path.normcase(str(Path(root).resolve())) != os.path.normcase(str(project)):
        raise WorktreeError(
            f"project is not a git repository root: {project} is inside {root}. "
            "Baton creates branches and worktrees at the repository root, so "
            f"point it at {root}, or make {project.name} its own repository."
        )


def _branch_exists(repo: Path, branch: str) -> bool:
    """Whether ``branch`` exists in ``repo``."""
    try:
        return _git_quiet(["rev-parse", "--verify", "--quiet", branch], repo).returncode == 0
    except WorktreeError:
        return False


def _is_ancestor(repo: Path, branch: str, target: str) -> bool:
    """Whether every commit of ``branch`` is already contained in ``target``."""
    try:
        return _git_quiet(["merge-base", "--is-ancestor", branch, target], repo).returncode == 0
    except WorktreeError:
        return False


def _list_branches(repo: Path, pattern: str) -> list[str]:
    try:
        result = _git_quiet(["for-each-ref", "--format=%(refname:short)", pattern], repo)
    except WorktreeError:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def _is_unclean(path: Path) -> bool:
    """Whether ``git worktree remove`` would refuse this worktree."""
    return bool(_tolerant(["status", "--porcelain"], path, ""))


def _is_ignored(project: Path, target: Path) -> bool:
    # The trailing slash tells git the path is a directory even before it
    # exists, so a directory-anchored pattern can match.
    try:
        probe = _git_quiet(["check-ignore", "-q", "--", str(target).rstrip("/") + "/"], project)
    except WorktreeError:
        return False
    return probe.returncode == 0


def exclude_runtime_dir(project_path: str | Path, relative: str = RUNTIME_DIR) -> bool:
    """Keep baton's runtime state out of the target repository's commits.

    The plan store, receipts and boards live under ``.dsh/baton/`` inside the
    business project; an agent that stages everything (``git add -A``) would
    commit them. The directory is appended to the repository's
    ``info/exclude`` — a local, untracked file — as a repository-relative
    pattern, so no tracked ``.gitignore`` is ever touched. Returns whether the
    directory is ignored in the end, verified with git itself; a non-git
    directory has nothing to exclude.
    """
    project = Path(project_path).resolve()
    if project in _excluded_projects:
        return True
    try:
        common = _git_quiet(["rev-parse", "--git-common-dir"], project)
        root = _git_quiet(["rev-parse", "--show-toplevel"], project)
    except WorktreeError:
        return False
    if common.returncode != 0 or root.returncode != 0:
        return False  # not a git repository
    target = project / relative
    if _is_ignored(project, target):
        _excluded_projects.add(project)
        return True
    git_dir = Path(common.stdout.strip())
    if not git_dir.is_absolute():
        git_dir = (project / git_dir).resolve()
    pattern = os.path.relpath(target, root.stdout.strip()).replace(os.sep, "/")
    pattern = pattern.rstrip("/") + "/"  # anchored to the directory itself
    exclude = git_dir / "info" / "exclude"
    try:
        existing = exclude.read_text(encoding="utf-8") if exclude.is_file() else ""
        if not any(line.strip() == pattern for line in existing.splitlines()):
            exclude.parent.mkdir(parents=True, exist_ok=True)
            with open(exclude, "a", encoding="utf-8") as handle:
                if existing and not existing.endswith("\n"):
                    handle.write("\n")
                handle.write(
                    "# baton runtime state (plan store, receipts, boards)\n"
                    f"{pattern}\n"
                )
    except OSError as exc:
        raise WorktreeError(f"cannot exclude {pattern} via {exclude}: {exc}") from exc
    if _is_ignored(project, target):
        _excluded_projects.add(project)
        return True
    return False


def _safe_component(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-")
    if not safe:
        raise WorktreeError("feature must contain a safe branch/path component")
    return safe


def integration_branch(feature: str) -> str:
    return f"baton/{_safe_component(feature)}"


def assignment_branch(feature: str, ticket_num: int, attempt: int) -> str:
    # Git refs cannot have both ``baton/feat`` and ``baton/feat/...`` because
    # the former occupies the path as a file. Keep sibling refs instead.
    return f"{integration_branch(feature)}-tic-{ticket_num:03d}-a{attempt:02d}"


def integration_worktree_path(project_path: str | Path, feature: str) -> Path:
    project = Path(project_path).resolve()
    return project.parent / (
        f"{project.name}-baton-{_safe_component(feature)}-integration"
    )


def assignment_worktree_path(
    project_path: str | Path, feature: str, ticket_num: int, attempt: int
) -> Path:
    project = Path(project_path).resolve()
    return project.parent / (
        f"{project.name}-baton-{_safe_component(feature)}-"
        f"tic-{ticket_num:03d}-a{attempt:02d}"
    )


def _prepare_explicit_worktree(
    project: Path,
    *,
    path: Path,
    branch: str,
    base_ref: str,
    worker_id: str,
) -> WorktreeSlot:
    _require_repo_root(project)
    if path.exists() and _is_git_repo(path):
        current = _current_branch(path)
        if current == branch:
            return WorktreeSlot(path, branch, project, worker_id)
        raise WorktreeError(
            f"worktree path {path} checks out {current}, expected {branch}"
        )
    if path.exists():
        raise WorktreeError(f"worktree path is occupied by a non-worktree: {path}")
    if _branch_exists(project, branch):
        _run_git(["worktree", "add", str(path), branch], cwd=str(project))
    else:
        _run_git(
            ["worktree", "add", "-b", branch, str(path), base_ref],
            cwd=str(project),
        )
    return WorktreeSlot(path, branch, project, worker_id)


def prepare_integration_worktree(
    project_path: str | Path,
    feature: str,
    *,
    base_branch: str = "main",
) -> WorktreeSlot:
    project = Path(project_path).resolve()
    return _prepare_explicit_worktree(
        project,
        path=integration_worktree_path(project, feature),
        branch=integration_branch(feature),
        base_ref=base_branch,
        worker_id=f"integration-{_safe_component(feature)}",
    )


def prepare_assignment_worktree(
    project_path: str | Path,
    feature: str,
    ticket_num: int,
    attempt: int,
    *,
    base_ref: str | None = None,
) -> WorktreeSlot:
    """One isolated worktree on a fresh assignment branch.

    ``base_ref`` is the commit the claim recorded; passing it makes the packet
    and the worktree agree by construction instead of both chasing the
    integration branch's moving tip.
    """
    project = Path(project_path).resolve()
    return _prepare_explicit_worktree(
        project,
        path=assignment_worktree_path(project, feature, ticket_num, attempt),
        branch=assignment_branch(feature, ticket_num, attempt),
        base_ref=base_ref or integration_branch(feature),
        worker_id=f"tic-{ticket_num:03d}-a{attempt:02d}",
    )


def sync_integration_base(integration_path: str | Path, base_branch: str) -> dict[str, Any]:
    """Re-align a reused integration branch with its base branch.

    The integration branch outlives a run's worktrees, so a change that is
    re-run after its branch was merged into the base would otherwise build on
    that stale tip. When every commit on the integration branch is already in
    the base branch it is fast-forwarded to the base tip (nothing to lose). A
    branch that still holds unmerged work is never touched — it is only
    reported, with how far it is behind.
    """
    path = Path(integration_path)
    settled: dict[str, Any] = {
        "base_branch": base_branch,
        "base_found": True,
        "fast_forwarded": False,
        "behind": 0,
    }
    base = _git_quiet(["rev-parse", "--verify", "--quiet", base_branch], path)
    if base.returncode != 0:
        return {**settled, "base_found": False}
    base_tip = base.stdout.strip()
    head = _git_quiet(["rev-parse", "HEAD"], path)
    if head.returncode != 0:
        raise WorktreeError(
            f"cannot read the integration branch in {path}: "
            f"{(head.stderr or '').strip() or 'git rev-parse HEAD failed'}"
        )
    if head.stdout.strip() == base_tip:
        return settled
    if _is_ancestor(path, "HEAD", base_tip):
        merged = _git_quiet(["merge", "--ff-only", base_branch], path)
        note = "" if merged.returncode == 0 else (merged.stderr or merged.stdout).strip()
        return {**settled, "fast_forwarded": merged.returncode == 0, "note": note}
    behind = _git_quiet(["rev-list", "--count", f"HEAD..{base_tip}"], path)
    count = behind.stdout.strip() if behind.returncode == 0 else ""
    return {**settled, "behind": int(count) if count.isdigit() else 0}


def branch_is_merged(repo_path: str | Path, branch: str, target: str) -> bool:
    return _is_ancestor(Path(repo_path).resolve(), branch, target)


def _parse_worktree_list(porcelain: str) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    cur_path: str | None = None
    cur_branch = ""
    for line in porcelain.splitlines():
        if line.startswith("worktree "):
            if cur_path:
                entries.append((cur_path, cur_branch))
            cur_path = line[len("worktree ") :]
            cur_branch = ""
        elif line.startswith("branch "):
            cur_branch = line[len("branch ") :]
            if cur_branch.startswith("refs/heads/"):
                cur_branch = cur_branch[len("refs/heads/") :]
    if cur_path:
        entries.append((cur_path, cur_branch))
    return entries


def _branch_plan(
    project: Path,
    feature: str,
    tic_branches: list[str],
    *,
    drop_integration: bool,
    base_branch: str,
    keep: set[str] | None = None,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Split the run's branches into deletable (provably merged) and kept.

    An assignment branch is deletable exactly when it is an ancestor of the
    integration branch (its work is contained there) or, once that branch is
    gone, of the base branch. Everything else — an abandoned attempt's
    unmerged commits, a branch that advanced past its seal — is kept for
    audit. The integration branch itself is deletable only when it is an
    ancestor of the base branch.
    """
    integ = integration_branch(feature)
    integ_exists = _branch_exists(project, integ)
    reference = integ if integ_exists else base_branch
    to_delete: list[dict[str, str]] = []
    kept: list[dict[str, str]] = []
    if reference and _branch_exists(project, reference):
        for branch in tic_branches:
            if branch in (keep or ()):
                kept.append({"branch": branch, "reason": _IN_FLIGHT_REASON})
            elif _is_ancestor(project, branch, reference):
                to_delete.append({"branch": branch, "merged_into": reference})
            else:
                kept.append(
                    {"branch": branch, "reason": f"not merged into {reference}"}
                )
    else:
        kept.extend(
            {
                "branch": branch,
                "reason": (
                    f"neither {integ} nor {base_branch} exists to prove it merged"
                ),
            }
            for branch in tic_branches
        )
    if drop_integration and integ_exists:
        if _branch_exists(project, base_branch) and _is_ancestor(
            project, integ, base_branch
        ):
            to_delete.append({"branch": integ, "merged_into": base_branch})
        else:
            kept.append(
                {"branch": integ, "reason": f"not merged into {base_branch}; merge it first"}
            )
    return to_delete, kept


_DIRTY_REASON = "dirty worktree — not discarded"
_IN_FLIGHT_REASON = "its attempt is still in flight"


def _cleanup_result(include_integration: bool) -> dict[str, Any]:
    return {
        "removed": [],
        "skipped": [],
        "branches_deleted": [],
        "branches_kept": [],
        "integration_included": include_integration,
    }


def cleanup_feature_worktrees(
    project_path: str | Path,
    feature: str,
    *,
    include_integration: bool = False,
    dry_run: bool = False,
    base_branch: str = "main",
    ran_before: bool = False,
    keep: set[str] | None = None,
) -> dict[str, Any]:
    """Remove a finished run's worktrees and the branches that provably merged.

    Safe by construction:
    - Never touches the main working tree.
    - Removes assignment worktrees on ``baton/<feature>-tic-*`` branches — their
      work is already integrated into the integration branch on a sealed receipt,
      so they are stale once the run completes. The shared ``baton/<feature>``
      integration worktree is removed only when ``include_integration=True``
      (after it has been merged to main).
    - Uses ``git worktree remove`` WITHOUT ``--force``: a dirty worktree is
      skipped, never discarded (red line: never discard the worktree).
    - Deletes only branches whose commits are contained in the integration (or
      base) branch; unmerged branches are kept and reported.
    - ``dry_run=True`` removes nothing: it previews the worktrees, the branches
      that would be deleted and the ones that would be kept.
    - Branches named in ``keep`` (attempts still in flight) are left alone and
      reported under ``skipped`` / ``branches_kept``.

    Returns ``{"removed", "skipped", "branches_deleted", "branches_kept",
    "integration_included"}``, or ``{"dry_run": True, "would_remove",
    "would_skip", "would_delete_branches", "branches_kept",
    "integration_included"}`` when previewing. The controller calls this
    automatically when a run reaches ``complete`` (assignment worktrees only);
    the CLI ``cleanup`` command exposes it directly.

    Fails loud instead of an empty success when the directory is not a git
    repository, or when nothing matches and no ``baton/<feature>*`` branch
    exists either — a typo'd change-id is otherwise indistinguishable from a
    fully cleaned run. A run that really happened here (``ran_before=True``,
    read from the plan store) keeps the empty-but-successful answer once its
    branches are gone too.
    """
    project = Path(project_path).resolve()
    result = _git_quiet(["worktree", "list", "--porcelain"], cwd=str(project))
    if result.returncode != 0:
        raise WorktreeError(
            f"git worktree list failed in {project}: "
            f"{(result.stderr or result.stdout or '').strip()}"
        )
    integ_branch = integration_branch(feature)
    tic_prefix = f"{integ_branch}-tic-"
    entries = _parse_worktree_list(result.stdout or "")
    held = [
        (wt_path, branch)
        for wt_path, branch in entries
        if branch in (keep or ())
    ]
    matches = [
        (wt_path, branch)
        for wt_path, branch in entries
        if Path(wt_path) != project  # never the main working tree
        and (wt_path, branch) not in held
        and (
            branch.startswith(tic_prefix)
            or (branch == integ_branch and include_integration)
        )
    ]
    tic_branches = _list_branches(project, f"refs/heads/{tic_prefix}*")

    if not matches and not tic_branches and not _branch_exists(project, integ_branch):
        if ran_before:
            return _cleanup_result(include_integration)
        raise WorktreeError(
            f"no baton worktrees or branches found for '{feature}' — "
            "nothing indicates this change ever ran here; check the change-id"
        )

    # The integration branch may only go once nothing checks it out any more.
    integration_attached = any(
        branch == integ_branch for wt_path, branch in entries if Path(wt_path) != project
    )

    def plan(gone: list[dict], staying: list[dict]) -> tuple[list[dict], list[dict]]:
        integration_free = include_integration and (
            not integration_attached
            or any(entry["branch"] == integ_branch for entry in gone)
        )
        to_delete, kept = _branch_plan(
            project,
            feature,
            tic_branches,
            drop_integration=integration_free,
            base_branch=base_branch,
            keep=keep,
        )
        # A branch whose worktree stays (it is dirty) stays checked out.
        for entry in [e for e in to_delete if e["branch"] in {s["branch"] for s in staying}]:
            to_delete.remove(entry)
            kept.append({"branch": entry["branch"], "reason": _DIRTY_REASON})
        return to_delete, kept

    def removable() -> tuple[list[dict], list[dict]]:
        unclean = {wt_path for wt_path, _ in matches if _is_unclean(Path(wt_path))}
        return (
            [
                {"path": wt_path, "branch": branch}
                for wt_path, branch in matches
                if wt_path not in unclean
            ],
            [
                {"path": wt_path, "branch": branch, "reason": _DIRTY_REASON}
                for wt_path, branch in matches
                if wt_path in unclean
            ],
        )

    if dry_run:
        would_remove, would_skip = removable()
        would_skip = would_skip + [
            {"path": wt_path, "branch": branch, "reason": _IN_FLIGHT_REASON}
            for wt_path, branch in held
        ]
        plan_delete, plan_keep = plan(would_remove, would_skip)
        return {
            "dry_run": True,
            "would_remove": would_remove,
            "would_skip": would_skip,
            "would_delete_branches": plan_delete,
            "branches_kept": plan_keep,
            "integration_included": include_integration,
        }

    removed: list[dict] = []
    skipped: list[dict] = [
        {"path": wt_path, "branch": branch, "reason": _IN_FLIGHT_REASON}
        for wt_path, branch in held
    ]
    for wt_path, branch in matches:
        outcome = _git_quiet(["worktree", "remove", wt_path], cwd=str(project))
        if outcome.returncode == 0:
            removed.append({"path": wt_path, "branch": branch})
        else:
            skipped.append(
                {
                    "path": wt_path,
                    "branch": branch,
                    "reason": (outcome.stderr or outcome.stdout or "").strip()
                    or _DIRTY_REASON,
                }
            )
    plan_delete, plan_keep = plan(removed, skipped)
    branches_deleted: list[dict] = []
    for entry in plan_delete:
        outcome = _git_quiet(["branch", "-D", entry["branch"]], cwd=str(project))
        if outcome.returncode == 0:
            branches_deleted.append(entry)
        else:
            plan_keep.append(
                {
                    "branch": entry["branch"],
                    "reason": (outcome.stderr or outcome.stdout or "").strip()
                    or "branch delete failed",
                }
            )
    summary = _cleanup_result(include_integration)
    summary.update(
        removed=removed,
        skipped=skipped,
        branches_deleted=branches_deleted,
        branches_kept=plan_keep,
    )
    return summary


__all__ = [
    "RUNTIME_DIR",
    "WorktreeError",
    "WorktreeSlot",
    "assignment_branch",
    "assignment_worktree_path",
    "branch_is_merged",
    "cleanup_feature_worktrees",
    "exclude_runtime_dir",
    "integration_branch",
    "integration_worktree_path",
    "prepare_assignment_worktree",
    "prepare_integration_worktree",
    "sync_integration_base",
]
