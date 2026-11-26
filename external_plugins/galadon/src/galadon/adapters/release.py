from __future__ import annotations

import fcntl
import os
import re
import shutil
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator

from ..config import DEFAULT_KEEP_RELEASES

ROOT_MARKER = ".galadon-root"
RELEASES_DIR = "releases"
SHARED_DIR = "shared"
LOCK_RELATIVE = "shared/deploy.lock"
CURRENT_LINK = "current"
PREVIOUS_LINK = "previous"

# A release directory galadon named itself: `<UTC stamp>-<version>`. Anything
# else in `releases/` is not ours to delete.
_RELEASE_NAME = re.compile(r"^\d{8}-\d{6}-\S+$")


class DeployError(RuntimeError):
    pass


@dataclass(frozen=True)
class ReleaseLayout:
    """One deployment root shared by the local and ssh adapters."""

    root: Path

    @property
    def releases(self) -> Path:
        return self.root / RELEASES_DIR

    @property
    def shared(self) -> Path:
        return self.root / SHARED_DIR

    @property
    def lock(self) -> Path:
        return self.root / LOCK_RELATIVE

    @property
    def current(self) -> Path:
        return self.root / CURRENT_LINK

    @property
    def previous(self) -> Path:
        return self.root / PREVIOUS_LINK

    def ensure(self) -> None:
        self.releases.mkdir(parents=True, exist_ok=True)
        self.shared.mkdir(parents=True, exist_ok=True)

    def release_dir(self, name: str) -> Path:
        return self.releases / name

    def previous_release(self) -> Path:
        if not self.previous.is_symlink():
            raise DeployError(f"galadon: no previous release link at {self.previous}")
        try:
            target = self.previous.resolve(strict=True)
        except OSError as exc:
            raise DeployError(f"galadon: previous release is unreadable: {exc}") from exc
        if not target.is_dir():
            raise DeployError(f"galadon: previous release is missing: {target}")
        if self.releases.resolve() not in target.parents:
            raise DeployError(
                f"galadon: previous link does not point into {self.releases}: {target}"
            )
        return target


def release_name(at: datetime, version: str) -> str:
    version = str(version).strip()
    if not version or "/" in version or version in {".", ".."}:
        raise DeployError(f"galadon: invalid release version: {version!r}")
    stamp = at.astimezone(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{version}"


def release_version(target: Path | str) -> str:
    name = str(target).rstrip("/").rsplit("/", 1)[-1]
    if "-" not in name:
        raise DeployError(f"galadon: cannot determine the release version from {str(target)!r}")
    return name.rsplit("-", 1)[-1]


def _atomic_symlink(link: Path, target: Path, suffix: str) -> None:
    temp = link.with_name(f".{link.name}.{suffix}")
    if temp.is_symlink() or temp.exists():
        temp.unlink()
    temp.symlink_to(target)
    os.replace(temp, link)


def switch_current(layout: ReleaseLayout, target: Path, *, suffix: str = "new") -> None:
    _atomic_symlink(layout.current, target, suffix)


def retain_previous(layout: ReleaseLayout) -> Path | None:
    if not layout.current.is_symlink():
        return None
    old = layout.current.resolve()
    if not old.is_dir():
        raise DeployError(f"galadon: current release is missing: {old}")
    if layout.releases.resolve() not in old.parents:
        raise DeployError(f"galadon: current link does not point into {layout.releases}: {old}")
    _atomic_symlink(layout.previous, old, "new")
    return old


def keep_releases(options: dict) -> int:
    """How many releases to keep besides the ones `current` and `previous`
    point at. 0 keeps everything; the default keeps the disk from filling."""
    return int(options.get("keep_releases", DEFAULT_KEEP_RELEASES))


def prune_releases(layout: ReleaseLayout, keep: int, protect: Iterable[Path]) -> list[str]:
    """Delete the oldest releases beyond `keep`, never the protected ones.

    Names start with a UTC stamp, so sorting by name is sorting by time.
    """
    if keep <= 0 or not layout.releases.is_dir():
        return []
    protected: set[Path] = set()
    for path in protect:
        if path is None:
            continue
        try:
            protected.add(path.resolve())
        except OSError:
            continue
    releases = [
        child
        for child in layout.releases.iterdir()
        if child.is_dir() and not child.is_symlink() and _RELEASE_NAME.match(child.name)
    ]
    pruned: list[str] = []
    for path in sorted(releases, key=lambda child: child.name, reverse=True)[keep:]:
        if path.resolve() in protected:
            continue
        shutil.rmtree(path, ignore_errors=True)
        if not path.exists():
            pruned.append(path.name)
    return pruned


@contextmanager
def deploy_lock(layout: ReleaseLayout) -> Iterator[None]:
    try:
        layout.shared.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise DeployError(
            f"galadon: cannot create deploy lock directory {layout.shared}: {exc}"
        ) from exc
    try:
        handle = layout.lock.open("a+", encoding="utf-8")
    except OSError as exc:
        raise DeployError(f"galadon: cannot open deploy lock {layout.lock}: {exc}") from exc
    with handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise DeployError(
                f"galadon: another deployment holds {layout.lock}"
            ) from exc
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def shell_lock() -> str:
    return (
        f'lock="$root/{LOCK_RELATIVE}"\n'
        'exec 9>"$lock"\n'
        "if ! flock -n 9; then\n"
        '  echo "galadon: another deployment holds $lock" >&2\n'
        "  exit 75\n"
        "fi\n"
    )


def shell_retain_previous() -> str:
    return (
        'old=""\n'
        'if [ -L "$root/current" ]; then\n'
        '  old=$(readlink -f "$root/current")\n'
        "fi\n"
        'if [ -n "$old" ]; then\n'
        '  ln -sfn "$old" "$root/.previous.new"\n'
        '  mv -Tf "$root/.previous.new" "$root/previous"\n'
        "fi\n"
    )


def shell_switch_current(target: str, suffix: str) -> str:
    return (
        f'ln -sfn {target} "$root/.current.{suffix}"\n'
        f'mv -Tf "$root/.current.{suffix}" "$root/current"\n'
    )


def shell_prune_releases() -> str:
    """The shell twin of `prune_releases`, for the host the ssh adapter
    releases onto. Only galadon-named directories are ever removed, a failed
    removal is reported and otherwise ignored: by now the release is live and
    nothing here may fail the ship."""
    return """if [ "$keep_releases" -gt 0 ]; then
  cur=""; prev=""
  if [ -L "$root/current" ]; then cur=$(readlink -f "$root/current"); fi
  if [ -L "$root/previous" ]; then prev=$(readlink -f "$root/previous"); fi
  pruned=""
  for name in $(ls -1 "$root/releases" | sort -r | tail -n +"$((keep_releases + 1))"); do
    case "$name" in
      [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-*) ;;
      *) continue ;;
    esac
    dir="$root/releases/$name"
    [ -d "$dir" ] || continue
    [ "$dir" = "$cur" ] && continue
    [ "$dir" = "$prev" ] && continue
    if rm -rf -- "$dir"; then pruned="$pruned $name"; else echo "galadon: could not remove old release $dir" >&2; fi
  done
  printf 'GALADON_PRUNED=%s\\n' "$pruned"
fi
"""
