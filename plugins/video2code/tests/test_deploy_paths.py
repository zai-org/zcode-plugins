"""Deployment must not delete or recursively copy its own source."""
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mcp"))
from v2c_tools import deploy


class DeploymentPathsTest(unittest.TestCase):
    def test_redeploy_same_directory_preserves_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "index.html").write_text("site", encoding="utf-8")
            deploy._swap_dir_contents(directory, directory / ".")
            self.assertEqual((directory / "index.html").read_text(), "site")

    def test_nested_source_is_rejected_before_deleting_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            dst = Path(tmp)
            src = dst / "build"
            src.mkdir()
            (src / "index.html").write_text("new", encoding="utf-8")
            (dst / "old.html").write_text("old", encoding="utf-8")
            with self.assertRaises(ValueError):
                deploy._swap_dir_contents(dst, src)
            self.assertEqual((src / "index.html").read_text(), "new")
            self.assertEqual((dst / "old.html").read_text(), "old")

    def test_nested_destination_is_rejected_before_deleting_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp)
            dst = src / "serve"
            dst.mkdir()
            (dst / "old.html").write_text("old", encoding="utf-8")
            with patch.object(deploy.shutil, "copytree") as copy:
                with self.assertRaises(ValueError):
                    deploy._swap_dir_contents(dst, src)
                copy.assert_not_called()
            self.assertEqual((dst / "old.html").read_text(), "old")

    def test_first_deploy_of_project_root_returns_error_without_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ctx = SimpleNamespace(work_dir=root / ".v2c", resolve=lambda _: root)
            with patch.object(deploy.shutil, "copytree") as copy, \
                    patch.object(deploy, "_spawn_httpd") as spawn:
                result = deploy.deploy_website({"local_dir": ".", "type": "static"}, ctx)
            self.assertTrue(result.startswith("[ERROR]"), result)
            copy.assert_not_called()
            spawn.assert_not_called()

    def test_live_and_dead_server_overlap_returns_error_preserving_files(self):
        for alive in (True, False):
            with self.subTest(alive=alive), tempfile.TemporaryDirectory() as tmp:
                dst = Path(tmp)
                src = dst / "build"
                src.mkdir()
                (src / "index.html").write_text("new", encoding="utf-8")
                proc = Mock()
                proc.poll.return_value = None if alive else 1
                ctx = SimpleNamespace(work_dir=dst / ".v2c", resolve=lambda _: src,
                                      _deployed_servers=[{"dst": dst, "proc": proc, "port": 1234}])
                with patch.object(deploy, "_spawn_httpd") as spawn:
                    result = deploy.deploy_website({"local_dir": str(src), "type": "static"}, ctx)
                self.assertTrue(result.startswith("[ERROR]"), result)
                self.assertEqual((src / "index.html").read_text(), "new")
                spawn.assert_not_called()

    def test_disjoint_directories_still_replace_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src, dst = root / "build", root / "serve"
            src.mkdir()
            dst.mkdir()
            (src / "index.html").write_text("new", encoding="utf-8")
            (dst / "old.html").write_text("old", encoding="utf-8")
            deploy._swap_dir_contents(dst, src)
            self.assertEqual((dst / "index.html").read_text(), "new")
            self.assertFalse((dst / "old.html").exists())
