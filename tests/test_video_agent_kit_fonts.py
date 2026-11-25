"""video-agent-kit timeline text fonts: Chinese text clips must find a CJK font on every platform.

fontconfig is not authoritative on macOS (Homebrew's fc-match answers ``:lang=zh`` with
Verdana) and the renderer's fixed candidates are Linux paths, so ``find_fontfile`` falls
back to the platform CJK lookup the subtitle renderer uses.
"""
from __future__ import annotations

import errno
import importlib.util
import os
import pathlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PLUGIN_MCP_DIR = Path(__file__).resolve().parents[1] / "plugins" / "video-agent-kit" / "mcp"
if str(PLUGIN_MCP_DIR) not in sys.path:
    sys.path.insert(0, str(PLUGIN_MCP_DIR))

from ve_tools import render, run_context, subtitle_style  # noqa: E402



class TimelineTextFontTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.latin = Path(self.tmp.name) / "latin.ttf"
        self.cjk = Path(self.tmp.name) / "cjk.ttc"
        self.latin.write_bytes(b"x")
        self.cjk.write_bytes(b"x")
        # clean_env skips empty values and falls back to project/plugin .env files, so
        # blank the font-dir variables at the clean_env layer, not in os.environ. render
        # imports clean_env lazily; subtitle_style bound it at import time: patch both.
        real_clean_env = run_context.clean_env
        font_vars = {"VE_FONT_DIRS", "VIDEO_EDIT_FONT_DIRS"}
        blank = lambda *names, **kw: None if font_vars & set(names) else real_clean_env(*names, **kw)  # noqa: E731
        for module in (run_context, subtitle_style):
            env = patch.object(module, "clean_env", side_effect=blank)
            env.start()
            self.addCleanup(env.stop)

    def _uncovered(self, font_file, text, limit=12):
        if str(font_file) == str(self.cjk) or text.isascii():
            return []
        return [ch for ch in text if not ch.isascii()][:limit]

    def test_cjk_text_falls_back_to_the_platform_font_when_fontconfig_answers_latin(self):
        with patch.object(render, "_fc_match_font", return_value=str(self.latin)), \
             patch.object(render, "_platform_cjk_fontfile", return_value=str(self.cjk)), \
             patch.object(render, "font_uncovered_characters", side_effect=self._uncovered):
            self.assertEqual(render.find_fontfile("插件完整测试"), str(self.cjk))
            self.assertEqual(render.find_fontfile("第1集 Episode"), str(self.cjk))
            # Latin text keeps fontconfig's answer: the fallback is only consulted when needed.
            self.assertEqual(render.find_fontfile("Hello"), str(self.latin))

    def test_cjk_text_without_any_candidate_still_finds_the_platform_font(self):
        with patch.object(render, "_fc_match_font", return_value=None), \
             patch.object(render, "_platform_cjk_fontfile", return_value=str(self.cjk)), \
             patch.object(render, "font_uncovered_characters", side_effect=self._uncovered), \
             patch.object(render.Path, "is_file", lambda p: str(p) in (str(self.latin), str(self.cjk))):
            self.assertEqual(render.find_fontfile("插件完整测试"), str(self.cjk))
            self.assertIsNone(render.find_fontfile(""))

    def test_unreadable_font_directories_are_skipped_not_raised(self):
        """A non-root user cannot stat /root/.fonts/* (EACCES): that is "no font here".

        os.stat is patched (not Path.stat): every pathlib version reaches it, so the
        simulation cannot silently stop applying."""
        real_stat = os.stat

        def stat(path, *args, **kwargs):
            if str(path).startswith("/root/"):
                raise PermissionError(errno.EACCES, "Permission denied", str(path))
            return real_stat(path, *args, **kwargs)

        with patch.object(os, "stat", stat):
            self.assertIsNone(subtitle_style._find_font_named("NotoSansCJK-Regular.ttc", [pathlib.Path("/root/.fonts")]))
            subtitle_style._platform_cjk_font("regular")   # must not raise
            self.assertIsInstance(subtitle_style.cjk_font_candidates(), list)

    def test_an_unreadable_ve_font_dirs_entry_is_skipped(self):
        locked = Path(self.tmp.name) / "locked"
        locked.mkdir()
        real_stat, real_clean_env = os.stat, run_context.clean_env

        def stat(path, *args, **kwargs):
            if str(path).startswith(str(locked)):
                raise PermissionError(errno.EACCES, "Permission denied", str(path))
            return real_stat(path, *args, **kwargs)

        with patch.object(run_context, "clean_env",
                          side_effect=lambda *names, **kw: str(locked) if "VE_FONT_DIRS" in names
                          else real_clean_env(*names, **kw)), \
             patch.object(os, "stat", stat), \
             patch.object(render, "_fc_match_font", return_value=str(self.latin)), \
             patch.object(render, "font_uncovered_characters", side_effect=self._uncovered):
            self.assertEqual(render.find_fontfile("Hello"), str(self.latin))

    def test_platform_font_misses_are_not_cached(self):
        render._PLATFORM_CJK_CACHE.clear()
        self.addCleanup(render._PLATFORM_CJK_CACHE.clear)
        with patch.object(render, "_drawtext_cjk_font", side_effect=[None, str(self.cjk)]) as lookup:
            self.assertIsNone(render._platform_cjk_fontfile())        # no CJK font yet
            self.assertEqual(render._platform_cjk_fontfile(), str(self.cjk))   # installed meanwhile
            self.assertEqual(render._platform_cjk_fontfile(), str(self.cjk))   # hit is cached
        self.assertEqual(lookup.call_count, 2)

    def test_drawtext_prefers_a_font_whose_face_0_is_simplified(self):
        """drawtext loads face 0; PingFang.ttc opens with PingFang HK, Hiragino Sans GB does not."""
        pingfang = str(Path(self.tmp.name) / "PingFang.ttc")
        hiragino = str(Path(self.tmp.name) / "Hiragino Sans GB.ttc")
        files = {"PingFang.ttc": pingfang, "Hiragino Sans GB.ttc": hiragino}

        def run(available):
            with patch.object(subtitle_style, "_platform_font_dirs", return_value=[]), \
                 patch.object(subtitle_style, "_font_file_index",
                              side_effect=lambda dirs, names: dict(available)), \
                 patch.object(subtitle_style, "font_covers_text", return_value=True), \
                 patch.object(subtitle_style, "font_face",
                              side_effect=lambda f: (3, "PingFang SC") if f == pingfang else (0, "Hiragino Sans GB")), \
                 patch.object(subtitle_style, "find_cjk_font", return_value="[ERROR] none"):
                return subtitle_style.find_drawtext_cjk_font()

        self.assertEqual(run(files), hiragino)
        self.assertEqual(run({"PingFang.ttc": pingfang}), pingfang)   # regional face only as a last resort

    @unittest.skipUnless(importlib.util.find_spec("fontTools"), "fontTools is needed to verify glyph coverage")
    def test_this_machine_resolves_a_covering_font_for_chinese(self):
        # Probed here, not at import: the scan walks the font dirs and may run fc-match.
        if not subtitle_style._platform_cjk_font("regular"):
            self.skipTest("no CJK font installed on this machine")
        font = render.find_fontfile("插件完整测试")
        self.assertIsNotNone(font)
        self.assertIsNotNone(render._font_charset(font))   # coverage really was checked
        self.assertEqual(render.font_uncovered_characters(font, "插件完整测试"), [])


if __name__ == "__main__":
    unittest.main()
