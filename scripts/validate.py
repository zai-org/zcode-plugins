#!/usr/bin/env python3
"""Validate marketplace.json and plugin manifests.

Checks:
- marketplace.json (repo root, ZCode convention) is valid JSON with required
  fields
- every plugin entry points to an existing ./plugins/<name> or ./external_plugins/<name> directory
- plugin names are kebab-case and unique
- each plugin dir has a manifest whose name/version match the marketplace
  entry; lookup order matches the ZCode client:
  .zcode-plugin/plugin.json (preferred) -> .claude-plugin/plugin.json (compat)
- every directory under both plugin roots is listed or explicitly unlisted, except
  TEMPLATE_DIRS (template sources kept for copying, not published)

Stdlib only. Exit code 0 = pass, 1 = fail.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN_ROOTS = {"plugins": "official", "external_plugins": "community"}
KEBAB = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

# Everything under a plugin directory is packaged verbatim and published to a
# public CDN by a job that runs on an internal machine. A symlink would make
# that job read (and publish) whatever it points at, so symlinks are rejected
# outright rather than skipped. The size caps keep a single entry from turning
# the artifact build into a disk-filling exercise. They bound one publishable
# unit (one plugin, or the shared assets), never a whole plugin root: the
# marketplace as a whole is allowed to outgrow any single plugin.
MAX_PLUGIN_FILES = 5000
MAX_PLUGIN_BYTES = 256 * 1024 * 1024
SEMVER = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$")
LOCALE = re.compile(r"^[a-z]{2}(-[A-Za-z0-9]+)*$")
CATEGORIES = {"游戏/3D", "developer-tools", "productivity", "utilities", "guides", "finance", "template", "other"}

# Template plugin sources stay in the repo as copy-and-start scaffolding but are
# deliberately absent from marketplace.json, so the registration check skips them.
TEMPLATE_DIRS = {"example-plugin"}

errors: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def load_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        err(f"{path.relative_to(ROOT)}: file not found")
    except json.JSONDecodeError as e:
        err(f"{path.relative_to(ROOT)}: invalid JSON: {e}")
    return None


def validate_i18n(label: str, obj: dict, field: str, required_locales: tuple[str, ...]) -> None:
    value = obj.get(field)
    if not value:
        err(f"{label}: missing '{field}'")
        return
    if not isinstance(value, dict):
        err(f"{label}: '{field}' must be an object")
        return

    for locale in required_locales:
        text = value.get(locale)
        if not isinstance(text, str) or not text.strip():
            err(f"{label}: '{field}.{locale}' must be a non-empty string")

    for locale, text in value.items():
        if not isinstance(locale, str) or not LOCALE.match(locale):
            err(f"{label}: '{field}' has invalid locale key '{locale}'")
        if not isinstance(text, str) or not text.strip():
            err(f"{label}: '{field}.{locale}' must be a non-empty string")


def tree_violations(root: Path, label: str, *, caps: bool = True) -> list[str]:
    """Symlinks and oversize trees under *root*, as error strings.

    Pass ``caps=False`` to sweep a whole plugin root for symlinks without
    applying the per-plugin file and size caps to the sum of all plugins.
    """
    if root.is_symlink():
        return [f"{label}: directory is a symlink"]
    found: list[str] = []
    files = 0
    total = 0
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if path.is_symlink():
            found.append(f"{label}: {rel} is a symlink (not allowed)")
            continue
        if path.is_file():
            files += 1
            total += path.stat().st_size
    if not caps:
        return found
    if files > MAX_PLUGIN_FILES:
        found.append(f"{label}: {files} files exceeds the {MAX_PLUGIN_FILES} file limit")
    if total > MAX_PLUGIN_BYTES:
        found.append(f"{label}: {total} bytes exceeds the {MAX_PLUGIN_BYTES} byte limit")
    return found


def plugin_manifest_path(plugin_dir: Path) -> Path:
    """ZCode-first manifest lookup, mirroring the client's priority."""
    preferred = plugin_dir / ".zcode-plugin" / "plugin.json"
    if preferred.is_file():
        return preferred
    return plugin_dir / ".claude-plugin" / "plugin.json"


