"""Deterministic integration of assignment branches into a Baton feature branch.

A branch is only integrated once the *merged* tree passes the run's
verification commands. The receipt proves the assignment's own commit was
green on its own; two green branches can still break each other (an API
renamed on one, a new caller of the old name on the other), and a hand-resolved
conflict was never verified by anyone. So every merge — fresh, or already
landed after a resolve — is verified here by the controller, inside the
integration lock, before the attempt is finalized.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator

from orchestration.git_run import run_git
from orchestration.plan_model import utc_now
from orchestration.worktree import WorktreeError, branch_is_merged

_LOCK_TIMEOUT_SECONDS = 120.0
#: A live owner may hold the lock through a whole verification (several
#: commands, each up to its own timeout); age alone only retires a lock whose
#: owner pid cannot be read.
_LOCK_STALE_SECONDS = 7200.0

#: Per-integration-worktree record of the last verification outcome, kept in
#: the worktree's private git dir so it never dirties a checkout.
VERIFICATION_MEMO_NAME = "baton-verification.json"


class IntegrationLockBusy(WorktreeError):
    """Another process holds the integration lock; nothing was attempted."""

    code = "integration-lock-busy"


def _git(path: Path, args: list[str]) -> subprocess.CompletedProcess:
    """Tolerant git call: raises only on spawn failure/timeout; callers judge
    the exit status (see :func:`run_git`)."""
    return run_git(args, cwd=path, error=WorktreeError, timeout=60, check=False)


def _pid_alive(pid: int) -> bool:
    if os.name == "nt" or pid <= 0:
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _lock_is_stale(lock_path: Path) -> bool:
    try:
        age = time.time() - lock_path.stat().st_mtime
    except FileNotFoundError:
        return True
    try:
        pid = int(lock_path.read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        pid = 0
    return (pid > 0 and not _pid_alive(pid)) or age > _LOCK_STALE_SECONDS


@contextmanager
def integration_lock(path: Path) -> Iterator[None]:
    """Serialize work in the shared integration worktree across processes.

    Git's own ``index.lock`` makes concurrent merges fail rather than corrupt,
    but a retry loop here turns a parallel reconcile into a wait. The lock file
    lives in the repository's common git dir (shared by linked worktrees) and
    is removed on every exit path. A lock whose owner process is gone is
    recovered, so a crashed merge cannot wedge the repo.
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
            if _lock_is_stale(lock_path):
                try:
                    lock_path.unlink()
                except FileNotFoundError:
                    pass
                continue
            if time.monotonic() >= deadline:
                raise IntegrationLockBusy(f"integration lock busy: {lock_path}")
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


def _head(path: Path) -> str:
    result = _git(path, ["rev-parse", "HEAD"])
    if result.returncode != 0:
        raise WorktreeError(
            result.stderr.strip() or f"cannot read integration HEAD in {path}"
        )
    return result.stdout.strip()


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


def _memo_path(path: Path) -> Path | None:
    result = _git(path, ["rev-parse", "--git-dir"])
    if result.returncode != 0:
        return None
    git_dir = Path(result.stdout.strip())
    if not git_dir.is_absolute():
        git_dir = (path / git_dir).resolve()
    return git_dir / VERIFICATION_MEMO_NAME


