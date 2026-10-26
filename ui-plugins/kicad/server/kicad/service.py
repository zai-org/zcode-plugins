"""Store-aware PCB operations (what the MCP tools call). Every function returns a JSON-serialisable dict and never raises:

    {"ok": bool, "error": str | None, "artifacts": [{"artifact_id", "kind", "name"}], ...}
"""
from __future__ import annotations

import io
import json
import shutil
import zipfile
from pathlib import Path

from .store import Artifact, ArtifactStore

from . import fab, library as lib, paths, verify
from .checker import check_spec, render_pin_table
from .pipeline import ORIGIN_MM, build_board
from .runner import KiCadError
from .spec import CircuitSpec, Rules, load_spec


def _art(a: Artifact) -> dict:
    return {"artifact_id": a.artifact_id, "kind": a.kind, "name": a.name}


def _fail(msg: str, **extra) -> dict:
    return {"ok": False, "error": msg, "artifacts": [], **extra}


def _error_dict(fn_name: str, e: Exception) -> dict:
    if isinstance(e, KeyError):
        return _fail(f"Unknown id: {e.args[0] if e.args else e}. Check project_id / artifact_id.")
    if isinstance(e, paths.KiCadMissing):
        return _fail(f"KiCad is not available on this machine: {e}")
    if isinstance(e, KiCadError):
        return _fail(f"KiCad step failed: {e}")
    if isinstance(e, lib.LibraryError):
        return _fail(e.msg, suggestions=e.suggestions)
    if isinstance(e, ValueError):
        return _fail(str(e))
    return _fail(f"Internal error in {fn_name}: {type(e).__name__}: {e}")


def _guard(fn):
    """Turn every exception into a structured, actionable error (agents must never see a raw traceback)."""
    def wrapper(self, *a, **kw):
        try:
            return fn(self, *a, **kw)
        except Exception as e:  # noqa: BLE001
            return _error_dict(fn.__name__, e)
    wrapper.__name__ = fn.__name__
    wrapper.__doc__ = fn.__doc__
    return wrapper


def _guard_png(fn):
    """Same as _guard for functions returning (dict, png_bytes | None)."""
    def wrapper(self, *a, **kw):
        try:
            return fn(self, *a, **kw)
        except Exception as e:  # noqa: BLE001
            return _error_dict(fn.__name__, e), None
    wrapper.__name__ = fn.__name__
    wrapper.__doc__ = fn.__doc__
    return wrapper


