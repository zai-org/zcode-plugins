from __future__ import annotations

import unittest
from email.message import Message

from huaqiu_model_inspector import (
    DownloadedModel,
    ModelInspectionError,
    compare_footprints,
    compare_symbols,
    download_text_model,
    inspect_part_models,
    model_url,
    parse_footprint_model,
    parse_symbol_model,
)


SYMBOL_TEXT = r'''
(kicad_symbol_lib (version 20231120) (generator kicad_symbol_editor)
  (symbol "NE555D"
    (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "NE555D" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (symbol "NE555D_1_1"
      (pin power_in line (at 0 0 0) (length 2.54) (name "GND" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
      (pin input line (at 0 2.54 0) (length 2.54) (name "TR" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
      (pin output line (at 0 5.08 0) (length 2.54) (name "Q" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))
      (pin power_in line (at 0 7.62 0) (length 2.54) (name "VCC" (effects (font (size 1.27 1.27)))) (number "4" (effects (font (size 1.27 1.27)))))
    )
  )
)
'''


FOOTPRINT_TEXT = r'''
(footprint "SOIC-4_TEST" (version 20240108) (generator pcbnew)
  (layer "F.Cu")
  (fp_rect (start -2.5 -3) (end 2.5 3) (stroke (width 0.05) (type default)) (fill none) (layer "F.CrtYd"))
  (pad "1" smd roundrect (at -2 1) (size 1.2 0.6) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "2" smd roundrect (at -2 -1) (size 1.2 0.6) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "3" smd roundrect (at 2 -1) (size 1.2 0.6) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "4" smd roundrect (at 2 1) (size 1.2 0.6) (layers "F.Cu" "F.Paste" "F.Mask"))
)
'''


class FakeResponse:
    def __init__(self, url: str, body: bytes, length: str | None = None):
        self.url = url
        self.body = body
        self.offset = 0
        self.headers = Message()
        self.headers["Content-Type"] = "text/plain; charset=utf-8"
        if length is not None:
            self.headers["Content-Length"] = length

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def geturl(self):
        return self.url

    def read(self, count: int):
        chunk = self.body[self.offset : self.offset + count]
        self.offset += len(chunk)
        return chunk


class FakeOpener:
    def __init__(self, response: FakeResponse):
        self.response = response

    def open(self, request, timeout):
        return self.response


class FakeLibrary:
    def __init__(self, symbol, footprint):
        self.symbol = symbol
        self.footprint = footprint

    def get_symbol(self, lib_id):
        if lib_id != "Timer:NE555D":
            raise KeyError(lib_id)
        return self.symbol

    def get_footprint(self, lib_id):
        if lib_id != "Package_SO:TEST":
            raise KeyError(lib_id)
        return self.footprint