def resolve_plugin_dir(entry: dict, root: Path) -> Path:
    source, name = entry.get("source"), entry.get("name")
    if not isinstance(name, str) or not KEBAB.fullmatch(name):
        raise ValueError("plugin name must be kebab-case")
    if source not in (f"./{directory}/{name}" for directory in PLUGIN_ROOTS):
        raise ValueError("source must be exactly ./plugins/<name> or ./external_plugins/<name>")
    directory = root / source[2:]
    # 根目录也不能是链接，否则单个插件的 realpath 检查会接受整个根被替换。
    if directory.parent.is_symlink() or directory.is_symlink():
        raise ValueError("plugin source is a symlink")
    if directory.resolve().parent != root.resolve() / directory.parent.name:
        raise ValueError("plugin source resolves outside its declared root")
    return directory


def ui_surface_errors(manifest: dict, plugin_dir: Path) -> list[str]:
    ui = manifest.get("ui")
    if ui is None:
        return []
    if not isinstance(ui, dict) or not isinstance(ui.get("surfaces", []), list):
        return ["ui.surfaces must be an array"]
    servers = manifest.get("mcpServers", "./.mcp.json")
    if isinstance(servers, str):
        path = (plugin_dir / servers).resolve()
        if not path.is_relative_to(plugin_dir.resolve()):
            return ["UI MCP declaration must remain inside the plugin"]
        try:
            servers = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
        except (OSError, ValueError):
            return ["UI MCP declaration must be valid JSON"]
        if isinstance(servers, dict):
            servers = servers.get("mcpServers", servers)
    names = set(servers) if isinstance(servers, dict) else set()
    problems, seen = [], set()
    for surface in ui.get("surfaces", []):
        if not isinstance(surface, dict):
            problems.append("ui.surfaces entry must be an object")
            continue
        surface_id = surface.get("id")
        if not isinstance(surface_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", surface_id) or surface_id in seen:
            problems.append("ui.surfaces requires unique valid ids")
        else:
            seen.add(surface_id)
        title = surface.get("title")
        titles = list(title.values()) if isinstance(title, dict) else [title]
        if not titles or not all(isinstance(text, str) and text.strip() for text in titles):
            problems.append("ui.surfaces title must contain non-empty text")
        server = surface.get("server")
        if not isinstance(server, str) or server.strip() not in names:
            problems.append("ui.surfaces server must name a declared MCP server")
        uri = surface.get("resourceUri")
        if not isinstance(uri, str) or not uri.strip().startswith("ui://") or not 5 < len(uri.strip()) <= 2048:
            problems.append("ui.surfaces resourceUri must use ui:// and be at most 2048 characters")
        if surface.get("availability") != "session":
            problems.append("ui.surfaces availability must be session")
    return problems


def main() -> int:
    marketplace = load_json(ROOT / "marketplace.json")
    if marketplace is None:
        print("\n".join(errors))
        return 1

    for field in ("name", "owner", "plugins"):
        if field not in marketplace:
            err(f"marketplace.json: missing required field '{field}'")

    # Claude Code marketplace schema: description lives at the top level.
    if not marketplace.get("description"):
        err("marketplace.json: missing 'description'")
    validate_i18n("marketplace.json", marketplace, "description_i18n", ("en", "zh-CN"))

    entries = marketplace.get("plugins", [])
    if not isinstance(entries, list):
        err("marketplace.json: 'plugins' must be a list")
        entries = []

    seen: set[str] = set()
    registered_dirs: set[str] = set()

    for i, entry in enumerate(entries):
        label = f"marketplace.json plugins[{i}]"
        name = entry.get("name")
        if not name:
            err(f"{label}: missing 'name'")
            continue
        label = f"{label} ({name})"

        if not KEBAB.match(name):
            err(f"{label}: name must be kebab-case (lowercase letters, digits, hyphens)")
        if name in seen:
            err(f"{label}: duplicate plugin name")
        seen.add(name)

        for field in ("source", "description", "version"):
            if not entry.get(field):
                err(f"{label}: missing '{field}'")
        validate_i18n(label, entry, "description_i18n", ("en", "zh-CN"))

        version = entry.get("version", "")
        if version and not SEMVER.match(version):
            err(f"{label}: version '{version}' is not semver (X.Y.Z)")

        category = entry.get("category")
        if not category:
            err(f"{label}: missing 'category'")
        elif category not in CATEGORIES:
            err(
                f"{label}: category '{category}' not in allowed set "
                f"({', '.join(sorted(CATEGORIES))}); propose new categories via PR"
            )

        source = entry.get("source", "")
        try:
            plugin_dir = resolve_plugin_dir(entry, ROOT)
        except ValueError as exc:
            err(f"{label}: {exc}")
            continue
        registered_dirs.add(source[2:])
        if not plugin_dir.is_dir():
            err(f"{label}: source directory {source} does not exist")
            continue
        if plugin_dir.name != name:
            err(f"{label}: directory name '{plugin_dir.name}' does not match plugin name")
        for problem in tree_violations(plugin_dir, label):
            err(problem)

        manifest = load_json(plugin_manifest_path(plugin_dir))
        if manifest is None:
            continue
        if manifest.get("name") != name:
            err(f"{label}: plugin.json name '{manifest.get('name')}' does not match")
        if manifest.get("version") != version:
            err(
                f"{label}: plugin.json version '{manifest.get('version')}' "
                f"does not match marketplace version '{version}'"
            )
        if not manifest.get("description"):
            err(f"{label}: plugin.json missing 'description'")
        validate_i18n(f"{label}: plugin.json", manifest, "description_i18n", ("en", "zh-CN"))
        if manifest.get("description_i18n") != entry.get("description_i18n"):
            err(f"{label}: plugin.json description_i18n does not match marketplace entry")
        for problem in ui_surface_errors(manifest, plugin_dir):
            err(f"{label}: {problem}")

    # Retain withdrawn source trees without making them installable catalog entries.
    unlisted = marketplace.get("unlistedPlugins", [])
    if not isinstance(unlisted, list):
        err("marketplace.json: 'unlistedPlugins' must be a list")
        unlisted = []
    for entry in unlisted:
        try:
            if not isinstance(entry, dict):
                raise ValueError("entry must be an object")
            plugin_dir = resolve_plugin_dir(entry, ROOT)
            if not plugin_dir.is_dir():
                raise ValueError("source directory does not exist")
            if entry["source"][2:] in registered_dirs:
                raise ValueError("source is already listed or unlisted")
            registered_dirs.add(entry["source"][2:])
        except ValueError as exc:
            err(f"marketplace.json unlistedPlugins: {exc}")

    for directory in PLUGIN_ROOTS:
        plugins_root = ROOT / directory
        if not plugins_root.is_dir():
            continue
        for child in sorted(plugins_root.iterdir()):
            if child.is_symlink():
                err(f"{directory}/{child.name}: symlink (not allowed)")
            elif (
                child.is_dir()
                and f"{directory}/{child.name}" not in registered_dirs
                and not (directory == "plugins" and child.name in TEMPLATE_DIRS)
            ):
                err(f"{directory}/{child.name}: directory not registered in marketplace.json")

    # Shared assets are published to the CDN by the same job; same rules apply.
    if (ROOT / "assets").is_dir():
        for problem in tree_violations(ROOT / "assets", "assets"):
            err(problem)

    if errors:
        print(f"FAIL: {len(errors)} problem(s)")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"OK: {len(entries)} plugin(s) validated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
