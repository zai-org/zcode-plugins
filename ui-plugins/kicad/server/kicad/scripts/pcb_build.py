"""Runs INSIDE KiCad's bundled Python (3.9, has ``pcbnew``). It imports nothing from this package, stdlib only.

    python pcb_build.py place  <job.json>   -> writes <out_pcb> (parts, nets, outline, holes) + <out_layout> (pad geometry)
    python pcb_build.py finish <job.json>   -> loads <in_pcb>, adds routed tracks/vias + GND zones, fills zones, saves <out_pcb>

All coordinates in the JSON are board coordinates in mm (origin = board top-left, +y down); ``origin_mm`` is added
when writing into the KiCad file and subtracted again in layout.json, so the rest of the pipeline never sees it.
"""
import json
import math
import os
import sys

import pcbnew

MM = pcbnew.FromMM
OX = OY = 0.0


def V(x, y):
    return pcbnew.VECTOR2I(MM(x + OX), MM(y + OY))


def mm(v):
    return pcbnew.ToMM(v)


def layer_id(name):
    return {"F.Cu": pcbnew.F_Cu, "B.Cu": pcbnew.B_Cu}[name]


def new_board():
    b = pcbnew.CreateEmptyBoard() if hasattr(pcbnew, "CreateEmptyBoard") else pcbnew.BOARD()
    b.SetCopperLayerCount(2)
    ds = b.GetDesignSettings()
    try:
        ds.SetBoardThickness(MM(1.6))
    except Exception:  # noqa: BLE001
        pass
    return b


def add_segment(board, a, b, layer, width=0.05):
    s = pcbnew.PCB_SHAPE(board)
    s.SetShape(pcbnew.SHAPE_T_SEGMENT)
    s.SetLayer(layer)
    s.SetStart(V(*a))
    s.SetEnd(V(*b))
    s.SetWidth(MM(width))
    board.Add(s)


def add_arc(board, start, mid, end, layer, width=0.05):
    s = pcbnew.PCB_SHAPE(board)
    s.SetShape(pcbnew.SHAPE_T_ARC)
    s.SetLayer(layer)
    s.SetArcGeometry(V(*start), V(*mid), V(*end))
    s.SetWidth(MM(width))
    board.Add(s)


def add_outline(board, W, H, r):
    L = pcbnew.Edge_Cuts
    if r <= 1e-6:
        pts = [(0, 0), (W, 0), (W, H), (0, H)]
        for i in range(4):
            add_segment(board, pts[i], pts[(i + 1) % 4], L)
        return
    k = r * (1 - math.sqrt(0.5))
    add_segment(board, (r, 0), (W - r, 0), L)
    add_segment(board, (W, r), (W, H - r), L)
    add_segment(board, (W - r, H), (r, H), L)
    add_segment(board, (0, H - r), (0, r), L)
    add_arc(board, (W - r, 0), (W - k, k), (W, r), L)
    add_arc(board, (W, H - r), (W - k, H - k), (W - r, H), L)
    add_arc(board, (r, H), (k, H - k), (0, H - r), L)
    add_arc(board, (0, r), (k, k), (r, 0), L)


def make_mounting_hole(board, idx, h):
    d = h["drill_mm"]
    fp = pcbnew.FOOTPRINT(board)
    fp.SetReference("H%d" % idx)
    fp.SetValue("MountingHole_%gmm" % d)
    fp.SetPosition(V(h["x_mm"], h["y_mm"]))
    pad = pcbnew.PAD(fp)
    pad.SetAttribute(pcbnew.PAD_ATTRIB_NPTH)
    pad.SetShape(pcbnew.PAD_SHAPE_CIRCLE)
    pad.SetSize(pcbnew.VECTOR2I(MM(d), MM(d)))
    pad.SetDrillSize(pcbnew.VECTOR2I(MM(d), MM(d)))
    pad.SetPosition(V(h["x_mm"], h["y_mm"]))
    pad.SetLayerSet(pad.UnplatedHoleMask())
    fp.Add(pad)
    c = pcbnew.PCB_SHAPE(fp)
    c.SetShape(pcbnew.SHAPE_T_CIRCLE)
    c.SetLayer(pcbnew.F_CrtYd)
    c.SetStart(V(h["x_mm"], h["y_mm"]))
    c.SetEnd(V(h["x_mm"] + d / 2 + h.get("keepout_mm", 1.0), h["y_mm"]))
    c.SetWidth(MM(0.05))
    fp.Add(c)
    board.Add(fp)


