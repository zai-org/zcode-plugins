#!/usr/bin/env python3
"""Validate marketplace.json and plugin manifests.

Checks:
- marketplace.json (repo root, ZCode convention) is valid JSON with required
  fields
- every plugin entry points to an existing ./plugins/<name> directory
- plugin names are kebab-case and unique
- each plugin dir has a manifest whose name/version match the marketplace
  entry; lookup order matches the ZCode client:
  .zcode-plugin/plugin.json (preferred) -> .claude-plugin/plugin.json (compat)
- every directory under plugins/ is registered in the marketplace, except
  TEMPLATE_DIRS (template sources kept for copying, not published)

Stdlib only. Exit code 0 = pass, 1 = fail.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGINS_ROOT = (ROOT / "plugins").resolve()
KEBAB = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

# Everything under a plugin directory is packaged verbatim and published to a
# public CDN by a job that runs on an internal machine. A symlink would make
# that job read (and publish) whatever it points at, so symlinks are rejected
# outright rather than skipped. The size caps keep a single entry from turning
# the artifact build into a disk-filling exercise.
MAX_PLUGIN_FILES = 5000
MAX_PLUGIN_BYTES = 256 * 1024 * 1024
SEMVER = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$")
LOCALE = re.compile(r"^[a-z]{2}(-[A-Za-z0-9]+)*$")
CATEGORIES = {"developer-tools", "productivity", "utilities", "guides", "finance", "template", "other"}

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


def tree_violations(root: Path, label: str) -> list[str]:
    """Symlinks and oversize trees under *root*, as error strings."""
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
        if (
            not isinstance(source, str)
            or not source.startswith("./plugins/")
            or ".." in Path(source).parts
            or source.count("/") != 2
        ):
            err(f"{label}: source must be exactly ./plugins/<name>")
            continue

        plugin_dir = ROOT / source[2:]
        registered_dirs.add(plugin_dir.name)
        if not plugin_dir.is_dir():
            err(f"{label}: source directory {source} does not exist")
            continue
        if plugin_dir.name != name:
            err(f"{label}: directory name '{plugin_dir.name}' does not match plugin name")
        if plugin_dir.resolve().parent != PLUGINS_ROOT:
            err(f"{label}: source resolves outside plugins/")
            continue
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

    plugins_root = ROOT / "plugins"
    if plugins_root.is_dir():
        for child in sorted(plugins_root.iterdir()):
            if child.is_symlink():
                err(f"plugins/{child.name}: symlink (not allowed)")
            elif (
                child.is_dir()
                and child.name not in registered_dirs
                and child.name not in TEMPLATE_DIRS
            ):
                err(f"plugins/{child.name}: directory not registered in marketplace.json")

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
