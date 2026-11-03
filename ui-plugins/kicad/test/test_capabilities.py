from __future__ import annotations

import plistlib
import tempfile
import unittest
from pathlib import Path

from kicad_capabilities import inspect_installation


def make_app(root: Path, *, huaqiu: bool = False, complete_huaqiu: bool = True) -> tuple[Path, Path, Path]:
    app = root / "KiCad.app"
    cli = app / "Contents/MacOS/kicad-cli"
    python = app / "Contents/Frameworks/Python.framework/Versions/Current/bin/python3"
    for path in (cli, python):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
    for name in ("symbols", "footprints", "3dmodels"):
        (app / "Contents/SharedSupport" / name).mkdir(parents=True)
    if huaqiu:
        base = app / "Contents/Resources/edge-headless"
        (base / "dsh").mkdir(parents=True)
        node = base / "bin/node"
        node.parent.mkdir(parents=True)
        node.touch()
        names = (
            "dsh-kicad",
            "dsh-kicad-drc",
            "dsh-tool-kicad-schematic-gen",
            "dsh-tool-part-search",
            "dsh-tool-symbol-footprint",
        ) if complete_huaqiu else ("dsh-kicad", "dsh-tool-part-search")
        for name in names:
            package = base / "dsh-plugins/@huaqiu" / name
            package.mkdir(parents=True)
            (package / "package.json").write_text("{}")
        part_search = base / "dsh-plugins/@huaqiu/node_modules/@huaqiu/part-search/dist/esm/index.js"
        part_search.parent.mkdir(parents=True)
        part_search.touch()
    with (app / "Contents/Info.plist").open("wb") as stream:
        plistlib.dump({"CFBundleShortVersionString": "10.0.7-test" if huaqiu else "10.0.6-test"}, stream)
    return app, cli, python


class CapabilitiesTest(unittest.TestCase):
    def test_official_distribution_is_ready_without_dsh(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, cli, python = make_app(Path(tmp))
            got = inspect_installation(app, cli=cli, version="10.0.6", python=python, python_importable=True, ipc={"available": False, "reachable": False})
            self.assertEqual(got["distribution"], "official")
            self.assertTrue(got["core_ready"])
            self.assertTrue(got["edition_ready"])
            self.assertEqual(got["requested_edition"], "standard")
            self.assertFalse(got["dsh"]["bundled"])
            self.assertIn("pcb_build", got["available_tools"])
            self.assertIn("kicad_check_spec_file", got["available_tools"])
            self.assertEqual(got["missing_dependencies"], [])

    def test_huaqiu_distribution_lists_bundled_plugins_but_does_not_expose_dsh(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, cli, python = make_app(Path(tmp), huaqiu=True)
            got = inspect_installation(app, cli=cli, version="unavailable", python=python, python_importable=True, ipc={"available": True, "reachable": True, "kipy": True}, requested_edition="huaqiu")
            self.assertEqual(got["distribution"], "huaqiu")
            self.assertEqual(got["version"], "10.0.7-test")
            self.assertTrue(got["edition_ready"])
            self.assertEqual(got["edition"]["missing_dsh_plugins"], [])
            self.assertIn("@huaqiu/dsh-kicad", got["dsh"]["plugins"])
            self.assertFalse(got["dsh"]["exposed_to_zcode"])
            self.assertTrue(got["huaqiu_native_adapter"]["available"])
            self.assertFalse(got["huaqiu_native_adapter"]["starts_dsh"])
            self.assertIn("search_hqsch_parts", got["available_tools"])
            self.assertIn("get_hqsch_supply_chain", got["available_tools"])
            self.assertIn("resolve_hqsch_part_for_kicad", got["available_tools"])
            self.assertIn("compare_hqsch_models_with_kicad", got["available_tools"])
            self.assertIn("kicad_live_move_footprint", got["available_tools"])

    def test_auto_edition_resolves_from_the_selected_distribution(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, cli, python = make_app(Path(tmp), huaqiu=True)
            selection = {
                "mode": "automatic",
                "reason": "newest_detected_installation",
                "requested_edition": "auto",
                "resolved_edition": "huaqiu",
            }
            got = inspect_installation(
                app,
                cli=cli,
                version="10.0.7",
                python=python,
                python_importable=True,
                requested_edition="auto",
                selection=selection,
            )
            self.assertEqual(got["requested_edition"], "auto")
            self.assertEqual(got["resolved_edition"], "huaqiu")
            self.assertTrue(got["edition"]["automatic"])
            self.assertTrue(got["edition_ready"])
            self.assertEqual(got["application"]["selection"], selection)
            self.assertIn("search_hqsch_parts", got["available_tools"])

    def test_missing_installation_returns_structured_reasons(self):
        with tempfile.TemporaryDirectory() as tmp:
            got = inspect_installation(Path(tmp) / "missing.app", cli=None, version="unavailable", python=None, python_importable=False, python_error="not installed", ipc={"kipy": False, "reason": "client missing"})
            self.assertEqual(got["distribution"], "missing")
            self.assertFalse(got["core_ready"])
            missing = {item["id"]: item for item in got["missing_dependencies"]}
            self.assertFalse(missing["kicad_app"]["optional"])
            self.assertFalse(missing["pcbnew_python"]["optional"])
            self.assertTrue(missing["kicad_python"]["optional"])

    def test_huaqiu_edition_rejects_official_distribution(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, cli, python = make_app(Path(tmp))
            got = inspect_installation(app, cli=cli, version="10.0.6", python=python, python_importable=True, requested_edition="huaqiu")
            self.assertTrue(got["core_ready"])
            self.assertFalse(got["edition_ready"])
            self.assertTrue(got["edition_mismatch"])
            missing = {item["id"]: item for item in got["missing_dependencies"]}
            self.assertIn("kicad_edition_mismatch", missing)
            self.assertIn("huaqiu_dsh_runtime", missing)
            self.assertIn("@huaqiu/dsh-kicad-drc", missing["huaqiu_dsh_plugins"]["missing"])

    def test_standard_edition_rejects_huaqiu_distribution(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, cli, python = make_app(Path(tmp), huaqiu=True)
            got = inspect_installation(app, cli=cli, version="10.0.7", python=python, python_importable=True, requested_edition="official")
            self.assertEqual(got["requested_edition"], "standard")
            self.assertFalse(got["edition_ready"])
            self.assertTrue(got["edition_mismatch"])

    def test_incomplete_huaqiu_distribution_lists_missing_components(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, cli, python = make_app(Path(tmp), huaqiu=True, complete_huaqiu=False)
            got = inspect_installation(app, cli=cli, version="10.0.7", python=python, python_importable=True, requested_edition="huaqiu")
            self.assertFalse(got["edition_ready"])
            self.assertFalse(got["edition_mismatch"])
            self.assertIn("@huaqiu/dsh-tool-symbol-footprint", got["edition"]["missing_dsh_plugins"])


if __name__ == "__main__":
    unittest.main()
