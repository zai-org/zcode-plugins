"""DRC + fabrication export through ``kicad-cli`` (the stable interface; SWIG is only used by the builder)."""
from __future__ import annotations

import json
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .runner import KiCadError, run_cli
from .spec import Rules

GERBER_LAYERS = "F.Cu,B.Cu,F.Paste,B.Paste,F.SilkS,B.SilkS,F.Mask,B.Mask,Edge.Cuts"

# DRC rule types that mean "this board should not be ordered". Everything else at severity error is also a failure;
# warnings are reported but do not fail the check.
FAIL_TYPES_ANY_SEVERITY = {"clearance", "shorting_items", "unconnected_items", "track_dangling", "via_dangling"}


def project_settings(rules: Rules, pour_net: str | None = None, power_nets: list[str] | None = None) -> dict:
    """Minimal ``.kicad_pro`` so that kicad-cli (DRC, plot) uses OUR design rules instead of KiCad defaults."""
    r = rules
    default_cls = {
        "name": "Default", "priority": 2147483647,
        "clearance": r.clearance_mm, "track_width": r.signal_width_mm,
        "via_diameter": r.via_diameter_mm, "via_drill": r.via_drill_mm,
        "diff_pair_width": 0.2, "diff_pair_gap": 0.25, "diff_pair_via_gap": 0.25,
        "microvia_diameter": 0.3, "microvia_drill": 0.1, "wire_width": 6, "bus_width": 12, "line_style": 0,
        "pcb_color": "rgba(0, 0, 0, 0.000)", "schematic_color": "rgba(0, 0, 0, 0.000)",
    }
    power_cls = dict(default_cls, name="Power", priority=0, track_width=r.power_width_mm)
    classes = [default_cls]
    patterns = []
    if power_nets:
        classes.append(power_cls)
        patterns = [{"netclass": "Power", "pattern": n} for n in power_nets]
    return {
        "meta": {"version": 3},
        "board": {
            "design_settings": {
                "defaults": {"board_outline_line_width": 0.05, "copper_line_width": 0.2, "copper_text_size_h": 1.5,
                             "copper_text_size_v": 1.5, "copper_text_thickness": 0.3, "silk_line_width": 0.1,
                             "silk_text_size_h": 1.0, "silk_text_size_v": 1.0, "silk_text_thickness": 0.15},
                "rules": {
                    "min_clearance": r.clearance_mm,
                    "min_connection": 0.0,
                    "min_copper_edge_clearance": r.edge_clearance_mm,
                    "min_hole_clearance": 0.25,
                    "min_hole_to_hole": 0.25,
                    "min_microvia_diameter": 0.2,
                    "min_microvia_drill": 0.1,
                    "min_resolved_spokes": 2,
                    "min_silk_clearance": 0.0,
                    "min_text_height": 0.8,
                    "min_text_thickness": 0.08,
                    "min_through_hole_diameter": 0.3,
                    "min_track_width": min(r.signal_width_mm, r.power_width_mm, 0.2),
                    "min_via_annular_width": 0.1,
                    "min_via_diameter": 0.5,
                    "use_height_for_length_calcs": True,
                },
                "rule_severities": {
                    # library bookkeeping only: our footprints come straight from the official libs but the headless
                    # project has no fp-lib-table, which would otherwise raise one warning per footprint library
                    "lib_footprint_issues": "ignore",
                    "lib_footprint_mismatch": "ignore",
                    "footprint_filters_mismatch": "ignore",
                },
            }
        },
        "net_settings": {
            "classes": classes,
            "meta": {"version": 4},
            "net_colors": None,
            "netclass_assignments": None,
            "netclass_patterns": patterns,
        },
    }


def write_project_file(pcb_path: Path, rules: Rules, power_nets: list[str] | None = None) -> Path:
    pro = Path(pcb_path).with_suffix(".kicad_pro")
    pro.write_text(json.dumps(project_settings(rules, power_nets=power_nets), indent=2))
    return pro


@dataclass
class DrcSummary:
    n_errors: int = 0
    n_warnings: int = 0
    n_unconnected: int = 0
    n_parity: int = 0
    by_type: dict = field(default_factory=dict)
    violations: list[dict] = field(default_factory=list)  # first N, with positions in board coords
    unconnected: list[dict] = field(default_factory=list)
    kicad_version: str = ""

    @property
    def passed(self) -> bool:
        """No errors, no unconnected items, no clearance/short class violations at any severity."""
        if self.n_errors or self.n_unconnected:
            return False
        return not any(t in FAIL_TYPES_ANY_SEVERITY for t in self.by_type)

    def to_dict(self) -> dict:
        return {
            "passed": self.passed, "errors": self.n_errors, "warnings": self.n_warnings, "unconnected": self.n_unconnected,
            "by_type": self.by_type, "violations": self.violations, "unconnected_items": self.unconnected,
            "kicad_version": self.kicad_version,
        }


