"""ZCode KiCad plugin — MCP server (stdio) + interactive board panel (MCP App).

Runs from the installed plugin directory (dist/py), started by dist/server.mjs. It needs nothing outside it: the KiCad worker (placement, auto-router, DRC,
Gerber/BOM/CPL export) is the Python package `kicad` next to this file, and its configuration (kicad/config.py) never reads any .env file.

Locations
  workspace      ZCODE_WORKSPACE_ROOT   files the agent can see; `kicad_export_files` writes to ./kicad/out here
  plugin data    ZCODE_PLUGIN_DATA      per-workspace artifact store (specs, boards, renders, fab files) and KiCad's private config
  KiCad          ZCODE_KICAD_APP        default /Applications/KiCad/KiCad.app (kicad-cli, its bundled Python and the libraries are used from there)

Tools: the worker's pcb_* tools (project_id bound here), kicad_* helpers, kicad_board_view (opens the panel), pcb_export_glb / kicad_checks, the app-only tools behind the panel tabs
(layers, 3D views, schematic, library drawings: kicad-cli, see kicad_views.py), the KiCad GUI round trip and the live link to the running PCB Editor (kicad_live_*, see kicad_live.py). skills/kicad-board/SKILL.md is the
reference for agents, README.md for people.

Round trip: pcb_build -> kicad_open_in_kicad -> the user edits and saves (Cmd+S) in KiCad -> kicad_edit_status (the panel polls it) / kicad_sync_edits imports the save, so
the panel, the agent and pcb_export_fab all work on the edited board. Nothing the user saved is ever overwritten: pending saves are imported before a new export.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import shutil
import sys
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

WORKSPACE = Path(os.environ.get("ZCODE_WORKSPACE_ROOT") or os.getcwd()).resolve()
PLUGIN_DATA = Path(os.environ.get("ZCODE_PLUGIN_DATA") or (WORKSPACE / ".kicad-plugin")).resolve()
ROOT = PLUGIN_DATA / f"ws-{hashlib.sha1(str(WORKSPACE).encode()).hexdigest()[:10]}"
os.environ.setdefault("ZCODE_KICAD_DATA_DIR", str(PLUGIN_DATA / "kicad-env"))
# Every KiCad program rewrites the settings it loads, even `kicad-cli version` (it stores the current directory as the working directory in kicad_common.json). So all
# KiCad subprocesses of this server run on a private config and documents folder (the worker's own default, set early so no call can bypass it) and never touch the
# user's ~/Library/Preferences/kicad. The GUI is started through `open` and keeps the user's own settings.
for _var, _sub in (("KICAD_CONFIG_HOME", "kicad_config"), ("KICAD_DOCUMENTS_HOME", "kicad_docs")):
    os.environ[_var] = str(Path(os.environ["ZCODE_KICAD_DATA_DIR"]) / _sub)   # unconditionally: a KICAD_CONFIG_HOME the user exported for their own KiCad must not be rewritten by ours
    Path(os.environ[_var]).mkdir(parents=True, exist_ok=True)

from fastmcp import FastMCP  # noqa: E402
from fastmcp.tools import Tool, ToolResult  # noqa: E402
from fastmcp.tools.tool_transform import ArgTransform  # noqa: E402
from mcp.types import ImageContent, TextContent  # noqa: E402

import kicad_live as live  # noqa: E402
import kicad_views as kv  # noqa: E402
from kicad_launch import launch_editor  # noqa: E402
from kicad.store import ArtifactStore  # noqa: E402
from kicad import examples, paths, verify  # noqa: E402
from kicad import mcp_server as worker  # noqa: E402
from kicad.pipeline import ORIGIN_MM  # noqa: E402
from kicad.service import PcbService  # noqa: E402
from kicad.spec import Rules  # noqa: E402

try:
    from plugin_version import VERSION as PLUGIN_VERSION  # noqa: E402  (written by scripts/build.mjs from the manifest; the host's artifact test compares it with initialize's serverInfo)
except ImportError:  # running from the source tree
    PLUGIN_VERSION = "0.0.0-dev"

UI_URI = "ui://kicad/board.html"
HERE = Path(__file__).resolve().parent
PAGE = HERE.parent / "panel.html"
PROJECT_NAME = "board"
EDIT_STATE = ROOT / "edit-session.json"
NO_LAUNCH = os.environ.get("KICAD_PLUGIN_NO_LAUNCH") == "1"  # tests: never open a GUI
MAX_LISTED_ARTIFACTS = 100  # artifact lists in tool results show the newest ones (the initial result of the panel tool must stay far below the host's 64 KiB limit)
_edit_lock = threading.Lock()  # the panel polls while the agent may call the same tools

store = ArtifactStore(ROOT / "store")
svc = PcbService(store)
VIEW_CACHE = ROOT / "views"  # rendered layer SVGs, 3D views, schematic sheets, check reports: derived from an artifact, so keyed by its id
MAX_LISTED = 25


def _seed_private_config() -> None:
    """KiCad's own stock library tables, so a schematic found in the edit project resolves symbols/footprints (ERC) even though the config folder is private."""
    try:
        cfg = Path(os.environ["KICAD_CONFIG_HOME"]) / "10.0"
        cfg.mkdir(parents=True, exist_ok=True)
        for name in ("sym-lib-table", "fp-lib-table"):
            src = paths.share_dir() / "template" / name
            if src.is_file() and not (cfg / name).exists():
                shutil.copyfile(src, cfg / name)
    except Exception:  # noqa: BLE001 - KiCad not installed yet: the tools report that themselves
        pass