def make_fiducial(board, idx, f):
    """MARK point: one unnetted top-layer SMD dot, solder-mask opening wider than the copper, excluded from BOM and placement files."""
    d, m = f["diameter_mm"], f["mask_mm"]
    fp = pcbnew.FOOTPRINT(board)
    fp.SetReference("FID%d" % idx)
    fp.SetValue("Fiducial")
    fp.SetPosition(V(f["x_mm"], f["y_mm"]))
    pad = pcbnew.PAD(fp)
    pad.SetAttribute(pcbnew.PAD_ATTRIB_SMD)
    pad.SetShape(pcbnew.PAD_SHAPE_CIRCLE)
    pad.SetSize(pcbnew.VECTOR2I(MM(d), MM(d)))
    pad.SetPosition(V(f["x_mm"], f["y_mm"]))
    ls = pcbnew.LSET()
    ls.AddLayer(pcbnew.F_Cu)
    ls.AddLayer(pcbnew.F_Mask)
    pad.SetLayerSet(ls)
    pad.SetLocalSolderMaskMargin(MM((m - d) / 2.0))
    fp.Add(pad)
    fp.Reference().SetVisible(False)
    fp.Value().SetVisible(False)
    fp.SetAttributes(pcbnew.FP_EXCLUDE_FROM_BOM | pcbnew.FP_EXCLUDE_FROM_POS_FILES | pcbnew.FP_BOARD_ONLY)
    board.Add(fp)


def pad_layout(pad, ref):
    """Axis-aligned geometry of one pad, in board coordinates (mm)."""
    bb = pad.GetBoundingBox()
    cx = mm(bb.GetX() + bb.GetWidth() / 2.0) - OX
    cy = mm(bb.GetY() + bb.GetHeight() / 2.0) - OY
    hw = mm(bb.GetWidth()) / 2.0
    hh = mm(bb.GetHeight()) / 2.0
    ang = pad.GetOrientationDegrees() % 360.0
    right_angle = min(ang % 90.0, 90.0 - (ang % 90.0)) < 1e-3
    shp = pad.GetShape()
    r = 0.0
    kind = "rect"
    if right_angle:
        if shp == pcbnew.PAD_SHAPE_CIRCLE:
            kind, r = "circle", min(hw, hh)
        elif shp == pcbnew.PAD_SHAPE_OVAL:
            kind, r = "oval", min(hw, hh)
        elif shp == pcbnew.PAD_SHAPE_ROUNDRECT:
            kind, r = "roundrect", min(mm(pad.GetRoundRectCornerRadius()), min(hw, hh))
    attr = pad.GetAttribute()
    tht = attr in (pcbnew.PAD_ATTRIB_PTH, pcbnew.PAD_ATTRIB_NPTH)
    layers = []
    if pad.IsOnLayer(pcbnew.F_Cu):
        layers.append("F.Cu")
    if pad.IsOnLayer(pcbnew.B_Cu):
        layers.append("B.Cu")
    drill = max(mm(pad.GetDrillSizeX()), mm(pad.GetDrillSizeY())) if pad.HasDrilledHole() or tht else 0.0
    return {
        "ref": ref, "number": pad.GetNumber(), "net": pad.GetNetname() or None,
        "x": round(cx, 4), "y": round(cy, 4), "hw": round(hw, 4), "hh": round(hh, 4), "r": round(r, 4), "kind": kind,
        "layers": layers, "tht": bool(tht), "npth": attr == pcbnew.PAD_ATTRIB_NPTH, "drill": round(drill, 4),
    }


