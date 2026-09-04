from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "zcode-remotion"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class ZCodeRemotionPluginTest(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = load_json(PLUGIN / ".zcode-plugin" / "plugin.json")
        self.marketplace = load_json(ROOT / "marketplace.json")
        self.entry = next(
            p for p in self.marketplace["plugins"] if p["name"] == "zcode-remotion"
        )
        self.compat = load_json(PLUGIN / "compatibility" / "remotion.json")

    def test_manifest_and_marketplace_contract_match(self) -> None:
        self.assertEqual(PLUGIN.name, "zcode-remotion")
        self.assertEqual(self.manifest["name"], "zcode-remotion")
        self.assertEqual(self.entry["source"], "./plugins/zcode-remotion")
        self.assertEqual(self.entry["version"], self.manifest["version"])
        self.assertEqual(
            self.entry["description_i18n"], self.manifest["description_i18n"]
        )
        self.assertEqual(self.entry["category"], "productivity")

    def test_official_skill_topology_is_canonical_and_not_vendored(self) -> None:
        names = self.compat["skills"]["names"]
        self.assertEqual(self.compat["skills"]["count"], 12)
        self.assertEqual(len(names), 12)
        self.assertEqual(len(names), len(set(names)))
        self.assertTrue(all(name.startswith("remotion-") for name in names))

        bundled_skill_dirs = {
            path.name for path in (PLUGIN / "skills").iterdir() if path.is_dir()
        }
        self.assertEqual(bundled_skill_dirs, {"remotion"})
        self.assertTrue(set(names).isdisjoint(bundled_skill_dirs))

    def test_router_mentions_every_recorded_official_skill(self) -> None:
        router = (PLUGIN / "skills" / "remotion" / "SKILL.md").read_text(
            encoding="utf-8"
        )
        for name in self.compat["skills"]["names"]:
            self.assertIn(name, router, f"missing routing coverage for {name}")

        version_match = re.search(r'^\s+version:\s*["\']?([^"\'\s]+)', router, re.M)
        self.assertIsNotNone(version_match)
        self.assertEqual(version_match.group(1), self.manifest["version"])

    def test_packaged_helper_references_do_not_assume_workspace_is_plugin_root(self) -> None:
        files = [
            PLUGIN / "skills" / "remotion" / "SKILL.md",
            PLUGIN / "commands" / "remotion-setup.md",
            PLUGIN / "commands" / "remotion-doctor.md",
            PLUGIN / "commands" / "remotion-update.md",
        ]
        for path in files:
            text = path.read_text(encoding="utf-8")
            self.assertIn("ZCODE_PLUGIN_ROOT", text, path.name)
            self.assertNotIn("node scripts/", text, path.name)

    def test_commands_have_descriptions(self) -> None:
        for path in sorted((PLUGIN / "commands").glob("*.md")):
            text = path.read_text(encoding="utf-8")
            self.assertTrue(text.startswith("---\n"), path.name)
            frontmatter = text.split("---\n", 2)[1]
            self.assertRegex(frontmatter, r"(?m)^description:\s*\S")

    def test_bilingual_docs_disclose_execution_network_writes_and_licensing(self) -> None:
        for filename in ("README.md", "README_CN.md"):
            text = (PLUGIN / filename).read_text(encoding="utf-8").lower()
            for required in (
                "node",
                "npx",
                "github",
                "remotion-dev/skills",
                "ffprobe",
                "license",
            ):
                self.assertIn(required, text, f"{filename}: missing {required}")

        notice = (PLUGIN / "NOTICE.md").read_text(encoding="utf-8").lower()
        self.assertIn("not redistributed", notice)
        self.assertIn("remotion-dev/skills", notice)


if __name__ == "__main__":
    unittest.main()
