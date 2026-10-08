import importlib.util
from pathlib import Path
import unittest
import sys
import tempfile
import json
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_dist

spec = importlib.util.spec_from_file_location("mcp_manifest_validator", Path(__file__).resolve().parents[1] / "scripts/validate.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class McpAppManifestTest(unittest.TestCase):
    def setUp(self):
        validator.errors.clear()

    def surface(self, **overrides):
        return {"id": "editor", "title": {"en": "Editor"}, "server": "app", "resourceUri": "ui://test/panel.html", **overrides}

    def validate(self, *surfaces):
        validator.validate_ui_surfaces({"mcpServers": {"app": {}}, "ui": {"surfaces": list(surfaces)}}, "test")
        return validator.errors

    def test_valid_panel_and_plugins_without_ui(self):
        self.assertEqual(self.validate(self.surface()), [])
        validator.validate_ui_surfaces({}, "ordinary skill")
        self.assertEqual(validator.errors, [])

    def test_unresolvable_and_duplicate_surfaces(self):
        self.assertTrue(self.validate(self.surface(), self.surface()))
        for overrides in [{"server": "missing"}, {"resourceUri": "file:///tmp/panel"}, {"id": "../panel"}, {"availability": "global"}, {"title": {}}, {"server": []}]:
            with self.subTest(overrides=overrides):
                validator.errors.clear()
                self.assertTrue(self.validate(self.surface(**overrides)))

    def test_full_and_incremental_zip_boundary_rejects_incomplete_builds(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plugin = root / "plugins/demo"
            (plugin / ".zcode-plugin").mkdir(parents=True)
            (plugin / "dist").mkdir()
            (root / "ui-plugins/demo").mkdir(parents=True)
            (root / "ui-plugins/demo/package.json").write_text('{"version":"0.1.0"}')
            manifest = {"name": "demo", "version": "0.1.0", "mcpServers": {"app": {"command": "node", "args": ["${ZCODE_PLUGIN_ROOT}/dist/app.cjs"]}}}
            (plugin / ".zcode-plugin/plugin.json").write_text(json.dumps(manifest))
            (plugin / "dist/app.cjs").write_text("export {};")
            with patch.object(build_dist, "ROOT", root):
                with self.assertRaisesRegex(build_dist.UnsafeTree, "incomplete build"):
                    build_dist.build_zip(plugin, root / "plugin.zip")
                (plugin / "dist/build-info.json").write_text('{"name":"demo","version":"0.0.1"}')
                with self.assertRaisesRegex(build_dist.UnsafeTree, "version mismatch"):
                    build_dist.build_zip(plugin, root / "plugin.zip")
                (plugin / "dist/build-info.json").write_text(json.dumps({"name": "demo", "version": "0.1.0"}))
                build_dist.build_zip(plugin, root / "plugin.zip")
                self.assertTrue((root / "plugin.zip").is_file())

                (plugin / "dist/app.cjs").unlink()
                with self.assertRaisesRegex(build_dist.UnsafeTree, "missing MCP path"):
                    build_dist.build_zip(plugin, root / "plugin.zip")
