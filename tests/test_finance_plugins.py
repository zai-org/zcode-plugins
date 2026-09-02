"""Structural contract for the vendored finance plugins.

These ten plugins are vendored from an upstream project, so their `agents/`,
`commands/` and `skills/` change without a local edit. What this file pins is
the layer this repository owns — the ZCode-first manifests, the host boundary
between them, the marketplace entries, and the bilingual documentation — plus
the invariants an upstream re-sync is most likely to quietly break.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGINS = ROOT / "plugins"
sys.path.insert(0, str(ROOT / "scripts"))

import build_dist  # noqa: E402


# name -> assets/<dir>/icon.png. The asset directory names are the icon design
# names, not the plugin names, so the mapping is pinned rather than derived.
FINANCE = {
    "accounting-and-reporting": "accounting-reporting",
    "assess-credit": "fixed-income-research",
    "find-clients": "corporate-client-acquisition",
    "model-deals": "trade-calculator",
    "pick-funds": "fund-research",
    "read-macro": "macro-strategy",
    "run-fpa": "business-analysis",
    "vet-companies": "corporate-due-diligence",
    "watch-positions": "portfolio-tracking",
    "write-research": "equity-research",
}

# Only this plugin ships without MCP servers: it works off the user's own
# ledger, so it needs no licensed market data and no paid plan.
NO_MCP = {"accounting-and-reporting"}

ZCODE_AUTH = {"type": "zcode_official", "provider": "jwt_token"}
URL_PREFIX = "${ZCODE_BASE_URL}/api/v1/mcp/server/"
ICON_PREFIX = "https://cdn-zcode.z.ai/zcode/official-plugin/assets/"

MCP_SERVERS = {
    "hexin-bond", "hexin-stock", "hexin-fund", "hexin-index", "hexin-global-stock",
    "wind-bond", "wind-stock", "wind-fund", "wind-index", "wind-economic",
    "wind-docs", "wind-global-stock", "tianyancha", "finance-search", "sec-search",
}

SHARED_SKILLS = ("report-render", "xlsx-author", "audit-xls")

# Strings that would send a user off to provision third-party credentials the
# plugins do not use. The stale upstream README told people to export these.
VENDOR_TOKEN_MARKERS = ("HEXIN_TOKEN", "WIND_API_KEY", "SEC_MCP_TOKEN")

# The upstream project is not public; its host must not reach the mirror.
INTERNAL_MARKERS = ("gitlab.", "glm.ai", "sync_financial.py")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def marketplace_entries() -> dict:
    return {e["name"]: e for e in load_json(ROOT / "marketplace.json")["plugins"]}


def frontmatter(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise AssertionError(f"{path} must start with YAML frontmatter")
    parts = text.split("---", 2)
    if len(parts) != 3:
        raise AssertionError(f"{path} must close its YAML frontmatter")
    return parts[1]


def commands_of(plugin: Path) -> set[str]:
    return {p.stem for p in (plugin / "commands").glob("*.md")}


def skills_of(plugin: Path) -> set[str]:
    return {p.parent.name for p in (plugin / "skills").glob("*/SKILL.md")}


class HostBoundaryTest(unittest.TestCase):
    """`.zcode-plugin` owns the MCP declarations because `${ZCODE_BASE_URL}`
    and `auth: zcode_official` only mean something to the ZCode host. The
    compatibility manifest must not carry them, and there must be no root
    `.mcp.json` re-introducing them behind the manifest's back."""

    def test_mcp_declarations_live_only_in_the_zcode_manifest(self) -> None:
        for name in FINANCE:
            plugin = PLUGINS / name
            with self.subTest(plugin=name):
                zcode = load_json(plugin / ".zcode-plugin" / "plugin.json")
                claude = load_json(plugin / ".claude-plugin" / "plugin.json")

                self.assertNotIn("mcpServers", claude)
                self.assertFalse((plugin / ".mcp.json").exists())

                if name in NO_MCP:
                    self.assertNotIn("mcpServers", zcode)
                    self.assertNotIn("requiresPaidPlan", zcode)
                    continue

                servers = zcode["mcpServers"]
                self.assertTrue(servers)
                self.assertTrue(zcode["requiresPaidPlan"])
                self.assertLessEqual(set(servers), MCP_SERVERS)
                for key, server in servers.items():
                    with self.subTest(server=key):
                        self.assertEqual(server["type"], "http")
                        self.assertEqual(server["auth"], ZCODE_AUTH)
                        self.assertTrue(server["url"].startswith(URL_PREFIX))

    def test_both_manifests_agree_on_identity(self) -> None:
        for name in FINANCE:
            plugin = PLUGINS / name
            with self.subTest(plugin=name):
                zcode = load_json(plugin / ".zcode-plugin" / "plugin.json")
                claude = load_json(plugin / ".claude-plugin" / "plugin.json")

                self.assertEqual(zcode["name"], name)
                self.assertEqual(zcode["name"], claude["name"])
                self.assertEqual(zcode["version"], claude["version"])
                self.assertEqual(zcode["displayName"], claude["displayName"])
                self.assertEqual(
                    set(zcode["description_i18n"]), {"en", "zh-CN"}
                )
                self.assertEqual(
                    zcode["displayName_i18n"]["zh-CN"], zcode["displayName"]
                )
                self.assertEqual(zcode["author"], {"name": "Z.ai", "url": "https://z.ai"})
                self.assertTrue(zcode["keywords"])


