"""Live link between this plugin and the KiCad PCB Editor that is already running, through KiCad 10's IPC API (python package `kicad-python`, imported as `kipy`).

What it does: tells whether a KiCad editor answers, which board it has open and whether that is the board of the plugin's edit session; reads the live board (parts, nets,
selection) while the user edits, without Cmd+S; and, on request of an agent, moves ONE footprint as an undoable KiCad commit. What it never does: save, revert, close,
delete, touch the selection, start or stop KiCad, or write to a board that is not the edit session's board.

Security (see README): the API is a local Unix socket, /tmp/kicad/api.sock (and api-<pid>.sock for further editors) on macOS; any process of the same user can connect and
KiCad asks for no token. So this module keeps the socket path and the KiCad-assigned token to itself: nothing here returns either (errors are scrubbed), the panel page and
the agent only see board facts.

The module never raises to its callers: every public function returns a plain dict with `ok`, and a short `reason`/`error` for humans. KiCad's own timeout (1.5 s) bounds a
hung editor; after a timeout the socket is left alone for a few seconds so polling cannot pile up.
"""
from __future__ import annotations

import glob
import hashlib
import json
import math
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

SETTING = "Enable KiCad API"
SOCKET_DIR = Path("/tmp/kicad")  # KiCad hard-codes /tmp on macOS (common/api/api_server.cpp); other platforms use the temp directory
CLIENT_NAME = "zcode-kicad-plugin"
TIMEOUT_MS = 1500
COOLDOWN_S = 5.0
MAX_PARTS = 300
MAX_SELECTED = 50
_lock = threading.RLock()  # one request at a time per process: an nng request socket cannot have two outstanding requests
_clients: dict[str, Any] = {}
_cooldown: dict[str, float] = {}


# ---------------------------------------------------------------------------------------------------------------------------------- helpers
def _kipy():
    try:
        import kipy  # noqa: F401
        import kipy.board
        import kipy.errors
        import kipy.geometry
        return kipy
    except Exception:  # noqa: BLE001 - not installed, or an incompatible build
        return None


def _scrub(text: object) -> str:
    """Error text without socket paths or tokens, short enough for a message."""
    return re.sub(r"(ipc://\S+|/tmp/kicad\S*|[Tt]oken\s*[=:]?\s*\S*)", "<KiCad socket>", " ".join(str(text).split()))[:200]


def socket_paths() -> list[str]:
    """Where KiCad editors may listen: KICAD_API_SOCKET if set (kipy's own override, used by tests), else api.sock first and api-<pid>.sock after it."""
    env = os.environ.get("KICAD_API_SOCKET")
    if env:
        path = env.split("://", 1)[-1]
        return [f"ipc://{path}"] if os.path.exists(path) else []
    d = str(SOCKET_DIR)
    found = [p for p in glob.glob(os.path.join(d, "api*.sock")) if os.path.basename(p) == "api.sock" or re.fullmatch(r"api-\d+\.sock", os.path.basename(p))]
    found.sort(key=lambda p: (os.path.basename(p) != "api.sock", p))
    return [f"ipc://{p}" for p in found]


def preferences_enable_api() -> bool | None:
    """The user's own "Enable KiCad API" preference (read only; None when it cannot be told)."""
    try:
        import pwd

        home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    except Exception:  # noqa: BLE001
        home = Path.home()
    base = Path(os.environ.get("KICAD_PLUGIN_PREFS_DIR") or home / "Library" / "Preferences" / "kicad")
    try:
        versions = sorted((p for p in base.iterdir() if (p / "kicad_common.json").is_file()), key=lambda p: [int(x) if x.isdigit() else 0 for x in re.split(r"\D+", p.name)])
        if not versions:
            return None
        return bool(json.loads((versions[-1] / "kicad_common.json").read_text()).get("api", {}).get("enable_server"))
    except Exception:  # noqa: BLE001
        return None


def _same_file(a: str | os.PathLike | None, b: str | os.PathLike | None) -> bool:
    return bool(a and b) and os.path.realpath(a) == os.path.realpath(b)


def _display(path: str, workspace: Path | None) -> str:
    try:
        if workspace and os.path.realpath(path).startswith(os.path.realpath(workspace) + os.sep):
            return os.path.relpath(os.path.realpath(path), os.path.realpath(workspace))
    except OSError:
        pass
    home = str(Path.home())
    return "~" + path[len(home):] if path.startswith(home + os.sep) else path


def _client(kipy, sock: str):
    k = _clients.get(sock)
    if k is None:
        k = kipy.KiCad(socket_path=sock, client_name=CLIENT_NAME, timeout_ms=TIMEOUT_MS)
        _clients[sock] = k
    return k


