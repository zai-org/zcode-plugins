"""Deterministic integration of assignment branches into a Baton feature branch."""

from __future__ import annotations

import os
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from orchestration.worktree import WorktreeError, branch_is_merged

_LOCK_TIMEOUT_SECONDS = 120.0
_LOCK_STALE_SECONDS = 3600


def _git(path: Path, args: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            ["git", *args],
            cwd=str(path),
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise WorktreeError(f"git {' '.join(args)} failed: {exc}") from exc


def _lock_owner_alive(lock_path: Path) -> bool:
    """Best-effort liveness check so a crashed merge cannot wedge the repo."""
    try:
        pid = int(lock_path.read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        return True
    if os.name == "nt" or pid <= 0:
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


@contextmanager
def _integration_lock(path: Path) -> Iterator[None]:
    """Serialize merges into the shared integration worktree across processes.

    Git's own ``index.lock`` makes concurrent merges fail rather than corrupt,
    but a retry loop here turns a parallel reconcile into a wait. The lock file
    lives in the repository's common git dir (shared by linked worktrees) and
    is removed on every exit path.
    """
    common = _git(path, ["rev-parse", "--git-common-dir"])
    if common.returncode != 0:
        raise WorktreeError(common.stderr.strip() or "cannot resolve git common dir")
    git_dir = Path(common.stdout.strip())
    if not git_dir.is_absolute():
        git_dir = (path / git_dir).resolve()
    lock_path = git_dir / "baton-integration.lock"
    deadline = time.monotonic() + _LOCK_TIMEOUT_SECONDS
    while True:
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            try:
                age = time.time() - lock_path.stat().st_mtime
            except FileNotFoundError:
                continue
            if age > _LOCK_STALE_SECONDS or not _lock_owner_alive(lock_path):
                try:
                    lock_path.unlink()
                except FileNotFoundError:
                    pass
                continue
            if time.monotonic() >= deadline:
                raise WorktreeError(f"integration lock busy: {lock_path}")
            time.sleep(0.05)
            continue
        try:
            os.write(fd, f"{os.getpid()}\n".encode("ascii"))
        finally:
            os.close(fd)
        break
    try:
        yield
    finally:
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass


def _conflict_files(path: Path) -> list[str]:
    result = _git(path, ["diff", "--name-only", "--diff-filter=U"])
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def _merge_head(path: Path) -> str:
    """The commit a preserved (unresolved) merge is merging, or ``''``.

    Git writes ``MERGE_HEAD`` for the whole duration of a conflicted merge, so
    its presence is the authoritative "this worktree is mid-merge" signal.
    """
    result = _git(path, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])
    return result.stdout.strip() if result.returncode == 0 else ""


def _branch_tip(path: Path, branch: str) -> str:
    result = _git(path, ["rev-parse", "-q", "--verify", branch])
    return result.stdout.strip() if result.returncode == 0 else ""


def _dirty_files(path: Path) -> list[str]:
    """Tracked files with uncommitted changes (untracked files are ignored)."""
    result = _git(path, ["status", "--porcelain", "--untracked-files=no"])
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def _not_merged(reason: str, files: list[str]) -> dict[str, Any]:
    return {
        "ok": False,
        "reason": reason,
        "already_merged": False,
        "integration_sha": "",
        "conflicts": files,
    }


def integrate_assignment(
    integration_path: str | Path,
    assignment_branch: str,
    *,
    expected_sha: str = "",
) -> dict[str, Any]:
    """Merge ``assignment_branch`` into the shared integration worktree.

    ``expected_sha`` is the commit the sealed receipt verified. When given, the
    merge only ever touches that commit: a branch tip that moved past it is
    refused (``branch-moved``) unless the verified commit already landed, and a
    preserved merge is attributed by ``MERGE_HEAD`` — not by the (possibly
    advanced) branch tip.

    Returns ``ok=True`` with the new ``integration_sha``, or ``ok=False`` with
    a ``reason`` the controller must distinguish:

    - ``conflict``: *this* branch conflicted; the conflict is preserved in the
      worktree and needs a ``resolve_merge`` action.
    - ``merge-in-progress``: the worktree is already mid-merge for **another**
      assignment. Nothing was attempted; try again after that one is resolved.
      (Git refuses a second merge while ``MERGE_HEAD`` exists, and its unmerged
      path list belongs to the earlier merge — reporting it as this branch's
      conflict would mis-attribute the failure and hand two solvers the same
      worktree.)
    - ``branch-moved``: the branch advanced past ``expected_sha`` and that
      commit is not in ``HEAD`` either. Nothing was attempted; integrating the
      branch would merge commits that never ran the verification commands.
    - ``worktree-dirty``: tracked files in the shared worktree have
      uncommitted changes, so a merge could destroy them. Nothing was
      attempted.
    """
    path = Path(integration_path).resolve()
    with _integration_lock(path):
        return _integrate_locked(path, assignment_branch, expected_sha)


def _integrate_locked(
    path: Path, assignment_branch: str, expected_sha: str
) -> dict[str, Any]:
    merge_head = _merge_head(path)
    if merge_head:
        # A preserved conflict blocks every other merge. Ownership is judged by
        # ``MERGE_HEAD`` against the receipt's verified commit when known: the
        # branch tip may legitimately advance after the merge was preserved,
        # and that must not turn the owning assignment into a bystander.
        owner_sha = expected_sha or _branch_tip(path, assignment_branch)
        if merge_head == owner_sha:
            return _not_merged("conflict", _conflict_files(path))
        return _not_merged("merge-in-progress", _conflict_files(path))

    dirty = _dirty_files(path)
    if dirty:
        return _not_merged("worktree-dirty", dirty)

    tip = _branch_tip(path, assignment_branch)
    if expected_sha and tip and tip != expected_sha:
        if branch_is_merged(path, expected_sha, "HEAD"):
            head = _git(path, ["rev-parse", "HEAD"])
            return {
                "ok": True,
                "already_merged": True,
                "integration_sha": head.stdout.strip(),
                "conflicts": [],
            }
        return {
            "ok": False,
            "reason": "branch-moved",
            "already_merged": False,
            "integration_sha": "",
            "conflicts": [],
            "branch_tip": tip,
            "expected_sha": expected_sha,
        }

    if branch_is_merged(path, assignment_branch, "HEAD"):
        head = _git(path, ["rev-parse", "HEAD"])
        return {
            "ok": True,
            "already_merged": True,
            "integration_sha": head.stdout.strip(),
            "conflicts": [],
        }

    result = _git(path, ["merge", "--no-ff", "--no-edit", assignment_branch])
    if result.returncode == 0:
        head = _git(path, ["rev-parse", "HEAD"])
        if head.returncode != 0:
            raise WorktreeError(head.stderr.strip() or "cannot read integration HEAD")
        return {
            "ok": True,
            "already_merged": False,
            "integration_sha": head.stdout.strip(),
            "conflicts": [],
        }

    conflict_files = _conflict_files(path)
    if conflict_files:
        return _not_merged("conflict", conflict_files)
    raise WorktreeError(
        result.stderr.strip() or result.stdout.strip() or "git merge failed"
    )


__all__ = ["integrate_assignment"]