class PcbService:
    def __init__(self, store: ArtifactStore):
        self.store = store

    # ------------------------------------------------------------------ helpers
    def _project(self, project_id: str):
        if not self.store.project_exists(project_id):
            raise ValueError(f"Unknown project_id '{project_id}'.")

    def _artifact(self, project_id: str, artifact_id: str, kind: str) -> Artifact:
        a = self.store.get(artifact_id)
        if a.project_id != project_id:
            raise ValueError(f"Artifact {artifact_id} does not belong to project {project_id}.")
        if a.kind != kind:
            raise ValueError(f"Artifact {artifact_id} is a '{a.kind}', expected '{kind}'.")
        return a

    def _load_spec(self, project_id: str, spec_artifact_id: str) -> tuple[Artifact, CircuitSpec]:
        a = self._artifact(project_id, spec_artifact_id, "circuit_spec")
        spec, errs = load_spec(json.loads(self.store.path(a.artifact_id).read_text()))
        if spec is None:
            raise ValueError("Stored spec is invalid: " + "; ".join(errs))
        return a, spec

    # ------------------------------------------------------------------ library
    @_guard
    def search_parts(self, query: str, kind: str = "both", limit: int = 12) -> dict:
        if kind not in ("symbol", "footprint", "both"):
            return _fail("kind must be 'symbol', 'footprint' or 'both'.")
        if not paths.libraries_available():
            return _fail("KiCad libraries not found (install KiCad or set ZCODE_KICAD_APP).")
        limit = max(1, min(int(limit), 40))
        out: dict = {"ok": True, "error": None, "artifacts": [], "query": query}
        notes = []
        if kind in ("symbol", "both"):
            hits = lib.search_symbols(query, limit)
            if not hits and len(query.split()) > 1:
                hits = lib.search_symbols(query, limit, match_any=True)  # best matches for any of the words
                if hits:
                    notes.append("No symbol matched all words; showing symbols that match some of them.")
            for h in hits[:8]:  # enrich the first few with pin counts
                try:
                    s = lib.get_symbol(h["lib_id"])
                    h["n_pins"] = len(s.pins)
                    h["ref_prefix"] = s.ref_prefix
                except lib.LibraryError:
                    pass
            out["symbols"] = hits
        if kind in ("footprint", "both"):
            fps = lib.search_footprints(query, limit)
            if not fps and len(query.split()) > 1:
                fps = lib.search_footprints(query, limit, match_any=True)
                if fps:
                    notes.append("No footprint matched all words; showing footprints that match some of them.")
            out["footprints"] = fps
        if notes:
            out["note"] = " ".join(notes)
        return out

    @_guard
    def part_info(self, symbol: str, footprint: str | None = None) -> dict:
        s = lib.get_symbol(symbol)
        out: dict = {
            "ok": True, "error": None, "artifacts": [],
            "symbol": {
                "id": s.lib_id, "description": s.description, "datasheet": s.datasheet, "ref_prefix": s.ref_prefix,
                "default_footprint": s.default_footprint, "footprint_filters": list(s.fp_filters),
                "pins": [{"number": p.number, "name": p.display_name or "~", "type": p.etype, **({"hidden": True} if p.hidden else {})}
                         for p in sorted(s.pins, key=lambda p: lib.natural_key(p.number))],
            },
        }
        if footprint:
            f = lib.get_footprint(footprint)
            m = lib.pin_pad_mapping(s, f)
            bb = f.bbox()
            out["footprint"] = {
                "id": f.lib_id, "description": f.description, "tags": f.tags, "attr": list(f.attr),
                "origin_note": "x/y below are relative to the footprint origin (the part's x_mm,y_mm); y points down",
                "courtyard": {"x_min": bb[0], "y_min": bb[1], "x_max": bb[2], "y_max": bb[3], "width": round(bb[2] - bb[0], 3), "height": round(bb[3] - bb[1], 3)},
                "pads": [{"number": p.number, "type": p.ptype, "shape": p.shape, "x": p.x, "y": p.y, "w": p.w, "h": p.h,
                          **({"drill": p.drill[0] if p.drill[0] == p.drill[1] else list(p.drill)} if p.drill else {}), "layers": list(p.layers)}
                         for p in f.pads],
            }
            out["pin_pad_mapping"] = {
                "consistent": not m["pins_without_pad"],
                "pins_without_pad": m["pins_without_pad"], "pads_without_pin": m["pads_without_pin"],
                "rule": "Symbol pin N is wired to footprint pad N (same number).",
                "filters_match": lib.footprint_matches_filters(footprint, s.fp_filters),
            }
            if m["pins_without_pad"]:
                out["ok"] = False
                out["error"] = f"Footprint '{footprint}' does not have pads for symbol pins {m['pins_without_pad']}; choose another footprint."
        else:
            top, total = lib.compatible_footprints(s)
            out["compatible_footprints"] = top
            out["compatible_footprints_total"] = total
            if total > len(top):
                out["note"] = "Many footprints fit this symbol; narrow down with pcb_search_parts(query, kind='footprint') (e.g. '0603', 'sot-23-5')."
        return out

    # ------------------------------------------------------------------ spec
    @_guard
    def check_spec(self, project_id: str, spec: dict) -> dict:
        self._project(project_id)
        if not paths.libraries_available():
            return _fail("KiCad libraries not found (install KiCad or set ZCODE_KICAD_APP).")
        model, errs = load_spec(spec)
        if model is None:
            return _fail("Invalid spec structure: " + "; ".join(errs[:8]), validation_errors=errs)
        rep = check_spec(model)
        d = rep.to_dict()
        art = self.store.put_bytes(
            project_id, json.dumps(rep.normalized_spec, indent=1).encode(), kind="circuit_spec", name=f"{model.name}.spec.json",
            meta={"check_ok": rep.ok, "n_errors": len(rep.errors), "n_warnings": len(rep.warnings),
                  "width_mm": model.outline.width_mm, "height_mm": model.outline.height_mm, "layers": model.layers},
        )
        d["artifacts"] = [_art(art)]
        d["spec_artifact_id"] = art.artifact_id
        if rep.ok:
            d["error"] = None
            d["next"] = "Spec is consistent. Call pcb_build(project_id, spec_artifact_id) to place, route and run DRC."
        else:
            d["error"] = f"Spec has {len(rep.errors)} error(s); fix them and call pcb_check_spec again."
        return d

    # ------------------------------------------------------------------ build
    @_guard
    def build(self, project_id: str, spec_artifact_id: str, route: bool = True) -> dict:
        self._project(project_id)
        spec_art, spec = self._load_spec(project_id, spec_artifact_id)
        rep = check_spec(spec)
        if not rep.ok:
            return _fail(f"Spec has {len(rep.errors)} error(s); run pcb_check_spec and fix them first.",
                         issues=[i.to_dict() for i in rep.errors][:20])
        scratch = self.store.scratch_dir(project_id, "pcbbuild")
        try:
            res = build_board(spec, scratch, route=route, check=rep)
            routing = None
            if res.route is not None:
                routing = {"complete": res.route.complete, "unrouted": res.route.unrouted[:25], "warnings": res.route.warnings,
                           "stats": res.route.stats, "tracks": len(res.route.tracks), "vias": len(res.route.vias)}
            meta = {
                "spec_artifact_id": spec_art.artifact_id, "width_mm": spec.outline.width_mm, "height_mm": spec.outline.height_mm,
                "layers": spec.layers, "rules": spec.rules.model_dump(), "power_nets": spec.power_nets, "pcb_name": spec.name,
                "origin_mm": list(ORIGIN_MM), "routed": route, "drc_passed": bool(res.drc.passed),
                "drc": {k: v for k, v in res.drc.to_dict().items() if k not in ("violations", "unconnected_items")},
                "routing": routing, "unrouted": len(res.route.unrouted) if res.route else None,
                "kicad_version": paths.kicad_version(),
            }
            pcb = self.store.put_file(project_id, res.pcb_path, kind="kicad_pcb", name=f"{spec.name}.kicad_pcb", parent_id=spec_art.artifact_id, meta=meta)
        finally:
            self.store.cleanup_scratch(scratch)

        drc = res.drc.to_dict()
        problems = []
        if routing and not routing["complete"]:
            problems.append(f"{len(routing['unrouted'])} connection(s) could not be routed")
        if not res.drc.passed:
            problems.append(f"DRC failed ({res.drc.n_errors} errors, {res.drc.n_unconnected} unconnected, types: {res.drc.by_type})")
        ok = not problems
        out = {
            "ok": ok,
            "error": None if ok else "Board built but is NOT manufacturable: " + "; ".join(problems) + ".",
            "artifacts": [_art(pcb)], "pcb_artifact_id": pcb.artifact_id,
            "drc": drc, "routing": routing,
            "board": {"width_mm": spec.outline.width_mm, "height_mm": spec.outline.height_mm, "layers": spec.layers, "parts": len(spec.parts)},
            "timings_s": res.timings,
        }
        if ok:
            out["next"] = "Call pcb_render (top and bottom) to inspect, then pcb_export_fab to produce gerbers + report."
        else:
            out["next"] = ("Move parts (more spacing, shorter nets, parts closer to their connectors), enlarge the board or fix the listed DRC items, "
                           "re-run pcb_check_spec and pcb_build. Use pcb_render to see the current state.")
        return out

    # ------------------------------------------------------------------ render
    @_guard_png
    def render(self, project_id: str, artifact_id: str, side: str = "top") -> tuple[dict, bytes | None]:
        self._project(project_id)
        if side not in ("top", "bottom"):
            return _fail("side must be 'top' or 'bottom'."), None
        a = self._artifact(project_id, artifact_id, "kicad_pcb")
        scratch = self.store.scratch_dir(project_id, "pcbrender")
        try:
            pcb = self._stage_pcb(a, scratch)
            w, h = a.meta.get("width_mm", 30), a.meta.get("height_mm", 20)
            width, height, zoom = verify.render_geometry(w, h)
            png = scratch / f"{a.meta.get('pcb_name', 'board')}_{side}.png"
            verify.render_png(pcb, png, side=side, width=width, height=height, zoom=zoom)
            data = png.read_bytes()
            art = self.store.put_bytes(project_id, data, kind="png", name=png.name, parent_id=a.artifact_id, meta={"side": side, "source": "kicad-cli pcb render"})
        finally:
            self.store.cleanup_scratch(scratch)
        return {"ok": True, "error": None, "artifacts": [_art(art)], "side": side, "artifact_id": art.artifact_id}, data

    # ------------------------------------------------------------------ export
    def _stage_pcb(self, a: Artifact, scratch: Path) -> Path:
        name = a.meta.get("pcb_name") or Path(a.name).stem
        pcb = scratch / f"{name}.kicad_pcb"
        shutil.copyfile(self.store.path(a.artifact_id), pcb)
        rules = Rules.model_validate(a.meta.get("rules") or {})
        verify.write_project_file(pcb, rules, a.meta.get("power_nets") or [])
        return pcb

    @_guard
    def export_fab(self, project_id: str, artifact_id: str, include_step: bool = False) -> dict:
        self._project(project_id)
        a = self._artifact(project_id, artifact_id, "kicad_pcb")
        spec_art, spec = self._load_spec(project_id, a.meta["spec_artifact_id"])
        check = check_spec(spec)
        scratch = self.store.scratch_dir(project_id, "pcbexport")
        arts: list[Artifact] = []
        warnings: list[str] = []
        try:
            pcb = self._stage_pcb(a, scratch)
            drc = verify.run_drc(pcb, scratch, origin=ORIGIN_MM)
            route_info = a.meta.get("routing") or {"complete": False, "note": "board was built with route=False"}
            route_info = {**route_info, "unrouted": route_info.get("unrouted", [])}
            ok = check.ok and drc.passed and route_info["complete"]
            base_meta = {"width_mm": float(spec.outline.width_mm), "height_mm": float(spec.outline.height_mm), "layers": int(spec.layers),
                         "spec_artifact_id": spec_art.artifact_id, "pcb_artifact_id": a.artifact_id, "board_name": spec.name,
                         # true only with 0 DRC errors AND 0 unconnected items (the quote gate relies on this)
                         "drc_passed": bool(drc.passed and drc.n_errors == 0 and drc.n_unconnected == 0)}
            gerber_files: list[str] = []
            gsha = None
            if ok:
                zp, gerber_files = verify.export_gerber_zip(pcb, scratch, f"{spec.name}_gerber.zip")
                gbytes = zp.read_bytes()
                gsha = fab.sha256_bytes(gbytes)
                arts.append(self.store.put_bytes(project_id, gbytes, kind="gerber_zip", name=zp.name, parent_id=a.artifact_id,
                                                 meta={**base_meta, "files": gerber_files}))
                buf = io.BytesIO()
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:  # editable source: open in KiCad, rules included
                    z.write(pcb, pcb.name)
                    z.write(pcb.with_suffix(".kicad_pro"), pcb.with_suffix(".kicad_pro").name)
                    z.writestr(f"{spec.name}.spec.json", json.dumps(check.normalized_spec, indent=1))
                arts.append(self.store.put_bytes(project_id, buf.getvalue(), kind="kicad_project", name=f"{spec.name}_kicad_project.zip",
                                                 parent_id=a.artifact_id, meta=base_meta))
                arts.append(self.store.put_bytes(project_id, fab.bom_csv(spec).encode(), kind="bom", name=f"{spec.name}_bom.csv",
                                                 parent_id=a.artifact_id, meta=base_meta))
                arts.append(self.store.put_bytes(project_id, fab.pos_csv(spec).encode(), kind="pos", name=f"{spec.name}_pos.csv",
                                                 parent_id=a.artifact_id, meta=base_meta))
                smt_issues = fab.smt_problems(spec)
                if not smt_issues:  # PCBA-ready: files in the layout 嘉立创 SMT uploads expect
                    arts.append(self.store.put_bytes(project_id, fab.jlc_bom_csv(spec).encode(), kind="jlc_bom", name=f"{spec.name}_jlc_bom.csv",
                                                     parent_id=a.artifact_id, meta=base_meta))
                    arts.append(self.store.put_bytes(project_id, fab.jlc_cpl_csv(spec).encode(), kind="jlc_cpl", name=f"{spec.name}_jlc_cpl.csv",
                                                     parent_id=a.artifact_id, meta=base_meta))
                elif spec.fiducials or any(p.lcsc for p in spec.parts):
                    warnings.append("Not SMT-ready, so no JLC BOM/CPL: " + "; ".join(smt_issues[:8]))
                if include_step:
                    try:
                        sp = verify.export_step(pcb, scratch / f"{spec.name}.step")
                        arts.append(self.store.put_file(project_id, sp, kind="step", name=sp.name, parent_id=a.artifact_id, meta=base_meta))
                    except KiCadError as e:
                        warnings.append(f"STEP export failed (gerbers are unaffected): {e}")
            report = fab.build_report(
                spec=spec, check=check.to_dict(), drc=drc.to_dict(), route=route_info, pin_table_text=render_pin_table(check.pin_table),
                pin_table=check.pin_table, kicad_version=paths.kicad_version(), spec_artifact_id=spec_art.artifact_id,
                pcb_artifact_id=a.artifact_id, gerber_files=gerber_files, gerber_sha256=gsha,
            )
            arts.append(self.store.put_bytes(project_id, json.dumps(report, indent=1).encode(), kind="report", name="pcb_report.json", parent_id=a.artifact_id,
                                             meta={**base_meta, "report_type": "pcb_report", "ready_to_order": report["ready_to_order"]}))
        finally:
            self.store.cleanup_scratch(scratch)
        out = {
            "ok": ok, "artifacts": [_art(x) for x in arts],
            "ready_to_order": report["ready_to_order"], "blocking_problems": report["blocking_problems"],
            "board": {"width_mm": spec.outline.width_mm, "height_mm": spec.outline.height_mm, "layers": spec.layers},
            "drc": {k: v for k, v in drc.to_dict().items() if k != "unconnected_items"},
            "warnings": warnings,
        }
        if ok:
            out["error"] = None
            out["gerber_zip_artifact_id"] = next(x.artifact_id for x in arts if x.kind == "gerber_zip")
        else:
            out["error"] = ("Not exported: " + "; ".join(report["blocking_problems"]) + ". Only the report was stored; fix the design and rebuild.")
        out["report_artifact_id"] = next(x.artifact_id for x in arts if x.kind == "report")
        return out
