"""video-agent-kit hooks and replication runtime: behaviour that the plugin's own scripts promise.

Covers the pieces that moved in from the retired video2code plugin or were added with them:
still.py crop bounds, the session clock, the replication hook dispatcher, PostToolUse
feedback under ZCode, and deploy_website (stable URL, readiness, cleanup).
"""
from __future__ import annotations

import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

PLUGIN = Path(__file__).resolve().parents[1] / "plugins" / "video-agent-kit"
STILL = PLUGIN / "skills" / "video2code" / "scripts" / "still.py"
DISPATCH = PLUGIN / "hooks" / "replicate" / "dispatch.py"
REPLICATE_HOOKS = PLUGIN / "hooks" / "replicate"

try:
    import cv2
    import numpy as np
except ModuleNotFoundError:
    cv2 = None
    np = None


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(path.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(path.parent))
    return module


@unittest.skipIf(cv2 is None or np is None, "requires the plugin's OpenCV and NumPy dependencies")
class StillCropBoundsTest(unittest.TestCase):
    """--crop is the intersection of the requested rectangle with the frame."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.video = cls.root / "clip.avi"
        writer = cv2.VideoWriter(str(cls.video), cv2.VideoWriter_fourcc(*"MJPG"), 10, (32, 24))
        for _ in range(10):
            writer.write(np.full((24, 32, 3), 128, dtype=np.uint8))
        writer.release()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _crop(self, crop: str, prefix: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(STILL), str(self.video), "0.2", "--crop", crop,
                               "--out", str(self.root / "stills"), "--prefix", prefix],
                              capture_output=True, text=True, timeout=60)

    def test_crops_keep_only_the_part_inside_the_frame(self):
        cases = {"-4,2,10,8": (8, 6), "2,-4,10,8": (4, 10), "-4,-3,10,8": (5, 6),
                 "28,20,10,8": (4, 4), "2,3,10,8": (8, 10)}
        for index, (crop, shape) in enumerate(cases.items()):
            with self.subTest(crop=crop):
                proc = self._crop(crop, f"case{index}")
                self.assertEqual(proc.returncode, 0, proc.stderr)
                image = cv2.imread(proc.stdout.strip().splitlines()[-1])
                self.assertEqual(image.shape[:2], shape)

    def test_fully_outside_crops_write_nothing(self):
        for index, crop in enumerate(("-12,2,8,8", "2,-12,8,8", "32,2,8,8", "2,24,8,8")):
            with self.subTest(crop=crop):
                proc = self._crop(crop, f"outside{index}")
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertIn("[WARN]", proc.stdout)
                self.assertFalse(list((self.root / "stills").glob(f"outside{index}_*")))


class SessionClockTest(unittest.TestCase):
    """The soft-deadline clock starts on creation tools only."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        env = patch.dict(os.environ, {"ZCODE_PLUGIN_DATA": self.tmp.name})
        env.start()
        self.addCleanup(env.stop)
        self.clock = _load("ve_session_clock", PLUGIN / "hooks" / "session_clock.py")
        self.t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def _call(self, tool: str, minutes: float, session: str = "s1"):
        payload = {"tool_name": f"mcp__plugin_video-agent-kit_video-edit__{tool}", "session_id": session}
        return self.clock.decide(self.t0 + timedelta(minutes=minutes), payload, {})

    def test_other_tools_never_start_or_trigger_it(self):
        self.assertIsNone(self.clock.decide(self.t0, {"tool_name": "Bash", "session_id": "s1"}, {}))
        self.assertIsNone(self._call("detect_shots", 0))
        self.assertIsNone(self._call("produce_film", 400))  # a long movie recap gets no reminder

    def test_reminds_after_the_deadline_and_then_every_interval(self):
        self.assertIsNone(self._call("video_generate", 0))     # starts the clock
        self.assertIsNone(self._call("video_render", 179))
        reminder = self._call("video_render", 181)
        self.assertIn("out/preview.mp4", reminder)
        self.assertIsNone(self._call("video_qc", 190))          # inside the 20-minute interval
        self.assertIsNotNone(self._call("video_qc", 202))


