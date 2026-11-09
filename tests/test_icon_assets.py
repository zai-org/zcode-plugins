"""Shared icon contract for every plugin; no per-plugin byte/format snapshots."""
import hashlib
import json
from pathlib import Path
import struct
import unittest
from urllib.parse import urlsplit
import zlib

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
PREFIX = "https://cdn-zcode.z.ai/zcode/official-plugin/assets/"


class IconAssetsTest(unittest.TestCase):
    def test_png_icons_share_one_format_contract(self):
        icons = list(ASSETS.rglob("*.png"))
        self.assertTrue(icons)
        for icon in icons:
            with self.subTest(icon=str(icon.relative_to(ASSETS))):
                data = icon.read_bytes()
                self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                chunks = []
                offset = 8
                while offset < len(data):
                    self.assertLessEqual(offset + 12, len(data))
                    length = int.from_bytes(data[offset:offset + 4], "big")
                    end = offset + length + 12
                    self.assertLessEqual(end, len(data))
                    kind = data[offset + 4:offset + 8]
                    payload = data[offset + 8:end - 4]
                    self.assertEqual(zlib.crc32(kind + payload), int.from_bytes(data[end - 4:end], "big"))
                    chunks.append((kind, payload))
                    offset = end
                self.assertEqual(chunks[0][0], b"IHDR")
                width, height, depth, colour, compression, filtering, interlace = struct.unpack(">IIBBBBB", chunks[0][1])
                self.assertGreater(width, 0)
                self.assertEqual(width, height, "icons must be square")
                # RGB and RGBA are equally valid; indexed and grayscale PNGs
                # remain supported. Background opacity is a design choice.
                allowed_depths = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
                self.assertIn(colour, allowed_depths)
                self.assertIn(depth, allowed_depths[colour])
                self.assertEqual((compression, filtering), (0, 0))
                self.assertIn(interlace, (0, 1))
                if colour == 3:
                    palette = next((p for k, p in chunks if k == b"PLTE"), b"")
                    self.assertTrue(palette)
                    self.assertEqual(len(palette) % 3, 0)
                    self.assertLessEqual(len(palette), 768)
                compressed = b"".join(p for k, p in chunks if k == b"IDAT")
                self.assertTrue(compressed)
                self.assertTrue(zlib.decompress(compressed))
                self.assertEqual(chunks[-1], (b"IEND", b""))

    def test_catalog_cdn_references_exist(self):
        for entry in json.loads((ROOT / "marketplace.json").read_text())["plugins"]:
            icon = entry.get("icon", "")
            if icon.startswith(PREFIX):
                with self.subTest(plugin=entry["name"]):
                    path = (ASSETS / urlsplit(icon).path.split("/assets/", 1)[1]).resolve()
                    self.assertTrue(path.is_relative_to(ASSETS.resolve()))
                    self.assertTrue(path.is_file(), str(path))

    def test_provenance_hashes_match_assets(self):
        records = json.loads((ASSETS / "icon-sources.json").read_text())
        seen = set()
        for record in records:
            with self.subTest(icon=record["icon"]):
                self.assertNotIn(record["icon"], seen)
                seen.add(record["icon"])
                path = (ASSETS / record["icon"]).resolve()
                self.assertTrue(path.is_relative_to(ASSETS.resolve()))
                self.assertTrue(path.is_file())
                self.assertTrue(record.get("source"))
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), record["sha256"])


if __name__ == "__main__":
    unittest.main()
