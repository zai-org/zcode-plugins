"""Subtitle render capabilities and real stream-copy mux regression coverage."""

import json
from contextlib import nullcontext
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "plugins/video-agent-kit/mcp"))
from ve_tools import subtitle  # noqa: E402
from ve_tools.run_context import RunContext  # noqa: E402


class SubtitleCapabilitiesTest(unittest.TestCase):
    def test_capabilities_match_the_selected_render_mode(self):
        for mode, encoders, filters in [
            (None, ("libx264",), ("ass",)),
            ("soft", ("mov_text",), ()),
            ("burn", ("libx264",), ("ass",)),
            ("both", ("libx264", "mov_text"), ("ass",)),
        ]:
            with self.subTest(mode=mode), patch.object(
                subtitle.shutil, "which", return_value="ffmpeg"
            ), patch.object(subtitle, "require_ffmpeg", return_value="[ERROR] missing capability") as check:
                result = subtitle.subtitle_render(
                    {"video_path": "source.mp4", "subtitles_path": "captions.json", "mode": mode},
                    None,
                )
                self.assertEqual(result.text, "[ERROR] missing capability")
                check.assert_called_once_with(encoders=encoders, filters=filters)

    def test_invalid_mode_is_reported_before_capability_checks(self):
        with patch.object(subtitle.shutil, "which", return_value="ffmpeg"), patch.object(
            subtitle, "require_ffmpeg", return_value="[ERROR] missing capability"
        ) as check:
            result = subtitle.subtitle_render(
                {"video_path": "source.mp4", "subtitles_path": "captions.json", "mode": "invalid"},
                None,
            )
            self.assertIn("mode must be one of", result.text)
            check.assert_not_called()


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "requires ffmpeg and ffprobe")
class SoftSubtitleMuxTest(unittest.TestCase):
    def test_soft_subtitles_keep_media_packets_without_burn_in_capabilities(self):
        self.assert_soft_mux(minimal=True)

    def test_soft_subtitles_with_installed_ffmpeg_capabilities(self):
        self.assert_soft_mux(minimal=False)

    def assert_soft_mux(self, minimal):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            "os.environ", {"CLAUDE_PROJECT_DIR": tmp}
        ):
            directory = Path(tmp)
            source = directory / "source.mp4"
            subprocess.run(
                ["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=size=64x64:rate=10",
                 "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1",
                 "-c:v", "mpeg4", "-c:a", "aac", str(source)],
                check=True, capture_output=True, timeout=30,
            )
            package = directory / "captions.json"
            package.write_text(json.dumps({
                "language": "eng",
                "cues": [{"start": 0, "end": 0.8, "text": "Hello subtitles"}],
                "style": {
                    "font_file": str(directory / "unused-font.ttf"), "font_family_resolved": "Arial",
                    "font_size": 12, "video_width": 64, "video_height": 64,
                    "primary_colour": "&H00FFFFFF", "outline_colour": "&H00000000",
                    "back_colour": "&H80000000", "border_style": 1, "outline": 1, "shadow": 0,
                    "alignment": 2, "margin_l": 2, "margin_r": 2, "margin_v": 2,
                },
            }), encoding="utf-8")
            # Simulate a minimal FFmpeg capability listing, not the mux itself:
            # the real command must only need mov_text, with no video/audio
            # encoder or libass filter. Homebrew's minimal build has no libass.
            capabilities = patch("ve_tools.ffproc._ffmpeg_feature_text", side_effect=lambda kind:
                                 " S..... mov_text " if kind == "encoders" else "") if minimal else nullcontext()
            with capabilities:
                result = subtitle.subtitle_render({
                    "video_path": str(source), "subtitles_path": str(package), "mode": "soft",
                }, RunContext())
            self.assertFalse(result.text.startswith("[ERROR]"), result.text)
            output = Path(result.data["outputs"]["soft"])
            for selector in ("v:0", "a:0"):
                self.assertEqual(self.packet_hashes(source, selector), self.packet_hashes(output, selector))
            subtitles = subprocess.run(
                ["ffmpeg", "-nostdin", "-v", "error", "-i", str(output), "-map", "0:s:0", "-f", "srt", "-"],
                check=True, capture_output=True, text=True, timeout=30,
            ).stdout
            self.assertIn("00:00:00,000 --> 00:00:00,800", subtitles)
            self.assertIn("Hello subtitles", subtitles)

    def packet_hashes(self, path, selector):
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", selector, "-show_packets",
             "-show_data_hash", "sha256", "-show_entries", "packet=data_hash", "-of", "json", str(path)],
            check=True, capture_output=True, text=True, timeout=30,
        )
        packets = json.loads(probe.stdout)["packets"]
        self.assertTrue(packets)
        return [packet["data_hash"] for packet in packets]


if __name__ == "__main__":
    unittest.main()