_seed_private_config()


def _project_id() -> str:
    for p in store.list_projects():
        if p["name"] == PROJECT_NAME:
            return p["project_id"]
    return store.create_project(PROJECT_NAME)


PID = _project_id()


def _art(a) -> dict:
    return {"artifact_id": a.artifact_id, "kind": a.kind, "name": a.name, "size": a.size, "created_at": a.created_at}


def _ok(**kw) -> dict:
    return {"ok": True, "error": None, **kw}


def _err(msg: str, **kw) -> dict:
    return {"ok": False, "error": msg, **kw}


def _latest(kind: str, **meta_eq):
    cands = [a for a in store.list(PID, kind) if all(a.meta.get(k) == v for k, v in meta_eq.items())]
    return cands[-1] if cands else None


class PathRefused(ValueError):
    """A path argument that leaves the workspace (or goes through a symlink out of it)."""


def _in_workspace(raw: str | Path) -> Path:
    """A path argument of a tool: relative paths are taken from the workspace, and the result must stay inside it once symlinks are resolved. Nothing outside the workspace is
    read or written by the file tools; an agent that is confused (or fed a malicious prompt) cannot reach ~/.ssh or overwrite a dotfile through them."""
    p = Path(raw)
    p = p if p.is_absolute() else WORKSPACE / p
    if not p.resolve().is_relative_to(WORKSPACE):
        raise PathRefused(f"{raw}: outside the workspace ({WORKSPACE}); the file tools only use paths inside it")
    return p


mcp = FastMCP(
    "kicad",
    version=PLUGIN_VERSION,
    instructions=(
        "KiCad 10 inside ZCode. Design a 2-layer board from a JSON circuit spec: pcb_search_parts / pcb_part_info (never guess pin numbers or library ids) -> "
        "kicad_check_spec_file or pcb_check_spec -> pcb_build (place hints, auto-route, DRC) -> pcb_render -> pcb_export_fab -> kicad_export_files; kicad_checks gives DRC (and ERC) details, pcb_export_glb a 3D model with a part table. Coordinates are mm, "
        "origin top-left, +y down. A board is manufacturable only when pcb_build returns ok=true (DRC 0 errors, 0 unconnected). Start from pcb_spec_example (default: a 555 LED "
        "blinker). kicad_board_view opens the board panel for the human; you cannot see pictures, so judge by the DRC and routing numbers."
    ),
)


def _mount_worker_tools() -> None:
    """Re-publish the worker's tools with `project_id` hidden and bound to this workspace's project."""
    inner = worker.create_server(store)

    async def _tools():
        return await inner.list_tools()

    for t in asyncio.run(_tools()):
        if t.name in ("pcb_render", "pcb_export_fab", "pcb_spec_example"):  # replaced below: a text-only render (the coding model may not accept images), an export that warns about edited boards, examples written to files
            continue
        if "project_id" in t.parameters.get("properties", {}):
            t = Tool.from_tool(t, transform_args={"project_id": ArgTransform(hide=True, default=PID)})
        mcp.add_tool(t)


_mount_worker_tools()


@mcp.tool
def kicad_info() -> dict:
    """KiCad version, workspace, and every artifact stored so far (specs, boards, renders, fab files) with their ids."""
    arts = store.list(PID)
    return _ok(kicad_version=paths.kicad_version(), workspace=str(WORKSPACE), store=str(store.root), artifacts=[_art(a) for a in arts[-MAX_LISTED_ARTIFACTS:]], artifacts_total=len(arts))


@mcp.tool(annotations={"title": "Write an example circuit spec", "readOnlyHint": False, "destructiveHint": True, "idempotentHint": True, "openWorldHint": False})
def pcb_spec_example(name: str = "ne555_blinker", write_to: str = "", inline: bool = False, overwrite: bool = False) -> dict:
    """A small, complete, DRC-clean circuit spec to start from, written into the workspace (default ./kicad/<name>_spec.json). name: 'ne555_blinker' (NE555 astable LED flasher, about 1 Hz,
    9 parts, 34 x 22 mm — the default), 'led_indicator' (5 V header + resistor + LED, 3 parts), 'ldo_3v3_breakout' (3.3 V regulator, 4 parts), 'shift_register_leds' (74HC595 + 8 LEDs, 19
    parts). Returns the path, the part list, net names and the documentation of every spec field; inline=true also returns the spec itself. Edit the file, then call kicad_check_spec_file.
    The path must be inside the workspace. A file that is already there and differs (you may have edited it) is not replaced unless overwrite=true; an identical one is left as it is."""
    if name not in examples.EXAMPLES:
        return _err(f"unknown example '{name}'. Choose one of {sorted(examples.EXAMPLES)}")
    spec = examples.example(name)
    try:
        dest = _in_workspace(write_to or Path("kicad") / f"{name}_spec.json")
    except PathRefused as e:
        return _err(str(e))
    text = json.dumps(spec, indent=2, ensure_ascii=False)
    if dest.exists() and not overwrite and dest.read_text() != text:
        return _err(f"{dest} already exists and differs from the example (edited?): pass overwrite=true to replace it, or another write_to")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or dest.read_text() != text:
        dest.write_text(text)
    return _ok(name=name, path=str(dest), outline=spec["outline"], parts=[{"ref": p["ref"], "symbol": p["symbol"], "value": p.get("value", "")} for p in spec["parts"]],
               nets=[n["name"] for n in spec["nets"]], fields=worker.SPEC_HELP, **({"spec": spec} if inline else {}))


