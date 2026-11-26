from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .discover import default_roots
from .util import is_under, load_json_strict, now_iso, unique_suffix, write_text


class ApplyError(RuntimeError):
    pass


class ConfigError(ValueError):
    """Invalid or unreadable config.json: exit-code contract treats these as
    tool/config errors (exit 1), not plan refusals (exit 4)."""


BACKUPS_KEEP = 10


def prune_backups(state_dir: Path, keep: int = BACKUPS_KEEP) -> List[str]:
    """Keep the newest `keep` plan backup directories; hub-config files and
    anything unexpected in backups/ stay untouched."""
    root = state_dir / "backups"
    if not root.is_dir():
        return []

    def stamp(item: Path) -> float:
        try:
            return item.stat().st_mtime
        except OSError:
            return 0.0

    dirs = sorted(
        (item for item in root.iterdir() if item.is_dir()),
        key=stamp,
        reverse=True,
    )
    removed: List[str] = []
    for item in dirs[keep:]:
        try:
            shutil.rmtree(item)
        except OSError:
            continue
        removed.append(str(item))
    return removed


def _config_roots(raw: Any, config_path: Path) -> List[Path]:
    """Same discipline as cli.parse_roots: a list of existing absolute directories;
    anything else is a config error, never silently widened into a write boundary."""
    if not isinstance(raw, list):
        raise ConfigError(
            f"Guster config 'roots' must be a list of absolute paths, "
            f"got {type(raw).__name__}: {config_path}"
        )
    if not raw:
        raise ConfigError(f"Guster config 'roots' must list at least one path: {config_path}")
    roots: List[Path] = []
    for item in raw:
        if not isinstance(item, str) or not item.strip():
            raise ConfigError(
                f"Guster config 'roots' entries must be non-empty strings: {item!r} in {config_path}"
            )
        path = Path(item).expanduser()
        if not path.is_absolute():
            raise ConfigError(
                f"Guster config 'roots' entries must be absolute paths: {item!r} in {config_path}"
            )
        if not path.exists():
            raise ConfigError(f"workspace root does not exist: {path.resolve()}")
        if not path.is_dir():
            raise ConfigError(f"workspace root is not a directory: {path.resolve()}")
        roots.append(path)
    return roots


def allowed_bases(state_dir: Path, extra_bases: Optional[Sequence[Path]] = None) -> List[Path]:
    """Directories a plan may write into: the state dir, the configured workspace
    roots (auto-detected defaults when the config names none), the attached hub
    (config "hub" key, written by `guster hub attach`) and any caller-declared
    extra bases (e.g. the project being initialized)."""
    bases: List[Path] = [state_dir]
    config_path = state_dir / "config.json"
    data, error = load_json_strict(config_path)
    if error is not None:
        raise ConfigError(f"cannot read Guster config {config_path}: {error}")
    if data is not None and not isinstance(data, dict):
        raise ConfigError(f"Guster config must be a JSON object: {config_path}")
    if data is not None and "roots" in data:
        bases.extend(_config_roots(data["roots"], config_path))
    else:
        bases.extend(default_roots(Path.home()))
    if data is not None and "hub" in data:
        raw_hub = data["hub"]
        if not isinstance(raw_hub, str) or not raw_hub.strip():
            raise ConfigError(f"Guster config 'hub' must be a path string: {config_path}")
        hub = Path(raw_hub).expanduser()
        if not hub.is_absolute():
            raise ConfigError(
                f"Guster config 'hub' must be an absolute path: {raw_hub!r} in {config_path}"
            )
        if not hub.is_dir():
            raise ConfigError(f"hub path from config is not a directory: {hub.resolve()}")
        bases.append(hub)
    bases.extend(extra_bases or [])
    return bases


def _outside_error(
    index: int,
    kind: str,
    field: str,
    path: Path,
    bases: Sequence[Path],
) -> Optional[str]:
    try:
        resolved = path.resolve()
    except OSError:
        return f"op {index}: cannot resolve {kind} {field}: {path}"
    if any(is_under(resolved, base) for base in bases):
        return None
    return (
        f"op {index}: {kind} {field} is outside the allowed bases: {path} "
        f"(resolved {resolved}); allowed bases: " + ", ".join(str(base) for base in bases)
    )


