from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from .util import read_text


DEFAULT_PATHS = {
    "knowledge": "knowledge",
    "projects": "projects",
    "tools": "tools",
}


def load_manifest(path: Path) -> Dict[str, Any]:
    """Parse the small flat YAML subset used by hub.yaml, including one paths map."""
    data: Dict[str, Any] = {}
    current: Optional[str] = None
    for raw_line in read_text(path).splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        line = raw_line.strip()
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if indent == 0:
            current = key if key == "paths" and not value else None
            if current:
                data.setdefault("paths", {})
            else:
                data[key] = value
        elif current == "paths":
            data.setdefault("paths", {})[key] = value
    return data


def validate_layout_value(value: str, key: str) -> str:
    raw = str(value).strip()
    if not raw:
        raise ValueError(f"hub path '{key}' is empty")
    if raw.startswith("~"):
        raise ValueError(f"hub path '{key}' must be relative to the hub")
    path = Path(raw)
    if path.is_absolute():
        raise ValueError(f"hub path '{key}' must be relative to the hub")
    if ".." in path.parts:
        raise ValueError(f"hub path '{key}' must not contain '..'")
    if raw in {".", "./"}:
        raise ValueError(f"hub path '{key}' must not be the hub root")
    return str(path)


def resolve_hub_layout(hub: Path) -> Dict[str, Path]:
    root = hub.expanduser().resolve()
    manifest = load_manifest(root / "hub.yaml")
    raw_paths = manifest.get("paths")
    paths = raw_paths if isinstance(raw_paths, dict) else {}
    resolved: Dict[str, Path] = {}
    for key, default in DEFAULT_PATHS.items():
        value = validate_layout_value(str(paths.get(key, default)), key)
        candidate = (root / value).resolve()
        if candidate == root or root not in candidate.parents:
            raise ValueError(f"hub path '{key}' escapes the hub: {value}")
        resolved[key] = candidate
    if len(set(resolved.values())) != len(resolved):
        raise ValueError("hub paths must point to distinct directories")
    return resolved


def load_waivers(hub: Optional[Path]) -> List[Dict[str, str]]:
    """Read `doctor.waivers` from `<hub>/hub.yaml`.

    Waivers are the only way to silence a finding, so each entry must carry a
    rule and a written reason; a broken block fails loud instead of guessing.
    """
    if hub is None:
        return []
    manifest = Path(hub) / "hub.yaml"
    if not manifest.is_file():
        return []
    waivers: List[Dict[str, str]] = []
    current: Optional[Dict[str, str]] = None
    in_block = False
    for raw_line in read_text(manifest).splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        line = raw_line.strip()
        if line.endswith("waivers:"):
            in_block = True
            current = None
            continue
        if not in_block:
            continue
        if indent == 0:
            break
        if line.startswith("- "):
            current = {}
            waivers.append(current)
            line = line[2:].strip()
        if current is None or ":" not in line:
            continue
        key, value = line.split(":", 1)
        current[key.strip()] = value.strip().strip("'\"")
    for entry in waivers:
        rule = entry.get("rule", "").strip()
        reason = entry.get("reason", "").strip()
        if not rule or not reason:
            raise ValueError(f"doctor waiver needs rule and reason in {manifest}")
        entry["path"] = entry.get("path", "").strip()
    return [
        {"rule": entry["rule"].strip(), "path": entry["path"], "reason": entry["reason"].strip()}
        for entry in waivers
    ]