def do_place(job):
    global OX, OY
    OX, OY = job["origin_mm"]
    spec = job["spec"]
    fp_root = job["footprints_dir"]
    board = new_board()

    # nets
    netobj = {}
    for n in spec["nets"]:
        ni = pcbnew.NETINFO_ITEM(board, n["name"])
        board.Add(ni)
        netobj[n["name"]] = ni
    pin_net = {}
    for n in spec["nets"]:
        for p in n["pins"]:
            pin_net[p] = n["name"]

    # footprints
    layout_pads = []
    for p in spec["parts"]:
        lib, _, name = p["footprint"].partition(":")
        fp = pcbnew.FootprintLoad(os.path.join(fp_root, lib + ".pretty"), name)
        if fp is None:
            raise RuntimeError("cannot load footprint %s" % p["footprint"])
        try:
            fp.SetFPID(pcbnew.LIB_ID(lib, name))
        except Exception:  # noqa: BLE001
            pass
        fp.SetReference(p["ref"])
        fp.SetValue(p.get("value") or name)
        fp.SetPosition(V(p["x_mm"], p["y_mm"]))
        board.Add(fp)  # must be on the board BEFORE Flip (flipping a free footprint crashes pcbnew)
        if p.get("side") == "bottom":
            fp.Flip(fp.GetPosition(), False)  # top<->bottom mirror about the footprint origin (KiCad default)
        fp.SetOrientationDegrees(float(p.get("rotation", 0.0)))
        if p.get("no_thermal_vias"):  # drop plated holes below the fab minimum (0.3 mm); the exposed pad itself stays
            for pad in list(fp.Pads()):
                if pad.HasHole() and min(pad.GetDrillSizeX(), pad.GetDrillSizeY()) < pcbnew.FromMM(0.3):
                    fp.Remove(pad)
        for pad in fp.Pads():
            key = "%s.%s" % (p["ref"], pad.GetNumber())
            nm = pin_net.get(key)
            if nm:
                pad.SetNet(netobj[nm])
    for i, h in enumerate(spec.get("mounting_holes", []), start=1):
        make_mounting_hole(board, i, h)
    for i, f in enumerate(spec.get("fiducials", []), start=1):
        make_fiducial(board, i, f)
    o = spec["outline"]
    add_outline(board, o["width_mm"], o["height_mm"], o.get("corner_radius_mm", 0.0))

    # layout dump (after everything is placed so pad bounding boxes are final)
    holes = []
    for fp in board.GetFootprints():
        ref = fp.GetReference()
        for pad in fp.Pads():
            g = pad_layout(pad, ref)
            if g["npth"]:
                holes.append({"x": g["x"], "y": g["y"], "d": g["drill"], "ref": ref})
            else:
                layout_pads.append(g)
    layout_pads.sort(key=lambda g: (g["ref"], _nat(g["number"]), g["x"], g["y"]))
    layout = {
        "pcbnew_version": pcbnew.Version(),
        "board": {"width": o["width_mm"], "height": o["height_mm"], "corner_radius": o.get("corner_radius_mm", 0.0)},
        "pads": layout_pads, "holes": holes, "nets": list(netobj),
    }
    pcbnew.SaveBoard(job["out_pcb"], board)
    with open(job["out_layout"], "w") as f:
        json.dump(layout, f, indent=1)


def _nat(s):
    return [int(t) if t.isdigit() else t for t in __import__("re").split(r"(\d+)", s)]


