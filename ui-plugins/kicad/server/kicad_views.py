"""Headless views of a board, a schematic and the libraries: what the panel tabs show and what `pcb_export_glb` hands to other agents.

Everything goes through `kicad-cli` (and the vendored worker's runner, which keeps KiCad on a private config folder): no GUI, no IPC API, no screen capture.
The functions take paths and return plain data; `kicad_server.py` wraps them in tools and caches the results.
"""
from __future__ import annotations

import json
import math
import re
import struct
from pathlib import Path

from kicad import paths
from kicad.runner import KiCadError, run_cli
from kicad.sexpr import children, find, parse, value

# Draw order, bottom to top. (id as kicad-cli spells it, label, visible by default.) Every layer of one board is exported with the same viewBox, so the images stack exactly.
LAYERS = [
    ("B.Fab", "Back fab", False), ("B.CrtYd", "Back courtyard", False), ("B.SilkS", "Back silkscreen", False), ("B.Paste", "Back paste", False),
    ("B.Mask", "Back mask", False), ("B.Cu", "Back copper", True), ("F.Cu", "Front copper", True), ("F.Mask", "Front mask", False),
    ("F.Paste", "Front paste", False), ("F.SilkS", "Front silkscreen", True), ("F.CrtYd", "Front courtyard", False), ("F.Fab", "Front fab", False),
    ("Edge.Cuts", "Board outline", True),
]
LAYER_IDS = [x[0] for x in LAYERS]

# name -> (side for kicad-cli, --rotate "x,y,z"); the 3D tab shows these pre-rendered views (not an interactive viewer)
VIEWS = {"top": ("top", "0,0,0"), "bottom": ("bottom", "0,0,0"), "iso": ("top", "-45,0,45"), "iso_rear": ("top", "-45,0,225"), "front": ("top", "-90,0,0"), "side": ("top", "-90,0,90")}


# ---------------------------------------------------------------------------------------------------------------------------------- board
def layer_svg(pcb: Path, layer: str, workdir: Path) -> dict:
    """One copper/silk/mask/... layer as SVG (own colour, transparent background, same frame as every other layer of the board)."""
    if layer not in LAYER_IDS:
        raise KiCadError(f"unknown layer '{layer}'. Choose one of {LAYER_IDS}")
    out = Path(workdir) / f"layer_{layer}.svg"
    run_cli(["pcb", "export", "svg", "--mode-single", "--layers", layer, "--page-size-mode", "2", "--exclude-drawing-sheet", "-o", str(out), str(pcb)], timeout=120, cwd=workdir)
    if not out.exists():
        raise KiCadError(f"kicad-cli produced no SVG for {layer}")
    svg = re.sub(r"<title>.*?</title>|<desc>.*?</desc>", "", out.read_text(), flags=re.S)
    return {"layer": layer, "svg": svg, **_svg_size(svg)}


def _svg_size(svg: str) -> dict:
    m = re.search(r'viewBox="\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)', svg)
    return {"width_mm": float(m.group(3)), "height_mm": float(m.group(4))} if m else {}


def render_view(pcb: Path, view: str, out: Path, board_w: float, board_h: float) -> Path:
    """kicad-cli pcb render from a preset angle (software ray tracer off: `basic` quality)."""
    if view not in VIEWS:
        raise KiCadError(f"unknown 3D view '{view}'. Choose one of {sorted(VIEWS)}")
    side, rotate = VIEWS[view]
    longest = max(float(board_w or 30), float(board_h or 20))
    zoom = 1.0 if view in ("top", "bottom") else max(0.5, min(1.4, 60.0 / longest * 1.1))  # keep big boards inside the frame at an angle
    run_cli(["pcb", "render", "--side", side, "--rotate", rotate, "--perspective", "--width", "1100", "--height", "720", "--quality", "basic", "--zoom", f"{zoom:.2f}",
             "--background", "opaque", "-o", str(out), str(pcb)], timeout=300, cwd=Path(out).parent)
    if not Path(out).exists():
        raise KiCadError("kicad-cli pcb render produced no image")
    return Path(out)