def read_integration_verification(path: str | Path) -> dict[str, Any] | None:
    """The recorded outcome of the last verification on this worktree."""
    memo_path = _memo_path(Path(path).resolve())
    if memo_path is None or not memo_path.is_file():
        return None
    try:
        memo = json.loads(memo_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return memo if isinstance(memo, dict) else None


def _record_verification(
    path: Path,
    head: str,
    *,
    ok: bool,
    results: list,
    error: str,
    key: str,
    could_not_run: bool,
) -> None:
    memo_path = _memo_path(path)
    if memo_path is None:
        return
    memo_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = memo_path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(
            {
                "integration_sha": head,
                "ok": ok,
                "verification": results,
                "error": error,
                "key": key,
                "could_not_run": could_not_run,
                "updated_at": utc_now(),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    os.replace(tmp, memo_path)


def _failed(results: list) -> list:
    return [item for item in results if item.get("exitCode") != 0]


def verify_integration_head(
    path: Path,
    verify: Callable[[], list[dict[str, Any]]],
    *,
    key: str = "",
    force: bool = False,
) -> dict[str, Any]:
    """Run ``verify`` on the integration HEAD and record the outcome.

    The same commit is never verified twice with the same commands: while an
    attempt sits parked on a red merge, every later call reads the recorded
    result instead of re-running the suite. ``key`` fingerprints the
    verification commands, so correcting them re-verifies that commit. A
    recorded red result stands; a verification that could not even run
    (``could_not_run``) is retried when ``force`` is set — the operator passed
    ``--verify`` again after fixing the environment.

    ``verify`` returns per-command results and raises only when it cannot run;
    that too is recorded, so an unverified HEAD keeps blocking new claims
    instead of silently passing for verified.
    """
    path = path.resolve()
    head = _head(path)
    memo = read_integration_verification(path)
    reusable = bool(
        memo
        and memo.get("integration_sha") == head
        and memo.get("key", "") == key
        and (memo.get("ok") or not memo.get("could_not_run") or not force)
    )
    if reusable:
        results = list(memo.get("verification") or [])
        error = str(memo.get("error") or "")
    else:
        results, error = [], ""
        try:
            results = verify()
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            _record_verification(
                path, head, ok=False, results=[], error=error, key=key, could_not_run=True
            )
            raise
        _record_verification(
            path, head, ok=not _failed(results), results=results, error="", key=key,
            could_not_run=False,
        )
    settled = {"already_merged": False, "integration_sha": head, "conflicts": []}
    if error or _failed(results):
        return {
            **settled,
            "ok": False,
            "reason": "verification-failed",
            "verification": results,
            "error": error,
        }
    return {**settled, "ok": True, "verified": True}


def integrate_assignment(
    integration_path: str | Path,
    assignment_branch: str,
    *,
    expected_sha: str = "",
    verify: Callable[[], list[dict[str, Any]]] | None = None,
    verify_key: str = "",
    verify_force: bool = False,
) -> dict[str, Any]:
    """Merge ``assignment_branch`` into the shared integration worktree.

    ``expected_sha`` is the commit the sealed receipt verified. When given, the
    merge only ever touches that commit: a branch tip that moved past it is
    refused (``branch-moved``) unless the verified commit already landed, and a
    preserved merge is attributed by ``MERGE_HEAD`` — not by the (possibly
    advanced) branch tip.

    ``verify`` (optional) re-runs the run's verification commands on the
    merged tree before the result is reported as landed; ``verify_key`` and
    ``verify_force`` are passed through to :func:`verify_integration_head`.

    Returns ``ok=True`` with the new ``integration_sha``, or ``ok=False`` with
    a ``reason`` the controller must distinguish:

    - ``conflict``: *this* branch conflicted; the conflict is preserved in the
      worktree and needs a ``resolve_merge`` action.
    - ``verification-failed``: the merge landed but the merged tree is red;
      the outcome stays recorded so nothing else builds on it until repaired.
      (A verification that cannot run at all raises instead — nothing is
      reported as landed.)
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
    with integration_lock(path):
        return _integrate_locked(
            path, assignment_branch, expected_sha, verify, verify_key, verify_force
        )


def _settled(path: Path, verify, *, already_merged: bool, key: str, force: bool) -> dict[str, Any]:
    if verify is None:
        return {
            "ok": True,
            "already_merged": already_merged,
            "integration_sha": _head(path),
            "conflicts": [],
        }
    outcome = verify_integration_head(path, verify, key=key, force=force)
    outcome["already_merged"] = already_merged
    return outcome


def _integrate_locked(
    path: Path,
    assignment_branch: str,
    expected_sha: str,
    verify: Callable[[], list[dict[str, Any]]] | None,
    verify_key: str = "",
    verify_force: bool = False,
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
            return _settled(
                path, verify, already_merged=True, key=verify_key, force=verify_force
            )
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
        return _settled(path, verify, already_merged=True, key=verify_key, force=verify_force)

    result = _git(path, ["merge", "--no-ff", "--no-edit", assignment_branch])
    if result.returncode == 0:
        return _settled(path, verify, already_merged=False, key=verify_key, force=verify_force)

    conflict_files = _conflict_files(path)
    if conflict_files:
        return _not_merged("conflict", conflict_files)
    raise WorktreeError(
        result.stderr.strip() or result.stdout.strip() or "git merge failed"
    )


__all__ = [
    "IntegrationLockBusy",
    "VERIFICATION_MEMO_NAME",
    "integration_lock",
    "integrate_assignment",
    "read_integration_verification",
    "verify_integration_head",
]