@mcp.tool
def kicad_check_spec_file(spec_path: str) -> dict:
    """Same as pcb_check_spec, but reads the spec JSON from a file in the workspace (no need to paste it into the call). Returns the issues, the pin table and
    `spec_artifact_id` for pcb_build."""
    try:
        p = _in_workspace(spec_path)
    except PathRefused as e:
        return _err(str(e))
    if not p.is_file():
        return _err(f"no such file: {spec_path}")
    try:
        spec = json.loads(p.read_text())
    except json.JSONDecodeError as e:
        return _err(f"not valid JSON: {e}")
    return svc.check_spec(PID, spec)


def _copy_artifacts(artifact_ids: list[str], dest: Path) -> tuple[list[dict], list[str]]:
    """The export path shared by kicad_export_files and pcb_export_glb: stored artifacts -> normal workspace files."""
    dest = _in_workspace(dest)
    dest.mkdir(parents=True, exist_ok=True)
    written, missing = [], []
    for aid in artifact_ids:
        try:
            art = store.require(PID, aid)
        except KeyError:
            missing.append(aid)
            continue
        out = _in_workspace(dest / Path(art.name).name)          # the stored name is a file name, never a path; a symlink at the target must not lead out of the workspace
        shutil.copyfile(store.path(aid), out)
        written.append({"artifact_id": aid, "kind": art.kind, "path": str(out)})
    return written, missing


@mcp.tool(annotations={"title": "Export stored files into the workspace", "readOnlyHint": False, "destructiveHint": True, "idempotentHint": True, "openWorldHint": False})
def kicad_export_files(artifact_ids: list[str], dest_dir: str = "") -> dict:
    """Copy stored artifacts (kicad_pcb, png renders, gerber_zip, bom/pos csv, glb, report) into the workspace so other tools and agents can use them. dest_dir (inside the
    workspace) defaults to ./kicad/out; files of the same name there are replaced by the current export. Returns the written paths."""
    try:
        written, missing = _copy_artifacts(artifact_ids, _in_workspace(dest_dir) if dest_dir else WORKSPACE / "kicad" / "out")
    except PathRefused as e:
        return _err(str(e))
    return _ok(written=written) if not missing else _err(f"unknown artifacts: {missing}", written=written)


@mcp.tool
def pcb_render(artifact_id: str, side: str = "top") -> dict:
    """Render a built board (kicad_pcb artifact) as a 3D PNG with kicad-cli. side: 'top' or 'bottom'. The image is stored as an artifact (you get its id; copy it out
    with kicad_export_files, or open the panel with kicad_board_view)."""
    info, data = svc.render(PID, artifact_id, side)
    if data is not None:
        info["bytes"] = len(data)
    return info


@mcp.tool
def pcb_export_fab(artifact_id: str, include_step: bool = False) -> dict:
    """Produce fabrication files from a built board: 'gerber_zip' (gerbers + drill), BOM and pos CSVs, a 'kicad_project' zip (open it in KiCad) and a 'pcb_report'
    (checks, DRC, pin table, BOM, limitations) for human review. Re-runs DRC first; if it fails nothing but the report is produced and ok=false. include_step=true also
    exports a STEP model (slow). For a board the user edited in KiCad, gerbers/drill/project come from the edited board, BOM/pos still come from the original spec."""
    out = svc.export_fab(PID, artifact_id, include_step)
    try:
        a = store.require(PID, artifact_id)
    except KeyError:
        return out
    if a.meta.get("edited_in_kicad"):
        out.setdefault("warnings", []).append("This board was edited in KiCad: gerbers, drill and the KiCad project zip come from the edited board, but the BOM and pos CSVs are generated "
                                              "from the original circuit spec and may not match moved or replaced parts.")
    return out


