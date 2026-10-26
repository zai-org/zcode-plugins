"""Exercise intake and published classification without executing plugin code."""

import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_dist
import validate


class CatalogClassificationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = {
            "name": "panel", "version": "1.0.0", "description": "Panel",
            "description_i18n": {"en": "Panel", "zh-CN": "面板"},
            "mcpServers": {"panel": {"command": "node", "args": ["server.mjs"]}},
            "ui": {"surfaces": [{"id": "panel", "title": "Panel", "server": "panel",
                "resourceUri": "ui://panel/app", "availability": "session"}]},
        }
        self.entry = {**self.manifest, "source": "./external_plugins/panel", "category": "productivity"}
        self.catalog = {"name": "fixture", "owner": {"name": "Example"},
            "description": "Fixture", "description_i18n": {"en": "Fixture", "zh-CN": "夹具"},
            "plugins": [self.entry]}
        self.write_fixture()

    def write_fixture(self):
        (self.root / "marketplace.json").write_text(json.dumps(self.catalog), encoding="utf-8")
        directory = self.root / self.entry["source"][2:]
        (directory / ".zcode-plugin").mkdir(parents=True, exist_ok=True)
        (directory / ".zcode-plugin/plugin.json").write_text(json.dumps(self.manifest), encoding="utf-8")
        return directory

    def check(self):
        with patch.object(validate, "ROOT", self.root), patch.object(validate, "errors", []), contextlib.redirect_stdout(io.StringIO()) as output:
            result = validate.main()
        return result, output.getvalue()

    def build(self):
        with patch.object(build_dist, "ROOT", self.root), patch.object(build_dist, "DIST", self.root / "dist"), patch.object(build_dist, "ASSETS_DIR", self.root / "assets"), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(build_dist.main(), 0)
        return json.loads((self.root / "dist/marketplace.json").read_text())["plugins"][0]

    def test_external_ui_is_classified_before_installation(self):
        self.assertEqual(self.check()[0], 0, self.check()[1])
        published = self.build()
        self.assertEqual(published["publisherType"], "community")
        self.assertIn("ui", published["componentTypes"])
        self.assertEqual(published["category"], "productivity")
        self.assertEqual(published["source"]["type"], "zip")

    def test_moving_source_keeps_install_identity_and_artifact_bytes(self):
        external = self.build()
        (self.root / "plugins").mkdir()
        shutil.move(self.root / "external_plugins/panel", self.root / "plugins/panel")
        self.entry["source"] = "./plugins/panel"
        self.write_fixture()
        official = self.build()
        self.assertEqual(official["publisherType"], "official")
        self.assertEqual(official["source"], external["source"])
        self.assertEqual(official["_artifact"], external["_artifact"])
        self.assertEqual(official["name"], external["name"])

    def test_invalid_ui_cannot_be_published_as_capability(self):
        for field, value in [("server", "unknown"), ("resourceUri", "https://example.com"), ("availability", "global"), ("id", "bad/id"), ("title", "")]:
            with self.subTest(field=field):
                surface = self.manifest["ui"]["surfaces"][0]
                old = surface[field]
                surface[field] = value
                self.write_fixture()
                self.assertNotEqual(self.check()[0], 0)
                surface[field] = old

    def test_mcp_or_self_reported_ui_does_not_create_ui_capability(self):
        self.manifest.pop("ui")
        self.entry.pop("ui")
        self.entry["componentTypes"] = ["ui"]
        self.write_fixture()
        self.assertNotIn("ui", self.build()["componentTypes"])

    def test_unregistered_external_directory_is_rejected(self):
        (self.root / "external_plugins/other").mkdir()
        code, message = self.check()
        self.assertNotEqual(code, 0)
        self.assertIn("external_plugins/other", message)

    def test_unlisted_plugin_keeps_source_without_publishing(self):
        self.catalog["plugins"] = []
        self.catalog["unlistedPlugins"] = [{"name": "panel", "source": self.entry["source"]}]
        directory = self.write_fixture()
        self.assertEqual(self.check()[0], 0, self.check()[1])
        with patch.object(build_dist, "ROOT", self.root), patch.object(build_dist, "DIST", self.root / "dist"), patch.object(build_dist, "ASSETS_DIR", self.root / "assets"), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(build_dist.main(), 0)
        published = json.loads((self.root / "dist/marketplace.json").read_text())
        self.assertEqual(published["plugins"], [])
        self.assertFalse((self.root / "dist/plugins/panel").exists())
        self.assertTrue(directory.is_dir())

    def test_invalid_unlisted_sources_are_rejected(self):
        for unlisted in [None, [None], [{"name": "panel", "source": self.entry["source"]}],
                         [{"name": "other", "source": "./external_plugins/other"}],
                         [{"name": "panel", "source": "./external_plugins/../panel"}]]:
            with self.subTest(unlisted=unlisted):
                self.catalog["unlistedPlugins"] = unlisted
                self.write_fixture()
                self.assertIn("unlistedPlugins", self.check()[1])

    def test_source_escape_is_rejected_by_validator_and_builder(self):
        self.entry["source"] = "./external_plugins/../panel"
        self.write_fixture()
        self.assertNotEqual(self.check()[0], 0)
        with self.assertRaises((ValueError, build_dist.UnsafeTree)):
            self.build()

    def test_missing_usage_category_is_rejected(self):
        self.entry.pop("category")
        self.write_fixture()
        self.assertIn("missing 'category'", self.check()[1])


if __name__ == "__main__":
    unittest.main()
