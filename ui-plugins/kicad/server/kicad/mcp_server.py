"""KiCad / PCB worker as an MCP server (stdio).

Run:   uv run python -m kicad.mcp_server   (from the plugin's py/ directory)

Workflow the tools are built for:
    pcb_search_parts -> pcb_part_info -> pcb_check_spec -> pcb_build -> pcb_render -> pcb_export_fab
All tools return {"ok", "error", "artifacts": [...], ...}; failures are returned, never raised.
"""
from __future__ import annotations

from typing import Any

from fastmcp import FastMCP
from fastmcp.utilities.types import Image

from .store import ArtifactStore

from . import examples
from .service import PcbService

INSTRUCTIONS = """PCB design worker (KiCad 10, 2-layer boards, bare boards only).
You describe the circuit as a JSON 'spec' (parts with library ids + positions, nets as REF.PIN lists). Never invent pin
numbers/names or library ids: look them up with pcb_search_parts and pcb_part_info. The spec checker (pcb_check_spec)
validates every pin against the official KiCad libraries BEFORE anything is built. A board is only manufacturable if
pcb_build returns ok=true (DRC: 0 errors, 0 unconnected). Coordinates: mm, origin top-left of the board, +y points DOWN.
Show the human the pin table and renders before pcb_export_fab output is used for ordering."""


