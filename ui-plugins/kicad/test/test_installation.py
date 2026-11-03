from __future__ import annotations

import plistlib
import tempfile
import unittest
from pathlib import Path

from kicad_installation import select_installation


def make_app(root: Path, name: str, version: str, *, huaqiu: bool = False) -> Path:
    app = root / name / "KiCad.app"
    cli = app / "Contents/MacOS/kicad-cli"
    cli.parent.mkdir(parents=True)
    cli.touch()
    with (app / "Contents/Info.plist").open("wb") as stream:
        plistlib.dump({"CFBundleShortVersionString": version}, stream)
    if huaqiu:
        (app / "Contents/Resources/edge-headless/dsh").mkdir(parents=True)
    return app


class InstallationSelectionTest(unittest.TestCase):
    def test_auto_selects_newest_installation_and_resolves_huaqiu(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            official = make_app(root, "KiCad", "10.0.6")
            huaqiu = make_app(root, "Huaqiu KiCad", "10.0.7", huaqiu=True)
            got = select_installation("", "auto", roots=[root])
            self.assertEqual(got["mode"], "automatic")
            self.assertEqual(got["resolved_edition"], "huaqiu")
            self.assertEqual(got["selected"]["path"], str(huaqiu))
            self.assertEqual({item["path"] for item in got["candidates"]}, {str(official), str(huaqiu)})

    def test_requested_edition_selects_matching_distribution(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            official = make_app(root, "KiCad", "10.0.6")
            make_app(root, "Huaqiu KiCad", "10.0.7", huaqiu=True)
            got = select_installation(None, "official", roots=[root])
            self.assertEqual(got["requested_edition"], "standard")
            self.assertEqual(got["resolved_edition"], "standard")
            self.assertEqual(got["selected"]["path"], str(official))

    def test_explicit_path_wins_even_when_another_installation_is_newer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            explicit = make_app(root, "KiCad", "10.0.5")
            make_app(root, "Huaqiu KiCad", "10.0.9", huaqiu=True)
            got = select_installation(explicit, "auto", roots=[root])
            self.assertEqual(got["mode"], "explicit")
            self.assertEqual(got["selected"]["path"], str(explicit))
            self.assertEqual(got["resolved_edition"], "standard")

    def test_missing_explicit_path_is_reported_instead_of_silently_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_app(root, "KiCad", "10.0.6")
            missing = root / "Not There.app"
            got = select_installation(missing, "auto", roots=[root])
            self.assertEqual(got["selected"]["path"], str(missing))
            self.assertEqual(got["selected"]["distribution"], "missing")
            self.assertEqual(got["candidates"], [])

    def test_automatic_discovery_ignores_similarly_named_apps_without_kicad_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            real = make_app(root, "KiCad", "10.0.6")
            mirror = root / "KiCadMirror.app"
            mirror.mkdir()
            with (mirror / "Info.plist").open("wb") as stream:
                plistlib.dump({"CFBundleShortVersionString": "99.0.0"}, stream)
            got = select_installation(None, "auto", roots=[root])
            self.assertEqual(got["selected"]["path"], str(real))
            self.assertEqual([item["path"] for item in got["candidates"]], [str(real)])


if __name__ == "__main__":
    unittest.main()