def _drop(sock: str, cool: bool = False) -> None:
    _clients.pop(sock, None)
    if cool:
        _cooldown[sock] = time.monotonic() + COOLDOWN_S


def _editors(kipy) -> tuple[list[dict], int, int]:
    """(editors that answered, stale sockets, sockets in cool-down). Each editor: {sock, k, version, api_version, boards: [(path, doc)]}."""
    from kipy.errors import ApiError, ConnectionError as KiConnectionError
    from kipy.proto.common.types import DocumentType

    out, stale, cooling = [], 0, 0
    for sock in socket_paths():
        if _cooldown.get(sock, 0) > time.monotonic():
            cooling += 1
            continue
        try:
            k = _client(kipy, sock)
            k.ping()
            docs = []
            try:
                docs = list(k.get_open_documents(DocumentType.DOCTYPE_PCB))
            except ApiError:  # an editor that serves no boards (schematic editor, project manager)
                docs = []
            out.append({"sock": sock, "k": k, "version": str(k.get_version()), "api_version": str(k.get_api_version()),
                        "boards": [(str(Path(d.project.path) / d.board_filename) if d.project.path else d.board_filename, d) for d in docs]})
        except KiConnectionError as e:
            timed_out = "imed out" in str(e) or "Timed out" in str(e)
            _drop(sock, cool=timed_out)
            if timed_out:
                cooling += 1
            else:
                stale += 1
        except Exception:  # noqa: BLE001
            _drop(sock)
            stale += 1
    return out, stale, cooling


def _pick(editors: list[dict], session_pcb: str | None) -> tuple[dict | None, tuple | None]:
    """(editor, (path, doc)) holding the session's board, else the first board any editor has open, else (None, None)."""
    first = None
    for e in editors:
        for b in e["boards"]:
            if _same_file(b[0], session_pcb):
                return e, b
            first = first or (e, b)
    return first if first else (None, None)


def _board(editor: dict, doc_entry: tuple):
    """A kipy Board for exactly that document (get_board() would take the first one)."""
    from kipy.board import Board

    return Board(editor["k"]._client, doc_entry[1])


# ---------------------------------------------------------------------------------------------------------------------------------- status
def _status_for(editors: list[dict], stale: int, cooling: int, session_pcb: str | None, workspace: Path | None) -> tuple[dict, dict | None, tuple | None]:
    """(status dict, editor, (path, doc) of the live board) from one probe round of the sockets; the dict never carries a socket path or token."""
    base: dict[str, Any] = {"ok": True, "setting": SETTING, "available": False, "reachable": False, "kipy": True, "session_board": _display(session_pcb, workspace) if session_pcb else None}
    pref = preferences_enable_api()
    base["api_enabled_in_preferences"] = pref
    if not editors:
        if cooling:
            reason = "KiCad did not answer in time (it may be busy or showing a dialog); trying again in a few seconds."
        elif stale:
            reason = "KiCad left an API socket behind but no editor answers on it (KiCad was closed or crashed). Open the board in the PCB Editor again."
        elif pref is False:
            reason = f'The KiCad API is off. In KiCad open Preferences and tick "{SETTING}"; an editor that is already running picks the setting up, then open the board in the PCB Editor.'
        elif pref is True:
            reason = "The API is enabled but no KiCad editor is running (or none has opened a board yet). Open the board in the PCB Editor."
        else:
            reason = f'No KiCad editor answers on the API. If it is off, tick "{SETTING}" in KiCad Preferences, then open the board in the PCB Editor.'
        return {**base, "reason": reason}, None, None
    ed, entry = _pick(editors, session_pcb)
    base.update(reachable=True, kicad_version=editors[0]["version"], api_version=editors[0]["api_version"], editors=len(editors), boards_open=[Path(b[0]).name for e in editors for b in e["boards"]])
    if entry is None:
        return {**base, "reason": "KiCad answers on the API, but no PCB Editor has a board open (a schematic editor or the project manager alone serves no boards)."}, None, None
    matches = _same_file(entry[0], session_pcb) if session_pcb else None
    board = {"name": Path(entry[0]).name, "path": _display(entry[0], workspace), "matches_session": matches}
    res = {**base, "available": True, "board": board}
    if matches is False:
        res.update(available=False, reason=f"KiCad has {board['name']} open ({board['path']}), which is not this session's board ({base['session_board']}). The live view is off for it.")
    elif matches is None:
        res.update(available=False, reason="There is no KiCad edit session yet: press Open in KiCad (or ask the agent to call kicad_open_in_kicad) so the live board can be tied to it.")
    return res, ed, entry


