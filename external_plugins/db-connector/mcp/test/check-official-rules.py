#!/usr/bin/env python3
"""官方市场（zai-org/zcode-plugins）规则自检脚本。

按 scripts/validate.py 的公开规则逐项校验插件目录与 marketplace 条目，
供发版前本地自查（原版脚本位于官方仓库，网络受限时用本脚本等价校验）：

  python mcp/test/check-official-rules.py <插件目录> <marketplace.json>

规则来源：zai-org/zcode-plugins scripts/validate.py（stdlib only）
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

KEBAB = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SEMVER = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$")
LOCALE = re.compile(r"^[a-z]{2}(-[A-Za-z0-9]+)*$")
CATEGORIES = {"游戏/3D", "developer-tools", "productivity", "utilities", "guides", "finance", "template", "other"}
MAX_PLUGIN_FILES = 5000
MAX_PLUGIN_BYTES = 256 * 1024 * 1024

errors: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def validate_i18n(label: str, obj: dict, field: str) -> None:
    value = obj.get(field)
    if not isinstance(value, dict):
        err(f"{label}: '{field}' 必须是对象")
        return
    for locale in ("en", "zh-CN"):
        text = value.get(locale)
        if not isinstance(text, str) or not text.strip():
            err(f"{label}: '{field}.{locale}' 必须是非空字符串")
    for locale, text in value.items():
        if not isinstance(locale, str) or not LOCALE.match(locale):
            err(f"{label}: '{field}' locale 键 '{locale}' 非法")
        if not isinstance(text, str) or not text.strip():
            err(f"{label}: '{field}.{locale}' 必须是非空字符串")


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    plugin_dir = Path(sys.argv[1]).resolve()
    marketplace_path = Path(sys.argv[2])

    # --- marketplace 条目规则 ---
    entry = json.loads(marketplace_path.read_text(encoding="utf-8"))
    name = entry.get("name")
    if not name or not KEBAB.match(name):
        err(f"entry: name '{name}' 必须是 kebab-case")
    for field in ("source", "description", "version"):
        if not entry.get(field):
            err(f"entry: 缺少 '{field}'")
    if entry.get("version") and not SEMVER.match(entry["version"]):
        err(f"entry: version '{entry['version']}' 不是 semver")
    category = entry.get("category")
    if not category:
        err("entry: 缺少 'category'")
    elif category not in CATEGORIES:
        err(f"entry: category '{category}' 不在允许集合内")
    expected_source = f"./external_plugins/{name}"
    if entry.get("source") != expected_source:
        err(f"entry: source 必须是 {expected_source}")
    validate_i18n("entry", entry, "description_i18n")

    # --- 插件目录规则 ---
    if plugin_dir.name != name:
        err(f"目录名 '{plugin_dir.name}' 与插件名 '{name}' 不一致")
    if plugin_dir.is_symlink():
        err("插件目录是符号链接")
    files = 0
    total = 0
    for path in sorted(plugin_dir.rglob("*")):
        rel = path.relative_to(plugin_dir).as_posix()
        if path.is_symlink():
            err(f"{rel} 是符号链接")
            continue
        if path.is_file():
            files += 1
            total += path.stat().st_size
    if files > MAX_PLUGIN_FILES:
        err(f"{files} 个文件超过上限 {MAX_PLUGIN_FILES}")
    if total > MAX_PLUGIN_BYTES:
        err(f"{total} 字节超过上限 {MAX_PLUGIN_BYTES}")
    print(f"目录统计: {files} 文件, {total} 字节（上限 {MAX_PLUGIN_FILES} / {MAX_PLUGIN_BYTES}）")

    # --- plugin.json 与条目一致性 ---
    manifest_path = plugin_dir / ".zcode-plugin" / "plugin.json"
    if not manifest_path.is_file():
        manifest_path = plugin_dir / ".claude-plugin" / "plugin.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("name") != name:
        err(f"plugin.json name '{manifest.get('name')}' 与条目不一致")
    if manifest.get("version") != entry.get("version"):
        err(f"plugin.json version '{manifest.get('version')}' 与条目 '{entry.get('version')}' 不一致")
    if not manifest.get("description"):
        err("plugin.json 缺少 description")
    validate_i18n("plugin.json", manifest, "description_i18n")
    if manifest.get("description_i18n") != entry.get("description_i18n"):
        err("plugin.json description_i18n 与条目不一致")

    # --- 关键文件存在性 ---
    for required in (".mcp.json", "README.md", "README_CN.md", "LICENSE",
                     "mcp/dist/db-connect-server.bundle.cjs", "skills/db-connector/SKILL.md"):
        if not (plugin_dir / required).is_file():
            err(f"缺少关键文件 {required}")

    if errors:
        print(f"FAIL: {len(errors)} 处问题")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("OK: 官方规则自检全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
