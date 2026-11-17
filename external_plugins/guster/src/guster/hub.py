from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import __version__
from .executor import apply_plan
from .layout import DEFAULT_PATHS, load_manifest, resolve_hub_layout, validate_layout_value
from .planner import build_plan, op_mkdir, op_write, save_plan
from .util import is_indexed, load_json_strict, now_iso, read_text, save_json, today_iso, unique_suffix


def default_hub_path(home: Path) -> Path:
    return home / "guster-hub"


def template_root() -> Path:
    root = Path(__file__).resolve().parents[2] / "templates" / "hub"
    if not root.is_dir():
        raise FileNotFoundError(f"lite hub template not found: {root}")
    return root


def _version_tuple(value: str) -> tuple:
    parts = [int(item) for item in re.findall(r"\d+", str(value))[:3]]
    return tuple(parts + [0] * (3 - len(parts)))


def _render(text: str, replacements: Dict[str, str]) -> str:
    for key, value in replacements.items():
        text = text.replace("{{" + key + "}}", value)
    if "{{" in text:
        raise ValueError("hub template still contains an unresolved placeholder")
    return text


def _relative(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def plan_init_hub(
    target: Path,
    name: Optional[str] = None,
    knowledge: str = DEFAULT_PATHS["knowledge"],
    projects: str = DEFAULT_PATHS["projects"],
    tools: str = DEFAULT_PATHS["tools"],
) -> Dict[str, Any]:
    root = template_root()
    hub = target.expanduser().resolve()
    path_values = {
        "knowledge": validate_layout_value(knowledge, "knowledge"),
        "projects": validate_layout_value(projects, "projects"),
        "tools": validate_layout_value(tools, "tools"),
    }
    layout = {key: (hub / value).resolve() for key, value in path_values.items()}
    if len(set(layout.values())) != len(layout):
        raise ValueError("hub paths must point to distinct directories")
    replacements = {
        "DATE": today_iso(),
        "HUB_NAME": name or hub.name,
        "PLUGIN_VERSION": __version__,
        "KNOWLEDGE_PATH": path_values["knowledge"],
        "PROJECTS_PATH": path_values["projects"],
        "TOOLS_PATH": path_values["tools"],
    }
    operations: List[Dict[str, Any]] = [op_mkdir(hub)]
    for path in layout.values():
        operations.append(op_mkdir(path))
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if rel.parts[0] in layout:
            output = layout[rel.parts[0]].joinpath(*rel.parts[1:])
        else:
            output = hub / rel
        if path.name == "gitignore.tmpl":
            output = hub / rel.parent / ".gitignore"
        elif path.suffix == ".tmpl":
            output = output.with_suffix("")
        content = (
            ""
            if path.name == ".gitkeep"
            else _render(path.read_text(encoding="utf-8"), replacements)
        )
        operations.append(op_write(output, content))
    return build_plan(
        f"Initialize Guster Hub {hub.name}",
        operations,
        notes=(
            "Creates the lite data plane: knowledge, project state, tool index "
            "and the hub contract."
        ),
    )


def validate_hub(target: Path, strict: bool = True) -> Dict[str, Any]:
    hub = target.expanduser().resolve()
    errors: List[str] = []
    warnings: List[str] = []
    if not hub.is_dir():
        return {
            "ok": False,
            "hub": str(hub),
            "manifest": {},
            "errors": [f"hub directory does not exist: {hub}"],
            "warnings": [],
            "plugin": __version__,
        }

    manifest = load_manifest(hub / "hub.yaml")
    try:
        layout = resolve_hub_layout(hub)
    except ValueError as exc:
        layout = {key: (hub / value).resolve() for key, value in DEFAULT_PATHS.items()}
        errors.append(f"invalid hub layout: {exc}")

    legacy = (
        not manifest
        and (hub / "AGENTS.md").is_file()
        and (hub / "knowledge").is_dir()
        and (hub / "projects").is_dir()
    )
    required_files = [hub / "AGENTS.md", hub / "README.md", hub / "hub.yaml"]
    required_dirs = []
    if "knowledge" in layout:
        required_files.append(layout["knowledge"] / "README.md")
        required_dirs.extend(
            [layout["knowledge"], layout["knowledge"] / "general", layout["knowledge"] / "projects"]
        )
    if "projects" in layout:
        required_files.append(layout["projects"] / "_registry.md")
        required_dirs.append(layout["projects"])
    if "tools" in layout:
        required_files.append(layout["tools"] / "README.md")
        required_dirs.append(layout["tools"])
    for path in required_files:
        if path.is_file():
            continue
        rel = _relative(path, hub)
        if legacy and not strict:
            warnings.append(f"legacy hub lite contract file is absent: {rel}")
        else:
            errors.append(f"required file is absent: {rel}")
    for path in required_dirs:
        if path.is_dir():
            continue
        rel = _relative(path, hub)
        if legacy and not strict:
            warnings.append(f"legacy hub lite contract directory is absent: {rel}")
        else:
            errors.append(f"required directory is absent: {rel}")

    if not manifest:
        message = "hub.yaml is absent or empty"
        if legacy and not strict:
            warnings.append(message + " (legacy hub)")
        elif (hub / "hub.yaml").is_file():
            errors.append(message)
    else:
        if manifest.get("schema_version") not in {"1", "2"}:
            errors.append(f"unsupported hub schema: {manifest.get('schema_version') or '(absent)'}")
        if manifest.get("profile") not in {"lite", "full"}:
            warnings.append(f"unexpected hub profile: {manifest.get('profile') or '(absent)'}")
        minimum = manifest.get("min_guster")
        if minimum and _version_tuple(minimum) > _version_tuple(__version__):
            errors.append(f"hub requires Guster >= {minimum}; installed CLI is {__version__}")

    agents = hub / "AGENTS.md"
    if agents.is_file() and len(read_text(agents).splitlines()) > 50:
        warnings.append("AGENTS.md exceeds the 50-line soft budget")

    if strict:
        index_path = layout["knowledge"] / "README.md"
        if index_path.is_file():
            index = read_text(index_path)
            for folder in ("general", "projects"):
                root = layout["knowledge"] / folder
                if not root.is_dir():
                    continue
                for note in sorted(root.rglob("*.md")):
                    if note.name.lower() == "readme.md":
                        continue
                    if not is_indexed(note.name, index):
                        errors.append(f"knowledge note is not indexed: {_relative(note, hub)}")

        registry_path = layout["projects"] / "_registry.md"
        if registry_path.is_file():
            registry = read_text(registry_path)
            if not re.search(
                r"(?:最后更新|更新时间|更新于|最近核实|最后核实|已核实|verified_at|(?i:last updated|updated))"
                r"\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}",
                registry,
            ):
                errors.append(f"{_relative(registry_path, hub)} has no verified date")

    return {
        "ok": not errors,
        "hub": str(hub),
        "manifest": manifest,
        "paths": {key: _relative(value, hub) for key, value in layout.items()},
        "profile": manifest.get("profile") or ("legacy" if legacy else ""),
        "errors": errors,
        "warnings": warnings,
        "plugin": __version__,
    }


def attach_hub(state_dir: Path, target: Path) -> Dict[str, Any]:
    info = validate_hub(target, strict=False)
    if not info["ok"]:
        raise ValueError("hub validation failed: " + "; ".join(info["errors"]))
    hub = target.expanduser().resolve()
    state_dir.mkdir(parents=True, exist_ok=True)
    config_path = state_dir / "config.json"
    data, error = load_json_strict(config_path)
    if error is not None:
        raise ValueError(f"cannot read Guster config {config_path}: {error}")
    if data is None:
        config: Dict[str, Any] = {}
    elif not isinstance(data, dict):
        raise ValueError(f"Guster config must be a JSON object: {config_path}")
    else:
        config = data
    backup: Optional[Path] = None
    if config_path.is_file():
        backup_dir = state_dir / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = re.sub(r"[^0-9A-Za-z]", "", now_iso())
        backup = backup_dir / f"hub-config-{stamp}-{unique_suffix()}.json"
        backup.write_bytes(config_path.read_bytes())
    config.setdefault("version", 1)
    config["hub"] = str(hub)
    save_json(config_path, config)
    return {
        "ok": True,
        "hub": str(hub),
        "config": str(config_path),
        "backup": str(backup) if backup else None,
    }


def init_hub(
    target: Path,
    state_dir: Path,
    yes: bool = False,
    dry_run: bool = True,
    name: Optional[str] = None,
    knowledge: str = DEFAULT_PATHS["knowledge"],
    projects: str = DEFAULT_PATHS["projects"],
    tools: str = DEFAULT_PATHS["tools"],
) -> Dict[str, Any]:
    hub = target.expanduser().resolve()
    if hub.exists():
        if not hub.is_dir():
            raise ValueError(f"hub target is not a directory: {hub}")
        if any(item.name != ".DS_Store" for item in hub.iterdir()):
            raise ValueError(f"hub target is not empty: {hub}")
    path_values = {
        "knowledge": validate_layout_value(knowledge, "knowledge"),
        "projects": validate_layout_value(projects, "projects"),
        "tools": validate_layout_value(tools, "tools"),
    }
    plan = plan_init_hub(
        hub,
        name=name,
        knowledge=path_values["knowledge"],
        projects=path_values["projects"],
        tools=path_values["tools"],
    )
    plan_path = save_plan(state_dir, plan)
    result = apply_plan(plan, state_dir, dry_run=dry_run, yes=yes)
    result["hub"] = str(hub)
    result["plan"] = str(plan_path)
    result["paths"] = path_values
    if result.get("ok") and not dry_run:
        result["attach"] = attach_hub(state_dir, hub)
    return result