def _missing_dirs(path: Path) -> List[Path]:
    """The not-yet-existing directories from `path` up to the nearest existing
    ancestor, nearest first."""
    missing: List[Path] = []
    probe = path
    while not probe.exists() and probe != probe.parent:
        missing.append(probe)
        probe = probe.parent
    return missing


def preflight(
    plan: Dict[str, Any],
    bases: Optional[Sequence[Path]] = None,
) -> List[str]:
    errors: List[str] = []
    operations = plan.get("operations", [])
    if not isinstance(operations, list):
        return ["plan operations must be a list"]
    for index, operation in enumerate(operations, start=1):
        if not isinstance(operation, dict):
            errors.append(f"op {index}: operation is not a JSON object")
            continue
        kind = operation.get("kind")
        if not isinstance(kind, str) or not kind:
            errors.append(f"op {index}: missing operation kind")
            continue
        if kind == "move":
            if "pointer" in operation:
                errors.append(
                    f"op {index}: pointer updates are no longer applied by `apply`; "
                    "update the referenced file with a write op"
                )
                continue
            src_value = operation.get("src")
            dst_value = operation.get("dst")
            missing = [
                key
                for key, value in (("src", src_value), ("dst", dst_value))
                if not isinstance(value, str) or not value
            ]
            if missing:
                errors.append(f"op {index}: move needs string field(s): {', '.join(missing)}")
                continue
            src = Path(src_value)
            dst = Path(dst_value)
            if not src.exists():
                errors.append(f"op {index}: source does not exist: {src}")
            if dst.exists():
                errors.append(f"op {index}: destination already exists: {dst}")
            if src == dst:
                errors.append(f"op {index}: source and destination are identical")
            if bases is not None:
                for field, value in (("src", src), ("dst", dst)):
                    error = _outside_error(index, kind, field, value, bases)
                    if error:
                        errors.append(error)
        elif kind in {"write", "mkdir"}:
            value = operation.get("path")
            if not isinstance(value, str) or not value:
                errors.append(f"op {index}: {kind} needs a string 'path'")
                continue
            path = Path(value)
            if kind == "mkdir":
                if path.exists() and not path.is_dir():
                    errors.append(f"op {index}: target exists and is not a directory: {path}")
            else:
                if not isinstance(operation.get("content"), str):
                    errors.append(f"op {index}: write needs a string 'content'")
                elif path.exists() and not path.is_file():
                    errors.append(f"op {index}: target is not a file: {path}")
            if bases is not None:
                error = _outside_error(index, kind, "path", path, bases)
                if error:
                    errors.append(error)
        elif kind != "manual":
            errors.append(f"op {index}: unknown operation kind: {kind}")
    return errors


