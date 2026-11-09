"""Hermetic tests for server/kicad_views.py: the GLB part table (synthetic glTF, no KiCad), board text helpers, id/layer/view validation. Run by test/static.test.mjs
(`pnpm test`) or directly: python3 test/test_views.py   (needs the build: the vendored worker lives in dist/py)."""
from __future__ import annotations

import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / "server"), str(HERE.parent / "dist" / "py")]  # the source first, the vendored worker (built into dist/py) after it
import kicad_views as kv  # noqa: E402
from kicad.library import LibraryError  # noqa: E402
from kicad.runner import KiCadError  # noqa: E402

Y90 = [0.0, 0.7071067811865476, 0.0, 0.7071067811865476]  # +90 degrees about Y (glTF up): a part rotated 90 degrees on the board
X180 = [1.0, 0.0, 0.0, 0.0]  # flipped over: a part on the bottom side


def glb_bytes(doc: dict) -> bytes:
    body = json.dumps(doc).encode()
    body += b" " * (-len(body) % 4)
    blob = b"\0\0\0\0"
    total = 12 + 8 + len(body) + 8 + len(blob)
    return struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(body), b"JSON") + body + struct.pack("<I4s", len(blob), b"BIN\0") + blob


def box(lo, hi):
    return {"componentType": 5126, "count": 8, "type": "VEC3", "min": lo, "max": hi}


def sample_doc(copper: bool = False) -> dict:
    nodes = [
        {"children": [1, 3, 5, 7] + ([8] if copper else [])},
        {"name": "U1", "translation": [0.017, 0.001595, 0.011], "children": [2]}, {"name": "=>[0:1:1:5]", "mesh": 0},
        {"name": "C3", "translation": [0.0215, 0.001595, 0.0165], "rotation": Y90, "children": [4]}, {"name": "=>[0:1:1:3]", "mesh": 1},
        {"name": "R9", "translation": [0.01, 0.0, 0.02], "rotation": X180, "children": [6]}, {"name": "=>[0:1:1:3]", "mesh": 1},
        {"name": "=>[0:1:1:9]", "mesh": 2},
    ]
    meshes = [{"name": "SOIC-8_3.9x4.9mm_P1.27mm", "primitives": [{"attributes": {"POSITION": 0}}]}, {"name": "C_0603_1608Metric", "primitives": [{"attributes": {"POSITION": 1}}]},
              {"name": "demo_PCB", "primitives": [{"attributes": {"POSITION": 2}}]}]
    accessors = [box([-0.002, 0.0, -0.0025], [0.002, 0.0017, 0.0025]), box([-0.0008, 0.0, -0.0004], [0.0008, 0.0005, 0.0004]), box([0.0, 0.0, 0.0], [0.034, 0.00151, 0.022])]
    if copper:
        nodes.append({"name": "=>[0:1:1:11]", "mesh": 3})
        meshes.append({"name": "demo_copper", "primitives": [{"attributes": {"POSITION": 3}}]})
        accessors.append(box([0.0, 0.0015, 0.0], [0.034, 0.0016, 0.022]))
    return {"asset": {"version": "2.0", "extras": {"generator": "KiCad 10.0.6"}}, "scene": 0, "scenes": [{"nodes": [0]}], "nodes": nodes, "meshes": meshes, "accessors": accessors,
            "materials": [{}]}


