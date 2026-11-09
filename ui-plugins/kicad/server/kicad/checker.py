"""Spec checker: the ERC replacement. Deterministic, pure Python, runs BEFORE any board is built.

Everything is derived from the official KiCad libraries (``library.py``); pin names / numbers are never trusted
from the caller. Output: structured issues + a human-readable pin table (ref, pin, name, type, net).
"""
from __future__ import annotations

import difflib
import math
from dataclasses import dataclass, field
from typing import Any

from . import library as lib
from .library import FootprintInfo, LibraryError, SymbolInfo
from .spec import CircuitSpec, split_pin_ref

DRIVER_TYPES = {"output", "power_out", "bidirectional", "tri_state", "open_collector", "open_emitter", "passive"}
MUST_CONNECT = {"input", "output", "bidirectional", "tri_state", "passive", "open_collector", "open_emitter", "power_in", "power_out"}


@dataclass
class Issue:
    severity: str  # error | warning | info
    code: str
    message: str
    ref: str | None = None
    pin: str | None = None
    net: str | None = None
    hint: str | None = None

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}


@dataclass
class CheckReport:
    issues: list[Issue] = field(default_factory=list)
    pin_table: list[dict] = field(default_factory=list)
    parts: list[dict] = field(default_factory=list)
    nets: dict[str, list[str]] = field(default_factory=dict)
    normalized_spec: dict | None = None

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "warning"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "n_errors": len(self.errors),
            "n_warnings": len(self.warnings),
            "issues": [i.to_dict() for i in self.issues],
            "pin_table": self.pin_table,
            "pin_table_text": render_pin_table(self.pin_table),
            "parts": self.parts,
            "nets": self.nets,
        }


def render_pin_table(rows: list[dict]) -> str:
    """Fixed-width pin table for humans (shown before ordering)."""
    if not rows:
        return "(no pins)"
    hdr = ("Ref", "Pin", "Name", "Type", "Net")
    data = [(r["ref"], r["pin"], r["name"], r["type"], r["net"]) for r in rows]
    w = [max(len(h), *(len(str(d[i])) for d in data)) for i, h in enumerate(hdr)]
    line = lambda cells: "  ".join(str(c).ljust(w[i]) for i, c in enumerate(cells)).rstrip()  # noqa: E731
    return "\n".join([line(hdr), line(["-" * x for x in w]), *[line(d) for d in data]])


def _near(s: str, options: list[str], n: int = 3) -> list[str]:
    return difflib.get_close_matches(s, options, n=n, cutoff=0.5)


def _pin_desc(sym: SymbolInfo, fp: FootprintInfo | None) -> str:
    pad_nums = set(fp.pad_numbers) if fp else None
    items = []
    for p in sorted(sym.pins, key=lambda p: lib.natural_key(p.number)):
        if pad_nums is not None and p.number not in pad_nums:
            continue
        items.append(f"{p.number}={p.display_name or '~'}")
    return ", ".join(items)


def _world_pad_boxes(fp: FootprintInfo, x: float, y: float, rot: float, side: str):
    th = math.radians(rot)
    c, s = math.cos(th), math.sin(th)
    out = []
    for p in fp.pads:
        py = -p.y if side == "bottom" else p.y  # bottom side: footprint mirrored y -> -y, then rotated
        wx = x + p.x * c + py * s
        wy = y - p.x * s + py * c
        phi = math.radians(rot + p.rotation)
        hw = abs(p.w / 2 * math.cos(phi)) + abs(p.h / 2 * math.sin(phi))
        hh = abs(p.w / 2 * math.sin(phi)) + abs(p.h / 2 * math.cos(phi))
        if p.shape == "circle":
            hw = hh = max(p.w, p.h) / 2
        out.append((p, wx - hw, wy - hh, wx + hw, wy + hh))
    return out


