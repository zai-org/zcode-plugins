"""The per-call extraction budget must hold across all segments."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mcp"))
from v2c_tools import video


class ClipFrameBudgetTest(unittest.TestCase):
    def run_clip(self, parsed, budget, sample="uniform"):
        requests = []

        def extract(src, out_dir, index, timestamps, tier):
            requests.append(list(timestamps))
            return [out_dir / f"{index}_{i}.jpg" for i in range(len(timestamps))], 0

        ctx = SimpleNamespace(clip_fps=1, clip_grid=False, clip_sample=sample,
                              virtualize=str)
        with tempfile.TemporaryDirectory() as tmp, \
                patch.dict(os.environ, {"V2C_CLIP_MAX_FRAMES": str(budget)}), \
                patch.object(video, "_extract_segment_frames", side_effect=extract), \
                patch.object(video, "_diff_select_ts", return_value=None):
            result = video._clip_as_frames(Path("sample.mp4"), "sample.mp4", parsed,
                                           Path(tmp), ctx)
        return result, requests

    def test_small_segments_do_not_push_proportional_budget_over_limit(self):
        for sample in ("uniform", "diff"):
            with self.subTest(sample=sample):
                result, requests = self.run_clip([(0, 60), (61, 62), (63, 64)], 3, sample)
                self.assertEqual(len(result.image_paths), 3)
                self.assertEqual([len(ts) for ts in requests], [1, 1, 1])

    def test_budget_smaller_than_segment_count_is_rejected_without_extraction(self):
        result, requests = self.run_clip([(0, 1), (2, 3), (4, 5)], 2)
        self.assertIsInstance(result, str)
        self.assertTrue(result.startswith("[ERROR]"), result)
        self.assertEqual(requests, [])

    def test_rounding_uses_available_budget_without_exceeding_requests(self):
        result, requests = self.run_clip([(0, 10), (11, 21), (22, 32)], 8)
        self.assertEqual(len(result.image_paths), 8)
        self.assertEqual(sorted(len(ts) for ts in requests), [2, 3, 3])

    def test_uncapped_requests_keep_existing_counts(self):
        result, requests = self.run_clip([(0, 2), (3, 6)], 10)
        self.assertEqual([len(ts) for ts in requests], [2, 3])
        self.assertEqual(len(result.image_paths), 5)
