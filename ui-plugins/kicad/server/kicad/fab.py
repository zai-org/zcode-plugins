"""Fabrication/assembly documents generated from the circuit spec: BOM, placement (pos) CSV, human-facing report."""
from __future__ import annotations

import csv
import hashlib
import io
from collections import defaultdict
from datetime import datetime, timezone

from . import library as lib
from .spec import CircuitSpec

LIMITATIONS = [
    "2-layer boards only; no RF/microwave, high-voltage/creepage, HDI/microvias, impedance control, differential pairs or length matching.",
    "Automatic placement is NOT done: part positions come from the spec. Routing is a simple grid router (45-degree tracks, through vias).",
    "Pin names/numbers come from the official KiCad libraries; they were NOT cross-checked against datasheets. Verify critical pins (power, polarity) yourself.",
    "No schematic is produced; the spec checker replaces ERC. DRC does not check electrical correctness, only manufacturability rules.",
    "BOM/pos files are bare-board helpers: part availability, LCSC numbers and pick-and-place rotation offsets are NOT verified (no PCBA support yet).",
]


def _short_fp(fp: str) -> str:
    return fp.split(":", 1)[-1]


def bom_rows(spec: CircuitSpec) -> list[dict]:
    groups: dict[tuple, list[str]] = defaultdict(list)
    for p in spec.parts:
        groups[(p.value or p.symbol.split(":")[-1], p.footprint, p.lcsc or "", p.symbol)].append(p.ref)
    rows = []
    for (value, fp, lcsc, sym), refs in groups.items():
        refs.sort(key=lib.natural_key)
        rows.append({"comment": value, "designators": ",".join(refs), "refs": refs, "footprint": _short_fp(fp), "footprint_id": fp,
                     "quantity": len(refs), "lcsc": lcsc, "symbol": sym})
    rows.sort(key=lambda r: lib.natural_key(r["refs"][0]))
    return rows


def bom_csv(spec: CircuitSpec) -> str:
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(["Comment", "Designator", "Footprint", "LCSC Part #", "Quantity", "Symbol"])
    for r in bom_rows(spec):
        w.writerow([r["comment"], r["designators"], r["footprint"], r["lcsc"], r["quantity"], r["symbol"]])
    return out.getvalue()


def pos_csv(spec: CircuitSpec) -> str:
    """Placement file in KiCad's convention: origin = board top-left, +X right, +Y UP (so Y = -y_spec), mm, degrees."""
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(["Designator", "Val", "Package", "Mid X", "Mid Y", "Rotation", "Layer"])
    for p in sorted(spec.parts, key=lambda p: lib.natural_key(p.ref)):
        w.writerow([p.ref, p.value, _short_fp(p.footprint), f"{p.x_mm:.4f}", f"{-p.y_mm:.4f}", f"{p.rotation % 360:.1f}", p.side])
    return out.getvalue()


def is_smt_part(p) -> bool:
    """Machine-assemblable: no through-hole pads (pin headers, DIP packages are hand-soldered)."""
    try:
        pads = lib.get_footprint(p.footprint).pads
    except lib.LibraryError:
        return False
    return not any(pad.ptype == "thru_hole" and not (p.no_thermal_vias and pad.drill and min(pad.drill) < 0.3) for pad in pads)  # dropped thermal vias don't count


def jlc_bom_csv(spec: CircuitSpec) -> str:
    """BOM in the column layout 嘉立创 SMT expects: Comment, Designator, Footprint, LCSC Part #. SMD parts only; every one needs an LCSC number."""
    groups: dict[tuple, list[str]] = defaultdict(list)
    for p in spec.parts:
        if is_smt_part(p):
            groups[(p.value or p.symbol.split(":")[-1], _short_fp(p.footprint), p.lcsc or "")].append(p.ref)
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(["Comment", "Designator", "Footprint", "LCSC Part #"])
    for (value, fp, lcsc), refs in sorted(groups.items(), key=lambda kv: lib.natural_key(sorted(kv[1], key=lib.natural_key)[0])):
        w.writerow([value, ",".join(sorted(refs, key=lib.natural_key)), fp, lcsc])
    return out.getvalue()