class MarketplaceTest(unittest.TestCase):
    def test_entries_match_the_zcode_manifest(self) -> None:
        entries = marketplace_entries()
        for name in FINANCE:
            with self.subTest(plugin=name):
                entry = entries[name]
                zcode = load_json(PLUGINS / name / ".zcode-plugin" / "plugin.json")

                self.assertEqual(entry["source"], f"./plugins/{name}")
                self.assertEqual(entry["category"], "finance")
                self.assertEqual(entry["version"], zcode["version"])
                self.assertEqual(entry["description"], zcode["description"])
                self.assertEqual(entry["description_i18n"], zcode["description_i18n"])
                self.assertEqual(entry["displayName"], zcode["displayName"])
                self.assertEqual(entry["displayName_i18n"], zcode["displayName_i18n"])
                self.assertEqual(entry["author"], zcode["author"])
                self.assertEqual(entry["keywords"], zcode["keywords"])
                self.assertEqual(
                    entry.get("requiresPaidPlan", False), name not in NO_MCP
                )

    def test_icons_exist_and_the_entry_points_at_them(self) -> None:
        entries = marketplace_entries()
        for name, asset in FINANCE.items():
            with self.subTest(plugin=name):
                icon = ROOT / "assets" / asset / "icon.png"
                self.assertTrue(icon.is_file(), f"missing {icon}")
                self.assertEqual(entries[name]["icon"], f"{ICON_PREFIX}{asset}/icon.png")

                data = icon.read_bytes()
                self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                self.assertEqual(data[12:16], b"IHDR")
                width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
                self.assertEqual(width, height, "icons must be square")
                self.assertEqual(data[25], 6, "icons need an alpha channel")

    def test_english_descriptions_stay_card_sized(self) -> None:
        """A marketplace card truncates; the two worst offenders were 415 and
        335 characters of vendored prose."""
        entries = marketplace_entries()
        for name in FINANCE:
            with self.subTest(plugin=name):
                self.assertLessEqual(len(entries[name]["description_i18n"]["en"]), 250)

    def test_plugins_are_listed_in_the_root_readmes(self) -> None:
        for doc in ("README.md", "README_CN.md"):
            text = (ROOT / doc).read_text(encoding="utf-8")
            with self.subTest(doc=doc):
                self.assertIn("| `finance` |", text)
                for name in FINANCE:
                    self.assertIn(f"[**{name}**](./plugins/{name})", text)