def status(session_pcb: str | None = None, workspace: Path | None = None) -> dict:
    """Is the API reachable, which board is open in the live editor, is it the session's board? Never raises, never returns a socket path or token."""
    try:
        kipy = _kipy()
        if kipy is None:
            return {"ok": True, "setting": SETTING, "available": False, "reachable": False, "kipy": False, "session_board": _display(session_pcb, workspace) if session_pcb else None,
                    "reason": "The Python package kicad-python (the KiCad API client) is not available to this plugin, so the live link is off. The file round trip (⌘S in KiCad) works as before."}
        with _lock:
            editors, stale, cooling = _editors(kipy)
        return _status_for(editors, stale, cooling, session_pcb, workspace)[0]
    except Exception as e:  # noqa: BLE001
        return {"ok": True, "setting": SETTING, "available": False, "reachable": False, "reason": f"The live link failed: {_scrub(e)}"}


# ---------------------------------------------------------------------------------------------------------------------------------- reading
def _fp_row(fp, origin: tuple[float, float]) -> dict:
    lib = str(fp.definition.id).lstrip(":")  # "Library:Name"
    from kipy.proto.board.board_types_pb2 import BoardLayer

    return {"ref": fp.reference_field.text.value, "value": fp.value_field.text.value, "footprint": lib,
            "x_mm": round(fp.position.x / 1e6 - origin[0], 3), "y_mm": round(fp.position.y / 1e6 - origin[1], 3),
            "rotation_deg": round(fp.orientation.degrees % 360, 2), "side": "bottom" if fp.layer == BoardLayer.BL_B_Cu else "top", "locked": bool(getattr(fp, "locked", False))}


def _selection_row(item) -> dict:
    kind = type(item).__name__
    row: dict[str, Any] = {"kind": {"FootprintInstance": "footprint", "Track": "track", "ArcTrack": "arc track", "Via": "via", "Pad": "pad", "Zone": "zone"}.get(kind, kind)}
    try:
        if kind == "FootprintInstance":
            row["ref"] = item.reference_field.text.value
        elif hasattr(item, "net") and item.net is not None:
            row["net"] = item.net.name
        if kind == "Pad":
            row["pad"] = item.number
    except Exception:  # noqa: BLE001
        pass
    return row