# 嘉立创's footprint library draws some packages rotated against KiCad's convention. Verified in the SMT order page's placement preview
# (2026-10-19): SOT-23 (3-pin) and SOT-223 came out 180 deg off when the KiCad rotation was passed through. Other packages are NOT verified:
# always check the preview before paying.
JLC_ROTATION_OFFSET = {"SOT-23": 180.0, "SOT-223": 180.0}


def jlc_rotation(p) -> float:
    name = _short_fp(p.footprint)
    off = JLC_ROTATION_OFFSET.get(name, 0.0) or (180.0 if name.startswith("SOT-223-3") else 0.0)  # SOT-23-5/-6 etc. are deliberately not matched
    return (p.rotation + off) % 360


def jlc_cpl_csv(spec: CircuitSpec) -> str:
    """Component placement list for 嘉立创: origin = board bottom-left, +X right, +Y up, mm, rotation in degrees counter-clockwise, Layer Top/Bottom."""
    H = float(spec.outline.height_mm)
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow(["Designator", "Mid X", "Mid Y", "Layer", "Rotation"])
    for p in sorted(spec.parts, key=lambda p: lib.natural_key(p.ref)):
        if is_smt_part(p):
            w.writerow([p.ref, f"{p.x_mm:.4f}mm", f"{H - p.y_mm:.4f}mm", "Top" if p.side == "top" else "Bottom", f"{jlc_rotation(p):.0f}"])
    return out.getvalue()


def smt_problems(spec: CircuitSpec) -> list[str]:
    """Things that stop an SMT order: SMD parts without an LCSC number, and fewer than 3 fiducials."""
    out = [f"{p.ref} has no LCSC part number" for p in spec.parts if is_smt_part(p) and not p.lcsc]
    if len(spec.fiducials) < 3:
        out.append(f"{len(spec.fiducials)} fiducial(s): SMT needs 3 MARK points")
    return out


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def build_report(*, spec: CircuitSpec, check: dict, drc: dict | None, route: dict | None, pin_table_text: str, pin_table: list[dict],
                 kicad_version: str, spec_artifact_id: str | None, pcb_artifact_id: str | None, gerber_files: list[str] | None = None,
                 gerber_sha256: str | None = None) -> dict:
    """The document a human reviews before ordering."""
    drc_ok = bool(drc and drc.get("passed"))
    routed = route is None or not route.get("unrouted")
    spec_ok = bool(check.get("ok"))
    problems = []
    if not spec_ok:
        problems.append("spec checker reported errors")
    if not drc_ok:
        problems.append("DRC did not pass")
    if not routed:
        problems.append("some connections are unrouted")
    return {
        "type": "pcb_report",
        "title": spec.name,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ready_to_order": spec_ok and drc_ok and routed,
        "blocking_problems": problems,
        "board": {"width_mm": spec.outline.width_mm, "height_mm": spec.outline.height_mm, "layers": spec.layers,
                  "corner_radius_mm": spec.outline.corner_radius_mm, "mounting_holes": len(spec.mounting_holes)},
        "design_rules": spec.rules.model_dump(),
        "checks": {
            "spec": {"ok": spec_ok, "n_errors": check.get("n_errors", 0), "n_warnings": check.get("n_warnings", 0), "issues": check.get("issues", [])},
            "drc": drc,
            "routing": route,
        },
        "pin_table": pin_table,
        "pin_table_text": pin_table_text,
        "bom": bom_rows(spec),
        "nets": {n.name: n.pins for n in spec.nets},
        "fab": {"gerber_files": gerber_files or [], "gerber_zip_sha256": gerber_sha256},
        "sources": {"spec_artifact_id": spec_artifact_id, "pcb_artifact_id": pcb_artifact_id, "kicad_version": kicad_version},
        "limitations": LIMITATIONS,
        "human_signoff_checklist": [
            "I checked the pin table: every power/ground/polarity pin goes to the net I intend.",
            "I reviewed the top and bottom renders and the board outline/size.",
            "I understand custom boards are not refundable if the design is wrong.",
        ],
    }