class GlbPartsTest(unittest.TestCase):
    def table(self, doc, origin=(50.0, 50.0)):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "b.glb"
            f.write_bytes(glb_bytes(doc))
            return kv.glb_parts(f, origin)

    def test_designators_positions_and_rotation_in_board_coordinates(self):
        t = self.table(sample_doc())
        by = {p["ref"]: p for p in t["parts"]}
        self.assertEqual(sorted(by), ["C3", "R9", "U1"])
        self.assertEqual((by["U1"]["x_mm"], by["U1"]["y_mm"], by["U1"]["rotation_deg"], by["U1"]["side"]), (67.0, 61.0, 0.0, "top"))
        self.assertEqual(by["U1"]["footprint"], "SOIC-8_3.9x4.9mm_P1.27mm")
        self.assertEqual((by["C3"]["x_mm"], by["C3"]["y_mm"], by["C3"]["rotation_deg"]), (71.5, 66.5, 90.0))
        self.assertEqual(by["U1"]["size_mm"], [4.0, 5.0, 1.7])

    def test_rotation_swaps_the_footprint_extents(self):
        c3 = {p["ref"]: p for p in self.table(sample_doc())["parts"]}["C3"]
        self.assertEqual(c3["size_mm"], [0.8, 1.6, 0.5], "a 1.6 x 0.8 part turned by 90 degrees is 0.8 wide and 1.6 deep on the board")
        self.assertEqual((c3["bbox_mm"]["x_min"], c3["bbox_mm"]["x_max"], c3["bbox_mm"]["y_min"], c3["bbox_mm"]["y_max"]), (71.1, 71.9, 65.7, 67.3))
        self.assertAlmostEqual(c3["bbox_mm"]["z_min"], 1.595, delta=0.006)  # 0.001595 m: the seating plane of a top-side part

    def test_bottom_side_part_is_flipped(self):
        r9 = {p["ref"]: p for p in self.table(sample_doc())["parts"]}["R9"]
        self.assertEqual(r9["side"], "bottom")
        self.assertEqual((r9["bbox_mm"]["z_min"], r9["bbox_mm"]["z_max"]), (-0.5, 0.0), "below the board")
        self.assertEqual(r9["rotation_deg"], 0.0)

    def test_board_body_is_not_a_part_and_origin_shifts_everything(self):
        t = self.table(sample_doc(), origin=(0.0, 0.0))
        self.assertEqual(t["board"]["mesh"], "demo_PCB")
        self.assertEqual((t["board"]["x_min"], t["board"]["x_max"], t["board"]["y_max"], t["board"]["thickness_mm"]), (0.0, 34.0, 22.0, 1.51))
        self.assertEqual({p["ref"]: p["x_mm"] for p in t["parts"]}["U1"], 17.0)
        self.assertNotIn("demo_PCB", [p["footprint"] for p in t["parts"]])

    def test_flat_copper_meshes_are_layers_not_parts(self):
        t = self.table(sample_doc(copper=True))
        self.assertEqual(t["flat_layers"], ["demo_copper"])
        self.assertEqual(len(t["parts"]), 3)

    def test_refs_sort_naturally(self):
        doc = sample_doc()
        for i, n in enumerate(("R10", "R2")):
            doc["nodes"].append({"name": n, "translation": [0, 0, 0], "children": [6]})
            doc["nodes"][0]["children"].append(len(doc["nodes"]) - 1)
        self.assertEqual([p["ref"] for p in self.table(doc)["parts"]], ["C3", "R2", "R9", "R10", "U1"])

    def test_not_a_glb_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "x.glb"
            f.write_bytes(b"not a glb at all, not a glb at all")
            with self.assertRaises(KiCadError):
                kv.glb_parts(f, (0, 0))