# ---------------------------------------------------------------------------------------------- real KiCad GUI + round trip
def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _session() -> dict | None:
    try:
        return json.loads(EDIT_STATE.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _save_session(sess: dict) -> None:
    EDIT_STATE.parent.mkdir(parents=True, exist_ok=True)
    EDIT_STATE.write_text(json.dumps(sess, indent=1))


def _editor_app() -> Path | None:
    app = paths.app_dir()  # .../KiCad/KiCad.app
    for cand in (app.parent / "PCB Editor.app", app / "Contents/Applications/pcbnew.app"):
        if cand.exists():
            return cand
    return None


def _launch(pcb: Path) -> tuple[bool, str]:
    if NO_LAUNCH:
        return False, "launch disabled (KICAD_PLUGIN_NO_LAUNCH=1)"
    if sys.platform != "darwin":
        return False, "automatic launch is implemented for macOS only: open the file in KiCad yourself"
    editor = _editor_app()
    if editor is None:
        return False, f"KiCad PCB Editor not found next to {paths.app_dir()}"
    # `open` exits 0 even when pcbnew dies right away (quarantined KiCad -> App Translocation -> dyld error): launch_editor checks that it stays up and explains why not
    return launch_editor(editor, pcb, paths.app_dir())


def _sync_locked() -> dict:
    sess = _session()
    if not sess:
        return {"ok": False, "error": "no KiCad edit session yet: call kicad_open_in_kicad first"}
    pcb = Path(sess["pcb"])
    if not pcb.is_file():
        return {"ok": False, "error": f"the edited board is gone: {pcb}"}
    sha = _sha(pcb)
    head = store.get(sess["head_artifact_id"])
    if sha == sess["imported_sha"]:
        return {"ok": True, "changed": False, "artifact_id": head.artifact_id, "pcb": str(pcb), "drc_passed": head.meta.get("drc_passed"), "edited": bool(head.meta.get("edited_in_kicad"))}
    scratch = store.scratch_dir(PID, "kicadedit")
    try:
        staged = scratch / pcb.name
        shutil.copyfile(pcb, staged)  # DRC runs on a copy: KiCad may still hold or rewrite the original
        user_pro = pcb.with_suffix(".kicad_pro")
        if user_pro.is_file():  # the user's own design rules win over the worker's
            shutil.copyfile(user_pro, staged.with_suffix(".kicad_pro"))
        else:
            verify.write_project_file(staged, Rules.model_validate(head.meta.get("rules") or {}), head.meta.get("power_nets") or [])
        drc = verify.run_drc(staged, scratch, origin=ORIGIN_MM)
        data = staged.read_bytes()
    finally:
        store.cleanup_scratch(scratch)
    d = drc.to_dict()
    meta = {**head.meta, "edited_in_kicad": True, "edited_at": _now(), "edit_source": str(pcb), "from_artifact_id": head.artifact_id, "drc_passed": bool(drc.passed),
            "drc": {k: v for k, v in d.items() if k not in ("violations", "unconnected_items")}, "unrouted": drc.n_unconnected}
    art = store.put_bytes(PID, data, "kicad_pcb", head.name, parent_id=head.artifact_id, meta=meta)
    sess.update(imported_sha=sha, head_artifact_id=art.artifact_id, imports=[*sess.get("imports", []), art.artifact_id], last_sync_at=_now())
    _save_session(sess)
    return {"ok": True, "changed": True, "artifact_id": art.artifact_id, "from_artifact_id": head.artifact_id, "pcb": str(pcb), "edited": True, "drc_passed": bool(drc.passed),
            "drc": meta["drc"], "violations": drc.violations[:10], "unconnected": drc.unconnected[:10],
            "next": "Call kicad_board_view to refresh the panel; pcb_export_fab on this artifact_id exports the edited board." if drc.passed
                    else "The edited board fails DRC: read `violations` / `unconnected`, tell the user what to fix in KiCad (or fix the circuit spec and rebuild)."}


@mcp.tool(annotations={"title": "Open the board in the KiCad PCB Editor", "readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": True})
def kicad_open_in_kicad(artifact_id: str = "") -> dict:
    """Open the board in the real KiCad PCB Editor so the user can keep editing it with the full KiCad GUI. The board is exported to ./kicad/edit/<name>/ (a normal KiCad
    project the user owns); artifact_id defaults to the board being worked on. Anything the user already saved there is imported first, never overwritten. After the user
    saves in KiCad (Cmd+S) the panel syncs by itself; call kicad_sync_edits to import and DRC-check the save yourself. Returns where the files are and whether KiCad was started."""
    with _edit_lock:
        sess = _session()
        pending = _sync_locked() if sess and Path(sess["pcb"]).is_file() else None
        sess = _session()
        try:
            art = store.require(PID, artifact_id) if artifact_id else (store.get(sess["head_artifact_id"]) if sess else _latest("kicad_pcb"))
        except KeyError:
            return _err(f"unknown board artifact {artifact_id}")
        if art is None:
            return _err("no board yet: run pcb_build first")
        if art.kind != "kicad_pcb":
            return _err(f"artifact {art.artifact_id} is a {art.kind}, not a board (kicad_pcb): use the id from pcb_build or kicad_board_view")
        name = art.meta.get("pcb_name") or Path(art.name).stem
        pcb = WORKSPACE / "kicad" / "edit" / name / f"{name}.kicad_pcb"
        if not (sess is not None and sess["head_artifact_id"] == art.artifact_id and sess["pcb"] == str(pcb) and pcb.is_file()):
            n = 1
            while pcb.exists():   # what is there is the user's work (a save this session does not know, or the board of an older session): never overwrite it, start the next folder
                n += 1
                pcb = pcb.parent.parent / f"{name}-r{n}" / f"{name}-r{n}.kicad_pcb"
            pcb.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(store.path(art.artifact_id), pcb)
            verify.write_project_file(pcb, Rules.model_validate(art.meta.get("rules") or {}), art.meta.get("power_nets") or [])
            sess = {"pcb": str(pcb), "head_artifact_id": art.artifact_id, "imported_sha": _sha(pcb), "imports": [], "opened_at": _now()}
            _save_session(sess)
    launched, note = _launch(pcb)  # outside the lock: it can take ~10 s while the panel keeps polling
    return _ok(pcb=str(pcb), project=str(pcb.with_suffix(".kicad_pro")), launched=launched, launch_note=note, board_artifact_id=art.artifact_id,
               imported_pending_edits=bool(pending and pending.get("changed")),
               how_to="Edit in KiCad and press Cmd+S. The KiCad board panel syncs automatically; or call kicad_sync_edits.")


@mcp.tool
def kicad_sync_edits() -> dict:
    """Import what the user saved in KiCad since the last sync as a new board artifact (parent = the board it started from), run DRC on it and return the verdict with the first
    violations. Safe to call at any time; changed=false means nothing was saved since the last import. The edited board becomes the board the panel and pcb_export_fab use."""
    with _edit_lock:
        return _sync_locked()


@mcp.tool(app={"visibility": ["app"]})
def kicad_edit_status() -> dict:
    """(panel only) Poll for saves from the KiCad GUI: imports a pending save (see kicad_sync_edits) and reports the edit session."""
    with _edit_lock:
        sess = _session()
        if not sess:
            return _ok(session=False)
        res = _sync_locked()
        return _ok(session=True, pcb=sess["pcb"], changed=bool(res.get("changed")), artifact_id=res.get("artifact_id"), drc_passed=res.get("drc_passed"),
                   last_sync_at=(_session() or {}).get("last_sync_at"), sync_error=None if res.get("ok") else res.get("error"))


def _summary(side: str) -> dict[str, Any]:
    pcb = _latest("kicad_pcb")
    if not pcb:
        return {"ok": False, "error": "no board yet: run pcb_build first", "artifacts": [_art(a) for a in store.list(PID)[-MAX_LISTED_ARTIFACTS:]]}
    spec = None
    sid = pcb.meta.get("spec_artifact_id")
    if sid:
        try:
            spec = json.loads(store.path(sid).read_text())
        except Exception:  # noqa: BLE001
            spec = None
    parts = [{"ref": p["ref"], "symbol": p["symbol"], "value": p.get("value", ""), "x_mm": p.get("x_mm"), "y_mm": p.get("y_mm")} for p in (spec or {}).get("parts", [])]
    return {"ok": True, "error": None, "name": pcb.meta.get("pcb_name"), "pcb_artifact_id": pcb.artifact_id, "side": side,
            "width_mm": pcb.meta.get("width_mm"), "height_mm": pcb.meta.get("height_mm"), "layers": pcb.meta.get("layers"),
            "drc_passed": pcb.meta.get("drc_passed"), "drc": pcb.meta.get("drc"), "unrouted": pcb.meta.get("unrouted"),
            "parts": parts, "nets": [n["name"] for n in (spec or {}).get("nets", [])], "artifacts": [_art(a) for a in store.list(PID)[-MAX_LISTED_ARTIFACTS:]], "artifacts_total": len(store.list(PID)),
            "edited": bool(pcb.meta.get("edited_in_kicad")), "edited_at": pcb.meta.get("edited_at"), "edit": _edit_summary()}


def _edit_summary() -> dict:
    sess = _session()
    if not sess:
        return {"active": False}
    return {"active": True, "pcb": sess["pcb"], "relative": os.path.relpath(sess["pcb"], WORKSPACE) if sess["pcb"].startswith(str(WORKSPACE)) else sess["pcb"],
            "last_sync_at": sess.get("last_sync_at"), "imports": len(sess.get("imports", []))}


@mcp.tool(app={"resourceUri": UI_URI, "surface": "board", "visibility": ["model", "app"]})
def kicad_board_view(side: str = "top") -> ToolResult:
    """Open/refresh the KiCad panel for the newest board: 3D render, DRC verdict, size, part list and every artifact. Build a board with pcb_build first. Returns a
    short text summary (the picture is shown in the panel, not sent to you)."""
    info = _summary(side)
    slim = {k: v for k, v in info.items() if k not in ("parts", "artifacts", "nets", "edit")}
    slim["part_count"] = len(info.get("parts", []))
    return ToolResult(content=[TextContent(type="text", text=json.dumps(slim, ensure_ascii=False))], structured_content=info)


@mcp.tool(app={"visibility": ["app"]})
def kicad_board_image(side: str = "top") -> ToolResult:
    """(panel only) PNG of the newest board for `side`, rendering it first if needed."""
    pcb = _latest("kicad_pcb")
    if not pcb:
        return ToolResult(content=[TextContent(type="text", text="no board yet")])
    png = _latest("png", side=side)
    if png and png.parent_id == pcb.artifact_id:
        data = store.path(png.artifact_id).read_bytes()
    else:
        _, data = svc.render(PID, pcb.artifact_id, side)
    if not data:
        return ToolResult(content=[TextContent(type="text", text="render failed")])
    return ToolResult(content=[ImageContent(type="image", data=base64.b64encode(data).decode(), mimeType="image/png")])


# ---------------------------------------------------------------------------------------------------------------------------------- panel tabs + GLB (all headless, kicad-cli only)
def _board(artifact_id: str = ""):
    """The board a tab shows: the given artifact, else the newest board (an import of the user's save becomes the newest)."""
    return store.require(PID, artifact_id) if artifact_id else _latest("kicad_pcb")


def _stage_board(art, scratch: Path) -> Path:
    """The board as kicad-cli should see it: the worker's own staging (rules in the project file); for a board edited in KiCad the user's own .kicad_pro wins, as in the import."""
    pcb = svc._stage_pcb(art, scratch)
    user_pro = Path(art.meta.get("edit_source") or "").with_suffix(".kicad_pro") if art.meta.get("edited_in_kicad") else None
    if user_pro and user_pro.is_file():
        shutil.copyfile(user_pro, pcb.with_suffix(".kicad_pro"))
    return pcb


def _cached(key: str, make, binary: bool = False):
    """Derived views are cached on disk by (artifact id, view): make(scratch) -> str | bytes runs only on a miss."""
    f = VIEW_CACHE / key
    if f.is_file():
        return f.read_bytes() if binary else f.read_text()
    scratch = store.scratch_dir(PID, "kicadviews")
    try:
        data = make(scratch)
    finally:
        store.cleanup_scratch(scratch)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_bytes(data) if binary else f.write_text(data)
    return data


def _text_result(text: str, **structured) -> ToolResult:
    return ToolResult(content=[TextContent(type="text", text=text)], structured_content=structured)


def _fail_result(msg: str) -> ToolResult:
    return _text_result(msg, ok=False, error=msg)


def _schematic_for(art) -> tuple[Path | None, Path]:
    """(root schematic or None, folder that was searched): the edit project of the board, else where it would be created."""
    sess = _session()
    folder = Path(sess["pcb"]).parent if sess else WORKSPACE / "kicad" / "edit" / (art.meta.get("pcb_name") or Path(art.name).stem)
    return kv.find_schematic(folder, Path(sess["pcb"]).stem if sess else ""), folder


def _rel(p: Path) -> str:
    return os.path.relpath(p, WORKSPACE) if str(p).startswith(str(WORKSPACE)) else str(p)


def _sch_stamp(sch: Path) -> str:
    """Changes when the schematic or any sheet next to it is saved (sub-sheets live in the same folder)."""
    parts = [f"{f.name}:{f.stat().st_mtime_ns}:{f.stat().st_size}" for f in sorted(sch.parent.glob("*.kicad_sch"))]
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:12]


