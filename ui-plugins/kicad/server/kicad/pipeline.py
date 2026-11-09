"""spec -> placed board (pcbnew) -> routed (our router) -> finished board (pcbnew) -> DRC (kicad-cli)."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import paths, verify
from .checker import CheckReport, check_spec
from .router import RouteNet, RouteResult, RouteRules, Router, connectivity_problems, verify_routes
from .runner import run_pcb_script
from .spec import CircuitSpec, all_keepouts

ORIGIN_MM = (50.0, 50.0)  # board top-left inside the KiCad page; subtracted again everywhere we report coordinates


@dataclass
class BuildResult:
    pcb_path: Path
    layout: dict
    route: RouteResult | None
    drc: verify.DrcSummary
    check: CheckReport
    spec: CircuitSpec
    timings: dict = field(default_factory=dict)
    workdir: Path | None = None

    @property
    def ok(self) -> bool:
        return self.drc.passed and (self.route is None or self.route.complete)


def default_grid_mm(spec: CircuitSpec) -> float:
    """0.1 mm for small boards (<= ~85x85 mm); coarser for big ones so that routing time stays bounded."""
    area = spec.outline.width_mm * spec.outline.height_mm
    return 0.1 if area <= 7000 else (0.15 if area <= 16000 else 0.2)


def route_rules(spec: CircuitSpec, grid_mm: float | None = None) -> RouteRules:
    r = spec.rules
    return RouteRules(
        grid_mm=grid_mm or default_grid_mm(spec), clearance_mm=r.clearance_mm, edge_clearance_mm=r.edge_clearance_mm,
        signal_width_mm=r.signal_width_mm, power_width_mm=r.power_width_mm,
        via_diameter_mm=r.via_diameter_mm, via_drill_mm=r.via_drill_mm, time_budget_s=40.0,
    )


def route_layout(spec: CircuitSpec, layout: dict, grid_mm: float | None = None) -> RouteResult:
    if "keepouts" not in layout:
        layout = {**layout, "keepouts": [k.model_dump() for k in all_keepouts(spec)]}
    nets = [RouteNet(n.name, spec.track_width(n), spec.net_kind(n.name)) for n in spec.nets]
    return Router(layout, nets, route_rules(spec, grid_mm), pour_net=spec.pour_net).route()


def build_board(spec: CircuitSpec, workdir: Path, route: bool = True, check: CheckReport | None = None,
                grid_mm: float | None = None, run_drc: bool = True) -> BuildResult:
    """Build ``<workdir>/<name>.kicad_pcb``. ``spec`` must already pass the checker (errors raise ValueError)."""
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    check = check or check_spec(spec)
    if not check.ok:
        raise ValueError("spec has errors; run the checker and fix them first: " + "; ".join(i.message for i in check.errors[:5]))
    t = {}
    norm = CircuitSpec.model_validate(check.normalized_spec)
    base = workdir / "base.kicad_pcb"
    layout_path = workdir / "layout.json"
    t0 = time.time()
    run_pcb_script("place", {
        "spec": check.normalized_spec, "footprints_dir": str(paths.footprints_dir()), "origin_mm": list(ORIGIN_MM),
        "out_pcb": str(base), "out_layout": str(layout_path),
    }, workdir)
    layout = json.loads(layout_path.read_text())
    layout["keepouts"] = [k.model_dump() for k in all_keepouts(norm)]
    t["place_s"] = round(time.time() - t0, 2)

    res: RouteResult | None = None
    routes: dict = {"tracks": [], "vias": []}
    if route:
        t0 = time.time()
        res = route_layout(norm, layout, grid_mm)
        routes = {"tracks": res.tracks, "vias": res.vias}
        t["route_s"] = round(time.time() - t0, 2)
    if norm.pour_net and norm.pour_net in {n.name for n in norm.nets}:
        routes["pour"] = {"net": norm.pour_net, "layers": ["F.Cu", "B.Cu"], "clearance": norm.rules.clearance_mm, "min_thickness": 0.25}

    out = workdir / f"{norm.name}.kicad_pcb"
    t0 = time.time()
    run_pcb_script("finish", {
        "in_pcb": str(base), "out_pcb": str(out), "origin_mm": list(ORIGIN_MM), "routes": routes,
        "board": layout["board"], "keepouts": layout["keepouts"],
    }, workdir)
    t["finish_s"] = round(time.time() - t0, 2)
    verify.write_project_file(out, norm.rules, [n for n in norm.power_nets])
    if run_drc:
        t0 = time.time()
        drc = verify.run_drc(out, workdir, origin=ORIGIN_MM)
        t["drc_s"] = round(time.time() - t0, 2)
    else:
        drc = verify.DrcSummary()
    return BuildResult(pcb_path=out, layout=layout, route=res, drc=drc, check=check, spec=norm, timings=t, workdir=workdir)


def sanity_check_routes(spec: CircuitSpec, layout: dict, res: RouteResult) -> list[str]:
    """Pure-python re-check of a RouteResult (clearance + connectivity)."""
    if "keepouts" not in layout:
        layout = {**layout, "keepouts": [k.model_dump() for k in all_keepouts(spec)]}
    return verify_routes(layout, res, route_rules(spec)) + connectivity_problems(layout, res, skip_net=spec.pour_net)
