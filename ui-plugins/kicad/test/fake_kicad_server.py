"""A stand-in for the KiCad 10 PCB Editor's IPC API server, for tests only: speaks the REAL wire protocol (pynng request/reply sockets, the protobuf messages shipped in
kicad-python), serves one board model and logs every request it receives, so a test can assert what the plugin did and did not send. No KiCad, no GUI.

    uv run --python '>=3.11' --with 'kicad-python>=0.8,<0.9' python test/fake_kicad_server.py --socket /tmp/x/fake.sock --board /path/to/board.kicad_pcb --model model.json

Control, one JSON object per line on stdin (each answered by one JSON line on stdout):
    {"cmd": "ready"}                                  -> {"ready": true}
    {"cmd": "board", "path": "..."}                   the editor now has another board open
    {"cmd": "select", "refs": ["R3"]}                 what the "user" has selected
    {"cmd": "drag", "ref": "R3", "x_mm": 1, "y_mm": 2}    the "user" moves a footprint (file coordinates, mm)
    {"cmd": "state"}                                  -> footprints, commit counters, request counts by message type
    {"cmd": "quit"}
Model file: {"origin_mm": [50, 50], "footprints": [{"ref", "value", "lib", "x_mm", "y_mm", "rotation_deg", "layer"}], "nets": [...], "tracks": [net, ...], "vias": [net, ...],
"pads": [[net, number], ...], "zones": 2}  (coordinates in the spec frame; origin_mm is added to give file coordinates)
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
from collections import Counter
from pathlib import Path

import pynng
from google.protobuf import empty_pb2
from google.protobuf.any_pb2 import Any

from kipy.board_types import FootprintInstance, Pad, Track, Via, Zone
from kipy.geometry import Angle, Vector2
from kipy.proto.board import board_commands_pb2, board_types_pb2
from kipy.proto.common import ApiRequest, ApiResponse, ApiStatusCode
from kipy.proto.common.commands import base_commands_pb2, editor_commands_pb2
from kipy.proto.common.types import DocumentType, base_types_pb2
from kipy.proto.common.types import KiCadObjectType

LAYERS = {"F.Cu": board_types_pb2.BoardLayer.BL_F_Cu, "B.Cu": board_types_pb2.BoardLayer.BL_B_Cu}


class Fake:
    def __init__(self, board: str, model: dict):
        self.lock = threading.Lock()
        self.board = board
        self.origin = tuple(model.get("origin_mm", (50, 50)))
        self.model = model
        self.fps = []
        for i, f in enumerate(model["footprints"]):
            self.fps.append({"id": f"fp-{i}", "ref": f["ref"], "value": f.get("value", ""), "lib": f.get("lib", "Lib:Name"), "x_nm": round((f["x_mm"] + self.origin[0]) * 1e6),
                             "y_nm": round((f["y_mm"] + self.origin[1]) * 1e6), "rot": f.get("rotation_deg", 0.0), "layer": f.get("layer", "F.Cu")})
        self.selection: list[str] = []
        self.requests: Counter = Counter()
        self.pending: dict[str, dict] | None = None
        self.commits = 0
        self.drops = 0
        self.commit_messages: list[str] = []

    # ---- protobuf builders
    def fp_proto(self, f: dict) -> FootprintInstance:
        fp = FootprintInstance()
        fp.proto.id.value = f["id"]
        fp.position = Vector2.from_xy(f["x_nm"], f["y_nm"])
        fp.orientation = Angle.from_degrees(f["rot"])
        fp.layer = LAYERS[f["layer"]]
        fp.reference_field.text.value = f["ref"]
        fp.value_field.text.value = f["value"]
        lib, _, name = f["lib"].partition(":")
        fp.definition.id.library, fp.definition.id.name = lib, name
        return fp

    @staticmethod
    def net_proto(name: str):
        from kipy.board_types import Net as BoardNet

        n = BoardNet()
        n.name = name
        return n

    def items(self, kind: int) -> list:
        m = self.model
        if kind == KiCadObjectType.KOT_PCB_FOOTPRINT:
            return [self.fp_proto(f) for f in self.fps]
        if kind == KiCadObjectType.KOT_PCB_TRACE:
            out = []
            for net in m.get("tracks", []):
                t = Track()
                t.net = self.net_proto(net)
                out.append(t)
            return out
        if kind == KiCadObjectType.KOT_PCB_VIA:
            out = []
            for net in m.get("vias", []):
                v = Via()
                v.net = self.net_proto(net)
                out.append(v)
            return out
        if kind == KiCadObjectType.KOT_PCB_PAD:
            out = []
            for net, number in m.get("pads", []):
                p = Pad()
                p.net = self.net_proto(net)
                p.number = number
                out.append(p)
            return out
        if kind == KiCadObjectType.KOT_PCB_ZONE:
            return [Zone() for _ in range(m.get("zones", 0))]
        return []

    def doc(self) -> base_types_pb2.DocumentSpecifier:
        d = base_types_pb2.DocumentSpecifier()
        d.type = DocumentType.DOCTYPE_PCB
        p = Path(self.board)
        d.board_filename = p.name
        d.project.name = p.stem
        d.project.path = str(p.parent)
        return d

    # ---- request handling
    def handle(self, data: bytes) -> bytes:
        req = ApiRequest()
        req.ParseFromString(data)
        name = req.message.type_url.rsplit(".", 1)[-1]
        resp = ApiResponse()
        resp.header.kicad_token = "fake-token-not-a-secret"
        with self.lock:
            self.requests[name] += 1
            try:
                out = self.dispatch(name, req)
            except KeyError:
                resp.status.status = ApiStatusCode.AS_UNHANDLED
                resp.status.error_message = f"no handler available for request of type {req.message.type_url}"
                return resp.SerializeToString()
            except Exception as e:  # noqa: BLE001 - a bug in the fake must show up as an API error, not as a dead server
                resp.status.status = ApiStatusCode.AS_BAD_REQUEST
                resp.status.error_message = f"fake server error: {type(e).__name__}: {e}"
                return resp.SerializeToString()
        resp.status.status = ApiStatusCode.AS_OK
        resp.message.Pack(out)
        return resp.SerializeToString()

    def dispatch(self, name: str, req: ApiRequest):
        ed, base = editor_commands_pb2, base_commands_pb2
        if name == "Ping":
            return empty_pb2.Empty()
        if name == "GetVersion":
            r = base.GetVersionResponse()
            r.version.major, r.version.minor, r.version.patch, r.version.full_version = 10, 0, 6, "10.0.6 (fake)"
            return r
        if name == "GetOpenDocuments":
            r = ed.GetOpenDocumentsResponse()
            r.documents.append(self.doc())
            return r
        if name == "GetItems":
            cmd = ed.GetItems()
            req.message.Unpack(cmd)
            r = ed.GetItemsResponse()
            r.status = base_types_pb2.ItemRequestStatus.IRS_OK
            for t in cmd.types:
                for it in self.items(t):
                    a = Any()
                    a.Pack(it.proto)
                    r.items.append(a)
            return r
        if name == "GetNets":
            r = board_commands_pb2.NetsResponse()
            for n in self.model.get("nets", []):
                r.nets.append(self.net_proto(n).proto)
            return r
        if name == "GetSelection":
            r = ed.SelectionResponse()
            for f in self.fps:
                if f["ref"] in self.selection:
                    a = Any()
                    a.Pack(self.fp_proto(f).proto)
                    r.items.append(a)
            return r
        if name == "BeginCommit":
            self.pending = {}
            r = ed.BeginCommitResponse()
            r.id.value = "commit-1"
            return r
        if name == "UpdateItems":
            cmd = ed.UpdateItems()
            req.message.Unpack(cmd)
            r = ed.UpdateItemsResponse()
            r.status = base_types_pb2.ItemRequestStatus.IRS_OK
            for a in cmd.items:
                p = board_types_pb2.FootprintInstance()
                a.Unpack(p)
                f = next(x for x in self.fps if x["id"] == p.id.value)
                new = dict(f, x_nm=p.position.x_nm, y_nm=p.position.y_nm, rot=p.orientation.value_degrees)
                if self.pending is None:  # no commit open: applied at once, one undo step per change (KiCad's behaviour)
                    f.update(new)
                    self.commits += 1
                else:
                    self.pending[f["id"]] = new
                res = r.updated_items.add()
                res.status.code = ed.ItemStatusCode.ISC_OK
                res.item.CopyFrom(a)
            return r
        if name == "EndCommit":
            cmd = ed.EndCommit()
            req.message.Unpack(cmd)
            if cmd.action == ed.CommitAction.CMA_COMMIT and self.pending is not None:
                for fid, new in self.pending.items():
                    next(x for x in self.fps if x["id"] == fid).update(new)
                self.commits += 1
                self.commit_messages.append(cmd.message)
            else:
                self.drops += 1
            self.pending = None
            return ed.EndCommitResponse()
        raise KeyError(name)  # anything else (save, revert, run action, selection changes, ...) is unhandled and logged in self.requests


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--socket", required=True)
    ap.add_argument("--board", required=True)
    ap.add_argument("--model", required=True)
    a = ap.parse_args()
    fake = Fake(a.board, json.loads(Path(a.model).read_text()))
    sock = pynng.Rep0(listen=f"ipc://{a.socket}")

    def serve():
        while True:
            try:
                msg = sock.recv()
            except pynng.exceptions.Closed:
                return
            sock.send(fake.handle(msg))

    threading.Thread(target=serve, daemon=True).start()
    for line in sys.stdin:
        cmd = json.loads(line)
        out: dict = {"ok": True}
        with fake.lock:
            if cmd["cmd"] == "ready":
                out = {"ready": True}
            elif cmd["cmd"] == "board":
                fake.board = cmd["path"]
            elif cmd["cmd"] == "select":
                fake.selection = list(cmd["refs"])
            elif cmd["cmd"] == "drag":
                f = next(x for x in fake.fps if x["ref"] == cmd["ref"])
                f["x_nm"], f["y_nm"] = round(cmd["x_mm"] * 1e6), round(cmd["y_mm"] * 1e6)
            elif cmd["cmd"] == "state":
                out = {"footprints": {f["ref"]: [f["x_nm"] / 1e6, f["y_nm"] / 1e6, f["rot"]] for f in fake.fps}, "commits": fake.commits, "drops": fake.drops, "commit_messages": fake.commit_messages,
                       "requests": dict(fake.requests), "pending_open": fake.pending is not None}
            elif cmd["cmd"] == "quit":
                print(json.dumps({"ok": True}), flush=True)
                break
        print(json.dumps(out), flush=True)
    sock.close()


if __name__ == "__main__":
    main()