def apply_plan(
    plan: Dict[str, Any],
    state_dir: Path,
    dry_run: bool = True,
    yes: bool = False,
    extra_bases: Optional[Sequence[Path]] = None,
) -> Dict[str, Any]:
    if not dry_run and not yes:
        raise ApplyError("refusing to write without --yes")
    bases = allowed_bases(state_dir, extra_bases)
    errors = preflight(plan, bases)
    if errors:
        return {
            "ok": False,
            "dry_run": dry_run,
            "plan": plan.get("id"),
            "errors": errors,
            "applied": 0,
            "skipped": 0,
        }

    plan_id = plan.get("id") or "plan"
    backup_dir = state_dir / "backups" / plan_id
    if not is_under(backup_dir, state_dir / "backups"):
        # A slug-hostile plan id must never escape the backup area, not even
        # when apply_plan is called as a library without load_plan's validation.
        raise ApplyError(f"plan id {plan_id!r} escapes the backup directory; refusing to apply")
    undo: List[Tuple[str, Dict[str, Any]]] = []
    applied = 0
    skipped = 0

    if dry_run:
        for operation in plan.get("operations", []):
            if operation.get("kind") == "manual":
                skipped += 1
            else:
                applied += 1
        return {
            "ok": True,
            "dry_run": True,
            "plan": plan_id,
            "errors": [],
            "applied": applied,
            "skipped": skipped,
            "operations": plan.get("operations", []),
        }

    if backup_dir.exists():
        # Never overwrite a previous run's rollback material for the same id.
        backup_dir = state_dir / "backups" / f"{plan_id}-{unique_suffix()}"
    backup_dir.mkdir(parents=True, exist_ok=True)
    try:
        for index, operation in enumerate(plan.get("operations", []), start=1):
            kind = operation.get("kind")
            if kind == "manual":
                skipped += 1
                continue
            if kind == "mkdir":
                path = Path(operation["path"])
                late = _outside_error(index, kind, "path", path, bases)
                if late:
                    raise ApplyError(late)
                created = _missing_dirs(path)
                path.mkdir(parents=True, exist_ok=True)
                # Reversed undo must rmdir the deepest level first, so the
                # shallowest created level is appended last.
                for fresh in reversed(created):
                    undo.append(("mkdir", {"path": str(fresh)}))
                applied += 1
            elif kind == "move":
                src = Path(operation["src"])
                dst = Path(operation["dst"])
                for field, value in (("src", src), ("dst", dst)):
                    late = _outside_error(index, kind, field, value, bases)
                    if late:
                        raise ApplyError(late)
                backup = backup_dir / f"{index:03d}-{src.name}"
                if src.is_dir():
                    shutil.copytree(src, backup)
                else:
                    shutil.copy2(src, backup)
                created = _missing_dirs(dst.parent)
                dst.parent.mkdir(parents=True, exist_ok=True)
                # Recorded ahead of the move: reversed undo restores the source
                # first, then removes the parents it leaves empty.
                for fresh in reversed(created):
                    undo.append(("mkdir", {"path": str(fresh)}))
                undo.append(("move", {"src": str(src), "dst": str(dst), "backup": str(backup)}))
                shutil.move(str(src), str(dst))
                applied += 1
            elif kind == "write":
                path = Path(operation["path"])
                late = _outside_error(index, kind, "path", path, bases)
                if late:
                    raise ApplyError(late)
                backup = backup_dir / f"{index:03d}-{path.name}"
                if path.exists():
                    shutil.copy2(path, backup)
                undo.append(("write", {"path": str(path), "backup": str(backup)}))
                write_text(path, operation["content"])
                applied += 1
            else:
                raise ApplyError(f"unsupported operation: {kind}")
    except Exception as exc:
        rollback_error: Optional[BaseException] = None
        residual: List[str] = []
        try:
            residual = rollback(undo)
        except BaseException as undo_exc:  # noqa: BLE001 - reported, never hidden
            rollback_error = undo_exc
        if rollback_error is not None:
            # Both the apply and the rollback failed: keep the root cause and
            # name the recovery material instead of swallowing either.
            raise ApplyError(
                f"apply failed ({exc}); rollback also failed ({rollback_error}) — "
                f"backups for manual recovery: {backup_dir}"
            ) from exc
        if residual:
            raise ApplyError(
                f"apply failed and was rolled back: {exc}; "
                f"directories left behind (not empty or in use): {', '.join(residual)}"
            ) from exc
        raise ApplyError(f"apply failed and was rolled back: {exc}") from exc

    pruned = prune_backups(state_dir)
    return {
        "ok": True,
        "dry_run": False,
        "plan": plan_id,
        "errors": [],
        "applied": applied,
        "skipped": skipped,
        "backup": str(backup_dir),
        "pruned_backups": pruned,
        "finished_at": now_iso(),
    }