def create_server(store: ArtifactStore | None = None) -> FastMCP:
    """Build the MCP server. ``store`` defaults to ``ArtifactStore(data_dir()/'store')`` (created lazily on first use)."""
    holder: dict[str, PcbService] = {}

    def svc() -> PcbService:
        if "s" not in holder:
            st = store
            if st is None:
                from .config import data_dir

                st = ArtifactStore(data_dir() / "store")
            holder["s"] = PcbService(st)
        return holder["s"]

    mcp = FastMCP("kicad-pcb", instructions=INSTRUCTIONS)

    @mcp.tool
    def pcb_search_parts(query: str, kind: str = "both") -> dict:
        """Search the official KiCad libraries by keyword (e.g. 'ne555', 'led', 'ldo 3.3v', '0603 resistor', 'sot-23-5').
        kind: 'symbol' | 'footprint' | 'both'. Returns lib ids ('Library:Name'), descriptions, and for symbols the
        default footprint and pin count. Use only ids returned here (or verified by pcb_part_info) in a spec."""
        return svc().search_parts(query, kind)

    @mcp.tool
    def pcb_part_info(symbol: str, footprint: str | None = None) -> dict:
        """Trusted pin data for a part. symbol: 'Timer:NE555D'. footprint (optional): 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm'.
        Returns symbol pins (number, name, electrical type), and with a footprint: pads (position/size relative to the
        footprint origin, drill), courtyard size, and whether every symbol pin has a pad (mapping is pin number == pad
        number). Without a footprint it lists footprints that match the symbol's filters. Use pin NUMBERS in nets."""
        return svc().part_info(symbol, footprint)

    @mcp.tool
    def pcb_spec_example(name: str = "led_indicator") -> dict:
        """Return a complete, valid example spec you can copy and modify. name: 'led_indicator' (LED+resistor+header),
        'ne555_blinker' (555 astable, SOIC-8), 'ldo_3v3_breakout' (SOT-23-5 LDO), 'shift_register_leds' (74HC595 + 8 LEDs).
        Also documents every spec field."""
        if name not in examples.EXAMPLES:
            return {"ok": False, "error": f"unknown example '{name}'. Choose one of {sorted(examples.EXAMPLES)}", "artifacts": []}
        return {"ok": True, "error": None, "artifacts": [], "spec": examples.example(name), "fields": SPEC_HELP}

    @mcp.tool
    def pcb_check_spec(project_id: str, spec: dict[str, Any]) -> dict:
        """Validate a circuit spec (ERC replacement) and store it as a 'circuit_spec' artifact. Checks: unknown
        symbol/footprint ids (with suggestions), every REF.PIN exists in BOTH symbol and footprint, pin<->pad mapping,
        unconnected pins, power inputs without a source, output conflicts, single-pin nets, duplicate refs, courtyard
        overlaps, parts too close to the edge. Returns issues, a pin table (ref, pin, name, type, net) and the stored
        spec_artifact_id. ok=true means no errors (warnings allowed). Fix all errors before pcb_build.
        Spec: {"name","outline":{"width_mm","height_mm","corner_radius_mm"},"parts":[{"ref":"R1","symbol":"Device:R",
        "footprint":"Resistor_SMD:R_0603_1608Metric","value":"1k","x_mm":9,"y_mm":4,"rotation":0,"side":"top"}],
        "nets":[{"name":"+5V","pins":["J1.1","R1.1"]}],"power_nets":["+5V"],"ground_nets":["GND"],"no_connect":["U1.4"],
        "mounting_holes":[{"x_mm":3,"y_mm":3,"drill_mm":3.2}],"rules":{"signal_width_mm":0.25,"power_width_mm":0.5,
        "clearance_mm":0.2}}. x/y = footprint origin (pin 1 for pin headers, body centre for most SMD parts). See
        pcb_spec_example for full examples."""
        return svc().check_spec(project_id, spec)

    @mcp.tool
    def pcb_build(project_id: str, spec_artifact_id: str, route: bool = True) -> dict:
        """Place parts, auto-route (2 layers, GND copper pour on both layers), build the .kicad_pcb and run DRC.
        Returns the 'kicad_pcb' artifact, DRC summary (errors / warnings / unconnected + first violations with
        positions) and the list of unrouted connections. ok=true only if DRC has 0 errors and 0 unconnected items and
        every net is routed. If not, adjust placement (parts closer to what they connect to, more spacing, bigger
        board) and rebuild; use pcb_render to look at the result."""
        return svc().build(project_id, spec_artifact_id, route)

    @mcp.tool
    def pcb_render(project_id: str, artifact_id: str, side: str = "top") -> list:
        """Render a built board (kicad_pcb artifact) as a 3D PNG image. side: 'top' or 'bottom'. Returns a small JSON
        status and the image; the PNG is also stored as an artifact. Look at it to check placement and routing."""
        info, data = svc().render(project_id, artifact_id, side)
        if data is None:
            return [info]
        return [info, Image(data=data, format="png")]

    @mcp.tool
    def pcb_export_fab(project_id: str, artifact_id: str, include_step: bool = False) -> dict:
        """Produce fabrication files from a built board: 'gerber_zip' (gerbers + drill; meta has width_mm, height_mm,
        layers), BOM and pos CSVs, and a 'pcb_report' (kind 'report', JSON: checks, DRC, pin table, BOM, limitations)
        for human review. Re-runs DRC first; if it fails nothing but the report is produced and ok=false.
        include_step=true also exports a STEP model (slow)."""
        return svc().export_fab(project_id, artifact_id, include_step)

    return mcp


SPEC_HELP = {
    "units": "millimetres; origin = top-left corner of the board; +x right, +y DOWN; rotation in degrees counter-clockwise (KiCad)",
    "parts[].ref": "unique reference designator, letters+digits (R1, C2, U1, J1, D1)",
    "parts[].symbol / footprint": "'Library:Name' ids from pcb_search_parts; symbol pin NUMBER n is wired to footprint pad n",
    "parts[].x_mm,y_mm": "footprint ORIGIN on the board (body centre for most SMD parts; pin 1 for pin headers; see pcb_part_info for pad offsets)",
    "nets[].pins": "'REF.PIN' with PIN = pin number (e.g. 'U1.8'); a pin may appear in only one net",
    "power_nets": "nets carrying supply rails (routed with power_width_mm); a power_in pin needs a power_out pin or a net listed here",
    "ground_nets": "first entry is poured as copper on both layers (not routed with tracks); every SMD pad gets a stitching via",
    "no_connect": "pins intentionally left open ('U1.4'); every other symbol pin must be on a net",
    "rules": "signal_width_mm 0.25, power_width_mm 0.5, clearance_mm 0.2, via 0.6/0.3, edge_clearance_mm 0.3",
}

mcp = create_server()

if __name__ == "__main__":
    mcp.run(show_banner=False)