class ReplicationHookTest(unittest.TestCase):
    def test_dispatch_exits_silently_when_replication_is_not_enabled(self):
        with tempfile.TemporaryDirectory() as project:
            event = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": project,
                     "tool_input": {"command": "ls"}}
            started = time.monotonic()
            proc = subprocess.run([sys.executable, str(DISPATCH)], input=json.dumps(event),
                                  capture_output=True, text=True, timeout=30)
            self.assertEqual((proc.returncode, proc.stdout, proc.stderr), (0, "", ""))
            self.assertLess(time.monotonic() - started, 10)
            self.assertFalse((Path(project) / ".v2c").exists())

    def _feedback(self, extra_env: dict) -> subprocess.CompletedProcess:
        env = {k: v for k, v in os.environ.items()
               if k not in ("V2C_AGENT", "ZCODE_PLUGIN_ROOT", "ZCODE_PLUGIN_DATA")}
        code = "import hook_common; hook_common.feedback('converge now')"
        return subprocess.run([sys.executable, "-c", code], cwd=str(REPLICATE_HOOKS),
                              env={**env, **extra_env}, capture_output=True, text=True, timeout=30)

    def test_post_tool_feedback_is_additional_context_under_zcode(self):
        proc = self._feedback({"ZCODE_PLUGIN_ROOT": str(PLUGIN)})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = json.loads(proc.stdout)
        self.assertEqual(out["hookSpecificOutput"],
                         {"hookEventName": "PostToolUse", "additionalContext": "converge now"})

    def test_post_tool_feedback_keeps_exit_2_for_claude_code(self):
        proc = self._feedback({})
        self.assertEqual(proc.returncode, 2)
        self.assertIn("converge now", proc.stderr)


class DeployWebsiteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        env = patch.dict(os.environ, {"VE_PROJECT_DIR": str(self.root)})
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("V2C_WORKSPACE", None)
        self.deploy = _load("ve_runtime_deploy", PLUGIN / "mcp" / "runtime_deploy.py")
        self.addCleanup(self.deploy.stop_all)

    def _dist(self, html: str) -> str:
        dist = self.root / "app" / "dist"
        dist.mkdir(parents=True, exist_ok=True)
        (dist / "index.html").write_text(html, encoding="utf-8")
        return "app/dist"

    def test_missing_index_fails_without_starting_a_server(self):
        (self.root / "empty").mkdir()
        result = self.deploy.deploy_website({"local_dir": "empty"})
        self.assertEqual(result["error"]["kind"], "index_missing")
        self.assertEqual(self.deploy._SERVERS, [])

    def test_redeploy_keeps_the_url_and_serves_the_new_build(self):
        first = self.deploy.deploy_website({"local_dir": self._dist("<p>one</p>")})
        self.assertEqual(first["status"], "deployed", first)
        with urllib.request.urlopen(first["url"], timeout=5) as response:
            self.assertIn(b"one", response.read())
        second = self.deploy.deploy_website({"local_dir": self._dist("<p>two</p>")})
        self.assertEqual(second["url"], first["url"])
        self.assertTrue(second["same_url"])
        with urllib.request.urlopen(second["url"], timeout=5) as response:
            self.assertIn(b"two", response.read())

        serve_dirs = list((self.root / ".v2c" / "serve").iterdir())
        self.assertEqual(len(serve_dirs), 1)
        self.deploy.stop_all()
        self.assertFalse(serve_dirs[0].exists())

    def test_a_port_that_never_listens_reports_server_start_failed(self):
        with socket.socket() as busy:   # bound but not listening: http.server cannot bind it
            busy.bind(("127.0.0.1", 0))
            port = busy.getsockname()[1]
            with patch.object(self.deploy, "_free_port", return_value=port), \
                 patch.object(self.deploy, "READY_TIMEOUT_SECONDS", 3.0):
                result = self.deploy.deploy_website({"local_dir": self._dist("<p>x</p>")})
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error"]["kind"], "server_start_failed")
        self.assertEqual(list((self.root / ".v2c" / "serve").iterdir()), [])


if __name__ == "__main__":
    unittest.main()
