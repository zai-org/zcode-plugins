from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = PLUGIN_ROOT / "hooks" / "run_python.mjs"


class PythonLauncherTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.node = shutil.which("node")
        if not cls.node:
            raise unittest.SkipTest("node is required to exercise the Python launcher")

    def test_executes_script_with_unicode_and_spaced_arguments(self) -> None:
        with tempfile.TemporaryDirectory(prefix="video2code launcher ") as directory:
            probe = Path(directory) / "probe script.py"
            probe.write_text(
                "import json, sys\n"
                "print(json.dumps({\"args\": sys.argv[1:], "
                "\"version\": list(sys.version_info[:2])}, ensure_ascii=False))\n",
                encoding="utf-8",
            )

            result = subprocess.run(
                [self.node, str(LAUNCHER), str(probe), "hello world", "\u590d\u523b"],
                capture_output=True,
                encoding="utf-8",
                check=False,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["args"], ["hello world", "\u590d\u523b"])
        self.assertGreaterEqual(output["version"], [3, 10])

    def test_preserves_script_exit_status(self) -> None:
        with tempfile.TemporaryDirectory(prefix="video2code-launcher-") as directory:
            failure = Path(directory) / "failure.py"
            failure.write_text("raise SystemExit(7)\n", encoding="utf-8")
            result = subprocess.run(
                [self.node, str(LAUNCHER), str(failure)],
                capture_output=True,
                encoding="utf-8",
                check=False,
            )

        self.assertEqual(result.returncode, 7, result.stderr)

    def test_hook_and_mcp_entries_use_launcher(self) -> None:
        hooks = json.loads(
            (PLUGIN_ROOT / "hooks" / "hooks.json").read_text(encoding="utf-8")
        )["hooks"]
        for groups in hooks.values():
            for group in groups:
                for hook in group["hooks"]:
                    self.assertIn("hooks/run_python.mjs", hook["command"])

        servers = json.loads(
            (PLUGIN_ROOT / ".mcp.json").read_text(encoding="utf-8")
        )["mcpServers"]
        for server in servers.values():
            self.assertEqual(server["command"], "node")
            self.assertEqual(
                server["args"][0],
                "${CLAUDE_PLUGIN_ROOT}/hooks/run_python.mjs",
            )


if __name__ == "__main__":
    unittest.main()