def board_origin(pcb: Path) -> tuple[float, float]:
    """The drill/place origin (`aux_axis_origin`) the GLB is exported relative to; (0, 0) when the board defines none."""
    try:
        tree = parse(pcb.read_text())
        setup = find(tree, "setup")
        node = find(setup, "aux_axis_origin") if setup else None
        return (float(node[1]), float(node[2])) if node and len(node) >= 3 else (0.0, 0.0)
    except (OSError, ValueError, IndexError):
        return (0.0, 0.0)


def board_footprints(pcb: Path) -> list[dict]:
    """Reference, library id and side of every footprint in a .kicad_pcb (text parse, no pcbnew)."""
    out = []
    for fp in children(parse(pcb.read_text()), "footprint"):
        ref = next((p[2] for p in children(fp, "property") if len(p) > 2 and p[1] == "Reference"), "") or ""
        out.append({"ref": ref, "footprint": fp[1] if len(fp) > 1 else "", "side": "bottom" if value(fp, "layer", "F.Cu") == "B.Cu" else "top"})
    return out


# ---------------------------------------------------------------------------------------------------------------------------------- GLB
def export_glb(pcb: Path, out: Path, include_copper: bool = False) -> Path:
    """kicad-cli pcb export glb, relative to the drill/place origin, library models substituted by STEP where the library has them."""
    args = ["pcb", "export", "glb", "--force", "--subst-models", "--drill-origin", "-o", str(out)]
    if include_copper:
        args += ["--include-tracks", "--include-pads", "--include-zones", "--include-silkscreen", "--include-soldermask"]
    run_cli([*args, str(pcb)], timeout=600, cwd=Path(out).parent)
    if not Path(out).exists():
        raise KiCadError("kicad-cli pcb export glb produced no file")
    return Path(out)


def _read_glb(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    signature, version, _length = struct.unpack("<4sII", raw[:12])
    if signature != b"glTF" or version != 2:
        raise KiCadError("not a binary glTF 2 file")
    pos, doc, blob = 12, None, b""
    while pos + 8 <= len(raw):
        size, kind = struct.unpack("<I4s", raw[pos:pos + 8])
        body = raw[pos + 8:pos + 8 + size]
        if kind == b"JSON":
            doc = json.loads(body)
        elif kind == b"BIN\x00":
            blob = body
        pos += 8 + size + (-size % 4)
    if doc is None:
        raise KiCadError("glTF has no JSON chunk")
    return doc, blob


def _quat_matrix(q: list[float]) -> list[list[float]]:
    x, y, z, w = q
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]


def _local(node: dict) -> tuple[list[list[float]], list[float]]:
    if "matrix" in node:  # column-major 4x4
        m = node["matrix"]
        return [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]], [m[12], m[13], m[14]]
    r = _quat_matrix(node.get("rotation", [0, 0, 0, 1]))
    s = node.get("scale", [1, 1, 1])
    return [[r[i][j] * s[j] for j in range(3)] for i in range(3)], list(node.get("translation", [0, 0, 0]))


