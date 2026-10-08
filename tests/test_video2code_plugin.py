"""Structural contract for the video2code plugin.

The root CI runs `python -m unittest discover -s tests`, which never reaches
`plugins/video2code/tests/`. `load_tests` at the bottom of this module pulls
those in-plugin tests into this suite so the plugin's own behavioural coverage
runs in CI too.
"""

from __future__ import annotations

import hashlib
import json
import re
import struct
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "video2code"
PLUGIN_TESTS = PLUGIN / "tests"
sys.path.insert(0, str(ROOT / "scripts"))

import build_dist  # noqa: E402


EXPECTED_COMMANDS = {"env-check", "record", "replicate", "replicate-fullstack"}
EXPECTED_SKILLS = {
    "env-setup",
    "url2video",
    "video2code",
    "video2code-3d",
    "video2fullstack",
    "web-replicate",
}
EXPECTED_MCP_SERVERS = {"runtime", "video"}
EXPECTED_HOOK_EVENTS = {"SessionStart", "UserPromptSubmit", "PreToolUse", "Stop"}

# Every hook command is `python3 "${CLAUDE_PLUGIN_ROOT}/hooks/<script>.py"`.
HOOK_SCRIPT = re.compile(r"\$\{CLAUDE_PLUGIN_ROOT\}/([A-Za-z0-9_./-]+\.py)")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def frontmatter(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise AssertionError(f"{path} must start with YAML frontmatter")
    parts = text.split("---", 2)
    if len(parts) != 3:
        raise AssertionError(f"{path} must close its YAML frontmatter")
    return parts[1]


def frontmatter_value(block: str, key: str) -> str | None:
    match = re.search(rf"^{key}:\s*(.+?)\s*$", block, re.MULTILINE)
    return match.group(1) if match else None


class ManifestTest(unittest.TestCase):
    def test_zcode_and_claude_manifests_are_identical(self) -> None:
        """The ZCode manifest is authoritative; the compat one must not drift.

        video2code has no host-specific auth boundary (unlike video-agent-kit),
        so the two files carry the same content — including `description_i18n`,
        which `scripts/validate.py` compares against the marketplace entry, and
        `mcpServers`, without which a Claude-Code host loses both servers.
        """
        zcode = load_json(PLUGIN / ".zcode-plugin" / "plugin.json")
        claude = load_json(PLUGIN / ".claude-plugin" / "plugin.json")

        self.assertEqual(zcode, claude)
        self.assertEqual(zcode["name"], "video2code")
        self.assertEqual(zcode["version"], "0.6.1")
        self.assertEqual(zcode["license"], "MIT")
        self.assertEqual(zcode["author"], {"name": "Z.ai", "url": "https://z.ai"})
        self.assertEqual(set(zcode["description_i18n"]), {"en", "zh-CN"})
        self.assertEqual(
            set(zcode["userConfig"]),
            {"media_resolution", "clip_max_frames"},
        )

    def test_marketplace_entry_matches_manifest(self) -> None:
        marketplace = load_json(ROOT / "marketplace.json")
        entry = next(
            item for item in marketplace["plugins"] if item["name"] == "video2code"
        )
        manifest = load_json(PLUGIN / ".zcode-plugin" / "plugin.json")

        self.assertEqual(entry["source"], "./plugins/video2code")
        self.assertEqual(entry["category"], "productivity")
        self.assertEqual(entry["version"], manifest["version"])
        self.assertEqual(entry["description"], manifest["description"])
        self.assertEqual(entry["description_i18n"], manifest["description_i18n"])
        self.assertEqual(entry["author"], manifest["author"])
        self.assertEqual(entry["keywords"], manifest["keywords"])
        self.assertEqual(
            entry["icon"],
            "https://cdn-zcode.z.ai/zcode/official-plugin/assets/video2code/icon.png",
        )

    def test_icon_matches_the_published_asset(self) -> None:
        """The marketplace entry points at the CDN, but the CDN only serves what
        the publish job syncs out of assets/. Pin the bytes so a dangling icon
        URL or an accidental re-render fails here instead of in the client."""
        icon = ROOT / "assets" / "video2code" / "icon.png"
        self.assertTrue(icon.is_file())
        data = icon.read_bytes()
        self.assertEqual(
            hashlib.sha256(data).hexdigest(),
            "d90515535bf9615f848c80f56d234d606be7cc8e513f31b8564d1895298769e1",
        )

        # Parsed from the IHDR chunk rather than with Pillow: the repository's
        # checks are stdlib-only and CI installs no packages.
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(data[12:16], b"IHDR")
        width, height, _depth, colour_type = struct.unpack(">IIBB", data[16:26])
        self.assertEqual((width, height), (256, 256))  # square, per assets/README.md
        self.assertEqual(colour_type, 6)               # truecolour + alpha (transparent bg)

    def test_mcp_json_matches_manifest_servers(self) -> None:
        manifest = load_json(PLUGIN / ".zcode-plugin" / "plugin.json")
        mcp = load_json(PLUGIN / ".mcp.json")

        self.assertEqual(set(mcp["mcpServers"]), EXPECTED_MCP_SERVERS)
        self.assertEqual(mcp["mcpServers"], manifest["mcpServers"])

        for name, server in mcp["mcpServers"].items():
            with self.subTest(server=name):
                self.assertEqual(server["type"], "stdio")
                self.assertEqual(server["command"], "python3")
                script = HOOK_SCRIPT.search(server["args"][0])
                self.assertIsNotNone(script)
                self.assertTrue((PLUGIN / script.group(1)).is_file())


class ComponentTest(unittest.TestCase):
    def test_commands_are_discoverable(self) -> None:
        names = {path.stem for path in (PLUGIN / "commands").glob("*.md")}
        self.assertEqual(names, EXPECTED_COMMANDS)

        for path in sorted((PLUGIN / "commands").glob("*.md")):
            with self.subTest(command=path.stem):
                block = frontmatter(path)
                self.assertTrue(frontmatter_value(block, "description"))
                self.assertTrue(frontmatter_value(block, "argument-hint"))

    def test_skills_are_discoverable_and_self_consistent(self) -> None:
        names = {path.parent.name for path in (PLUGIN / "skills").glob("*/SKILL.md")}
        self.assertEqual(names, EXPECTED_SKILLS)

        descriptions = set()
        for path in sorted((PLUGIN / "skills").glob("*/SKILL.md")):
            with self.subTest(skill=path.parent.name):
                block = frontmatter(path)
                self.assertEqual(frontmatter_value(block, "name"), path.parent.name)
                description = frontmatter_value(block, "description")
                self.assertTrue(description)
                self.assertNotIn(description, descriptions)
                descriptions.add(description)

    def test_commands_only_reference_bundled_skills(self) -> None:
        for path in sorted((PLUGIN / "commands").glob("*.md")):
            declared = frontmatter_value(frontmatter(path), "skills") or ""
            referenced = {item.strip() for item in declared.split(",") if item.strip()}
            with self.subTest(command=path.stem):
                self.assertTrue(referenced)
                self.assertLessEqual(referenced, EXPECTED_SKILLS)

    def test_hooks_are_registered_and_their_scripts_exist(self) -> None:
        hooks = load_json(PLUGIN / "hooks" / "hooks.json")["hooks"]
        self.assertEqual(set(hooks), EXPECTED_HOOK_EVENTS)

        scripts = set()
        for event, matchers in hooks.items():
            for matcher in matchers:
                for hook in matcher["hooks"]:
                    with self.subTest(event=event):
                        self.assertEqual(hook["type"], "command")
                        self.assertGreater(hook["timeout"], 0)
                        found = HOOK_SCRIPT.search(hook["command"])
                        self.assertIsNotNone(found)
                        self.assertTrue((PLUGIN / found.group(1)).is_file())
                        scripts.add(found.group(1))

        self.assertEqual(
            scripts,
            {
                "hooks/env_check.py",
                "hooks/check_video_input.py",
                "hooks/check_url_input.py",
                "hooks/check_plan_first.py",
                "hooks/check_closeout.py",
            },
        )

    def test_closeout_hook_and_audit_script_share_one_rule_set(self) -> None:
        """The Stop hook must delegate, not re-implement the contract rules."""
        hook = (PLUGIN / "hooks" / "check_closeout.py").read_text(encoding="utf-8")
        self.assertIn("contract_audit", hook)
        self.assertTrue(
            (PLUGIN / "skills" / "video2code" / "scripts" / "contract_audit.py").is_file()
        )


class DocumentationTest(unittest.TestCase):
    def test_gitignore_keeps_per_machine_runtime_state_out_of_the_package(self) -> None:
        """`.v2c/env_report.json` records the absolute interpreter path of
        whoever ran the env doctor — i.e. a username. Running the doctor from
        the plugin directory creates it, and build_dist packages every file
        verbatim, so it has to be ignored rather than merely 'usually absent'."""
        patterns = {
            line.strip()
            for line in (PLUGIN / ".gitignore").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        }
        self.assertLessEqual({".v2c/", "__pycache__/", "out/", "recordings/"}, patterns)

    def test_both_language_readmes_and_license_are_present(self) -> None:
        for name in ("README.md", "README_CN.md", "LICENSE"):
            with self.subTest(file=name):
                self.assertTrue((PLUGIN / name).is_file())

        self.assertIn("[中文说明](./README_CN.md)", (PLUGIN / "README.md").read_text(encoding="utf-8"))
        self.assertIn("[English](./README.md)", (PLUGIN / "README_CN.md").read_text(encoding="utf-8"))

    def test_readmes_document_the_side_effects_that_matter(self) -> None:
        """CONTRIBUTING.md requires network access, command execution, file
        writes, hooks and MCP servers to be documented. Those are the facts a
        reviewer needs before granting this plugin code-execution trust."""
        english = (PLUGIN / "README.md").read_text(encoding="utf-8")
        chinese = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")

        for text in (english, chinese):
            for marker in ("ffmpeg", "npm install", "deploy_website", "recordings/", "requirements.txt"):
                self.assertIn(marker, text)
            for server in EXPECTED_MCP_SERVERS:
                self.assertIn(f"`{server}`", text)

    def test_plugin_is_listed_in_the_root_readmes(self) -> None:
        for name in ("README.md", "README_CN.md"):
            text = (ROOT / name).read_text(encoding="utf-8")
            with self.subTest(file=name):
                self.assertIn("[**video2code**](./plugins/video2code)", text)
                self.assertIn("| `productivity` |", text)


class PackagingTest(unittest.TestCase):
    def test_packaged_zip_carries_every_component(self) -> None:
        with tempfile.TemporaryDirectory(prefix="video2code-dist-test-") as directory:
            artifact = Path(directory) / "plugin.zip"
            build_dist.build_zip(PLUGIN, artifact)
            with zipfile.ZipFile(artifact) as archive:
                names = set(archive.namelist())

        for expected in (
            "video2code/.zcode-plugin/plugin.json",
            "video2code/.claude-plugin/plugin.json",
            "video2code/.mcp.json",
            "video2code/README.md",
            "video2code/README_CN.md",
            "video2code/LICENSE",
            "video2code/requirements.txt",
            "video2code/hooks/hooks.json",
            "video2code/mcp/runtime_server.py",
            "video2code/mcp/video_server.py",
            "video2code/skills/web-replicate/scripts/init-webapp.sh",
        ):
            with self.subTest(entry=expected):
                self.assertIn(expected, names)

        for command in EXPECTED_COMMANDS:
            self.assertIn(f"video2code/commands/{command}.md", names)
        for skill in EXPECTED_SKILLS:
            self.assertIn(f"video2code/skills/{skill}/SKILL.md", names)

        # Both webapp templates must ship, or scaffolding fails after install.
        for template in ("default", "default-3d"):
            self.assertIn(
                f"video2code/skills/web-replicate/templates/{template}/template/package.json",
                names,
            )


def load_tests(loader, tests, pattern):  # noqa: ARG001
    """Run plugins/video2code/tests/ as part of the root suite.

    A dedicated loader keeps `_top_level_dir` off the caller's loader, and
    sys.path is restored so the plugin test directory cannot shadow modules
    for the rest of the root discovery.
    """
    saved_path = list(sys.path)
    try:
        plugin_loader = unittest.TestLoader()
        tests.addTests(
            plugin_loader.discover(
                start_dir=str(PLUGIN_TESTS),
                top_level_dir=str(PLUGIN_TESTS),
            )
        )
    finally:
        sys.path[:] = saved_path
    return tests


if __name__ == "__main__":
    unittest.main()
