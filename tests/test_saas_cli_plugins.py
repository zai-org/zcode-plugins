"""Structural contract for the SaaS CLI + Skill plugins."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGINS = ROOT / "plugins"

PLUGIN_SPECS = {
    "alibaba-cloud-cli": {
        "binary": "aliyun",
        "install": "aliyun-cli",
        "auth": "aliyun sts GetCallerIdentity",
    },
    "lark-cli": {
        "binary": "lark-cli",
        "install": "@larksuite/cli@latest",
        "auth": "lark-cli auth status",
    },
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def frontmatter(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not match:
        raise AssertionError(f"{path}: missing YAML frontmatter")
    return match.group(1)


class SaaSCLIPluginContract(unittest.TestCase):
    def test_manifests_and_marketplace_entries_are_consistent(self) -> None:
        marketplace = load_json(ROOT / "marketplace.json")
        entries = {entry["name"]: entry for entry in marketplace["plugins"]}
        self.assertNotIn("feishu-cli", entries)
        self.assertFalse((PLUGINS / "feishu-cli").exists())
        self.assertFalse((ROOT / "assets" / "feishu-cli").exists())
        self.assertEqual(entries["lark-cli"]["displayName"], "Lark CLI")
        self.assertEqual(entries["lark-cli"]["displayName_i18n"],
                         {"en": "Lark CLI", "zh-CN": "飞书 CLI"})

        for name in PLUGIN_SPECS:
            with self.subTest(plugin=name):
                plugin = PLUGINS / name
                zcode = load_json(plugin / ".zcode-plugin" / "plugin.json")
                claude = load_json(plugin / ".claude-plugin" / "plugin.json")
                entry = entries[name]

                self.assertEqual(zcode, claude)
                self.assertEqual(zcode["version"], "0.1.2")
                self.assertEqual(zcode["author"], {"name": "Z.ai", "url": "https://z.ai"})
                self.assertEqual(entry["author"], zcode["author"])
                self.assertEqual(zcode["name"], name)
                self.assertEqual(entry["source"], f"./plugins/{name}")
                self.assertEqual(entry["version"], zcode["version"])
                self.assertEqual(entry["description"], zcode["description"])
                self.assertEqual(
                    entry["description_i18n"], zcode["description_i18n"]
                )
                self.assertEqual(entry["category"], "productivity" if name == "lark-cli" else "developer-tools")

    def test_each_plugin_contains_only_cli_skills_and_required_docs(self) -> None:
        allowed = {
            ".claude-plugin/plugin.json",
            ".zcode-plugin/plugin.json",
            "README.md",
            "README_CN.md",
            "skills/cli/SKILL.md",
            "skills/setup/SKILL.md",
        }
        for name in PLUGIN_SPECS:
            plugin = PLUGINS / name
            with self.subTest(plugin=name):
                files = {
                    path.relative_to(plugin).as_posix()
                    for path in plugin.rglob("*")
                    if path.is_file()
                }
                self.assertEqual(files, allowed)

    def test_setup_skills_pin_latest_install_and_read_only_verification(self) -> None:
        for name, spec in PLUGIN_SPECS.items():
            path = PLUGINS / name / "skills" / "setup" / "SKILL.md"
            text = path.read_text(encoding="utf-8")
            with self.subTest(plugin=name):
                self.assertIn(spec["binary"], text)
                self.assertIn(spec["install"], text)
                self.assertIn(spec["auth"], text)
                self.assertRegex(text, r"(?i)(明确|用户).*(同意|参与|确认)")
                self.assertRegex(text, r"(?i)(Token|Secret|密钥|凭证)")
                self.assertRegex(text, r"(粘贴|回显|输出|复制)")

    def test_cli_skills_require_live_help_and_write_confirmation(self) -> None:
        for name, spec in PLUGIN_SPECS.items():
            path = PLUGINS / name / "skills" / "cli" / "SKILL.md"
            text = path.read_text(encoding="utf-8")
            with self.subTest(plugin=name):
                self.assertIn(spec["binary"], text)
                self.assertRegex(text, r"(?i)(--help|schema)")
                self.assertRegex(text, r"(?i)(写操作|远端写操作).*(确认|请求确认)")
                self.assertRegex(text, r"(?i)(Token|Secret|密钥|凭证)")
                self.assertRegex(text, r"(不要|不).*(输出|暴露|复制)")

    def test_root_readmes_list_both_plugins(self) -> None:
        for readme in (ROOT / "README.md", ROOT / "README_CN.md"):
            text = readme.read_text(encoding="utf-8")
            for name in PLUGIN_SPECS:
                with self.subTest(readme=readme.name, plugin=name):
                    self.assertIn(f"[**{name}**](./plugins/{name})", text)


if __name__ == "__main__":
    unittest.main()