def _items(v: dict, origin: tuple[float, float]) -> list[dict]:
    out = []
    for it in v.get("items", []):
        pos = it.get("pos") or {}
        out.append({"what": it.get("description", ""), "x_mm": round(pos.get("x", 0) - origin[0], 3), "y_mm": round(pos.get("y", 0) - origin[1], 3)})
    return out


def run_drc(pcb_path: Path, workdir: Path, origin: tuple[float, float] = (0.0, 0.0), refill: bool = False, max_listed: int = 25) -> DrcSummary:
    out = Path(workdir) / "drc.json"
    args = ["pcb", "drc", "--format", "json", "--severity-all", "--all-track-errors", "--units", "mm", "-o", str(out)]
    if refill:
        args.append("--refill-zones")
    args.append(str(pcb_path))
    run_cli(args, timeout=240, cwd=workdir, ok_codes=(0, 5))
    if not out.exists():
        raise KiCadError("kicad-cli pcb drc produced no report")
    data = json.loads(out.read_text())
    s = DrcSummary(kicad_version=str(data.get("kicad_version", "")))
    viol = data.get("violations", []) or []
    s.n_errors = sum(1 for v in viol if v.get("severity") == "error")
    s.n_warnings = sum(1 for v in viol if v.get("severity") == "warning")
    s.by_type = dict(Counter(v.get("type", "?") for v in viol if v.get("severity") in ("error", "warning")))
    for v in viol:
        if v.get("severity") not in ("error", "warning"):
            continue
        if len(s.violations) < max_listed:
            s.violations.append({"type": v.get("type"), "severity": v.get("severity"), "description": v.get("description"), "items": _items(v, origin)})
    unc = data.get("unconnected_items", []) or []
    s.n_unconnected = len(unc)
    for v in unc[:max_listed]:
        s.unconnected.append({"description": v.get("description"), "items": _items(v, origin)})
    s.n_parity = len(data.get("schematic_parity", []) or [])
    return s


# ---------------------------------------------------------------------------------------------- fab export
def export_gerber_zip(pcb_path: Path, outdir: Path, zip_name: str) -> tuple[Path, list[str]]:
    """Gerbers (RS-274X + X2) and Excellon drill files (PTH/NPTH separated) zipped for upload to a fab."""
    outdir = Path(outdir)
    gdir = outdir / "gerbers"
    gdir.mkdir(parents=True, exist_ok=True)
    run_cli(["pcb", "export", "gerbers", "--layers", GERBER_LAYERS, "--subtract-soldermask", "--use-drill-file-origin",
             "-o", str(gdir) + "/", str(pcb_path)], timeout=240, cwd=outdir)
    run_cli(["pcb", "export", "drill", "--format", "excellon", "--drill-origin", "plot", "--excellon-units", "mm",
             "--excellon-separate-th", "-o", str(gdir) + "/", str(pcb_path)], timeout=240, cwd=outdir)
    for f in list(gdir.glob("*-NPTH.drl")):  # an NPTH drill file without any hole only confuses fab uploads
        if "\nT" not in f.read_text(errors="replace"):
            f.unlink()
    files = sorted(p for p in gdir.iterdir() if p.is_file())
    if not files:
        raise KiCadError("kicad-cli produced no gerber files")
    zp = outdir / zip_name
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, arcname=f.name)
    return zp, [f.name for f in files]


def render_geometry(board_w: float, board_h: float, width: int = 1400) -> tuple[int, int, float]:
    """(width, height, zoom) so the board fills ~85% of the frame. kicad-cli's ortho camera fits the board DIAGONAL to
    the image height at zoom 1 (measured), so zoom = 0.85 * min(width * diag / (w * height), diag / h)."""
    height = int(max(520, min(1400, width * (board_h / board_w) + 160)))
    diag = (board_w ** 2 + board_h ** 2) ** 0.5
    zoom = 0.85 * min(width * diag / (board_w * height), diag / board_h)
    return width, height, round(max(0.5, min(zoom, 2.5)), 2)


def render_png(pcb_path: Path, out_png: Path, side: str = "top", width: int = 1600, height: int = 1000, quality: str = "basic",
               zoom: float = 1.0) -> Path:
    if side not in ("top", "bottom"):
        raise KiCadError("side must be 'top' or 'bottom'")
    run_cli(["pcb", "render", "--side", side, "--width", str(width), "--height", str(height), "--quality", quality,
             "--zoom", str(zoom), "--background", "opaque", "-o", str(out_png), str(pcb_path)], timeout=300, cwd=Path(out_png).parent)
    if not Path(out_png).exists():
        raise KiCadError("kicad-cli pcb render produced no image")
    return Path(out_png)


def export_step(pcb_path: Path, out_step: Path) -> Path:
    run_cli(["pcb", "export", "step", "--subst-models", "--drill-origin", "--force", "-o", str(out_step), str(pcb_path)], timeout=600, cwd=Path(out_step).parent)
    if not Path(out_step).exists():
        raise KiCadError("kicad-cli pcb export step produced no file")
    return Path(out_step)