def _overlap(a, b, eps=0.01) -> bool:
    return a[0] < b[2] - eps and b[0] < a[2] - eps and a[1] < b[3] - eps and b[1] < a[3] - eps


def check_spec(spec: CircuitSpec) -> CheckReport:
    rep = CheckReport()
    add = lambda sev, code, msg, **kw: rep.issues.append(Issue(sev, code, msg, **kw))  # noqa: E731

    # ---- duplicates --------------------------------------------------------------------------------
    seen_refs: dict[str, int] = {}
    for p in spec.parts:
        seen_refs[p.ref] = seen_refs.get(p.ref, 0) + 1
    for ref, n in seen_refs.items():
        if n > 1:
            add("error", "DUPLICATE_REF", f"Reference '{ref}' is used by {n} parts; references must be unique.", ref=ref)
    seen_nets: dict[str, int] = {}
    for n_ in spec.nets:
        seen_nets[n_.name] = seen_nets.get(n_.name, 0) + 1
    for name, n in seen_nets.items():
        if n > 1:
            add("error", "DUPLICATE_NET", f"Net '{name}' is defined {n} times; list all its pins in one net.", net=name)

    # ---- library resolution -----------------------------------------------------------------------
    syms: dict[str, SymbolInfo] = {}
    fps: dict[str, FootprintInfo] = {}
    for p in spec.parts:
        if p.ref in syms or p.ref in fps:
            continue
        try:
            syms[p.ref] = lib.get_symbol(p.symbol)
        except LibraryError as e:
            sug = e.suggestions or lib.suggest_symbols(p.symbol)
            add("error", "UNKNOWN_SYMBOL", f"{p.ref}: {e.msg}", ref=p.ref,
                hint=("Did you mean: " + ", ".join(sug)) if sug else "Use pcb_search_parts(kind='symbol') to find valid ids.")
        try:
            fps[p.ref] = lib.get_footprint(p.footprint)
        except LibraryError as e:
            sug = e.suggestions or lib.suggest_footprints(p.footprint)
            add("error", "UNKNOWN_FOOTPRINT", f"{p.ref}: {e.msg}", ref=p.ref,
                hint=("Did you mean: " + ", ".join(sug)) if sug else "Use pcb_search_parts(kind='footprint') to find valid ids.")

    # ---- symbol <-> footprint consistency ----------------------------------------------------------
    for p in spec.parts:
        s, f = syms.get(p.ref), fps.get(p.ref)
        if not (s and f):
            continue
        if s.fp_filters and not lib.footprint_matches_filters(p.footprint, s.fp_filters):
            add("warning", "FOOTPRINT_FILTER_MISMATCH",
                f"{p.ref}: footprint '{p.footprint}' does not match the symbol's recommended footprint filters {list(s.fp_filters)}.",
                ref=p.ref, hint="Check pin numbering of this footprint against the symbol; mapping is by pin number == pad number.")
        m = lib.pin_pad_mapping(s, f)
        if m["pins_without_pad"]:
            add("error", "PIN_WITHOUT_PAD",
                f"{p.ref}: symbol '{p.symbol}' has pin(s) {m['pins_without_pad']} that do not exist as pads in footprint '{p.footprint}'. "
                f"Footprint pads: {f.pad_numbers}.", ref=p.ref,
                hint="Pick a footprint that matches this symbol (see pcb_part_info for compatible footprints).")
        if m["pads_without_pin"]:
            add("warning", "PAD_WITHOUT_PIN",
                f"{p.ref}: footprint pad(s) {m['pads_without_pin']} have no matching pin in symbol '{p.symbol}' (left unconnected).",
                ref=p.ref)

    # ---- resolve net pins --------------------------------------------------------------------------
    pin_net: dict[tuple[str, str], str] = {}
    net_pins: dict[str, list[tuple[str, str]]] = {}
    norm_nets: list[dict[str, Any]] = []
    ref_list = [p.ref for p in spec.parts]
    for net in spec.nets:
        resolved: list[tuple[str, str]] = []
        if not net.pins:
            add("error", "EMPTY_NET", f"Net '{net.name}' has no pins.", net=net.name)
        for raw in net.pins:
            sp = split_pin_ref(raw)
            if not sp:
                add("error", "BAD_PIN_REF", f"Net '{net.name}': '{raw}' is not of the form 'REF.PIN' (e.g. 'U1.3').", net=net.name)
                continue
            ref, pin = sp
            if ref not in seen_refs:
                sug = _near(ref, ref_list)
                add("error", "UNKNOWN_REF", f"Net '{net.name}': part '{ref}' does not exist.", ref=ref, net=net.name,
                    hint=("Did you mean: " + ", ".join(sug)) if sug else None)
                continue
            s, f = syms.get(ref), fps.get(ref)
            if not (s and f):
                resolved.append((ref, pin))  # library problem already reported; keep for connectivity stats
                continue
            number = pin
            sym_pin = s.pin(number)
            if sym_pin is None:
                by_name = s.pins_by_name(pin)
                if len(by_name) == 1:
                    number = by_name[0].number
                    sym_pin = by_name[0]
                elif len(by_name) > 1:
                    add("error", "AMBIGUOUS_PIN",
                        f"Net '{net.name}': {ref}.{pin} matches several pins by name ({[p.number for p in by_name]}); use pin numbers.",
                        ref=ref, pin=pin, net=net.name)
                    continue
            if sym_pin is None:
                add("error", "UNKNOWN_PIN",
                    f"Net '{net.name}': {ref}.{pin} - symbol '{s.lib_id}' has no pin '{pin}'. Valid pins of {ref}: {_pin_desc(s, f)}.",
                    ref=ref, pin=pin, net=net.name)
                continue
            if not f.pads_numbered(number):
                add("error", "PIN_NOT_IN_FOOTPRINT",
                    f"Net '{net.name}': {ref}.{number} exists in the symbol but footprint '{f.lib_id}' has no pad '{number}' "
                    f"(pads: {f.pad_numbers}).", ref=ref, pin=number, net=net.name)
                continue
            key = (ref, number)
            if key in pin_net and pin_net[key] != net.name:
                add("error", "PIN_IN_MULTIPLE_NETS",
                    f"{ref}.{number} is in both net '{pin_net[key]}' and net '{net.name}'. A pin can only be on one net.",
                    ref=ref, pin=number, net=net.name)
                continue
            if key in pin_net:
                add("warning", "DUPLICATE_PIN_IN_NET", f"{ref}.{number} is listed twice in net '{net.name}'.", ref=ref, pin=number, net=net.name)
                continue
            pin_net[key] = net.name
            resolved.append(key)
        net_pins[net.name] = resolved
        norm_nets.append({"name": net.name, "pins": [f"{r}.{n}" for r, n in resolved], **({"width_mm": net.width_mm} if net.width_mm else {})})

    # ---- explicit no-connects ----------------------------------------------------------------------
    nc: set[tuple[str, str]] = set()
    norm_nc: list[str] = []
    for raw in spec.no_connect:
        sp = split_pin_ref(raw)
        if not sp or sp[0] not in seen_refs:
            add("error", "BAD_NO_CONNECT", f"no_connect entry '{raw}' is malformed or refers to an unknown part.")
            continue
        ref, pin = sp
        s = syms.get(ref)
        if s:
            q = s.pin(pin)
            if q is None:
                bn = s.pins_by_name(pin)
                q = bn[0] if len(bn) == 1 else None
            if q is None:
                add("error", "BAD_NO_CONNECT", f"no_connect '{raw}': symbol has no such pin.", ref=ref, pin=pin)
                continue
            pin = q.number
        if (ref, pin) in pin_net:
            add("error", "NC_AND_CONNECTED", f"{ref}.{pin} is declared no_connect but also appears in net '{pin_net[(ref, pin)]}'.", ref=ref, pin=pin)
            continue
        nc.add((ref, pin))
        norm_nc.append(f"{ref}.{pin}")

    # ---- unconnected pins + pin table --------------------------------------------------------------
    for p in sorted(spec.parts, key=lambda p: lib.natural_key(p.ref)):
        s, f = syms.get(p.ref), fps.get(p.ref)
        if not s:
            continue
        for q in sorted(s.pins, key=lambda q: lib.natural_key(q.number)):
            key = (p.ref, q.number)
            net = pin_net.get(key)
            if net is None:
                if key in nc:
                    label = "NC (declared)"
                elif q.etype == "no_connect":
                    label = "NC"
                else:
                    label = "UNCONNECTED"
                    if f and not f.pads_numbered(q.number):
                        pass  # PIN_WITHOUT_PAD already reported
                    elif q.etype in ("power_in", "power_out"):
                        add("error", "POWER_PIN_UNCONNECTED",
                            f"{p.ref}.{q.number} ({q.display_name}, {q.etype}) is not connected to any net. Power pins must be connected.",
                            ref=p.ref, pin=q.number, hint="Add it to the supply/ground net, or to no_connect if truly unused.")
                    elif q.etype in MUST_CONNECT:
                        add("error", "PIN_UNCONNECTED",
                            f"{p.ref}.{q.number} ({q.display_name or '~'}, {q.etype}) is not connected to any net.",
                            ref=p.ref, pin=q.number, hint="Connect it, or list it in no_connect if intentionally unused.")
                    else:
                        add("warning", "PIN_UNCONNECTED", f"{p.ref}.{q.number} ({q.display_name or '~'}, {q.etype}) is not connected.",
                            ref=p.ref, pin=q.number)
            else:
                label = net
                if q.etype == "no_connect":
                    add("warning", "NC_PIN_CONNECTED", f"{p.ref}.{q.number} is a no-connect pin of the symbol but is wired to '{net}'.",
                        ref=p.ref, pin=q.number, net=net)
            rep.pin_table.append({
                "ref": p.ref, "pin": q.number, "name": q.display_name or "~", "type": q.etype, "net": label,
                **({"hidden": True} if q.hidden else {}),
            })

    # ---- per-net electrical checks -----------------------------------------------------------------
    def ptype(ref: str, num: str) -> str:
        s = syms.get(ref)
        q = s.pin(num) if s else None
        return q.etype if q else "unspecified"

    declared_power = set(spec.power_nets) | set(spec.ground_nets)
    explicit = spec.model_fields_set
    for name in declared_power:
        if name in spec.ground_nets and "ground_nets" not in explicit and name not in spec.power_nets:
            continue  # implicit default ('GND') on a board that has no ground net: not worth a warning
        if name not in seen_nets:
            add("warning", "POWER_NET_NOT_USED", f"'{name}' is declared as a power/ground net but no net with that name exists.", net=name)
    for net in spec.nets:
        pins = net_pins.get(net.name, [])
        uniq = list(dict.fromkeys(pins))
        types = [(r, n, ptype(r, n)) for r, n in uniq]
        if len(uniq) == 1:
            add("warning", "SINGLE_PIN_NET",
                f"Net '{net.name}' has only one pin ({uniq[0][0]}.{uniq[0][1]}): nothing to connect it to.", net=net.name,
                hint="Connect it to another pin or remove the net (use no_connect for unused pins).")
        outs = [t for t in types if t[2] == "output"]
        pouts = [t for t in types if t[2] == "power_out"]
        if len(pouts) > 1:
            add("error", "POWER_OUT_CONFLICT",
                f"Net '{net.name}' is driven by several power outputs: {[f'{r}.{n}' for r, n, _ in pouts]}.", net=net.name)
        if len(outs) > 1:
            add("error", "OUTPUT_CONFLICT",
                f"Net '{net.name}' has several output pins driving it: {[f'{r}.{n}' for r, n, _ in outs]}.", net=net.name)
        if outs and pouts:
            add("error", "OUTPUT_CONFLICT", f"Net '{net.name}' connects an output pin to a power output.", net=net.name)
        pins_in = [t for t in types if t[2] == "power_in"]
        if pins_in and not pouts and net.name not in declared_power:
            add("error", "POWER_IN_NOT_DRIVEN",
                f"Net '{net.name}' feeds power input pin(s) {[f'{r}.{n}' for r, n, _ in pins_in]} but has no power output "
                f"and is not declared in power_nets/ground_nets.", net=net.name,
                hint=f"Add '{net.name}' to power_nets (supplied from a connector) or connect a power_out pin.")
        if types and all(t[2] == "input" for t in types) and net.name not in declared_power:
            add("warning", "NO_DRIVER", f"Net '{net.name}' has only input pins; nothing drives it.", net=net.name)
        if net.name in spec.ground_nets and net.name in spec.power_nets:
            add("error", "NET_KIND_CONFLICT", f"'{net.name}' is listed in both power_nets and ground_nets.", net=net.name)

    # ---- polarity (semantic): reversed LEDs / diodes / polarized capacitors ------------------------------
    # Structural checks cannot see this: a reversed LED is a perfectly valid netlist. Heuristic: for a part with an
    # anode/cathode (A/K) or +/- pin pair, the positive side must not sit on a ground net while the negative side does not.
    pin_net = {(r, n): name for name, pins in net_pins.items() for r, n in pins}
    grounds = set(spec.ground_nets)
    for part in spec.parts:
        sym = syms.get(part.ref)
        if sym is None:
            continue
        pos = [q for q in sym.pins if (q.display_name or q.name).strip().upper() in ("A", "+")]
        neg = [q for q in sym.pins if (q.display_name or q.name).strip().upper() in ("K", "-")]
        if len(pos) != 1 or len(neg) != 1:
            continue
        pn, nn = pin_net.get((part.ref, pos[0].number)), pin_net.get((part.ref, neg[0].number))
        if pn in grounds and nn is not None and nn not in grounds:
            add("error", "REVERSED_POLARITY",
                f"{part.ref} ({part.symbol}) looks reversed: its positive pin {pos[0].number} ({pos[0].display_name or pos[0].name}) is on ground net "
                f"'{pn}' while its negative pin {neg[0].number} ({neg[0].display_name or neg[0].name}) is on '{nn}'. "
                f"For an LED/diode the anode (A) must face the more positive net.",
                ref=part.ref, pin=pos[0].number, net=pn,
                hint=f"Swap the two connections: put pin {pos[0].number} on '{nn}' and pin {neg[0].number} on '{pn}'.")

    # ---- placement ---------------------------------------------------------------------------------
    W, H = spec.outline.width_mm, spec.outline.height_mm
    edge = spec.rules.edge_clearance_mm
    boxes: dict[str, tuple[float, float, float, float]] = {}
    for p in spec.parts:
        f = fps.get(p.ref)
        if not f:
            continue
        cb = f.world_bbox(p.x_mm, p.y_mm, p.rotation, p.side)
        boxes[p.ref] = cb
        rep.parts.append({
            "ref": p.ref, "symbol": p.symbol, "footprint": p.footprint, "value": p.value, "x_mm": p.x_mm, "y_mm": p.y_mm,
            "rotation": p.rotation, "side": p.side,
            "courtyard_mm": [round(v, 3) for v in cb], "size_mm": [round(cb[2] - cb[0], 3), round(cb[3] - cb[1], 3)],
        })
        right_angle = abs(p.rotation / 90 - round(p.rotation / 90)) < 1e-6
        if cb[0] < -1e-6 or cb[1] < -1e-6 or cb[2] > W + 1e-6 or cb[3] > H + 1e-6:
            add("warning", "COURTYARD_OUTSIDE_BOARD",
                f"{p.ref}: courtyard [{cb[0]:.2f},{cb[1]:.2f} .. {cb[2]:.2f},{cb[3]:.2f}] sticks out of the {W}x{H} mm board.", ref=p.ref)
        for pad, x0, y0, x1, y1 in _world_pad_boxes(f, p.x_mm, p.y_mm, p.rotation, p.side):
            if pad.is_np:
                continue
            if x0 < edge - 1e-6 or y0 < edge - 1e-6 or x1 > W - edge + 1e-6 or y1 > H - edge + 1e-6:
                add("error" if right_angle else "warning", "PAD_NEAR_EDGE",
                    f"{p.ref} pad {pad.number} ([{x0:.2f},{y0:.2f} .. {x1:.2f},{y1:.2f}]) is closer than {edge} mm to the board edge "
                    f"or outside the {W}x{H} mm outline.", ref=p.ref, pin=pad.number,
                    hint="Move the part inwards or enlarge the board.")
                break
    for p in spec.parts:
        f = fps.get(p.ref)
        tiny = sorted({round(min(q.drill), 3) for q in f.pads if q.drill and min(q.drill) < 0.3}) if f else []
        if tiny and not p.no_thermal_vias:
            add("error", "FOOTPRINT_HOLE_TOO_SMALL",
                f"{p.ref} ({p.footprint}) has plated holes of {tiny} mm, below the 0.3 mm minimum of standard 2-layer fabs (e.g. the thermal vias under an RF module's ground pad).",
                ref=p.ref, hint="Set \"no_thermal_vias\": true on this part (the exposed pad stays as an SMD pad) or pick a different footprint.")
    for i, k in enumerate(spec.keepouts, start=1):
        if k.x_mm < -1e-6 or k.y_mm < -1e-6 or k.x_mm + k.width_mm > W + 1e-6 or k.y_mm + k.height_mm > H + 1e-6:
            add("error", "KEEPOUT_OUTSIDE_BOARD", f"Keep-out #{i} ({k.reason or 'no reason given'}) sticks out of the {W}x{H} mm board.")
        kb = (k.x_mm, k.y_mm, k.x_mm + k.width_mm, k.y_mm + k.height_mm)
        for p in spec.parts:
            f = fps.get(p.ref)
            if not f:
                continue
            for pad, x0, y0, x1, y1 in _world_pad_boxes(f, p.x_mm, p.y_mm, p.rotation, p.side):
                pad_layers = {"top", "bottom"} if pad.ptype == "thru_hole" else {p.side}  # a through-hole pad has copper on both layers
                if not pad.is_np and _overlap(kb, (x0, y0, x1, y1)) and (k.layers == "both" or k.layers in pad_layers):
                    add("error", "PAD_IN_KEEPOUT", f"{p.ref} pad {pad.number} lies inside keep-out #{i} ({k.reason or 'no copper allowed'}); move the part or shrink the keep-out.", ref=p.ref, pin=pad.number)
                    break
    for i, f in enumerate(spec.fiducials, start=1):
        half = f.keepout_mm / 2
        fb = (f.x_mm - half, f.y_mm - half, f.x_mm + half, f.y_mm + half)
        if min(f.x_mm, f.y_mm, W - f.x_mm, H - f.y_mm) < 3.0 + f.mask_mm / 2:
            add("error", "FIDUCIAL_NEAR_EDGE", f"Fiducial #{i} at ({f.x_mm},{f.y_mm}) is closer than 3 mm (to the edge of its mask opening) to the board edge; fabs cannot see it reliably.")
        for p in spec.parts:
            fp_ = fps.get(p.ref)
            if not fp_ or p.side != "top":
                continue
            for pad, x0, y0, x1, y1 in _world_pad_boxes(fp_, p.x_mm, p.y_mm, p.rotation, p.side):
                if not pad.is_np and _overlap(fb, (x0, y0, x1, y1)):
                    add("error", "FIDUCIAL_OVERLAPS_PART", f"Fiducial #{i} clearance zone overlaps pad {pad.number} of {p.ref}; move the fiducial.", ref=p.ref, pin=pad.number)
                    break
        for j, h in enumerate(spec.mounting_holes, start=1):
            if (f.x_mm - h.x_mm) ** 2 + (f.y_mm - h.y_mm) ** 2 < (h.drill_mm / 2 + h.keepout_mm + half) ** 2:
                add("error", "FIDUCIAL_OVERLAPS_HOLE", f"Fiducial #{i} is too close to mounting hole #{j}.")
    if 0 < len(spec.fiducials) < 3:
        add("warning", "FEW_FIDUCIALS", f"Only {len(spec.fiducials)} fiducial(s): assembly houses ask for 3 (not symmetric).")
    refs_b = [r for r in boxes]
    by_side = {p.ref: p.side for p in spec.parts}
    rot_of = {p.ref: p.rotation for p in spec.parts}
    for i, ra in enumerate(refs_b):
        for rb in refs_b[i + 1:]:
            if by_side[ra] == by_side[rb] and _overlap(boxes[ra], boxes[rb]):
                exact = all(abs(rot_of[r] / 90 - round(rot_of[r] / 90)) < 1e-6 for r in (ra, rb))
                add("error" if exact else "warning", "COURTYARD_OVERLAP",
                    f"Courtyards of {ra} and {rb} overlap (move them apart): {ra}={[round(v, 2) for v in boxes[ra]]}, "
                    f"{rb}={[round(v, 2) for v in boxes[rb]]}.", ref=ra)
    for i, h in enumerate(spec.mounting_holes):
        r = h.drill_mm / 2 + h.keepout_mm
        hb = (h.x_mm - r, h.y_mm - r, h.x_mm + r, h.y_mm + r)
        if h.x_mm - h.drill_mm / 2 < edge or h.y_mm - h.drill_mm / 2 < edge or h.x_mm + h.drill_mm / 2 > W - edge or h.y_mm + h.drill_mm / 2 > H - edge:
            add("error", "HOLE_NEAR_EDGE", f"Mounting hole #{i + 1} at ({h.x_mm},{h.y_mm}) is too close to / outside the board edge.")
        for ref, cb in boxes.items():
            if _overlap(hb, cb):
                add("error", "HOLE_OVERLAPS_PART", f"Mounting hole #{i + 1} keep-out overlaps {ref}.", ref=ref)

    # ---- misc --------------------------------------------------------------------------------------
    for p in spec.parts:
        if p.lcsc and not (p.lcsc.upper().startswith("C") and p.lcsc[1:].isdigit()):
            add("warning", "LCSC_FORMAT", f"{p.ref}: lcsc '{p.lcsc}' is not of the form 'C12345'.", ref=p.ref)
    r = spec.rules
    if r.signal_width_mm < 0.127 or r.clearance_mm < 0.127:
        add("warning", "RULES_TIGHT", "Track width / clearance below 0.127 mm (5 mil) is below the capability of most cheap fabs.")
    if r.via_diameter_mm < 0.45 or r.via_drill_mm < 0.2:
        add("warning", "RULES_TIGHT", "Via diameter < 0.45 mm or drill < 0.2 mm is below standard fab capability.")
    if W < 10 or H < 10:
        add("warning", "BOARD_SMALL", "Board smaller than 10x10 mm may be rejected or cost a panel fee at some fabs.")

    rep.nets = {n: [f"{r}.{p}" for r, p in pins] for n, pins in net_pins.items()}
    rep.issues.sort(key=lambda i: {"error": 0, "warning": 1, "info": 2}[i.severity])
    nd = spec.model_dump(mode="json")
    nd["nets"] = norm_nets
    nd["no_connect"] = norm_nc
    rep.normalized_spec = nd
    return rep
