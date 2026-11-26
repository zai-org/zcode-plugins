from __future__ import annotations

import hashlib
import json
import os
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class StateFileError(ValueError):
    """A file galadon itself writes cannot be read back."""


class GitError(RuntimeError):
    """git is installed but cannot answer for this project.

    A corrupt repository or a permission problem used to read as "no git here",
    which switched the ship guard off without a word.
    """


@dataclass(frozen=True)
class GitContext:
    """What git says about a project directory.

    `commit` is None when nothing versions the project: no repository around
    it, or one around it that does not track its files. In that case there is
    no commit to stamp a release with and nothing to judge a dirty tree
    against.
    """

    toplevel: Path | None
    commit: str | None
    # The project's path inside the repository; empty when the project is the
    # repository root.
    prefix: str

    @property
    def versioned(self) -> bool:
        return self.commit is not None


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def read_json(path: Path, default: Any = None) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise StateFileError(
            f"{path} is not valid JSON ({exc}); galadon writes this file — "
            "delete it and run the command again"
        ) from exc


def write_json(path: Path, data: Any) -> None:
    """Replace the file in one step: a crash mid-write must never leave a
    truncated check or release record behind."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def digest_path(path: Path) -> str:
    if path.is_file():
        return sha256_file(path)
    digest = hashlib.sha256()
    for child in sorted(path.rglob("*")):
        if child.is_file():
            digest.update(child.relative_to(path).as_posix().encode("utf-8"))
            digest.update(b"\0")
            with child.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
            digest.update(b"\0")
    return digest.hexdigest()


def _git(root: Path, *args: str) -> subprocess.CompletedProcess | None:
    """None when git is not installed at all. GIT_OPTIONAL_LOCKS keeps git from
    rewriting the project's index, so asking about the tree never touches it."""
    try:
        return subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            encoding="utf-8",
            errors="surrogateescape",
            env={**os.environ, "GIT_OPTIONAL_LOCKS": "0", "LC_ALL": "C", "LANG": "C"},
            check=False,
        )
    except OSError:
        return None


def _unversioned() -> GitContext:
    return GitContext(toplevel=None, commit=None, prefix="")


def _repo_marker(root: Path) -> Path | None:
    """The nearest `.git` at or above `root`, if there is one."""
    for directory in (root, *root.parents):
        marker = directory / ".git"
        if marker.exists() or marker.is_symlink():
            return marker
    return None


def git_context(root: Path) -> GitContext:
    top = _git(root, "rev-parse", "--show-toplevel")
    if top is None:
        return _unversioned()
    if top.returncode != 0:
        if "not a git repository" in top.stderr:
            # git words a broken `.git` almost like "no repository here"
            # ("not a git repository: /gone"). A marker that it refuses is a
            # repository that cannot answer, not the absence of one.
            marker = _repo_marker(root)
            if marker is None:
                return _unversioned()
            raise GitError(f"git cannot read {marker}: {top.stderr.strip()}")
        raise GitError(f"git cannot read {root}: {top.stderr.strip() or top.stdout.strip()}")
    toplevel = Path(top.stdout.strip())
    prefix = ""
    if not os.path.samefile(toplevel, root):
        try:
            prefix = os.path.relpath(os.path.realpath(root), os.path.realpath(toplevel))
        except ValueError:
            return _unversioned()
        if prefix.startswith(".."):
            raise GitError(f"git reports {toplevel} above {root}, which is not inside it")
        prefix = prefix.replace(os.sep, "/") + "/"
        # A directory inside somebody else's repository only counts as
        # versioned when that repository tracks its files. An ignored or
        # untracked folder would otherwise ship under a commit that has
        # nothing to do with it.
        tracked = _git(root, "ls-files", "--", ".")
        if tracked is None or tracked.returncode != 0:
            raise GitError(f"git cannot list tracked files in {root}: {tracked and tracked.stderr.strip()}")
        if not tracked.stdout.strip():
            return GitContext(toplevel=toplevel, commit=None, prefix=prefix)
    head = _git(root, "rev-parse", "--short", "HEAD")
    if head is None or head.returncode != 0:
        return GitContext(toplevel=toplevel, commit=None, prefix=prefix)
    return GitContext(toplevel=toplevel, commit=head.stdout.strip(), prefix=prefix)


def git_commit(root: Path) -> str | None:
    return git_context(root).commit


def git_dirty_entries(root: Path, context: GitContext) -> list[tuple[str, str]]:
    """(status, path) for every uncommitted change and untracked file, project
    paths relative to the project root. A project nested in a larger
    repository only sees its own directory."""
    if not context.versioned:
        return []
    scope = ["--", "."] if context.prefix else []
    proc = _git(root, "status", "--porcelain", "-z", "--untracked-files=all", *scope)
    if proc is None or proc.returncode != 0:
        detail = proc.stderr.strip() if proc is not None else "git is unavailable"
        raise GitError(f"git cannot read the working tree in {root}: {detail}")
    fields = proc.stdout.split("\0")
    entries: list[tuple[str, str]] = []
    index = 0
    while index < len(fields):
        field = fields[index]
        index += 1
        if not field:
            continue
        status, path = field[:2], field[3:]
        if status[0] in "RC":
            index += 1
        if context.prefix and path.startswith(context.prefix):
            path = path[len(context.prefix):]
        entries.append((status, path))
    return entries


def git_changed_paths(root: Path, context: GitContext, before: str, after: str) -> list[str] | None:
    """Project-relative paths that differ between two commits, or None when
    git cannot compare them (a rewritten history, a pruned object)."""
    scope = ["--", "."] if context.prefix else []
    proc = _git(root, "diff", "--name-only", "-z", before, after, *scope)
    if proc is None or proc.returncode != 0:
        return None
    paths = []
    for path in proc.stdout.split("\0"):
        if not path:
            continue
        if context.prefix and path.startswith(context.prefix):
            path = path[len(context.prefix):]
        paths.append(path)
    return paths


def run_shell(
    command: str,
    cwd: Path,
    timeout: int = 300,
    env: dict[str, str] | None = None,
) -> tuple[int, str, str]:
    merged = os.environ.copy()
    if env:
        merged.update(env)
    try:
        proc = subprocess.run(
            command,
            cwd=str(cwd),
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=merged,
            check=False,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode(errors="replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode(errors="replace")
        return 124, stdout, stderr + f"\ncommand timed out after {timeout}s"