@mcp.tool
def pcb_export_glb(artifact_id: str = "", include_copper: bool = False, copy_to_workspace: bool = True) -> dict:
    """Export the board (default: the newest, i.e. the one edited in KiCad if the user saved) as a binary glTF (.glb) with KiCad's 3D models, for Blender or any 3D tool.
    Stored as a `glb` artifact and, by default, copied to ./kicad/out/<name>.glb. Returns the part table you need for fit checks: for every part with a 3D model its
    reference designator, footprint, position and yaw, bounding box and size in BOARD coordinates (mm, x right, y down, origin of the .kicad_pcb) and `z` above the bottom of
    the board, so you never have to guess which mesh is which part. Read `contains` and `caveats` before relying on it: parts without a library 3D model are NOT in the
    file (see `parts_without_model`), heights are the library models' nominal ones, include_copper=true adds flat copper/pad/via/silk/mask faces (about 4x larger)."""
    try:
        art = _board(artifact_id)
    except KeyError:
        return _err(f"unknown board artifact {artifact_id}")
    if art is None:
        return _err("no board yet: run pcb_build first")
    name = art.meta.get("pcb_name") or Path(art.name).stem
    glb = next((a for a in reversed(store.list(PID, "glb")) if a.meta.get("pcb_artifact_id") == art.artifact_id and a.meta.get("include_copper") == include_copper), None)
    pcb_file = store.path(art.artifact_id)
    origin = kv.board_origin(pcb_file)
    if glb is None:
        scratch = store.scratch_dir(PID, "pcbglb")
        try:
            out = kv.export_glb(_stage_board(art, scratch), scratch / f"{name}.glb", include_copper)
            glb = store.put_bytes(PID, out.read_bytes(), "glb", f"{name}.glb", parent_id=art.artifact_id,
                                  meta={"pcb_artifact_id": art.artifact_id, "include_copper": include_copper, "origin_mm": list(origin), "source": "kicad-cli pcb export glb",
                                        "kicad_version": paths.kicad_version(), "edited_in_kicad": bool(art.meta.get("edited_in_kicad"))})
        except Exception as e:  # noqa: BLE001 - KiCadError and I/O alike: tell the agent, do not crash the server
            return _err(f"GLB export failed: {e}")
        finally:
            store.cleanup_scratch(scratch)
    try:
        info = kv.glb_parts(store.path(glb.artifact_id), origin)
        in_board = kv.board_footprints(pcb_file)
    except Exception as e:  # noqa: BLE001
        return _err(f"the GLB was written but could not be read back: {e}", artifact_id=glb.artifact_id)
    have = {p["ref"] for p in info["parts"]}
    res = _ok(artifact_id=glb.artifact_id, name=glb.name, size=glb.size, from_board_artifact_id=art.artifact_id, edited_in_kicad=bool(art.meta.get("edited_in_kicad")),
              include_copper=include_copper, origin_mm=list(origin), board=info["board"], parts=info["parts"], part_count=len(info["parts"]),
              parts_without_model=[f["ref"] for f in in_board if f["ref"] not in have], footprints_on_board=len(in_board),
              axes={"units": "metres in the file (the table below is mm)", "up": "+Y", "board_x": "+X", "board_y": "+Z (board y points down on screen)",
                    "origin": f"the board's drill/place origin {list(origin)} mm: board x = {origin[0]:g} + 1000*X, board y = {origin[1]:g} + 1000*Z, height above the board's bottom = 1000*Y"},
              contains=["Board body: one mesh named `<board>_PCB` (a plain slab: no copper, mask or silkscreen unless include_copper=true).",
                        "Each part with a 3D model in KiCad's libraries: a node named by its REFERENCE DESIGNATOR (verified on KiCad 10.0.6) whose child mesh is named by the FOOTPRINT; "
                        "identical footprints share one mesh and differ only in the node's translation/rotation. Import keeps the node names, e.g. Blender objects 'U1', 'R3'."]
              + (["include_copper=true: flat copper, pad, via, silkscreen and soldermask faces as extra root meshes (" + ", ".join(info["flat_layers"]) + ")."] if include_copper else []),
              caveats=["Parts whose footprint has no 3D model are missing from the file (parts_without_model): size them from the footprint courtyard instead.",
                       "Models are KiCad's library models, STEP where available: heights and body sizes are nominal, not the real manufacturer part.",
                       "Mesh names alone are footprint names, not designators: use the node names / this table to tell parts apart.",
                       "Through-hole pins reach below the board (z < 0 in the table): keep that clearance in an enclosure."],
              next="Import the .glb into Blender (File > Import > glTF 2.0) or load it with trimesh/three.js; the table gives every part's place without opening the file.")
    if copy_to_workspace:
        written, _missing = _copy_artifacts([glb.artifact_id], WORKSPACE / "kicad" / "out")
        res["workspace_path"] = written[0]["path"] if written else None
    return res


