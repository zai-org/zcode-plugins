from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .discover import default_hub, default_roots
from .util import now_iso, write_text


class ApplyError(RuntimeError):
    pass


def preflight(plan: Dict[str, Any]) -> List[str]:
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
        elif kind in {"write", "mkdir"}:
            value = operation.get("path")
            if not isinstance(value, str) or not value:
                errors.append(f"op {index}: {kind} needs a string 'path'")
                continue
            path = Path(value)
            if kind == "mkdir":
                if path.exists() and not path.is_dir():
                    errors.append(f"op {index}: target exists and is not a directory: {path}")
            elif path.exists() and not path.is_file():
                errors.append(f"op {index}: target is not a file: {path}")
        elif kind != "manual":
            errors.append(f"op {index}: unknown operation kind: {kind}")
    return errors


def apply_plan(
    plan: Dict[str, Any],
    state_dir: Path,
    dry_run: bool = True,
    yes: bool = False,
) -> Dict[str, Any]:
    if not dry_run and not yes:
        raise ApplyError("refusing to write without --yes")
    errors = preflight(plan)
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

    backup_dir.mkdir(parents=True, exist_ok=True)
    try:
        for index, operation in enumerate(plan.get("operations", []), start=1):
            kind = operation.get("kind")
            if kind == "manual":
                skipped += 1
                continue
            if kind == "mkdir":
                path = Path(operation["path"])
                path.mkdir(parents=True, exist_ok=True)
                applied += 1
            elif kind == "move":
                src = Path(operation["src"])
                dst = Path(operation["dst"])
                backup = backup_dir / f"{index:03d}-{src.name}"
                if src.is_dir():
                    shutil.copytree(src, backup)
                else:
                    shutil.copy2(src, backup)
                undo.append(("move", {"src": str(src), "dst": str(dst), "backup": str(backup)}))
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(dst))
                pointer = operation.get("pointer")
                if pointer and pointer.get("path"):
                    pointer_path = Path(pointer["path"])
                    pointer_backup = backup_dir / f"{index:03d}-pointer-{pointer_path.name}"
                    if pointer_path.exists():
                        shutil.copy2(pointer_path, pointer_backup)
                    undo.append(
                        ("write", {"path": str(pointer_path), "backup": str(pointer_backup)})
                    )
                    write_text(pointer_path, pointer.get("content", ""))
                applied += 1
            elif kind == "write":
                path = Path(operation["path"])
                backup = backup_dir / f"{index:03d}-{path.name}"
                if path.exists():
                    shutil.copy2(path, backup)
                undo.append(("write", {"path": str(path), "backup": str(backup)}))
                write_text(path, operation.get("content", ""))
                applied += 1
            else:
                raise ApplyError(f"unsupported operation: {kind}")
    except Exception as exc:
        rollback(undo)
        raise ApplyError(f"apply failed and was rolled back: {exc}") from exc

    return {
        "ok": True,
        "dry_run": False,
        "plan": plan_id,
        "errors": [],
        "applied": applied,
        "skipped": skipped,
        "backup": str(backup_dir),
        "finished_at": now_iso(),
    }


def rollback(undo: List[Tuple[str, Dict[str, Any]]]) -> None:
    for kind, payload in reversed(undo):
        if kind == "move":
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


def init_home(
    state_dir: Path,
    yes: bool = False,
    dry_run: bool = True,
    home: Optional[Path] = None,
) -> Dict[str, Any]:
    operations = [
        {"kind": "mkdir", "path": str(state_dir)},
        {"kind": "mkdir", "path": str(state_dir / "plans")},
        {"kind": "mkdir", "path": str(state_dir / "backups")},
    ]
    config_path = state_dir / "config.json"
    if not config_path.exists():
        resolved_home = (home or Path.home()).expanduser().resolve()
        config: Dict[str, Any] = {
            "version": 1,
            "roots": [str(root) for root in default_roots(resolved_home)],
            "scan_max_depth": 5,
        }
        hub = default_hub(resolved_home)
        if hub is not None:
            config["hub"] = str(hub)
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
    plan = {
        "version": 1,
        "id": f"init-home-{now_iso().replace(':', '').replace('-', '')}",
        "created_at": now_iso(),
        "title": "Initialize Guster state home",
        "notes": "Creates the local state directory and default config.",
        "operations": operations,
    }
    return apply_plan(plan, state_dir, dry_run=dry_run, yes=yes)