class BoardTextTest(unittest.TestCase):
    PCB = '(kicad_pcb (version 20260206) (setup (pad_to_mask_clearance 0) (aux_axis_origin 50 50.5)) (footprint "Resistor_SMD:R_0603_1608Metric" (layer "F.Cu") (property "Reference" "R1" (at 0 0)))' \
          ' (footprint "LED_SMD:LED_0603_1608Metric" (layer "B.Cu") (property "Reference" "D1" (at 0 0))))'

    def write(self, text):
        d = tempfile.mkdtemp(prefix="kicad-views-test-")
        self.addCleanup(lambda: __import__("shutil").rmtree(d, True))
        f = Path(d) / "b.kicad_pcb"
        f.write_text(text)
        return f

    def test_origin_and_footprints(self):
        f = self.write(self.PCB)
        self.assertEqual(kv.board_origin(f), (50.0, 50.5))
        self.assertEqual(kv.board_footprints(f), [{"ref": "R1", "footprint": "Resistor_SMD:R_0603_1608Metric", "side": "top"}, {"ref": "D1", "footprint": "LED_SMD:LED_0603_1608Metric", "side": "bottom"}])

    def test_no_origin_is_zero_and_garbage_never_raises(self):
        self.assertEqual(kv.board_origin(self.write("(kicad_pcb (setup))")), (0.0, 0.0))
        self.assertEqual(kv.board_origin(Path("/no/such/file.kicad_pcb")), (0.0, 0.0))

    def test_find_schematic_prefers_the_project_name(self):
        d = Path(tempfile.mkdtemp(prefix="kicad-views-test-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(d, True))
        self.assertIsNone(kv.find_schematic(d))
        (d / "other.kicad_sch").write_text("x")
        (d / "board.kicad_sch").write_text("x")
        self.assertEqual(kv.find_schematic(d, "board").name, "board.kicad_sch")
        self.assertEqual(kv.find_schematic(d, "").name, "board.kicad_sch")  # first by name
        self.assertIsNone(kv.find_schematic(d / "missing"))


class ErcReportTest(unittest.TestCase):
    # real output of `kicad-cli sch erc --format report --units mm` (KiCad 10.0.6) for test/fixtures/minimal_dangling.kicad_sch
    REPORT = """ERC report (2026-10-20T10:49:52, Encoding UTF8)
Report includes: Errors, Warnings, Exclusions

***** Sheet /
[label_dangling]: Label not connected
    ; error
    @(50.80 mm, 50.80 mm): Label 'FLOATING'
[wire_dangling]: Wires not connected to anything
    ; error
    @(76.20 mm, 50.80 mm): Horizontal Wire, length 25.40 mm
[unconnected_wire_endpoint]: Unconnected wire endpoint
    ; warning
    @(76.20 mm, 50.80 mm): Horizontal Wire, length 25.40 mm
[unconnected_wire_endpoint]: Unconnected wire endpoint
    ; warning
    @(76.20 mm, 50.80 mm): Horizontal Wire, length 25.40 mm

 ** ERC messages: 4  Errors 2  Warnings 2
"""

    def test_counts_positions_and_order(self):
        r = kv.parse_erc_report(self.REPORT)
        self.assertEqual((r["errors"], r["warnings"], r["total"]), (2, 2, 4))
        self.assertEqual(r["by_type"], {"label_dangling": 1, "wire_dangling": 1, "unconnected_wire_endpoint": 2})
        self.assertEqual([v["severity"] for v in r["violations"]], ["error", "error", "warning", "warning"], "errors first")
        self.assertEqual(r["violations"][0]["items"], [{"what": "Label 'FLOATING'", "x_mm": 50.8, "y_mm": 50.8}])
        self.assertIn("length 25.40 mm", r["violations"][1]["items"][0]["what"], "the text report has the right lengths (the JSON one is 100x too small)")

    def test_sheets_limit_and_garbage(self):
        two = self.REPORT + "\n***** Sheet /power/\n[pin_not_connected]: Pin not connected\n    ; error\n    @(10.00 mm, 20.00 mm): Symbol U1 Pin 3\n"
        r = kv.parse_erc_report(two, max_listed=2)
        self.assertEqual((r["errors"], len(r["violations"])), (3, 2))
        self.assertEqual({v["sheet"] for v in kv.parse_erc_report(two)["violations"]}, {"/", "/power/"})
        for junk in ("", "nothing here", "\x00\x01", "[broken"):
            self.assertEqual(kv.parse_erc_report(junk)["total"], 0)


class ValidationTest(unittest.TestCase):
    def test_layers_and_views(self):
        self.assertEqual(len(kv.LAYER_IDS), len(set(kv.LAYER_IDS)))
        self.assertEqual([i for i, _, on in kv.LAYERS if on], ["B.Cu", "F.Cu", "F.SilkS", "Edge.Cuts"])
        self.assertIn("iso", kv.VIEWS)
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(KiCadError):
                kv.layer_svg(Path(d) / "b.kicad_pcb", "../../etc/passwd", Path(d))
            with self.assertRaises(KiCadError):
                kv.render_view(Path(d) / "b.kicad_pcb", "orbit", Path(d) / "x.png", 30, 20)

    def test_library_ids_are_validated_before_anything_runs(self):
        with tempfile.TemporaryDirectory() as d:
            for bad in ("../../etc:passwd", "NoColon", "Lib:../x", ".hidden:x"):
                with self.subTest(bad=bad), self.assertRaises(LibraryError):
                    kv.library_svg("symbol", bad, Path(d))
            with self.assertRaises(KiCadError):
                kv.library_svg("model", "Device:R", Path(d))

    def test_svg_size(self):
        self.assertEqual(kv._svg_size('<svg viewBox="0.0000 0.0000 33.9852 21.9964">'), {"width_mm": 33.9852, "height_mm": 21.9964})
        self.assertEqual(kv._svg_size("<svg>"), {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