def do_finish(job):
    global OX, OY
    OX, OY = job["origin_mm"]
    board = pcbnew.LoadBoard(job["in_pcb"])
    routes = job["routes"]
    nets = {}
    for ni in board.GetNetInfo().NetsByName().values():
        nets[ni.GetNetname()] = ni

    for t in routes.get("tracks", []):
        tr = pcbnew.PCB_TRACK(board)
        tr.SetStart(V(t["x1"], t["y1"]))
        tr.SetEnd(V(t["x2"], t["y2"]))
        tr.SetWidth(MM(t["width"]))
        tr.SetLayer(layer_id(t["layer"]))
        tr.SetNet(nets[t["net"]])
        board.Add(tr)
    for v in routes.get("vias", []):
        via = pcbnew.PCB_VIA(board)
        via.SetPosition(V(v["x"], v["y"]))
        via.SetViaType(pcbnew.VIATYPE_THROUGH)
        try:
            via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
        except Exception:  # noqa: BLE001
            pass
        try:
            via.SetWidth(pcbnew.F_Cu, MM(v["dia"]))
            via.SetWidth(pcbnew.B_Cu, MM(v["dia"]))
        except TypeError:
            via.SetWidth(MM(v["dia"]))
        via.SetDrill(MM(v["drill"]))
        via.SetNet(nets[v["net"]])
        board.Add(via)

    for k in job.get("keepouts", []):  # rule areas: no zone fill / tracks / vias (the pour below honours them)
        ra = pcbnew.ZONE(board)
        ra.SetIsRuleArea(True)
        ra.SetDoNotAllowZoneFills(True)
        ra.SetDoNotAllowTracks(True)
        ra.SetDoNotAllowVias(True)
        ra.SetDoNotAllowPads(False)
        ra.SetDoNotAllowFootprints(False)
        ls = pcbnew.LSET()
        for ln in (["F.Cu", "B.Cu"] if k["layers"] == "both" else ["F.Cu"] if k["layers"] == "top" else ["B.Cu"]):
            ls.AddLayer(layer_id(ln))
        ra.SetLayerSet(ls)
        ol = ra.Outline()
        ol.NewOutline()
        for cx, cy in ((k["x_mm"], k["y_mm"]), (k["x_mm"] + k["width_mm"], k["y_mm"]), (k["x_mm"] + k["width_mm"], k["y_mm"] + k["height_mm"]), (k["x_mm"], k["y_mm"] + k["height_mm"])):
            pt = V(cx, cy)
            ol.Append(pt.x, pt.y)
        ra.SetZoneName("KEEPOUT " + (k.get("reason") or ""))
        board.Add(ra)

    z = routes.get("pour")
    if z:
        W, H = job["board"]["width"], job["board"]["height"]
        for ln in z["layers"]:
            zone = pcbnew.ZONE(board)
            zone.SetLayer(layer_id(ln))
            zone.SetNet(nets[z["net"]])
            zone.SetIsFilled(False)
            zone.SetMinThickness(MM(z.get("min_thickness", 0.25)))
            zone.SetLocalClearance(MM(z["clearance"]))
            zone.SetPadConnection(pcbnew.ZONE_CONNECTION_FULL)
            zone.SetThermalReliefGap(MM(0.3))
            zone.SetThermalReliefSpokeWidth(MM(0.4))
            try:
                zone.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)
            except Exception:  # noqa: BLE001
                pass
            ol = zone.Outline()
            ol.NewOutline()
            for (x, y) in ((0, 0), (W, 0), (W, H), (0, H)):
                ol.Append(MM(x + OX), MM(y + OY))
            board.Add(zone)
        # through-hole pads of the pour net: thermal relief makes hand soldering feasible
        for fp in board.GetFootprints():
            for pad in fp.Pads():
                if pad.GetNetname() == z["net"] and pad.GetAttribute() == pcbnew.PAD_ATTRIB_PTH:
                    pad.SetLocalZoneConnection(pcbnew.ZONE_CONNECTION_THERMAL)
        filler = pcbnew.ZONE_FILLER(board)
        filler.Fill(board.Zones())
    # drill/place origin = board top-left corner, so gerbers/drill/STEP use board-relative coordinates
    try:
        board.GetDesignSettings().SetAuxOrigin(pcbnew.VECTOR2I(MM(OX), MM(OY)))
    except Exception:  # noqa: BLE001
        pass
    pcbnew.SaveBoard(job["out_pcb"], board)


def main():
    mode, job_path = sys.argv[1], sys.argv[2]
    with open(job_path) as f:
        job = json.load(f)
    if mode == "place":
        do_place(job)
    elif mode == "finish":
        do_finish(job)
    else:
        raise SystemExit("unknown mode %s" % mode)
    print("OK")


if __name__ == "__main__":
    main()