def snapshot(session_pcb: str | None, origin_mm: tuple[float, float], workspace: Path | None = None, since: str = "") -> dict:
    """The live board for the Live tab: parts, nets, selection, counts, a signature. Positions are in the plugin's spec frame (mm, top-left origin = file coordinates minus
    origin_mm). `since` = a previous signature: unchanged boards answer with just that fact. Only when the live board IS the session's board."""
    try:
        kipy = _kipy()
        if kipy is None:
            st = status(session_pcb, workspace)
            return {"ok": True, "live": False, "reason": st["reason"], "setting": SETTING}
        with _lock:
            editors, stale, cooling = _editors(kipy)
            st, ed, entry = _status_for(editors, stale, cooling, session_pcb, workspace)
            if not st.get("available"):
                return {"ok": True, "live": False, **{k: st[k] for k in ("reason", "reachable", "board", "setting", "session_board", "kicad_version") if k in st}}
            b = _board(ed, entry)
            fps = list(b.get_footprints())
            tracks, vias, zones, pads = list(b.get_tracks()), list(b.get_vias()), list(b.get_zones()), list(b.get_pads())
            nets = [n.name for n in b.get_nets()]
            sel = [_selection_row(i) for i in b.get_selection()]
        rows = sorted((_fp_row(f, origin_mm) for f in fps), key=lambda r: [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", r["ref"])])
        per: dict[str, dict[str, int]] = {}
        for kind, items in (("pads", pads), ("tracks", tracks), ("vias", vias)):
            for it in items:
                name = it.net.name if getattr(it, "net", None) is not None else ""
                if name:
                    per.setdefault(name, {"pads": 0, "tracks": 0, "vias": 0})[kind] += 1
        net_rows = [{"name": n, **per.get(n, {"pads": 0, "tracks": 0, "vias": 0})} for n in sorted(nets) if n]
        sig = hashlib.sha1(json.dumps([rows, net_rows, sel, len(zones)], sort_keys=True).encode()).hexdigest()[:16]
        out = {"ok": True, "live": True, "signature": sig, "board": st["board"], "kicad_version": st.get("kicad_version"), "frame": f"mm from the board's top-left corner (file coordinates minus {origin_mm[0]:g}, {origin_mm[1]:g})",
               "counts": {"footprints": len(rows), "tracks": len(tracks), "vias": len(vias), "zones": len(zones), "pads": len(pads), "nets": len(net_rows)}, "selection_count": len(sel)}
        if since and since == sig:
            return {**out, "unchanged": True}
        return {**out, "parts": rows[:MAX_PARTS], "parts_truncated": len(rows) > MAX_PARTS, "nets": net_rows[:MAX_PARTS], "selection": sel[:MAX_SELECTED], "read_at": time.strftime("%H:%M:%S")}
    except Exception as e:  # noqa: BLE001
        with _lock:
            for s in socket_paths():
                _drop(s, cool="imed out" in str(e))
        return {"ok": True, "live": False, "reason": f"Reading the live board failed: {_scrub(e)}", "setting": SETTING}


# ---------------------------------------------------------------------------------------------------------------------------------- writing
def move_footprint(session_pcb: str | None, ref: str, x_mm: float, y_mm: float, origin_mm: tuple[float, float], rotation_deg: float | None = None, workspace: Path | None = None,
                   outline_mm: tuple[float, float] | None = None) -> dict:
    """Move ONE footprint of the live board as one undoable KiCad commit. Refuses unless the live editor has exactly the session's board open. Nothing is saved: the user
    presses Cmd+S, then the plugin imports the save. Positions are in the plugin's spec frame (see snapshot)."""
    try:
        for name, v in (("x_mm", x_mm), ("y_mm", y_mm)) + ((("rotation_deg", rotation_deg),) if rotation_deg is not None else ()):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or abs(v) > 2000:
                return {"ok": False, "error": f"{name} must be a finite number of millimetres/degrees within ±2000, got {v!r}"}
        if not isinstance(ref, str) or not ref.strip():
            return {"ok": False, "error": "ref must be a reference designator such as 'R3'"}
        kipy = _kipy()
        if kipy is None:
            return {"ok": False, "error": status(session_pcb, workspace)["reason"], "refused": True, "nothing_changed": True}
        from kipy.geometry import Angle, Vector2

        with _lock:
            editors, stale, cooling = _editors(kipy)
            st, ed, entry = _status_for(editors, stale, cooling, session_pcb, workspace)  # the board is checked in the same locked round that writes: no window for a swap in between
            if not st.get("available"):
                return {"ok": False, "error": st.get("reason") or "KiCad is not reachable", "refused": True, "nothing_changed": True}
            b = _board(ed, entry)
            hits = [f for f in b.get_footprints() if f.reference_field.text.value == ref.strip()]
            if len(hits) != 1:
                return {"ok": False, "error": f"expected exactly one footprint '{ref}' on the live board, found {len(hits)}", "nothing_changed": True}
            fp = hits[0]
            before = _fp_row(fp, origin_mm)
            if before.get("locked"):
                return {"ok": False, "error": f"'{ref.strip()}' is locked in KiCad (the user marked it \"do not move\"): unlock it there first", "refused": True, "nothing_changed": True}
            commit = b.begin_commit()
            try:
                fp.position = Vector2.from_xy_mm(x_mm + origin_mm[0], y_mm + origin_mm[1])
                if rotation_deg is not None:
                    fp.orientation = Angle.from_degrees(rotation_deg)
                b.update_items(fp)
                b.push_commit(commit, f"ZCode: move {ref.strip()}")
            except Exception:
                try:
                    b.drop_commit(commit)
                except Exception:  # noqa: BLE001
                    pass
                raise
            after_fp = next((f for f in b.get_footprints() if f.reference_field.text.value == ref.strip()), None)
        after = _fp_row(after_fp, origin_mm) if after_fp is not None else None
        want_rot = before["rotation_deg"] if rotation_deg is None else round(rotation_deg % 360, 2)
        matches = bool(after) and abs(after["x_mm"] - x_mm) < 0.001 and abs(after["y_mm"] - y_mm) < 0.001 and abs((after["rotation_deg"] - want_rot + 180) % 360 - 180) < 0.01
        res = {"ok": True, "saved": False, "ref": ref.strip(), "board": st["board"], "before": {k: before[k] for k in ("x_mm", "y_mm", "rotation_deg")},
               "after_read_back": {k: after[k] for k in ("x_mm", "y_mm", "rotation_deg")} if after else None, "read_back_matches_request": matches,
               "frame": f"mm from the board's top-left corner (file coordinates minus {origin_mm[0]:g}, {origin_mm[1]:g})",
               "note": "NOTHING WAS SAVED. The move is one undo step in KiCad (Edit > Undo / ⌘Z). The user presses ⌘S in KiCad; the panel or kicad_sync_edits then imports the save and runs DRC."}
        if outline_mm and (not 0 <= x_mm <= outline_mm[0] or not 0 <= y_mm <= outline_mm[1]):
            res["warning"] = f"the new position is outside the board outline (0..{outline_mm[0]:g} x 0..{outline_mm[1]:g} mm)"
        return res
    except Exception as e:  # noqa: BLE001
        with _lock:
            for s in socket_paths():
                _drop(s, cool="imed out" in str(e))
        return {"ok": False, "error": f"the move failed ({_scrub(e)}); check the live board in KiCad before retrying", "nothing_changed": "unknown"}