@mcp.tool(app={"visibility": ["app"]})
def kicad_layers() -> dict:
    """(panel only) The layers of the newest board the Layers tab can draw, in draw order (bottom to top), and which are on by default."""
    art = _latest("kicad_pcb")
    if not art:
        return _err("no board yet: run pcb_build first")
    return _ok(artifact_id=art.artifact_id, name=art.meta.get("pcb_name"), width_mm=art.meta.get("width_mm"), height_mm=art.meta.get("height_mm"), edited=bool(art.meta.get("edited_in_kicad")),
               layers=[{"id": i, "label": label, "default": on} for i, label, on in kv.LAYERS])


@mcp.tool(app={"visibility": ["app"]})
def kicad_layer_svg(layer: str, artifact_id: str = "") -> ToolResult:
    """(panel only) One layer of the board as SVG text (own colours, transparent, same frame for every layer so they stack)."""
    try:
        art = _board(artifact_id)
    except KeyError:
        return _fail_result(f"unknown board artifact {artifact_id}")
    if art is None:
        return _fail_result("no board yet: run pcb_build first")
    if layer not in kv.LAYER_IDS:
        return _fail_result(f"unknown layer '{layer}'")
    try:
        svg = _cached(f"{art.artifact_id}/layer_{layer}.svg", lambda tmp: kv.layer_svg(_stage_board(art, tmp), layer, tmp)["svg"])
    except Exception as e:  # noqa: BLE001
        return _fail_result(f"could not draw {layer}: {e}")
    return _text_result(svg, ok=True, layer=layer, artifact_id=art.artifact_id, bytes=len(svg), **kv._svg_size(svg))


