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
integration worktree (``prepare_integration_worktree``), and
``cleanup_feature_worktrees`` for disk hygiene once a run completes. It
**never touches** uncommitted changes in the main working tree (red line:
"never discard the worktree") — a worktree is a new checkout, not an
overwrite.

Design decisions:
- Worktrees are attached in a **sibling directory of the project**
  (``../<project>-baton-<change>-...``), not inside the project, to avoid
  polluting ``.gitignore`` and being swept up by ``git add -A``.
- Assignment branches are ``baton/<change>-tic-<ticket>-a<attempt>``, created
  from the integration branch ``baton/<change>``.
- Worktree creation failure (branch exists, path occupied, not a git repo)
  **raises an exception** rather than failing silently — in parallel execution
  a worktree that did not come up must surface to the caller.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


class WorktreeError(Exception):
    """Worktree creation/cleanup failure."""


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


def _run_git(args: list[str], cwd: str, timeout: int = 30) -> subprocess.CompletedProcess:
    """Run a git subprocess in ``cwd``; raise WorktreeError on failure.

    git unavailable / not a git repo / branch conflict → uniformly raised as
    WorktreeError, so the executor can decide whether to skip this worker or
    abort the whole batch.
    """
    try:
        result = subprocess.run(
            ["git"] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise WorktreeError(f"git unavailable: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        raise WorktreeError(f"git {' '.join(args)} timed out ({exc.timeout}s)") from exc
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        raise WorktreeError(
            f"git {' '.join(args)} failed (exit {result.returncode}): {stderr}"
        )
    return result


def _is_git_repo(path: Path) -> bool:
    """Whether ``path`` is a git repo (has ``.git`` or git rev-parse succeeds)."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=str(path),
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and result.stdout.strip() == "true"


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
    if not _is_git_repo(project):
        raise WorktreeError(f"project is not a git repo: {project}")
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
) -> WorktreeSlot:
    project = Path(project_path).resolve()
    return _prepare_explicit_worktree(
        project,
        path=assignment_worktree_path(project, feature, ticket_num, attempt),
        branch=assignment_branch(feature, ticket_num, attempt),
        base_ref=integration_branch(feature),
        worker_id=f"tic-{ticket_num:03d}-a{attempt:02d}",
    )


def branch_is_merged(repo_path: str | Path, branch: str, target: str) -> bool:
    try:
        _run_git(
            ["merge-base", "--is-ancestor", branch, target],
            cwd=str(Path(repo_path).resolve()),
        )
        return True
    except WorktreeError:
        return False


def _current_branch(path: Path) -> str:
    """Read the current branch name at ``path``; returns empty for non-repos or detached HEAD."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(path),
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""
    return (result.stdout or "").strip()


def _branch_exists(repo: Path, branch: str) -> bool:
    """Whether ``branch`` exists in ``repo``."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--verify", branch],
            cwd=str(repo),
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def _git_quiet(args: list[str], cwd: str, timeout: int = 30) -> subprocess.CompletedProcess:
    """Run git WITHOUT raising on non-zero exit (for tolerant operations).

    Unlike :func:`_run_git`, this does not raise — used by cleanup where a
    non-zero exit (e.g. a dirty worktree) is an expected, handleable case.
    """
    try:
        return subprocess.run(
            ["git"] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise WorktreeError(f"git {' '.join(args)} unavailable/timed out: {exc}") from exc


def cleanup_feature_worktrees(
    project_path: str | Path,
    feature: str,
    *,
    include_integration: bool = False,
    dry_run: bool = False,
) -> dict:
    """Remove a finished run's worktrees (disk hygiene).

    Safe by construction:
    - Never touches the main working tree.
    - Removes assignment worktrees on ``baton/<feature>-tic-*`` branches — their
      work is already integrated into the integration branch on a sealed receipt,
      so they are stale once the run completes. The shared ``baton/<feature>``
      integration worktree is removed only when ``include_integration=True``
      (after it has been merged to main).
    - Uses ``git worktree remove`` WITHOUT ``--force``: a dirty worktree is
      skipped, never discarded (red line: never discard the worktree).
    - ``dry_run=True`` removes nothing: the matched worktrees are listed as
      ``wouldRemove`` (a dirty one would still be skipped by the real run).

    Returns a ``{"removed": [...], "skipped": [...], "integrationIncluded": bool}``
    summary, or ``{"dryRun": True, "wouldRemove": [...], "integrationIncluded":
    bool}`` when previewing. The controller calls this automatically when a run
    reaches ``complete`` (assignment worktrees only); the CLI ``cleanup``
    command exposes it directly.

    Fails loud instead of an empty success when the directory is not a git
    repository, or when nothing matches and no ``baton/<feature>*`` branch
    exists either — a typo'd change-id is otherwise indistinguishable from a
    fully cleaned run. Any run that dispatched created the integration branch
    (``prepare_integration_worktree`` runs before every action batch) and
    branches outlive worktree removal, so a feature that really ran keeps the
    empty-but-successful answer.
    """
    project = Path(project_path).resolve()
    result = _git_quiet(["worktree", "list", "--porcelain"], cwd=str(project))
    if result.returncode != 0:
        raise WorktreeError(
            f"git worktree list failed in {project}: "
            f"{(result.stderr or result.stdout or '').strip()}"
        )
    entries: list[tuple[str, str]] = []
    cur_path: str | None = None
    cur_branch = ""
    for line in (result.stdout or "").splitlines():
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

    integ_branch = integration_branch(feature)
    tic_prefix = f"{integ_branch}-tic-"
    matches = [
        (wt_path, branch)
        for wt_path, branch in entries
        if Path(wt_path) != project  # never the main working tree
        and (
            branch.startswith(tic_prefix)
            or (branch == integ_branch and include_integration)
        )
    ]

    if not matches:
        probe = _git_quiet(
            ["branch", "--list", integ_branch, f"{tic_prefix}*"], cwd=str(project)
        )
        if not (probe.stdout or "").strip():
            raise WorktreeError(
                f"no baton worktrees or branches found for '{feature}' — "
                "nothing indicates this change ever ran here; check the change-id"
            )

    if dry_run:
        return {
            "dryRun": True,
            "wouldRemove": [{"path": p, "branch": b} for p, b in matches],
            "integrationIncluded": include_integration,
        }

    removed: list[dict] = []
    skipped: list[dict] = []
    for wt_path, branch in matches:
        r = _git_quiet(["worktree", "remove", wt_path], cwd=str(project))
        if r.returncode == 0:
            removed.append({"path": wt_path, "branch": branch})
        else:
            skipped.append(
                {
                    "path": wt_path,
                    "branch": branch,
                    "reason": (r.stderr or r.stdout or "").strip()
                    or "worktree remove failed (likely dirty — not discarded)",
                }
            )
    return {
        "removed": removed,
        "skipped": skipped,
        "integrationIncluded": include_integration,
    }


__all__ = [
    "WorktreeError",
    "WorktreeSlot",
    "assignment_branch",
    "assignment_worktree_path",
    "branch_is_merged",
    "cleanup_feature_worktrees",
    "integration_branch",
    "integration_worktree_path",
    "prepare_assignment_worktree",
    "prepare_integration_worktree",
]