def _compose(a: tuple, b: tuple) -> tuple:
    (ra, ta), (rb, tb) = a, b
    r = [[sum(ra[i][k] * rb[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    t = [sum(ra[i][k] * tb[k] for k in range(3)) + ta[i] for i in range(3)]
    return r, t


def glb_parts(path: Path, origin_mm: tuple[float, float]) -> dict:
    """The part table of a KiCad GLB: one entry per node that carries a mesh below it, with the position, yaw and bounding box in *board* coordinates (mm, origin and
    axes of the .kicad_pcb: x right, y down), height above the bottom of the board. glTF is metres, Y up; KiCad puts board x on +X and board y on +Z.
    Verified on KiCad 10.0.6: the node name is the reference designator, the mesh name is the footprint name, the board itself is the mesh `<name>_PCB`."""
    doc, _blob = _read_glb(path)
    nodes, meshes, acc = doc.get("nodes", []), doc.get("meshes", []), doc.get("accessors", [])
    roots = (doc.get("scenes") or [{"nodes": [0]}])[doc.get("scene", 0)].get("nodes", [])

    def mesh_box(mesh_idx: int):
        lo, hi = None, None
        for prim in meshes[mesh_idx].get("primitives", []):
            a = acc[prim["attributes"]["POSITION"]]
            if "min" not in a or "max" not in a:
                continue
            lo = a["min"] if lo is None else [min(x, y) for x, y in zip(lo, a["min"])]
            hi = a["max"] if hi is None else [max(x, y) for x, y in zip(hi, a["max"])]
        return lo, hi

    found: list[tuple[str, int, tuple]] = []  # (name of the nearest named ancestor, mesh index, transform)

    def walk(i: int, tf: tuple, name: str | None):
        node = nodes[i]
        tf = _compose(tf, _local(node))
        nm = node.get("name") if node.get("name") and not str(node["name"]).startswith("=>") else name
        if "mesh" in node:
            found.append((nm, node["mesh"], tf))
        for c in node.get("children", []):
            walk(c, tf, nm)

    ident = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0])
    for r in roots:
        walk(r, ident, None)

    ox, oy = origin_mm
    parts, board, layers = [], None, []
    for name, mesh_idx, (rot, tr) in found:
        lo, hi = mesh_box(mesh_idx)
        if lo is None:
            continue
        corners = [[rot[i][0] * x + rot[i][1] * y + rot[i][2] * z + tr[i] for i in range(3)] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
        mn = [min(c[i] for c in corners) for i in range(3)]
        mx = [max(c[i] for c in corners) for i in range(3)]
        bbox = {"x_min": round(ox + mn[0] * 1000, 2), "x_max": round(ox + mx[0] * 1000, 2), "y_min": round(oy + mn[2] * 1000, 2), "y_max": round(oy + mx[2] * 1000, 2),
                "z_min": round(mn[1] * 1000, 2), "z_max": round(mx[1] * 1000, 2)}
        mesh_name = meshes[mesh_idx].get("name", "")
        if name is None:  # attached to the scene root without a designator: the board body, or (include_copper) a flat copper/pad/via/silk/mask layer
            if mesh_name.endswith("_PCB"):
                board = {"mesh": mesh_name, **bbox, "thickness_mm": round((mx[1] - mn[1]) * 1000, 2)}
            else:
                layers.append(mesh_name)
            continue
        ex, ez = rot[0][0], rot[2][0]  # where the part's local +x ends up
        parts.append({"ref": name, "footprint": mesh_name, "x_mm": round(ox + tr[0] * 1000, 3), "y_mm": round(oy + tr[2] * 1000, 3),
                      "rotation_deg": round(math.degrees(math.atan2(-ez, ex)) % 360, 1), "side": "bottom" if rot[1][1] < 0 else "top",
                      "size_mm": [round((mx[0] - mn[0]) * 1000, 2), round((mx[2] - mn[2]) * 1000, 2), round((mx[1] - mn[1]) * 1000, 2)], "bbox_mm": bbox})
    parts.sort(key=lambda p: [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p["ref"])])
    return {"parts": parts, "board": board, "flat_layers": layers, "nodes": len(nodes), "meshes": len(meshes), "materials": len(doc.get("materials", [])), "generator": (doc.get("asset") or {}).get("extras", {}).get("generator")}


# ---------------------------------------------------------------------------------------------------------------------------------- schematic
def find_schematic(project_dir: Path, stem: str = "") -> Path | None:
    """The root schematic next to the edited board: <stem>.kicad_sch, else the project's only/first .kicad_sch (sub-sheets are found by KiCad itself)."""
    try:
        cands = sorted(Path(project_dir).glob("*.kicad_sch"))
    except OSError:
        return None
    for c in cands:
        if stem and c.stem == stem:
            return c
    return cands[0] if cands else None


def schematic_svgs(sch: Path, outdir: Path) -> list[dict]:
    """One SVG per sheet (white paper, KiCad's default colours)."""
    outdir.mkdir(parents=True, exist_ok=True)
    run_cli(["sch", "export", "svg", "--exclude-drawing-sheet", "-o", str(outdir), str(sch)], timeout=240, cwd=outdir)
    sheets = []
    for f in sorted(outdir.glob("*.svg")):
        svg = re.sub(r"<title>.*?</title>|<desc>.*?</desc>", "", f.read_text(), flags=re.S)
        sheets.append({"sheet": f.stem, "svg": svg, "bytes": len(svg)})
    if not sheets:
        raise KiCadError("kicad-cli sch export svg produced no file")
    return sheets


_ERC_ITEM = re.compile(r"^\s*@\(\s*(-?[\d.]+) mm,\s*(-?[\d.]+) mm\):\s*(.*)$")


def parse_erc_report(text: str, max_listed: int = 25) -> dict:
    """The text report of `kicad-cli sch erc --format report --units mm`. (The JSON format of 10.0.6 reports positions and lengths 100 times too small, e.g. a 25.4 mm
    wire as 'length 0.2540 mm', so this parses the text report, which is right.)"""
    found, sheet, cur = [], "/", None
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("***** Sheet"):
            sheet, cur = line[len("***** Sheet"):].strip() or "/", None
        elif (m := re.match(r"^\[([^\]]+)\]:\s*(.*)$", line)):
            cur = {"type": m.group(1), "severity": "", "description": m.group(2), "sheet": sheet, "items": []}
            found.append(cur)
        elif cur is not None and (m := re.match(r"^\s*;\s*(\w+)", line)) and not cur["severity"]:
            cur["severity"] = m.group(1).lower()
        elif cur is not None and (m := _ERC_ITEM.match(line)):
            cur["items"].append({"what": m.group(3), "x_mm": float(m.group(1)), "y_mm": float(m.group(2))})
    counts: dict[str, int] = {}
    by_type: dict[str, int] = {}
    for v in found:
        counts[v["severity"]] = counts.get(v["severity"], 0) + 1
        by_type[v["type"]] = by_type.get(v["type"], 0) + 1
    ranked = sorted(found, key=lambda v: {"error": 0, "warning": 1}.get(v["severity"], 2))
    return {"errors": counts.get("error", 0), "warnings": counts.get("warning", 0), "total": len(found), "by_type": by_type,
            "violations": [{**v, "items": v["items"][:3]} for v in ranked[:max_listed]]}


def run_erc(sch: Path, workdir: Path, max_listed: int = 25) -> dict:
    out = Path(workdir) / "erc.rpt"
    run_cli(["sch", "erc", "--format", "report", "--severity-all", "--units", "mm", "-o", str(out), str(sch)], timeout=240, cwd=workdir, ok_codes=(0, 5))
    if not out.exists():
        raise KiCadError("kicad-cli sch erc produced no report")
    return {**parse_erc_report(out.read_text(errors="replace"), max_listed), "kicad_version": paths.kicad_version()}


# ---------------------------------------------------------------------------------------------------------------------------------- library
def library_svg(kind: str, lib_id: str, workdir: Path) -> dict:
    """The drawing of one symbol (unit 1) or footprint from KiCad's official libraries, as SVG."""
    from kicad.library import split_lib_id  # same id rules as the worker: 'Library:Name', no path separators

    lib, name = split_lib_id(lib_id)
    workdir.mkdir(parents=True, exist_ok=True)
    if kind == "symbol":
        run_cli(["sym", "export", "svg", "--symbol", name, "-o", str(workdir), str(paths.symbols_dir() / f"{lib}.kicad_sym")], timeout=120, cwd=workdir)
        files = sorted(workdir.glob(f"{name}*.svg"))
    elif kind == "footprint":
        run_cli(["fp", "export", "svg", "--footprint", name, "-o", str(workdir), str(paths.footprints_dir() / f"{lib}.pretty")], timeout=120, cwd=workdir)
        files = sorted(workdir.glob(f"{name}.svg"))
    else:
        raise KiCadError("kind must be 'symbol' or 'footprint'")
    if not files:
        raise KiCadError(f"no drawing produced for {lib_id}")
    svg = re.sub(r"<title>.*?</title>|<desc>.*?</desc>", "", files[0].read_text(), flags=re.S)
    return {"kind": kind, "lib_id": lib_id, "svg": svg, "units_drawn": 1 if kind == "symbol" else None, **_svg_size(svg)}
