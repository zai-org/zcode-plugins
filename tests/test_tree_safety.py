"""The publish job packages plugin trees on an internal machine and uploads the
result to a public CDN. These tests pin the properties that keep that from
becoming a file-disclosure primitive: symlinks are refused (not followed, not
silently skipped) and plugin sources cannot point outside plugins/. They also
pin that interpreter bytecode stays out of the artifact, so a build is
reproducible whether or not the tree was executed first.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
import zipfile
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


validate = load("validate")
build_dist = load("build_dist")


class SymlinkRefusalTest(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="tree-safety-"))
        self.plugin = self.root / "my-plugin"
        (self.plugin / ".zcode-plugin").mkdir(parents=True)
        (self.plugin / ".zcode-plugin" / "plugin.json").write_text("{}", encoding="utf-8")
        (self.plugin / "README.md").write_text("hi", encoding="utf-8")
        self.secret = self.root / "outside-secret.txt"
        self.secret.write_text("AKIA-not-for-the-cdn", encoding="utf-8")

    def test_clean_tree_passes_and_packages(self) -> None:
        self.assertEqual(validate.tree_violations(self.plugin, "p"), [])
        out = self.root / "plugin.zip"
        build_dist.build_zip(self.plugin, out)
        self.assertTrue(out.is_file())

    def test_file_symlink_is_rejected_by_validator_and_builder(self) -> None:
        os.symlink(self.secret, self.plugin / "leak.txt")
        problems = validate.tree_violations(self.plugin, "p")
        self.assertTrue(any("leak.txt is a symlink" in p for p in problems), problems)
        with self.assertRaises(build_dist.UnsafeTree):
            build_dist.build_zip(self.plugin, self.root / "plugin.zip")

    def test_directory_symlink_is_rejected(self) -> None:
        outside = self.root / "outside-dir"
        outside.mkdir()
        (outside / "config").write_text("x", encoding="utf-8")
        os.symlink(outside, self.plugin / "nested")
        problems = validate.tree_violations(self.plugin, "p")
        self.assertTrue(any("nested is a symlink" in p for p in problems), problems)
        with self.assertRaises(build_dist.UnsafeTree):
            build_dist.regular_files(self.plugin)

    def test_plugin_root_symlink_is_rejected(self) -> None:
        link = self.root / "linked-plugin"
        os.symlink(self.plugin, link)
        self.assertEqual(validate.tree_violations(link, "p"), ["p: directory is a symlink"])
        with self.assertRaises(build_dist.UnsafeTree):
            build_dist.regular_files(link)


class BytecodeExclusionTest(unittest.TestCase):
    """Vendored plugin trees arrive with __pycache__ from whoever ran them.

    git ignores it, but the packager walks the filesystem — so without this
    exclusion the same plugin version builds to different bytes depending on
    whether anything executed first, and publish_incremental.py refuses an
    already-published version whose bytes changed.
    """

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="bytecode-safety-"))
        self.plugin = self.root / "my-plugin"
        scripts = self.plugin / "skills" / "shared" / "scripts"
        cache = scripts / "__pycache__"
        cache.mkdir(parents=True)
        (self.plugin / ".zcode-plugin").mkdir()
        (self.plugin / ".zcode-plugin" / "plugin.json").write_text("{}", encoding="utf-8")
        (scripts / "recalc.py").write_text("x = 1\n", encoding="utf-8")
        (cache / "recalc.cpython-311.pyc").write_bytes(b"\x00\x0f\x0d\x0a")
        (scripts / "stray.pyc").write_bytes(b"\x00")
        (scripts / "stray.pyo").write_bytes(b"\x00")

    def test_bytecode_is_not_packaged(self) -> None:
        packaged = build_dist.regular_files(self.plugin)
        names = {p.relative_to(self.plugin).as_posix() for p in packaged}

        self.assertIn("skills/shared/scripts/recalc.py", names)
        self.assertIn(".zcode-plugin/plugin.json", names)
        for excluded in (
            "skills/shared/scripts/__pycache__/recalc.cpython-311.pyc",
            "skills/shared/scripts/stray.pyc",
            "skills/shared/scripts/stray.pyo",
        ):
            self.assertNotIn(excluded, names)

        out = self.root / "plugin.zip"
        build_dist.build_zip(self.plugin, out)
        with zipfile.ZipFile(out) as archive:
            entries = archive.namelist()
        self.assertEqual([e for e in entries if ".pyc" in e or ".pyo" in e], [])
        self.assertIn("my-plugin/skills/shared/scripts/recalc.py", entries)

    def test_symlink_inside_pycache_is_still_refused(self) -> None:
        """The exclusion must not become a blind spot: the walk still visits
        __pycache__, so a symlink parked there is refused, not skipped."""
        secret = self.root / "outside-secret.txt"
        secret.write_text("AKIA-not-for-the-cdn", encoding="utf-8")
        cache = self.plugin / "skills" / "shared" / "scripts" / "__pycache__"
        os.symlink(secret, cache / "leak.pyc")

        with self.assertRaises(build_dist.UnsafeTree):
            build_dist.regular_files(self.plugin)
        with self.assertRaises(build_dist.UnsafeTree):
            build_dist.build_zip(self.plugin, self.root / "plugin.zip")

    def test_build_is_reproducible_across_a_bytecode_change(self) -> None:
        first = self.root / "a.zip"
        build_dist.build_zip(self.plugin, first)
        digest = build_dist.sha256_of(first)

        cache = self.plugin / "skills" / "shared" / "scripts" / "__pycache__"
        (cache / "recalc.cpython-311.pyc").write_bytes(b"\x00\x0f\x0d\x0a" * 64)
        (cache / "extra.cpython-312.pyc").write_bytes(b"\x99")

        second = self.root / "b.zip"
        build_dist.build_zip(self.plugin, second)
        self.assertEqual(digest, build_dist.sha256_of(second))


class CapScopeTest(unittest.TestCase):
    """The file and size caps bound one plugin, not the marketplace.

    Applying the per-plugin cap to the whole of plugins/ made the repository
    fail as soon as the legal plugins together outgrew a single plugin's limit.
    """

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="cap-scope-")) / "plugins"
        for name in ("alpha", "beta"):
            (self.root / name).mkdir(parents=True)
            (self.root / name / "payload.bin").write_bytes(b"x" * 6)

    def test_plugins_within_the_cap_may_exceed_it_together(self) -> None:
        with mock.patch.object(validate, "MAX_PLUGIN_BYTES", 10):
            for name in ("alpha", "beta"):
                self.assertEqual(validate.tree_violations(self.root / name, name), [])
            self.assertEqual(validate.tree_violations(self.root, "plugins", caps=False), [])

    def test_one_oversize_plugin_is_still_rejected(self) -> None:
        (self.root / "beta" / "payload.bin").write_bytes(b"x" * 11)
        with mock.patch.object(validate, "MAX_PLUGIN_BYTES", 10):
            self.assertEqual(validate.tree_violations(self.root / "alpha", "alpha"), [])
            self.assertEqual(
                validate.tree_violations(self.root / "beta", "beta"),
                ["beta: 11 bytes exceeds the 10 byte limit"],
            )

    def test_one_plugin_with_too_many_files_is_still_rejected(self) -> None:
        (self.root / "alpha" / "extra.bin").write_bytes(b"x")
        with mock.patch.object(validate, "MAX_PLUGIN_FILES", 1):
            self.assertEqual(validate.tree_violations(self.root / "beta", "beta"), [])
            self.assertEqual(
                validate.tree_violations(self.root / "alpha", "alpha"),
                ["alpha: 2 files exceeds the 1 file limit"],
            )

    def test_a_root_sweep_without_caps_still_reports_symlinks(self) -> None:
        os.symlink(self.root / "alpha" / "payload.bin", self.root / "beta" / "leak.bin")
        self.assertEqual(
            validate.tree_violations(self.root, "plugins", caps=False),
            ["plugins: beta/leak.bin is a symlink (not allowed)"],
        )


class RepositoryTreeTest(unittest.TestCase):
    def test_current_repository_has_no_symlinks_in_published_trees(self) -> None:
        for name in validate.PLUGIN_ROOTS:
            self.assertEqual(validate.tree_violations(ROOT / name, name, caps=False), [])
        self.assertEqual(validate.tree_violations(ROOT / "assets", "assets"), [])

    def test_every_plugin_stays_within_the_per_plugin_caps(self) -> None:
        for plugin in sorted(path for name in validate.PLUGIN_ROOTS for path in (ROOT / name).glob("*")):
            if not plugin.is_dir():
                continue
            with self.subTest(plugin=plugin.name):
                self.assertEqual(validate.tree_violations(plugin, plugin.name), [])

    def test_no_plugin_artifact_would_ship_bytecode(self) -> None:
        for plugin in sorted(path for name in validate.PLUGIN_ROOTS for path in (ROOT / name).glob("*")):
            if not plugin.is_dir():
                continue
            with self.subTest(plugin=plugin.name):
                packaged = build_dist.regular_files(plugin)
                self.assertEqual(
                    [p.name for p in packaged if p.suffix in build_dist.BYTECODE_SUFFIXES],
                    [],
                )

    def test_github_workflows_pin_read_only_token(self) -> None:
        # PR checks run in the internal intake (sync_external_prs.py), not on
        # GitHub; only the Pages publisher is left here.
        workflows = sorted((ROOT / ".github" / "workflows").glob("*.yml"))
        self.assertEqual([wf.name for wf in workflows], ["publish.yml"])
        for wf in workflows:
            text = wf.read_text(encoding="utf-8")
            with self.subTest(workflow=wf.name):
                self.assertIn("permissions:", text)
                self.assertNotIn("pull_request_target", text)


if __name__ == "__main__":
    unittest.main()
