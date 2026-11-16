"""Real SceneDetect/FFmpeg regressions for whole-video shot coverage.

Run with Python >= 3.10, scenedetect and opencv-python-headless installed:
    python -m unittest discover -s plugins/video-agent-kit/tests -p 'test_shots_coverage.py'
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MCP_ROOT = Path(__file__).resolve().parents[1] / "mcp"
sys.path.insert(0, str(MCP_ROOT))

from ve_tools import shots  # noqa: E402
from ve_tools.run_context import RunContext  # noqa: E402


HAS_RUNTIME = (
    shutil.which("ffmpeg") is not None
    and shutil.which("ffprobe") is not None
    and importlib.util.find_spec("scenedetect") is not None
    and importlib.util.find_spec("cv2") is not None
)


@unittest.skipUnless(HAS_RUNTIME, "requires FFmpeg, SceneDetect and OpenCV")
class ShotCoverageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="shots-coverage-")
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name).resolve()
        self.env = patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(self.project)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.ctx = RunContext()

    def make_video(self, *, cut: bool = False) -> Path:
        video = self.project / "source.mp4"
        command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
        command += ["-f", "lavfi", "-i", "color=c=blue:s=160x90:r=24:d=2"]
        if cut:
            command += ["-f", "lavfi", "-i", "color=c=red:s=160x90:r=24:d=1"]
            command += [
                "-filter_complex", "[0:v]trim=duration=1,setpts=PTS-STARTPTS[a];"
                "[a][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]",
            ]
        command += ["-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", str(video)]
        subprocess.run(command, check=True, capture_output=True, timeout=30)
        return video

    def detect(self, video: Path, **options) -> tuple[dict, dict]:
        result = shots.detect_shots({"input_path": str(video), **options}, self.ctx)
        self.assertFalse(result.text.startswith("[ERROR]"), result.text)
        timeline = json.loads(Path(result.data["output_json"]).read_text(encoding="utf-8"))
        return result.data, timeline

    def assert_covers_video(self, timeline: dict, expected_shots: int) -> None:
        self.assertEqual(timeline["n_shots"], expected_shots)
        self.assertEqual(len(timeline["shots"]), expected_shots)
        self.assertEqual(timeline["shots"][0]["start"], 0.0)
        # Early SceneDetect 0.6 releases report the final frame's timestamp;
        # newer releases report the exclusive end. Allow one frame of rounding.
        self.assertAlmostEqual(
            timeline["shots"][-1]["end"], 2.0, delta=1 / timeline["fps"] + 0.001
        )
        for previous, following in zip(timeline["shots"], timeline["shots"][1:]):
            self.assertEqual(previous["end"], following["start"])

    def test_no_cuts_cover_the_whole_video_in_both_detection_modes(self) -> None:
        video = self.make_video()
        for frame_skip in (0, 2):
            with self.subTest(frame_skip=frame_skip):
                _, timeline = self.detect(video, frame_skip=frame_skip, force=True)
                self.assert_covers_video(timeline, 1)

    def test_no_cuts_shorter_than_min_len_are_still_retained(self) -> None:
        video = self.make_video()
        for frame_skip in (0, 2):
            with self.subTest(frame_skip=frame_skip):
                _, timeline = self.detect(video, frame_skip=frame_skip, min_len=3.0, force=True)
                self.assert_covers_video(timeline, 1)

    def test_real_cut_boundaries_remain_contiguous(self) -> None:
        video = self.make_video(cut=True)
        for frame_skip in (0, 2):
            with self.subTest(frame_skip=frame_skip):
                _, timeline = self.detect(video, frame_skip=frame_skip, force=True)
                self.assert_covers_video(timeline, 2)
                self.assertAlmostEqual(timeline["shots"][0]["end"], 1.0, delta=0.15)

    def test_old_empty_cache_is_rebuilt_and_new_cache_can_be_reused(self) -> None:
        video = self.make_video()
        output = self.project / "out" / "shots.json"
        old_cache = {
            "video": str(video), "video_signature": shots.file_signature(video),
            "segment_version": "cover-all-v2", "threshold": 27.0,
            "min_len": 0.8, "frame_skip": 0, "duration": 2.0,
            "fps": 24.0, "n_shots": 0, "shots": [],
        }
        output.write_text(json.dumps(old_cache), encoding="utf-8")
        data, timeline = self.detect(video)
        self.assertFalse(data["reused"])
        self.assert_covers_video(timeline, 1)
        reused, cached = self.detect(video)
        self.assertTrue(reused["reused"])
        self.assertEqual(cached, timeline)


if __name__ == "__main__":
    unittest.main()
