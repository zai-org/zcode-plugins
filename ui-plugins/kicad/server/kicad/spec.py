"""Circuit spec: the single, LLM-authored source of truth for a PCB (replaces schematic + netlist).

Coordinates: millimetres, origin = top-left corner of the board, +x right, +y DOWN (same as KiCad).
A part's (x_mm, y_mm) is the footprint ORIGIN. For most SMD parts and ICs that is the body centre; for pin
headers it is pin 1. ``rotation`` is KiCad's footprint rotation (degrees, counter-clockwise on screen).
"""
from __future__ import annotations

import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

REF_RE = re.compile(r"^[A-Za-z]{1,4}[0-9]{1,4}$")
NET_RE = re.compile(r"^[A-Za-z0-9_+\-.#~!@$%^&*=<>?|\\:]{1,40}$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Outline(_Strict):
    width_mm: float = Field(gt=3, le=400, description="Board width (x extent), mm")
    height_mm: float = Field(gt=3, le=400, description="Board height (y extent), mm")
    corner_radius_mm: float = Field(0.0, ge=0, description="Rounded corner radius, mm (0 = square)")

    @model_validator(mode="after")
    def _radius(self):
        if self.corner_radius_mm > min(self.width_mm, self.height_mm) / 2:
            raise ValueError("corner_radius_mm must be <= half of the smaller board side")
        return self


class Keepout(_Strict):
    """A rectangle where NO copper may exist (no tracks, vias or ground pour), e.g. under/around a PCB antenna."""
    x_mm: float = Field(description="Top-left x of the rectangle, mm (board origin top-left, +y down)")
    y_mm: float = Field(description="Top-left y of the rectangle, mm")
    width_mm: float = Field(gt=0)
    height_mm: float = Field(gt=0)
    layers: Literal["both", "top", "bottom"] = "both"
    reason: str = Field("", description="Why, e.g. 'WiFi antenna keep-out'")


class Fiducial(_Strict):
    """A MARK point for pick-and-place cameras: a bare copper dot on the top layer with a bigger solder-mask opening (fabs ask for 3, not symmetric)."""
    x_mm: float
    y_mm: float
    diameter_mm: float = Field(1.0, ge=0.5, le=3.0, description="Copper dot diameter (JLC: 1.0 mm)")
    mask_mm: float = Field(2.0, ge=1.0, le=6.0, description="Solder-mask opening diameter (JLC: 2.0 mm)")

    @property
    def keepout_mm(self) -> float:
        """Side of the copper-free square around the dot (mask opening plus a little air)."""
        return self.mask_mm + 0.5


class Part(_Strict):
    ref: str = Field(description="Reference designator, e.g. R1, C2, U1, J1, D1")
    symbol: str = Field(description="KiCad symbol id 'Library:Name', e.g. 'Device:R' (use pcb_search_parts)")
    footprint: str = Field(description="KiCad footprint id 'Library:Name', e.g. 'Resistor_SMD:R_0603_1608Metric'")
    value: str = Field("", description="Value text, e.g. '10k', '100nF', 'NE555'")
    x_mm: float = Field(description="Footprint origin x on the board, mm")
    y_mm: float = Field(description="Footprint origin y on the board, mm")
    rotation: float = Field(0.0, description="Degrees, KiCad convention (CCW on screen). Prefer multiples of 90")
    side: Literal["top", "bottom"] = "top"
    lcsc: str | None = Field(None, description="Optional LCSC part number, e.g. 'C25804'")
    no_thermal_vias: bool = Field(False, description="Remove plated holes smaller than the fab minimum (0.3 mm) from this footprint, e.g. the 0.2 mm thermal vias under "
                                  "an RF module's ground pad. The pad stays as an SMD pad. The checker demands this (or another footprint) when such holes exist.")

    @field_validator("ref")
    @classmethod
    def _ref(cls, v: str) -> str:
        if not REF_RE.match(v):
            raise ValueError(f"bad reference '{v}': use letters+digits like R1, C12, U3, J1")
        return v


class Net(_Strict):
    name: str = Field(description="Net name, e.g. 'GND', '+5V', 'LED_A'. No spaces.")
    pins: list[str] = Field(description="Pins on this net as 'REF.PIN', e.g. ['R1.1','D1.2']. PIN is the pad/pin NUMBER")
    width_mm: float | None = Field(None, gt=0.05, le=5, description="Optional track-width override for this net")

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not NET_RE.match(v):
            raise ValueError(f"bad net name '{v}': no spaces/quotes/parentheses, max 40 chars")
        return v


class MountingHole(_Strict):
    x_mm: float
    y_mm: float
    drill_mm: float = Field(3.2, gt=0.5, le=8, description="Hole diameter (3.2 = M3 clearance, 2.2 = M2)")
    keepout_mm: float = Field(1.0, ge=0, description="Extra courtyard radius around the hole (screw head room)")


class Rules(_Strict):
    signal_width_mm: float = Field(0.25, ge=0.1, le=2)
    power_width_mm: float = Field(0.5, ge=0.1, le=5)
    clearance_mm: float = Field(0.2, ge=0.1, le=2)
    via_diameter_mm: float = Field(0.6, ge=0.4, le=2)
    via_drill_mm: float = Field(0.3, ge=0.2, le=1.5)
    edge_clearance_mm: float = Field(0.3, ge=0.2, le=3, description="Copper to board edge")

    @model_validator(mode="after")
    def _via(self):
        if self.via_drill_mm >= self.via_diameter_mm - 0.2:
            raise ValueError("via_drill_mm must leave at least 0.1 mm annular ring (via_diameter_mm - via_drill_mm >= 0.2)")
        return self


class CircuitSpec(_Strict):
    name: str = Field("board", description="Board name (used for file names)")
    outline: Outline
    layers: Literal[2] = Field(2, description="Only 2-layer boards are supported")
    parts: list[Part] = Field(max_length=400)
    nets: list[Net] = Field(max_length=400)
    power_nets: list[str] = Field(default_factory=list, description="Net names that carry power rails (routed wide), e.g. ['+5V','+3V3']")
    ground_nets: list[str] = Field(default_factory=lambda: ["GND"], description="Ground net names; the FIRST one gets a copper pour on both layers")
    ground_pour: bool = Field(True, description="Pour ground_nets[0] on both layers instead of routing it with tracks")
    no_connect: list[str] = Field(default_factory=list, description="Pins deliberately left unconnected, as 'REF.PIN'")
    mounting_holes: list[MountingHole] = Field(default_factory=list)
    fiducials: list[Fiducial] = Field(default_factory=list, description="MARK points for SMT assembly (3 recommended, asymmetric, >= 3 mm from the edge). Top layer only")
    keepouts: list[Keepout] = Field(default_factory=list, description="No-copper rectangles (antenna keep-outs). The router, the ground pour and DRC all honour them")
    rules: Rules = Field(default_factory=Rules)

    @field_validator("name")
    @classmethod
    def _n(cls, v: str) -> str:
        return re.sub(r"[^A-Za-z0-9_.-]+", "_", v.strip()) or "board"

    # convenience
    def part(self, ref: str) -> Part | None:
        for p in self.parts:
            if p.ref == ref:
                return p
        return None

    def net_kind(self, name: str) -> str:
        if name in self.ground_nets:
            return "ground"
        if name in self.power_nets:
            return "power"
        return "signal"

    def track_width(self, net: Net) -> float:
        if net.width_mm:
            return net.width_mm
        return self.rules.power_width_mm if self.net_kind(net.name) in ("power", "ground") else self.rules.signal_width_mm

    @property
    def pour_net(self) -> str | None:
        return self.ground_nets[0] if (self.ground_pour and self.ground_nets) else None

    def canonical_json(self) -> str:
        return json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))