@mcp.tool(app={"visibility": ["app"]})
def kicad_3d_image(view: str = "iso", artifact_id: str = "") -> ToolResult:
    """(panel only) PNG of the newest board from a preset angle: top, bottom, iso, iso_rear, front or side (kicad-cli pcb render; pre-rendered, not interactive)."""
    try:
        art = _board(artifact_id)
    except KeyError:
        return _fail_result(f"unknown board artifact {artifact_id}")
    if art is None:
        return _fail_result("no board yet: run pcb_build first")
    if view not in kv.VIEWS:
        return _fail_result(f"unknown view '{view}'. Choose one of {sorted(kv.VIEWS)}")
    try:
        png = _cached(f"{art.artifact_id}/view_{view}.png", lambda tmp: kv.render_view(_stage_board(art, tmp), view, tmp / f"{view}.png", art.meta.get("width_mm"), art.meta.get("height_mm")).read_bytes(), binary=True)
    except Exception as e:  # noqa: BLE001
        return _fail_result(f"render failed: {e}")
    return ToolResult(content=[ImageContent(type="image", data=base64.b64encode(png).decode(), mimeType="image/png")], structured_content={"ok": True, "view": view, "artifact_id": art.artifact_id})


@mcp.tool(app={"visibility": ["app"]})
def kicad_schematic(sheet: str = "") -> ToolResult:
    """(panel only) The schematic of the board's edit project as SVG (one sheet per call; `sheets` lists them), or exists=false with the reason when there is none."""
    art = _latest("kicad_pcb")
    if not art:
        return _fail_result("no board yet: run pcb_build first")
    sch, folder = _schematic_for(art)
    if sch is None:
        msg = (f"There is no schematic in {_rel(folder)}. The plugin builds the board straight from the circuit spec and does not generate a schematic. Draw one in KiCad's "
               "Schematic Editor and save it inside this project folder; it shows up here.")
        return _text_result(msg, ok=True, exists=False, searched=_rel(folder), message=msg)
    key = f"sch-{_sch_stamp(sch)}"
    try:
        sheets = json.loads(_cached(f"{art.artifact_id}/{key}.json", lambda tmp: json.dumps([{"sheet": s["sheet"], "svg": s["svg"]} for s in kv.schematic_svgs(sch, tmp / "svg")])))
    except Exception as e:  # noqa: BLE001
        return _text_result(f"could not draw the schematic {_rel(sch)}: {e}", ok=False, exists=True, error=str(e), path=_rel(sch))
    pick = next((s for s in sheets if s["sheet"] == sheet), sheets[0])
    return _text_result(pick["svg"], ok=True, exists=True, path=_rel(sch), sheet=pick["sheet"], sheets=[s["sheet"] for s in sheets], bytes=len(pick["svg"]), **kv._svg_size(pick["svg"]))