class ComponentTest(unittest.TestCase):
    def test_every_plugin_exposes_an_agent_commands_and_skills(self) -> None:
        for name in FINANCE:
            plugin = PLUGINS / name
            with self.subTest(plugin=name):
                agents = sorted((plugin / "agents").glob("*.md"))
                self.assertEqual([p.stem for p in agents], [name])
                self.assertTrue(commands_of(plugin))
                self.assertTrue(skills_of(plugin))

    def test_component_frontmatter_is_well_formed(self) -> None:
        for name in FINANCE:
            plugin = PLUGINS / name
            for path in sorted(plugin.glob("agents/*.md")) + sorted(plugin.glob("skills/*/SKILL.md")):
                with self.subTest(component=str(path.relative_to(PLUGINS))):
                    block = frontmatter(path)
                    declared = re.search(r"^name:\s*(\S+)", block, re.M)
                    self.assertIsNotNone(declared)
                    self.assertTrue(re.search(r"^description:", block, re.M))
                    expected = name if path.parent.name == "agents" else path.parent.name
                    self.assertEqual(declared.group(1), expected)
            for path in sorted(plugin.glob("commands/*.md")):
                with self.subTest(component=str(path.relative_to(PLUGINS))):
                    self.assertTrue(re.search(r"^description:", frontmatter(path), re.M))

    def test_readmes_document_every_command_and_skill(self) -> None:
        """The components are vendored, the READMEs are not — so a re-sync that
        adds or renames a component has to fail here rather than ship
        documentation that silently omits it."""
        for name in FINANCE:
            plugin = PLUGINS / name
            documented = {
                doc: (plugin / doc).read_text(encoding="utf-8")
                for doc in ("README.md", "README_CN.md")
            }
            for component in sorted(commands_of(plugin) | skills_of(plugin)):
                for doc, text in documented.items():
                    with self.subTest(plugin=name, doc=doc, component=component):
                        self.assertIn(component, text)

    def test_shared_skills_are_byte_identical_across_plugins(self) -> None:
        """Upstream generates these from one source and fails its own build if a
        vendored copy diverges. Bytecode is excluded: `.pyc` embeds the source
        path, so it differs per plugin by construction."""
        for shared in SHARED_SKILLS:
            digests: dict[str, set[str]] = {}
            for name in FINANCE:
                root = PLUGINS / name / "skills" / shared
                if not root.is_dir():
                    continue
                for path in root.rglob("*"):
                    if path.is_file() and not build_dist.is_bytecode(path, root):
                        rel = path.relative_to(root).as_posix()
                        digests.setdefault(rel, set()).add(
                            hashlib.sha256(path.read_bytes()).hexdigest()
                        )
            for rel, seen in sorted(digests.items()):
                with self.subTest(skill=shared, file=rel):
                    self.assertEqual(len(seen), 1)


class PublishingHygieneTest(unittest.TestCase):
    def test_no_internal_or_misleading_credential_markers(self) -> None:
        for name in FINANCE:
            for path in sorted((PLUGINS / name).rglob("*")):
                if not path.is_file() or path.suffix in {".png", ".pyc"}:
                    continue
                try:
                    text = path.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    continue
                with self.subTest(file=str(path.relative_to(PLUGINS))):
                    for marker in INTERNAL_MARKERS:
                        self.assertNotIn(marker, text)
                    for marker in VENDOR_TOKEN_MARKERS:
                        self.assertNotIn(marker, text)

    def test_upstream_provenance_is_recorded(self) -> None:
        for name in FINANCE:
            text = (PLUGINS / name / "UPSTREAM.md").read_text(encoding="utf-8")
            with self.subTest(plugin=name):
                self.assertIn("Owned by this repository", text)
                self.assertIn(".zcode-plugin/plugin.json", text)
                self.assertIn("Open publishing gates", text)

    def test_packaged_artifacts_carry_no_bytecode(self) -> None:
        for name in FINANCE:
            with self.subTest(plugin=name), tempfile.TemporaryDirectory() as directory:
                artifact = Path(directory) / "plugin.zip"
                build_dist.build_zip(PLUGINS / name, artifact)
                with zipfile.ZipFile(artifact) as archive:
                    entries = archive.namelist()
                self.assertEqual([e for e in entries if e.endswith((".pyc", ".pyo"))], [])
                self.assertIn(f"{name}/.zcode-plugin/plugin.json", entries)
                self.assertIn(f"{name}/README.md", entries)
                self.assertIn(f"{name}/README_CN.md", entries)


if __name__ == "__main__":
    unittest.main()
