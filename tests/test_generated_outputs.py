"""Compiled install payloads are build outputs, not source.

`pnpm build` writes plugins/<name>/dist/ (and whatever a plugin's own stage
script adds) from the sources under ui-plugins/<name>/. CI and local
development both run that build, so the outputs stay out of Git: committing
them duplicates every byte in history and lets a stale payload pass for the
current source. These tests pin that the outputs are ignored and untracked.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def compiled_plugins() -> list[tuple[str, str]]:
    """(source, name) of every marketplace plugin that has a build under ui-plugins/."""
    marketplace = json.loads((ROOT / "marketplace.json").read_text(encoding="utf-8"))
    return [
        (entry["source"].removeprefix("./"), entry["name"])
        for entry in marketplace["plugins"]
        if (ROOT / "ui-plugins" / entry["name"] / "package.json").is_file()
    ]


@unittest.skipUnless(
    shutil.which("git") and git("rev-parse", "--is-inside-work-tree").returncode == 0,
    "needs a Git checkout",
)
class GeneratedOutputsStayOutOfGitTest(unittest.TestCase):
    def test_marketplace_has_compiled_plugins(self) -> None:
        self.assertGreater(len(compiled_plugins()), 0, "no compiled plugin found; the guard below would be vacuous")

    def test_no_tracked_file_is_ignored(self) -> None:
        """Whatever .gitignore names as generated must not be committed anyway."""
        tracked = git("ls-files", "-ci", "--exclude-standard")
        self.assertEqual(tracked.returncode, 0, tracked.stderr)
        self.assertEqual(tracked.stdout.splitlines(), [])

    def test_compiled_install_payloads_are_ignored_and_untracked(self) -> None:
        for source, name in compiled_plugins():
            with self.subTest(plugin=name):
                payload = f"{source}/dist"
                ignored = git("check-ignore", "-q", f"{payload}/build-info.json")
                self.assertEqual(ignored.returncode, 0, f"{payload}/ must be ignored by .gitignore")
                tracked = git("ls-files", "--", payload)
                self.assertEqual(tracked.returncode, 0, tracked.stderr)
                self.assertEqual(tracked.stdout.splitlines(), [], f"{payload}/ is a build output; run git rm --cached")


if __name__ == "__main__":
    unittest.main()
