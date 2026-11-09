from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    import cv2
    import numpy as np
except ModuleNotFoundError:
    cv2 = None
    np = None


PLUGIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN / "mcp"))

from v2c_tools.run_context import RunContext
from v2c_tools.stillview import still_crops


@unittest.skipIf(cv2 is None or np is None, "requires the plugin's OpenCV and NumPy dependencies")
class StillCropBoundsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(self.root)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.ctx = RunContext()
        self.frame = np.arange(24 * 32 * 3, dtype=np.uint16).reshape(24, 32, 3).astype(np.uint8)
        self.source = self.root / "source.png"
        self.assertTrue(cv2.imwrite(str(self.source), self.frame))

    def test_crops_intersect_the_requested_rectangle_with_the_frame(self) -> None:
        cases = [
            ((-4, 2, 10, 8), self.frame[2:10, :6]),
            ((2, -4, 10, 8), self.frame[:4, 2:12]),
            ((-4, -3, 10, 8), self.frame[:5, :6]),
            ((28, 20, 10, 8), self.frame[20:24, 28:32]),
            ((2, 3, 10, 8), self.frame[3:11, 2:12]),
        ]
        for index, (crop, expected) in enumerate(cases):
            with self.subTest(crop=crop):
                result = still_crops({"source": str(self.source), "crop": crop,
                                      "prefix": f"case{index}"}, self.ctx)
                actual = cv2.imread(result.image_paths[0])
                np.testing.assert_array_equal(actual, expected)

    def test_fully_outside_crops_do_not_create_an_image_or_asset(self) -> None:
        self.ctx.app_dir.mkdir()
        for crop in [(-12, 2, 8, 8), (2, -12, 8, 8), (32, 2, 8, 8), (2, 24, 8, 8)]:
            for save_to in (None, "outside.png"):
                with self.subTest(crop=crop, save_to=save_to):
                    result = still_crops({"source": str(self.source), "crop": crop,
                                          "save_to": save_to}, self.ctx)
                    self.assertIsInstance(result, str)
                    self.assertTrue(result.startswith("[ERROR]"), result)
        self.assertEqual(list(self.ctx.output_dir.rglob("*.png")), [])
        self.assertFalse((self.ctx.app_dir / "public" / "assets").exists())
        self.assertFalse((self.ctx.work_dir / "assets_manifest.json").exists())

    def test_asset_is_scaled_after_clipping_and_keeps_original_provenance(self) -> None:
        import json

        self.ctx.app_dir.mkdir()
        crop = [-4, -3, 10, 8]
        result = still_crops({"source": str(self.source), "crop": crop, "scale": 2,
                              "save_to": "edge.png", "inline": "none"}, self.ctx)
        actual = cv2.imread(str(self.ctx.app_dir / "public" / "assets" / "edge.png"))
        expected = cv2.resize(self.frame[:5, :6], None, fx=2, fy=2,
                              interpolation=cv2.INTER_CUBIC)
        np.testing.assert_array_equal(actual, expected)
        self.assertEqual(result.image_paths, [])
        manifest = json.loads((self.ctx.work_dir / "assets_manifest.json").read_text())
        self.assertEqual(manifest[0]["crop"], crop)
        self.assertEqual(manifest[0]["size"], [12, 10])

    def test_cli_uses_the_same_bounds_for_video_frames(self) -> None:
        video = self.root / "source.avi"
        writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"MJPG"), 1, (32, 24))
        self.assertTrue(writer.isOpened())
        writer.write(self.frame)
        writer.release()
        capture = cv2.VideoCapture(str(video))
        ok, decoded = capture.read()
        capture.release()
        self.assertTrue(ok)
        for name, crop, expected in [
            ("partial", "-4,2,10,8", decoded[2:10, :6]),
            ("outside", "2,-12,8,8", None),
        ]:
            with self.subTest(crop=crop):
                out = self.root / name
                completed = subprocess.run(
                    [sys.executable, str(PLUGIN / "skills/video2code/scripts/still.py"),
                     str(video), "0", f"--crop={crop}", "--out", str(out)],
                    text=True, encoding="utf-8", capture_output=True, check=True,
                )
                images = list(out.glob("*.png"))
                if expected is None:
                    self.assertEqual(images, [])
                    self.assertIn("[WARN]", completed.stdout)
                else:
                    self.assertEqual(len(images), 1)
                    np.testing.assert_array_equal(cv2.imread(str(images[0])), expected)


if __name__ == "__main__":
    unittest.main()