def split_pin_ref(s: str) -> tuple[str, str] | None:
    """'U1.3' -> ('U1', '3'); None if malformed."""
    ref, sep, pin = (s or "").strip().partition(".")
    if not sep or not ref or not pin:
        return None
    return ref, pin


def format_validation_error(e: ValidationError) -> list[str]:
    out = []
    for err in e.errors():
        loc = ".".join(str(x) if not isinstance(x, int) else f"[{x}]" for x in err["loc"]).replace(".[", "[")
        msg = err["msg"]
        if err["type"] == "extra_forbidden":
            msg = "unknown field (check spelling; see pcb_spec_example)"
        out.append(f"{loc or 'spec'}: {msg}")
    return out


def load_spec(data: dict | str | CircuitSpec) -> tuple[CircuitSpec | None, list[str]]:
    """Validate a spec dict. Returns (spec, []) or (None, human-readable errors)."""
    if isinstance(data, CircuitSpec):
        return data, []
    try:
        if isinstance(data, str):
            data = json.loads(data)
        if not isinstance(data, dict):
            return None, ["spec must be a JSON object"]
        return CircuitSpec.model_validate(data), []
    except ValidationError as e:
        return None, format_validation_error(e)
    except ValueError as e:
        return None, [f"spec is not valid JSON: {e}"]


def all_keepouts(spec: "CircuitSpec") -> list[Keepout]:
    """User keep-outs plus the copper-free squares around fiducials (top layer)."""
    extra = [Keepout(x_mm=f.x_mm - f.keepout_mm / 2, y_mm=f.y_mm - f.keepout_mm / 2, width_mm=f.keepout_mm, height_mm=f.keepout_mm, layers="top", reason="fiducial clearance")
             for f in spec.fiducials]
    return [*spec.keepouts, *extra]