class InspectorTest(unittest.TestCase):
    def test_model_url_accepts_only_the_requested_allowlisted_file(self):
        models = {
            "symbol": {"url": "https://file.eda.cn/web/a.kicad_sym"},
            "footprint": {"downloadUrl": "https://file1.eda.cn/web/a.kicad_mod?token=x"},
        }
        self.assertEqual(model_url(models, "symbol"), models["symbol"]["url"])
        self.assertEqual(model_url(models, "footprint"), models["footprint"]["downloadUrl"])
        for refused in (
            "http://file.eda.cn/a.kicad_sym",
            "https://example.com/a.kicad_sym",
            "https://user@file.eda.cn/a.kicad_sym",
            "https://file.eda.cn/a.kicad_mod",
        ):
            with self.subTest(refused=refused), self.assertRaises(ModelInspectionError):
                model_url({"symbol": {"url": refused}}, "symbol")

    def test_download_is_in_memory_utf8_and_size_limited(self):
        url = "https://file.eda.cn/web/a.kicad_sym"
        response = FakeResponse(url, SYMBOL_TEXT.encode())
        got = download_text_model(url, "symbol", opener=FakeOpener(response))
        self.assertEqual(got.text, SYMBOL_TEXT)
        self.assertEqual(len(got.sha256), 64)
        self.assertEqual(got.metadata()["persisted"], False)

        too_large = FakeResponse(url, b"x", str(2 * 1024 * 1024 + 1))
        with self.assertRaisesRegex(ModelInspectionError, "2 MiB"):
            download_text_model(url, "symbol", opener=FakeOpener(too_large))

        redirected = FakeResponse("https://file1.eda.cn/web/a.kicad_sym", b"x")
        with self.assertRaisesRegex(ModelInspectionError, "redirect"):
            download_text_model(url, "symbol", opener=FakeOpener(redirected))

    def test_parsers_and_comparisons_are_rotation_translation_invariant(self):
        symbol = parse_symbol_model(SYMBOL_TEXT)
        footprint = parse_footprint_model(FOOTPRINT_TEXT)
        self.assertEqual([pin.number for pin in symbol.pins], ["1", "2", "3", "4"])
        self.assertEqual(footprint.pad_numbers, ["1", "2", "3", "4"])
        self.assertTrue(compare_symbols(symbol, symbol)["model_matches_local_symbol"])

        # Rotate 90 degrees and translate. Pairwise pad distances and dimensions
        # remain identical, so this is the same physical land pattern.
        rotated_text = FOOTPRINT_TEXT.replace("-2 1", "9 18").replace("-2 -1", "11 18").replace("2 -1", "11 22").replace("2 1", "9 22")
        rotated_text = rotated_text.replace("-2.5 -3", "-3 -2.5").replace("2.5 3", "3 2.5")
        rotated = parse_footprint_model(rotated_text)
        compared = compare_footprints(footprint, rotated)
        self.assertTrue(compared["pad_geometry_match"])
        self.assertTrue(compared["courtyard_dimensions_match"])
        self.assertTrue(compared["model_matches_local_footprint"])

    def test_mismatches_stay_unconfirmed(self):
        symbol = parse_symbol_model(SYMBOL_TEXT)
        changed_symbol = parse_symbol_model(SYMBOL_TEXT.replace('(name "TR"', '(name "THRESH"'))
        self.assertFalse(compare_symbols(symbol, changed_symbol)["pin_names_match"])
        footprint = parse_footprint_model(FOOTPRINT_TEXT)
        changed_footprint = parse_footprint_model(FOOTPRINT_TEXT.replace('(at 2 1)', '(at 2.5 1)'))
        compared = compare_footprints(footprint, changed_footprint)
        self.assertFalse(compared["pad_geometry_match"])
        self.assertFalse(compared["model_matches_local_footprint"])

    def test_inspection_returns_hashes_but_never_model_text(self):
        symbol = parse_symbol_model(SYMBOL_TEXT)
        footprint = parse_footprint_model(FOOTPRINT_TEXT)
        library = FakeLibrary(symbol, footprint)
        urls = {
            "symbol": "https://file.eda.cn/web/a.kicad_sym",
            "footprint": "https://file.eda.cn/web/a.kicad_mod",
        }

        def downloader(url, kind):
            text = SYMBOL_TEXT if kind == "symbol" else FOOTPRINT_TEXT
            raw = text.encode()
            return DownloadedModel(kind, url, text, len(raw), "a" * 64, "text/plain")

        got = inspect_part_models(
            {"mpn": "NE555", "models": {kind: {"url": url} for kind, url in urls.items()}},
            "Timer:NE555D",
            "Package_SO:TEST",
            library=library,
            downloader=downloader,
        )
        self.assertTrue(got["ok"])
        self.assertTrue(got["model_consistency_confirmed"])
        self.assertFalse(got["review"]["electrical_compatibility_confirmed"])
        self.assertFalse(got["review"]["physical_package_confirmed"])
        self.assertFalse(got["downloads"]["written_to_disk"])
        self.assertNotIn(SYMBOL_TEXT, str(got))
        self.assertEqual(got["spec_part_fields"]["footprint"], "Package_SO:TEST")


if __name__ == "__main__":
    unittest.main()