def rollback(undo: List[Tuple[str, Dict[str, Any]]]) -> List[str]:
    """Reverse applied operations; returns created-directory paths that could
    not be removed (non-empty or busy) so the caller can name them."""
    residual: List[str] = []
    for kind, payload in reversed(undo):
        if kind == "mkdir":
            path = Path(payload["path"])
            if not path.is_dir():
                continue
            try:
                path.rmdir()
            except OSError:
                residual.append(str(path))
        elif kind == "move":
            src = Path(payload["src"])
            dst = Path(payload["dst"])
            backup = Path(payload["backup"])
            if dst.exists():
                if dst.is_dir():
                    shutil.rmtree(dst)
                else:
                    dst.unlink()
            if backup.is_dir():
                shutil.copytree(backup, src, dirs_exist_ok=True)
            elif backup.exists():
                src.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(backup, src)
        elif kind == "write":
            path = Path(payload["path"])
            backup = Path(payload["backup"])
            if backup.exists():
                shutil.copy2(backup, path)
            elif path.exists():
                path.unlink()
    return residual


def init_home(
    state_dir: Path,
    yes: bool = False,
    dry_run: bool = True,
    home: Optional[Path] = None,
    roots: Optional[List[Path]] = None,
) -> Dict[str, Any]:
    """First run writes the config with the detected or given roots. On an
    already-initialized machine `roots` are added to the configured ones, so
    `init --root` is never a success-shaped no-op; a broken config still refuses."""
    operations = [
        {"kind": "mkdir", "path": str(state_dir)},
        {"kind": "mkdir", "path": str(state_dir / "plans")},
        {"kind": "mkdir", "path": str(state_dir / "backups")},
    ]
    config_path = state_dir / "config.json"
    added: List[Path] = []
    if not config_path.exists():
        resolved_home = (home or Path.home()).expanduser().resolve()
        if roots is None:
            roots = default_roots(resolved_home)
        if not roots:
            raise ValueError(
                f"no workspace roots detected under {resolved_home} "
                "(looked for ~/Projects, ~/code, ~/dev, ~/src); "
                "pass --root <path> to declare where your projects live"
            )
        config: Dict[str, Any] = {
            "version": 1,
            "roots": [str(root) for root in roots],
            "scan_max_depth": 5,
        }
        added = list(roots)
        operations.append(
            {
                "kind": "write",
                "path": str(config_path),
                "content": json.dumps(
                    config,
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
            }
        )
    else:
        # A broken config must not turn `guster init --root <path>` into a
        # success-shaped no-op: validate it or refuse loudly.
        data, error = load_json_strict(config_path)
        reason = error
        if reason is None and not isinstance(data, dict):
            reason = f"config must be a JSON object, got {type(data).__name__}"
        if reason is None and "roots" not in data:
            reason = "config declares no 'roots'"
        if reason is None:
            try:
                _config_roots(data["roots"], config_path)
            except ValueError as exc:
                reason = str(exc)
        if reason is not None:
            raise ValueError(
                f"config exists but invalid ({reason}); fix or remove {config_path} "
                "then re-run `guster init --root <path>`"
            )
        known = {str(Path(item).expanduser().resolve()) for item in data["roots"]}
        added = [root for root in (roots or []) if str(root.resolve()) not in known]
        if added:
            # Other keys (scan_max_depth, hub, zones) and the spelling of the
            # existing roots survive the merge.
            merged = dict(data)
            merged["roots"] = list(data["roots"]) + [str(root) for root in added]
            operations.append(
                {
                    "kind": "write",
                    "path": str(config_path),
                    "content": json.dumps(merged, ensure_ascii=False, indent=2) + "\n",
                }
            )
    plan = {
        "version": 1,
        # Same slug discipline as planner.new_plan_id so a saved init plan can
        # still pass load_plan's id check when re-applied by hand.
        "id": f"init-home-{now_iso().replace(':', '').replace('-', '').replace('+', 'p')}-{unique_suffix()}",
        "created_at": now_iso(),
        "title": "Initialize Guster state home",
        "notes": "Creates the local state directory and default config.",
        "operations": operations,
    }
    result = apply_plan(plan, state_dir, dry_run=dry_run, yes=yes)
    result["added_roots"] = [str(root) for root in added]
    return result