@mcp.tool
def kicad_checks(artifact_id: str = "") -> dict:
    """DRC of the newest board (or artifact_id) with the first violations and their positions in board mm, plus ERC of the schematic when the board's edit project has a
    .kicad_sch (the plugin does not generate one: it exists only if the user drew it in KiCad). DRC uses the rules of the board (for a board edited in KiCad: the user's own
    .kicad_pro). Safe to call at any time; results are cached until the board or schematic changes."""
    try:
        art = _board(artifact_id)
    except KeyError:
        return _err(f"unknown board artifact {artifact_id}")
    if art is None:
        return _err("no board yet: run pcb_build first")

    def drc_report(tmp: Path) -> str:
        d = verify.run_drc(_stage_board(art, tmp), tmp, origin=ORIGIN_MM, max_listed=MAX_LISTED).to_dict()
        return json.dumps({**d, "violations": d["violations"][:MAX_LISTED], "unconnected_items": d["unconnected_items"][:MAX_LISTED]})

    try:
        drc = json.loads(_cached(f"{art.artifact_id}/drc.json", drc_report))
    except Exception as e:  # noqa: BLE001
        return _err(f"DRC failed: {e}")
    sch, folder = _schematic_for(art)
    schematic: dict = {"exists": sch is not None, "searched": _rel(folder)}
    if sch is not None:
        schematic["path"] = _rel(sch)
        try:
            schematic["erc"] = json.loads(_cached(f"{art.artifact_id}/erc-{_sch_stamp(sch)}.json", lambda tmp: json.dumps(kv.run_erc(sch, tmp, MAX_LISTED))))
        except Exception as e:  # noqa: BLE001
            schematic["erc_error"] = str(e)
    else:
        schematic["note"] = "No .kicad_sch in the edit project: there is nothing to run ERC on (the board is built from the circuit spec, which has no schematic)."
    return _ok(artifact_id=art.artifact_id, board=art.meta.get("pcb_name"), edited_in_kicad=bool(art.meta.get("edited_in_kicad")), drc=drc, schematic=schematic)


@mcp.tool(app={"visibility": ["app"]})
def kicad_library_preview(kind: str, lib_id: str) -> ToolResult:
    """(panel only) The drawing of one symbol (unit 1) or footprint from KiCad's official libraries as SVG; kind is 'symbol' or 'footprint', lib_id 'Library:Name'."""
    safe = hashlib.sha1(f"{kind}:{lib_id}".encode()).hexdigest()[:16]
    try:
        got = json.loads(_cached(f"library/{safe}.json", lambda tmp: json.dumps(kv.library_svg(kind, lib_id, tmp / "lib"))))
    except Exception as e:  # noqa: BLE001
        return _fail_result(f"no drawing for {lib_id}: {e}")
    return _text_result(got["svg"], ok=True, kind=kind, lib_id=lib_id, bytes=len(got["svg"]), width_mm=got.get("width_mm"), height_mm=got.get("height_mm"), units_drawn=got.get("units_drawn"))


# ---------------------------------------------------------------------------------------------------------------------------------- live link to the running PCB Editor (KiCad 10 IPC API)
def _session_pcb() -> str | None:
    sess = _session()
    return sess["pcb"] if sess else None


@mcp.tool(annotations={"title": "KiCad live link status", "readOnlyHint": True, "openWorldHint": False})
def kicad_live_status() -> dict:
    """Is the running KiCad PCB Editor reachable through KiCad's API, which board does it have open, and is that the board of this plugin's edit session (kicad_open_in_kicad)?
    Read-only. If the API is off or no editor runs, `reason` says so in one sentence (the KiCad preference is "Enable KiCad API"); the file round trip (⌘S in KiCad, then
    kicad_sync_edits) works either way. Never returns the socket path or any token."""
    return live.status(_session_pcb(), WORKSPACE)


@mcp.tool(app={"visibility": ["app"]})
def kicad_live_snapshot(since: str = "") -> dict:
    """(panel only) The live board in the running PCB Editor, read through KiCad's API while the user edits (no ⌘S needed): parts, nets, selection, counts, a signature. Only when
    the live editor has exactly this session's board open; otherwise live=false with the reason. since = the last signature: an unchanged board answers with just that."""
    return live.snapshot(_session_pcb(), ORIGIN_MM, WORKSPACE, since)


@mcp.tool(app={"visibility": ["model"]}, annotations={"title": "Move one footprint in the live KiCad editor", "readOnlyHint": False, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False})
def kicad_live_move_footprint(ref: str, x_mm: float, y_mm: float, rotation_deg: float | None = None) -> dict:
    """CHANGES THE USER'S OPEN BOARD IN THE KICAD WINDOW: moves ONE footprint (ref, e.g. 'R3') to x_mm, y_mm (the same frame as the spec and the parts table: mm from the board's
    top-left corner) and optionally sets its rotation (degrees, counter-clockwise). It is one undoable KiCad step (⌘Z) and NOTHING IS SAVED: the user presses ⌘S in KiCad and the
    panel / kicad_sync_edits then imports the save and runs DRC. Refuses unless the live editor has exactly this session's board open (see kicad_live_status). Returns the position
    read back from the live editor. Use it for small, requested adjustments, not to rework a board while the user is editing."""
    art = _latest("kicad_pcb")
    outline = (float(art.meta["width_mm"]), float(art.meta["height_mm"])) if art and art.meta.get("width_mm") and art.meta.get("height_mm") else None
    return live.move_footprint(_session_pcb(), ref, x_mm, y_mm, ORIGIN_MM, rotation_deg, WORKSPACE, outline)




@mcp.resource(UI_URI, mime_type="text/html;profile=mcp-app", name="KiCad board panel")
def board_page() -> str:
    if PAGE.is_file():
        return PAGE.read_text()
    return "<!doctype html><meta charset=utf-8><body style='font:14px system-ui;padding:16px'>KiCad panel UI is missing from this installation (dist/panel.html).</body>"


def main() -> None:
    mcp.run(transport="stdio", show_banner=False)


if __name__ == "__main__":
    main()
