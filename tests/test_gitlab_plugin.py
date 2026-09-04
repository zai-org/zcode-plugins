import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "gitlab"
EXPECTED_SKILLS = {"glab", "glab-stack", "setup"}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class GitLabPluginTests(unittest.TestCase):
    def test_zcode_and_compatibility_manifests_match(self) -> None:
        zcode_manifest = load_json(PLUGIN / ".zcode-plugin" / "plugin.json")
        claude_manifest = load_json(PLUGIN / ".claude-plugin" / "plugin.json")

        self.assertEqual(zcode_manifest, claude_manifest)
        self.assertEqual(zcode_manifest["name"], "gitlab")
        self.assertEqual(zcode_manifest["version"], "0.1.3")
        self.assertEqual(zcode_manifest["author"], {"name": "Z.ai", "url": "https://z.ai"})
        self.assertEqual(zcode_manifest["license"], "MIT")
        self.assertEqual(
            zcode_manifest["repository"], "https://gitlab.com/gitlab-org/cli"
        )
        self.assertEqual(set(zcode_manifest["description_i18n"]), {"en", "zh-CN"})

    def test_marketplace_entry_matches_manifest(self) -> None:
        marketplace = load_json(ROOT / "marketplace.json")
        entry = next(item for item in marketplace["plugins"] if item["name"] == "gitlab")
        manifest = load_json(PLUGIN / ".zcode-plugin" / "plugin.json")

        self.assertEqual(entry["source"], "./plugins/gitlab")
        self.assertEqual(entry["version"], manifest["version"])
        self.assertEqual(entry["description"], manifest["description"])
        self.assertEqual(entry["description_i18n"], manifest["description_i18n"])

    def test_expected_skills_are_packaged(self) -> None:
        skill_dirs = {
            path.parent.name for path in (PLUGIN / "skills").glob("*/SKILL.md")
        }
        self.assertEqual(skill_dirs, EXPECTED_SKILLS)

    def test_every_skill_requires_the_shared_preflight(self) -> None:
        reference_path = "../../references/gitlab-cli-preflight.md"

        for skill_name in sorted(EXPECTED_SKILLS):
            skill_text = (PLUGIN / "skills" / skill_name / "SKILL.md").read_text(
                encoding="utf-8"
            )
            with self.subTest(skill=skill_name):
                self.assertTrue(skill_text.startswith("---\n"))
                self.assertRegex(skill_text, rf"(?m)^name: {skill_name}$")
                self.assertIn("\ndescription:", skill_text.split("---", 2)[1])
                self.assertIn(reference_path, skill_text)

    def test_preflight_guides_installation_and_private_oauth_login(self) -> None:
        preflight = (PLUGIN / "references" / "gitlab-cli-preflight.md").read_text(
            encoding="utf-8"
        )

        for required in (
            "command -v glab",
            "glab version",
            "glab check-update",
            "brew upgrade glab",
            "latest stable release",
            "If this check cannot complete",
            "no update remains",
            "glab auth status --hostname <host>",
            "glab auth login --hostname <host> --web",
            "glab api --hostname <host> user",
            "user to paste a personal access token",
            "Do not print their values",
        ):
            with self.subTest(required=required):
                self.assertIn(required, preflight)

        self.assertNotIn("glab auth status --show-token\n", preflight)
        self.assertNotIn("--use-keyring", preflight)
        self.assertNotIn("v1.112.0", preflight)

    def test_official_source_and_license_are_recorded(self) -> None:
        upstream = (PLUGIN / "UPSTREAM.md").read_text(encoding="utf-8")
        license_text = (PLUGIN / "LICENSE").read_text(encoding="utf-8")

        self.assertIn("https://gitlab.com/gitlab-org/cli", upstream)
        self.assertIn("v1.112.0", upstream)
        self.assertIn("816e3a52411aba73d90237859fdc6ecbc86bd169", upstream)
        self.assertIn("MIT License", license_text)
        self.assertIn("Copyright (c) 2022-present GitLab Inc.", license_text)

    def test_core_skill_contains_version_and_remote_change_guardrails(self) -> None:
        skill = (PLUGIN / "skills" / "glab" / "SKILL.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("inspect the exact subcommand", skill)
        self.assertIn("Before any write", skill)
        self.assertIn("Require the user's explicit confirmation", skill)
        self.assertIn("Never retrieve, echo, log, or summarize secret values", skill)


if __name__ == "__main__":
    unittest.main()
