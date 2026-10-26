"""Hermetic tests for server/kicad_live.py with a stub `kipy` (no KiCad, no sockets, no kicad-python): discovery, every failure reason, the session-board guard, the commit
discipline of the one write, and that nothing but board facts ever leaves the module. The real wire protocol is covered by test/fake_kicad_server.py in the e2e test.
Run by test/static.test.mjs (`pnpm test`) or directly: python3 test/test_live.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "server"))

FORBIDDEN = {"save", "save_as", "revert", "remove_items", "remove_items_by_id", "run_action", "clear_selection", "add_to_selection", "remove_from_selection", "create_items",
             "refill_zones", "interactive_move", "flip_items", "set_visible_layers", "set_active_layer", "set_enabled_layers", "set_origin", "set_title_block_info"}
B_CU, F_CU = 34, 3


class ApiError(Exception):
    pass


class KiConnectionError(Exception):
    pass


class Vec:
    def __init__(self, x, y):
        self.x, self.y = x, y

    @classmethod
    def from_xy_mm(cls, x, y):
        return cls(round(x * 1e6), round(y * 1e6))


class Ang:
    def __init__(self, d):
        self.degrees = d

    @classmethod
    def from_degrees(cls, d):
        return cls(d)


class Text:
    def __init__(self, value):
        self.value = value


class Field:
    def __init__(self, value):
        self.text = Text(value)


class Net:
    def __init__(self, name):
        self.name = name


class Item:
    def __init__(self, net=""):
        self.net = Net(net)


class FootprintInstance:  # the class NAME matters: the module maps selection rows by it
    def __init__(self, ref, x, y, rot=0.0, layer=F_CU, value="", lib="Lib:Name"):
        self.reference_field, self.value_field = Field(ref), Field(value)
        self.position, self.orientation, self.layer, self.locked = Vec(round((x + 50) * 1e6), round((y + 50) * 1e6)), Ang(rot), layer, False  # x, y given in the spec frame; file origin 50, 50
        self.definition = types.SimpleNamespace(id=lib)


class Track(Item):
    pass


class Via(Item):
    pass


class Pad(Item):
    def __init__(self, net="", number="1"):
        super().__init__(net)
        self.number = number


class Zone(Item):
    pass


class Editor:
    """What one KiCad editor process looks like through the stub: a board path, its items, and a log of every call."""

    def __init__(self, board, fps, tracks=(), vias=(), pads=(), zones=0, nets=(), selection=(), version="10.0.6"):
        self.board, self.fps, self.tracks, self.vias, self.pads, self.zones, self.nets, self.selection = board, fps, list(tracks), list(vias), list(pads), zones, nets, list(selection)
        self.version, self.calls, self.commits, self.drops, self.pending, self.fail_update = version, [], [], 0, None, False
        self.swap_board_after = None  # simulate the user opening another board between two requests
        self.boom = None  # reading the footprints raises this


EDITORS: dict[str, object] = {}  # socket -> Editor | Exception (what dialing it does)
CONNECTS: list[str] = []


class KiCadStub:
    def __init__(self, socket_path=None, client_name=None, timeout_ms=None):
        self.sock = socket_path
        self.timeout_ms = timeout_ms
        self._client = self

    def _ed(self):
        e = EDITORS.get(self.sock)
        CONNECTS.append(self.sock)
        if isinstance(e, Exception):
            raise e
        if e is None:
            raise KiConnectionError("Failed to connect to KiCad: Connection refused")
        return e

    def ping(self):
        self._ed().calls.append("ping")

    def get_version(self):
        return self._ed().version

    def get_api_version(self):
        return "10.0.6-0-gtest"

    def get_open_documents(self, doc_type):
        e = self._ed()
        e.calls.append("get_open_documents")
        if e.board is None:
            raise ApiError("no handler available for request of type GetOpenDocuments")
        p = Path(e.board)
        doc = types.SimpleNamespace(board_filename=p.name, project=types.SimpleNamespace(path=str(p.parent)), editor=e)
        if e.swap_board_after is not None and e.calls.count("get_open_documents") > e.swap_board_after:
            e.board = "/tmp/someone/else.kicad_pcb"
        return [doc]


class BoardStub:
    def __init__(self, client, doc):
        self.e = doc.editor

    def _log(self, name):
        assert name not in FORBIDDEN, f"the module called forbidden {name}"
        self.e.calls.append(name)

    def get_footprints(self):
        self._log("get_footprints")
        if self.e.boom:
            raise RuntimeError(self.e.boom)
        return list(self.e.fps)

    def get_tracks(self):
        self._log("get_tracks")
        return list(self.e.tracks)

    def get_vias(self):
        self._log("get_vias")
        return list(self.e.vias)

    def get_pads(self):
        self._log("get_pads")
        return list(self.e.pads)

    def get_zones(self):
        self._log("get_zones")
        return [Zone() for _ in range(self.e.zones)]

    def get_nets(self):
        self._log("get_nets")
        return [Net(n) for n in self.e.nets]

    def get_selection(self):
        self._log("get_selection")
        return list(self.e.selection)

    def begin_commit(self):
        self._log("begin_commit")
        self.e.pending = {}
        return "commit"

    def update_items(self, fp):
        self._log("update_items")
        if self.e.fail_update:
            raise ApiError("item not allowed to be modified")
        self.e.pending[id(fp)] = (fp.position.x, fp.position.y, fp.orientation.degrees)

    def push_commit(self, commit, message=""):
        self._log("push_commit")
        self.e.commits.append(message)
        self.e.pending = None

    def drop_commit(self, commit):
        self._log("drop_commit")
        self.e.drops += 1
        self.e.pending = None


def install_stub():
    names = ["kipy", "kipy.board", "kipy.errors", "kipy.geometry", "kipy.proto", "kipy.proto.common", "kipy.proto.common.types", "kipy.proto.board", "kipy.proto.board.board_types_pb2"]
    mods = {n: types.ModuleType(n) for n in names}
    mods["kipy"].KiCad = KiCadStub
    mods["kipy.board"].Board = BoardStub
    mods["kipy.errors"].ApiError, mods["kipy.errors"].ConnectionError = ApiError, KiConnectionError
    mods["kipy.geometry"].Vector2, mods["kipy.geometry"].Angle = Vec, Ang
    mods["kipy.proto.common.types"].DocumentType = types.SimpleNamespace(DOCTYPE_PCB=1)
    mods["kipy.proto.board.board_types_pb2"].BoardLayer = types.SimpleNamespace(BL_F_Cu=F_CU, BL_B_Cu=B_CU)
    sys.modules.update(mods)
    return mods


import kicad_live as kl  # noqa: E402


class LiveTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="kicad-live-test-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, True))
        saved_modules, saved_env = dict(sys.modules), dict(os.environ)
        mods = install_stub()
        self.addCleanup(lambda: [sys.modules.pop(n, None) for n in mods] or sys.modules.update({k: v for k, v in saved_modules.items() if k in mods}))
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(saved_env)))
        EDITORS.clear()
        CONNECTS.clear()
        kl._clients.clear()
        kl._cooldown.clear()
        self.sockdir = self.tmp / "kicad"
        self.sockdir.mkdir()
        kl.SOCKET_DIR = self.sockdir
        os.environ.pop("KICAD_API_SOCKET", None)
        self.prefs = self.tmp / "prefs"
        (self.prefs / "10.0").mkdir(parents=True)
        os.environ["KICAD_PLUGIN_PREFS_DIR"] = str(self.prefs)
        self.pcb = str(self.tmp / "ws" / "kicad" / "edit" / "demo" / "demo.kicad_pcb")
        Path(self.pcb).parent.mkdir(parents=True)

    def pref(self, enabled):
        (self.prefs / "10.0" / "kicad_common.json").write_text(json.dumps({"api": {"enable_server": enabled}}))

    def socket(self, name="api.sock", editor="stale"):
        p = self.sockdir / name
        p.write_text("")  # a regular file stands in for the socket: only its existence matters to the stub
        EDITORS[f"ipc://{p}"] = None if editor == "stale" else editor
        return f"ipc://{p}"

    def editor(self, board=None, **kw):
        fps = kw.pop("fps", [FootprintInstance("R10", 25, 5.5, value="1k", lib="R:R_0603"), FootprintInstance("R2", 26.5, 10, 90, B_CU), FootprintInstance("U1", 17, 11)])
        return Editor(self.pcb if board is None else board, fps, **kw)

    # ------------------------------------------------------------------------------------------------------------------ discovery
    def test_socket_discovery_order_and_env_override(self):
        for name in ("api-4242.sock", "api.sock", "api-17.sock", "api.lock", "notes.txt", "api-x.sock"):
            (self.sockdir / name).write_text("")
        self.assertEqual([os.path.basename(p) for p in kl.socket_paths()], ["api.sock", "api-17.sock", "api-4242.sock"])
        os.environ["KICAD_API_SOCKET"] = f"ipc://{self.sockdir}/api-17.sock"
        self.assertEqual(kl.socket_paths(), [f"ipc://{self.sockdir}/api-17.sock"])
        os.environ["KICAD_API_SOCKET"] = f"{self.sockdir}/api-4242.sock"  # without the scheme
        self.assertEqual(kl.socket_paths(), [f"ipc://{self.sockdir}/api-4242.sock"])
        os.environ["KICAD_API_SOCKET"] = f"ipc://{self.sockdir}/nothing-here.sock"
        self.assertEqual(kl.socket_paths(), [], "an override that points nowhere means: no editor")

    # ------------------------------------------------------------------------------------------------------------------ status reasons
    def test_no_sockets_names_the_setting(self):
        for enabled, needle in ((False, "API is off"), (True, "no KiCad editor is running"), (None, "No KiCad editor answers")):
            with self.subTest(enabled=enabled):
                if enabled is None:
                    (self.prefs / "10.0" / "kicad_common.json").unlink(missing_ok=True)
                else:
                    self.pref(enabled)
                st = kl.status(self.pcb)
                self.assertEqual((st["ok"], st["available"], st["reachable"]), (True, False, False))
                self.assertIn(needle, st["reason"])
                self.assertIn("Enable KiCad API", st["reason"] if enabled is not True else json.dumps(st))
                self.assertEqual(st["setting"], "Enable KiCad API")

    def test_kipy_missing(self):
        sys.modules["kipy"] = None  # import kipy -> ImportError
        st = kl.status(self.pcb)
        self.assertFalse(st["available"])
        self.assertFalse(st["kipy"])
        self.assertIn("file round trip", st["reason"])
        self.assertFalse(kl.snapshot(self.pcb, (50, 50))["live"])
        r = kl.move_footprint(self.pcb, "R2", 1, 1, (50, 50))
        self.assertEqual((r["ok"], r.get("nothing_changed")), (False, True))

    def test_stale_socket(self):
        self.socket()
        st = kl.status(self.pcb)
        self.assertIn("left an API socket behind", st["reason"])
        self.assertFalse(st["reachable"])

    def test_timeout_leaves_the_socket_alone_for_a_few_seconds(self):
        sock = self.socket("api.sock", KiConnectionError("Error receiving reply from KiCad: Timed out"))
        self.assertIn("did not answer in time", kl.status(self.pcb)["reason"])
        n = len(CONNECTS)
        kl.status(self.pcb)
        self.assertEqual(len(CONNECTS), n, "after a timeout the socket is left alone for a few seconds, so polling cannot pile up")
        kl._cooldown[sock] = 0
        kl.status(self.pcb)
        self.assertGreater(len(CONNECTS), n)

    def test_editor_without_a_board(self):
        ed = self.editor()
        ed.board = None
        self.socket(editor=ed)
        st = kl.status(self.pcb)
        self.assertTrue(st["reachable"])
        self.assertFalse(st["available"])
        self.assertIn("no PCB Editor has a board open", st["reason"])

    def test_matching_board_even_through_symlinks_and_relative_forms(self):
        link = self.tmp / "link"
        link.symlink_to(self.tmp / "ws")
        ed = self.editor(board=str(link / "kicad" / "edit" / "demo" / "demo.kicad_pcb"))
        self.socket(editor=ed)
        st = kl.status(self.pcb, self.tmp / "ws")
        self.assertTrue(st["available"])
        self.assertTrue(st["board"]["matches_session"])
        self.assertEqual(st["board"]["path"], os.path.join("kicad", "edit", "demo", "demo.kicad_pcb"), "shown relative to the workspace")
        self.assertEqual((st["kicad_version"], st["api_version"]), ("10.0.6", "10.0.6-0-gtest"))

    def test_other_board_is_said_so_and_not_offered(self):
        ed = self.editor(board="/tmp/someone/else.kicad_pcb")
        self.socket(editor=ed)
        st = kl.status(self.pcb)
        self.assertTrue(st["reachable"])
        self.assertFalse(st["available"])
        self.assertIs(st["board"]["matches_session"], False)
        self.assertIn("is not this session's board", st["reason"])
        snap = kl.snapshot(self.pcb, (50, 50))
        self.assertFalse(snap["live"])
        self.assertNotIn("parts", snap)
        self.assertNotIn("get_footprints", ed.calls, "the other board is not even read")

    def test_no_session_yet(self):
        self.socket(editor=self.editor())
        st = kl.status(None)
        self.assertFalse(st["available"])
        self.assertIsNone(st["board"]["matches_session"])
        self.assertIn("no KiCad edit session", st["reason"])

    def test_two_editors_the_one_with_the_session_board_wins(self):
        other = self.editor(board="/tmp/other/board.kicad_pcb")
        mine = self.editor()
        self.socket("api.sock", other)
        self.socket("api-77.sock", mine)
        st = kl.status(self.pcb)
        self.assertTrue(st["available"])
        self.assertEqual(st["editors"], 2)
        self.assertEqual(sorted(st["boards_open"]), ["board.kicad_pcb", "demo.kicad_pcb"])
        kl.snapshot(self.pcb, (50, 50))
        self.assertIn("get_footprints", mine.calls)
        self.assertNotIn("get_footprints", other.calls)

    # ------------------------------------------------------------------------------------------------------------------ snapshot
    def test_snapshot_contents_frame_and_signature(self):
        ed = self.editor(tracks=[Track("GND"), Track("GND"), Track("VCC")], vias=[Via("GND")], pads=[Pad("GND", "1"), Pad("VCC", "8"), Pad("", "3")], zones=2, nets=["", "VCC", "GND"],
                         selection=[FootprintInstance("R2", 26.5, 10), Track("GND"), Pad("VCC", "8"), Zone("GND")])
        self.socket(editor=ed)
        s = kl.snapshot(self.pcb, (50.0, 50.0))
        self.assertTrue(s["live"])
        self.assertEqual([p["ref"] for p in s["parts"]], ["R2", "R10", "U1"], "natural order")
        r2 = s["parts"][0]
        self.assertEqual((r2["x_mm"], r2["y_mm"], r2["rotation_deg"], r2["side"]), (26.5, 10.0, 90.0, "bottom"))
        self.assertEqual(s["parts"][1]["footprint"], "R:R_0603")
        self.assertEqual(s["counts"], {"footprints": 3, "tracks": 3, "vias": 1, "zones": 2, "pads": 3, "nets": 2})
        self.assertEqual(s["nets"], [{"name": "GND", "pads": 1, "tracks": 2, "vias": 1}, {"name": "VCC", "pads": 1, "tracks": 1, "vias": 0}])
        self.assertEqual(s["selection"], [{"kind": "footprint", "ref": "R2"}, {"kind": "track", "net": "GND"}, {"kind": "pad", "net": "VCC", "pad": "8"}, {"kind": "zone", "net": "GND"}])
        self.assertIn("minus 50, 50", s["frame"])
        again = kl.snapshot(self.pcb, (50.0, 50.0), since=s["signature"])
        self.assertTrue(again["unchanged"])
        self.assertNotIn("parts", again)
        ed.fps[0].position = Vec(76_000_000, 55_500_000)
        changed = kl.snapshot(self.pcb, (50.0, 50.0), since=s["signature"])
        self.assertNotIn("unchanged", changed)
        self.assertNotEqual(changed["signature"], s["signature"])

    def test_snapshot_truncates(self):
        kl.MAX_PARTS = 2
        self.addCleanup(setattr, kl, "MAX_PARTS", 300)
        self.socket(editor=self.editor())
        s = kl.snapshot(self.pcb, (50, 50))
        self.assertEqual((len(s["parts"]), s["parts_truncated"], s["counts"]["footprints"]), (2, True, 3))

    def test_a_failing_read_is_reported_not_raised(self):
        ed = self.editor()
        ed.boom = f"boom while reading ipc://{self.sockdir}/api.sock with token=xyz"
        self.socket(editor=ed)
        s = kl.snapshot(self.pcb, (50, 50))
        self.assertEqual((s["ok"], s["live"]), (True, False))
        self.assertIn("Reading the live board failed: boom while reading", s["reason"])
        self.assertNotIn("api.sock", s["reason"])
        self.assertNotIn("xyz", s["reason"])

    # ------------------------------------------------------------------------------------------------------------------ the one write
    def test_move_is_one_commit_read_back_and_nothing_saved(self):
        ed = self.editor()
        self.socket(editor=ed)
        r = kl.move_footprint(self.pcb, " R10 ", 30.25, 6, (50.0, 50.0), rotation_deg=270, outline_mm=(34, 22))
        self.assertTrue(r["ok"])
        self.assertIs(r["saved"], False)
        self.assertEqual(r["before"], {"x_mm": 25.0, "y_mm": 5.5, "rotation_deg": 0.0})
        self.assertEqual(r["after_read_back"], {"x_mm": 30.25, "y_mm": 6.0, "rotation_deg": 270.0})
        self.assertTrue(r["read_back_matches_request"])
        self.assertIn("NOTHING WAS SAVED", r["note"])
        self.assertNotIn("warning", r)
        self.assertEqual(ed.commits, ["ZCode: move R10"])
        self.assertEqual(ed.calls.count("begin_commit"), 1)
        self.assertEqual(ed.drops, 0)

    def test_move_keeps_the_rotation_when_none_given_and_warns_outside_the_outline(self):
        ed = self.editor()
        self.socket(editor=ed)
        r = kl.move_footprint(self.pcb, "R2", 40, 10, (50.0, 50.0), outline_mm=(34, 22))
        self.assertEqual(r["after_read_back"]["rotation_deg"], 90.0)
        self.assertIn("outside the board outline", r["warning"])

    def test_move_refusals_change_nothing(self):
        ed = self.editor()
        self.socket(editor=ed)
        cases = [("no session", dict(session=None)), ("another board", dict(session="/tmp/another/x.kicad_pcb"))]
        for label, c in cases:
            with self.subTest(label):
                r = kl.move_footprint(c["session"], "R10", 1, 1, (50, 50))
                self.assertEqual((r["ok"], r["refused"], r["nothing_changed"]), (False, True, True))
        for label, args in (("unknown ref", ("R99", 1, 1)), ("empty ref", ("  ", 1, 1)), ("nan", ("R10", float("nan"), 1)), ("inf", ("R10", 1, float("inf"))), ("huge", ("R10", 1e6, 1)),
                            ("bool", ("R10", True, 1)), ("string", ("R10", "5", 1))):
            with self.subTest(label):
                r = kl.move_footprint(self.pcb, *args, (50, 50))
                self.assertFalse(r["ok"])
        r = kl.move_footprint(self.pcb, "R10", 1, 1, (50, 50), rotation_deg=float("nan"))
        self.assertFalse(r["ok"])
        self.assertEqual((ed.commits, ed.calls.count("begin_commit")), ([], 0), "no commit was even opened")

    def test_a_locked_footprint_is_not_moved(self):
        locked = FootprintInstance("R1", 1, 1)
        locked.locked = True                       # the user's "do not move" marker in KiCad
        ed = self.editor(fps=[locked, FootprintInstance("R2", 2, 2)])
        self.socket(editor=ed)
        r = kl.move_footprint(self.pcb, "R1", 5, 5, (50, 50))
        self.assertEqual((r["ok"], r["refused"], r["nothing_changed"]), (False, True, True))
        self.assertIn("locked", r["error"])
        self.assertEqual((ed.commits, ed.calls.count("begin_commit")), ([], 0), "no commit was even opened")
        self.assertTrue(kl.move_footprint(self.pcb, "R2", 5, 5, (50, 50))["ok"], "other footprints still move")

    def test_ambiguous_reference_is_refused(self):
        ed = self.editor(fps=[FootprintInstance("R1", 1, 1), FootprintInstance("R1", 2, 2)])
        self.socket(editor=ed)
        r = kl.move_footprint(self.pcb, "R1", 5, 5, (50, 50))
        self.assertFalse(r["ok"])
        self.assertIn("found 2", r["error"])
        self.assertEqual(ed.calls.count("begin_commit"), 0)

    def test_failed_update_drops_the_commit(self):
        ed = self.editor()
        ed.fail_update = True
        self.socket(editor=ed)
        r = kl.move_footprint(self.pcb, "R10", 1, 1, (50, 50))
        self.assertFalse(r["ok"])
        self.assertEqual((ed.drops, ed.commits, ed.pending), (1, [], None), "an abandoned commit is dropped so the editor is not left in a half-open transaction")

    def test_board_swapped_between_the_checks_is_refused_before_any_write(self):
        ed = self.editor()
        ed.swap_board_after = 0  # the very first get_open_documents answers truthfully, every later one names another board
        self.socket(editor=ed)
        first = kl.status(self.pcb)
        self.assertTrue(first["available"])
        r = kl.move_footprint(self.pcb, "R10", 1, 1, (50, 50))
        self.assertEqual((r["ok"], r.get("refused")), (False, True))
        self.assertEqual(ed.calls.count("begin_commit"), 0)

    # ------------------------------------------------------------------------------------------------------------------ what leaves the module
    def test_results_never_contain_the_socket_path_or_a_token(self):
        self.pref(True)
        secret = self.socket("api.sock", KiConnectionError(f"Failed to connect to KiCad: ipc://{self.sockdir}/api.sock token abc123"))
        outs = [kl.status(self.pcb), kl.snapshot(self.pcb, (50, 50)), kl.move_footprint(self.pcb, "R10", 1, 1, (50, 50))]
        ed = self.editor()
        ed.boom = f"read failed on ipc://{self.sockdir}/api-3.sock (token abc123)"
        EDITORS[secret] = ed  # the same socket now answers, but reading blows up with the path in the message
        outs += [kl.status(self.pcb), kl.snapshot(self.pcb, (50, 50)), kl.move_footprint(self.pcb, "R10", 2, 2, (50, 50))]
        self.assertIn("Reading the live board failed", outs[-2]["reason"])
        self.assertFalse(outs[-1]["ok"])
        text = json.dumps(outs)
        for needle in (secret, str(self.sockdir), ".sock", "ipc://", "abc123", "token"):
            self.assertNotIn(needle, text.replace("Enable KiCad API", ""))
        self.assertFalse(re.search(r"api-\d+", text))

    def test_the_module_only_ever_calls_read_methods_and_the_commit_trio(self):
        ed = self.editor(tracks=[Track("GND")], pads=[Pad("GND")], nets=["GND"], selection=[FootprintInstance("R10", 25, 5.5)])
        self.socket(editor=ed)
        self.assertTrue(kl.status(self.pcb)["available"])
        self.assertTrue(kl.snapshot(self.pcb, (50, 50))["live"])
        self.assertTrue(kl.move_footprint(self.pcb, "R10", 1, 2, (50, 50))["ok"])
        used = set(ed.calls)
        self.assertEqual(used - {"ping", "get_open_documents", "get_footprints", "get_tracks", "get_vias", "get_pads", "get_zones", "get_nets", "get_selection", "begin_commit", "update_items", "push_commit"}, set())
        source = (HERE.parent / "server" / "kicad_live.py").read_text()
        for name in FORBIDDEN:
            self.assertFalse(re.search(rf"\.{name}\(", source), f"kicad_live.py must never call .{name}(")


if __name__ == "__main__":
    unittest.main(verbosity=2)
