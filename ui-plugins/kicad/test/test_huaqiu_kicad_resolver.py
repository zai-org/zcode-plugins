from __future__ import annotations

import unittest
from types import SimpleNamespace

from huaqiu_kicad_resolver import package_queries, resolve_part


def pin(number: str, name: str, etype: str = "input"):
    return SimpleNamespace(number=number, display_name=name, etype=etype, hidden=False)


class FakeLibrary:
    def __init__(self):
        self.symbol = SimpleNamespace(
            lib_id="Timer:NE555D",
            description="Precision timer, SOIC-8",
            ref_prefix="U",
            default_footprint="Package_SO:SOIC-8_3.9x4.9mm_P1.27mm",
            fp_filters=("SOIC*3.9x4.9mm*P1.27mm*",),
            pins=tuple(pin(str(i), "GND" if i == 1 else "VCC" if i == 8 else f"P{i}") for i in range(1, 9)),
        )
        self.footprint = SimpleNamespace(
            lib_id="Package_SO:SOIC-8_3.9x4.9mm_P1.27mm",
            description="SOIC, 8 Pin",
            tags="SOIC",
            pad_numbers=[str(i) for i in range(1, 9)],
            bbox=lambda: (-2.5, -3.0, 2.5, 3.0),
        )

    def search_symbols(self, query, limit, match_any=False):
        return [{"lib_id": self.symbol.lib_id}] if "ne555" in query.lower() else []

    def search_footprints(self, query, limit, match_any=False):
        return [{"lib_id": self.footprint.lib_id}] if "soic-8" in query.lower() else []

    def get_symbol(self, lib_id):
        if lib_id != self.symbol.lib_id:
            raise KeyError(lib_id)
        return self.symbol

    def get_footprint(self, lib_id):
        if lib_id != self.footprint.lib_id:
            raise KeyError(lib_id)
        return self.footprint

    def footprint_exists(self, lib_id):
        return lib_id == self.footprint.lib_id

    def compatible_footprints(self, symbol, limit=30):
        return [self.footprint.lib_id], 1

    def footprint_matches_filters(self, footprint_id, filters):
        return footprint_id == self.footprint.lib_id

    def pin_pad_mapping(self, symbol, footprint):
        return {"pins_without_pad": [], "pads_without_pin": [], "mapped": [str(i) for i in range(1, 9)]}

    @staticmethod
    def natural_key(value):
        return [int(value)]


class ResolverTest(unittest.TestCase):
    def test_package_aliases_are_conservative(self):
        part = {"mpn": "NE555", "attributes": [{"shortName": "package", "name": "制造商封装", "value": "SOP-8"}]}
        self.assertEqual(package_queries(part), ["SOP-8", "SOIC-8"])
        self.assertIn("SOT-23-5", package_queries({"mpn": "X", "package": "SOT23-5"}))
        self.assertIn("QFN-32", package_queries({"mpn": "X", "package": "QFN32"}))

    def test_resolver_returns_only_pin_pad_and_filter_checked_pair(self):
        part = {
            "mpn": "NE555",
            "manufacturer": {"id": "9373", "name": "IDCHIP"},
            "attributes": [{"shortName": "package", "name": "制造商封装", "value": "SOP-8"}],
            "models": {"symbol": {"url": "https://example.invalid/a.kicad_sym"}},
        }
        got = resolve_part(part, library=FakeLibrary())
        self.assertTrue(got["ok"])
        self.assertEqual(got["recommended_pair"]["symbol"], "Timer:NE555D")
        self.assertEqual(got["recommended_pair"]["footprint"], "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm")
        self.assertTrue(got["review"]["local_pin_pad_mapping_verified"])
        self.assertFalse(got["review"]["electrical_compatibility_confirmed"])
        self.assertFalse(got["review"]["physical_package_confirmed"])
        self.assertEqual(got["spec_part_fields"]["value"], "NE555")
        self.assertFalse(got["huaqiu_model_files_downloaded"])

    def test_no_symbol_never_invents_a_library_id(self):
        library = FakeLibrary()
        library.search_symbols = lambda *args, **kwargs: []
        got = resolve_part({"mpn": "UNKNOWN-123", "package": "QFN32"}, library=library)
        self.assertIsNone(got["recommended_pair"])
        self.assertNotIn("spec_part_fields", got)
        self.assertIn("do not invent", got["note"])

    def test_package_mismatch_and_extra_pads_are_not_spec_candidates(self):
        part = {"mpn": "NE555", "package": "SOP-8"}
        package_mismatch = FakeLibrary()
        package_mismatch.footprint.lib_id = "Package_DIP:DIP-8_W7.62mm"
        package_mismatch.symbol.default_footprint = package_mismatch.footprint.lib_id
        self.assertIsNone(resolve_part(part, library=package_mismatch)["recommended_pair"])

        exposed_pad = FakeLibrary()
        exposed_pad.pin_pad_mapping = lambda symbol, footprint: {
            "pins_without_pad": [],
            "pads_without_pin": ["9"],
            "mapped": [str(i) for i in range(1, 9)],
        }
        self.assertIsNone(resolve_part(part, library=exposed_pad)["recommended_pair"])


if __name__ == "__main__":
    unittest.main()
