from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_ROOT / "mcp"))

from ve_tools.ffproc import ffconcat_file_line, write_ffconcat_file  # noqa: E402


class FFConcatPathTests(unittest.TestCase):
    def test_file_line_escapes_apostrophe_once(self) -> None:
        path = Path("Director's cut") / "clip.mp4"

        line = ffconcat_file_line(path)

        expected_path = path.resolve().as_posix().replace("'", "'\\''")
        self.assertEqual(line, f"file '{expected_path}'\n")

    def test_file_line_rejects_line_breaks(self) -> None:
        with self.assertRaisesRegex(ValueError, "line breaks"):
            ffconcat_file_line("clip\nnext.mp4")

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg is required for the concat smoke test")
    def test_ffmpeg_reads_concat_file_below_apostrophe_directory(self) -> None:
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg is not None
        with tempfile.TemporaryDirectory(prefix="video-agent-concat-") as directory:
            root = Path(directory) / "Editor's project"
            root.mkdir()
            inputs: list[Path] = []
            for index, frequency in enumerate((440, 660)):
                source = root / f"tone-{index}.wav"
                generated = subprocess.run(
                    [
                        ffmpeg,
                        "-nostdin",
                        "-v",
                        "error",
                        "-f",
                        "lavfi",
                        "-i",
                        f"sine=frequency={frequency}:duration=0.05",
                        "-c:a",
                        "pcm_s16le",
                        str(source),
                    ],
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=False,
                )
                self.assertEqual(generated.returncode, 0, generated.stderr)
                inputs.append(source)

            concat_file = root / "concat.txt"
            output = root / "joined.wav"
            write_ffconcat_file(concat_file, inputs)
            rendered = subprocess.run(
                [
                    ffmpeg,
                    "-nostdin",
                    "-v",
                    "error",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    str(concat_file),
                    "-c",
                    "copy",
                    str(output),
                ],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )

            self.assertEqual(rendered.returncode, 0, rendered.stderr)
            self.assertTrue(output.is_file())
            self.assertGreater(output.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
