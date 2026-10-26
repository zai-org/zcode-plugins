"""Trusted pin / pad database built from the official KiCad libraries (pure Python, no pcbnew).

LLMs must never invent pin names or numbers: everything the checker, the router and the builder know
about a part comes from here.

* ``search_symbols`` / ``search_footprints``: keyword search (cached index on disk).
* ``get_symbol("Timer:NE555D")`` -> pins (number, name, electrical type, unit, hidden)
* ``get_footprint("Package_SO:SOIC-8_3.9x4.9mm_P1.27mm")`` -> pads (number, type, shape, size, offset, layers, drill) + courtyard
"""
from __future__ import annotations

import difflib
import fnmatch
import json
import math
import os
import re
import threading
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

from .config import data_dir

from . import paths
from .sexpr import children, find, flag, numbers, parse, value

PIN_TYPES = (
    "input", "output", "bidirectional", "tri_state", "passive", "free", "unspecified",
    "power_in", "power_out", "open_collector", "open_emitter", "no_connect",
)


class LibraryError(KeyError):
    """Unknown library / symbol / footprint. ``.suggestions`` holds close matches."""

    def __init__(self, msg: str, suggestions: list[str] | None = None):
        super().__init__(msg)
        self.msg = msg
        self.suggestions = suggestions or []

    def __str__(self) -> str:
        return self.msg


def split_lib_id(lib_id: str) -> tuple[str, str]:
    lib, sep, name = (lib_id or "").partition(":")
    if not sep or not lib or not name:
        raise LibraryError(f"'{lib_id}' is not a 'Library:Name' id (e.g. 'Device:R', 'Resistor_SMD:R_0603_1608Metric').")
    if any(c in lib_id for c in "/\\\0") or lib.startswith(".") or name.startswith("."):
        raise LibraryError(f"'{lib_id}' is not a valid library id (no path separators or leading dots).")
    return lib, name


# --------------------------------------------------------------------------------------- data classes
@dataclass(frozen=True)
class Pin:
    number: str
    name: str
    etype: str
    unit: int = 1
    hidden: bool = False

    @property
    def display_name(self) -> str:
        """``~{RST}`` -> ``/RST`` style (overbar markup removed)."""
        n = re.sub(r"~\{([^}]*)\}", r"\1", self.name)
        return n


@dataclass(frozen=True)
class SymbolInfo:
    lib_id: str
    ref_prefix: str
    value: str
    description: str
    keywords: str
    datasheet: str
    default_footprint: str
    fp_filters: tuple[str, ...]
    pins: tuple[Pin, ...]
    extends: str = ""

    def pin(self, number: str) -> Pin | None:
        for p in self.pins:
            if p.number == number:
                return p
        return None

    def pins_by_name(self, name: str) -> list[Pin]:
        n = name.strip().lower()
        return [p for p in self.pins if p.name.lower() == n or p.display_name.lower() == n]


@dataclass(frozen=True)
class Pad:
    number: str
    ptype: str  # smd | thru_hole | np_thru_hole | connect
    shape: str  # circle | rect | oval | roundrect | trapezoid | custom
    x: float
    y: float
    w: float
    h: float
    rotation: float
    layers: tuple[str, ...]
    drill: tuple[float, float] | None = None  # (dx, dy) mm; dx==dy for round
    drill_offset: tuple[float, float] = (0.0, 0.0)

    @property
    def is_np(self) -> bool:
        return self.ptype == "np_thru_hole"


@dataclass(frozen=True)
class FootprintInfo:
    lib_id: str
    description: str
    tags: str
    attr: tuple[str, ...]
    pads: tuple[Pad, ...]
    courtyard: tuple[float, float, float, float] | None  # xmin, ymin, xmax, ymax in footprint-local mm

    @property
    def pad_numbers(self) -> list[str]:
        seen: list[str] = []
        for p in self.pads:
            if p.number and not p.is_np and p.number not in seen:
                seen.append(p.number)
        return seen

    def pads_numbered(self, number: str) -> list[Pad]:
        return [p for p in self.pads if p.number == number]

    def bbox(self) -> tuple[float, float, float, float]:
        """Courtyard if present, else pad extents grown by 0.25 mm."""
        if self.courtyard:
            return self.courtyard
        xs0, ys0, xs1, ys1 = [], [], [], []
        for p in self.pads:
            xs0.append(p.x - p.w / 2)
            xs1.append(p.x + p.w / 2)
            ys0.append(p.y - p.h / 2)
            ys1.append(p.y + p.h / 2)
        if not xs0:
            return (-0.5, -0.5, 0.5, 0.5)
        return (min(xs0) - 0.25, min(ys0) - 0.25, max(xs1) + 0.25, max(ys1) + 0.25)

    def world_bbox(self, x: float, y: float, rotation: float = 0.0, side: str = "top") -> tuple[float, float, float, float]:
        """Axis-aligned bbox of the courtyard after placing the footprint at (x, y) (KiCad rotation convention)."""
        x0, y0, x1, y1 = self.bbox()
        pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        if side == "bottom":
            pts = [(px, -py) for px, py in pts]  # KiCad flips bottom-side footprints top<->bottom (y -> -y), then rotates
        th = math.radians(rotation)
        c, s = math.cos(th), math.sin(th)
        wp = [(x + px * c + py * s, y - px * s + py * c) for px, py in pts]
        return (min(p[0] for p in wp), min(p[1] for p in wp), max(p[0] for p in wp), max(p[1] for p in wp))


# --------------------------------------------------------------------------------------- index (cached)
_CACHE_VERSION = 3


def _cache_path() -> Path:
    d = data_dir() / "kicad_cache"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"index_v{_CACHE_VERSION}.json"


_PROP_RE = re.compile(r'\(property "([^"]+)" "((?:[^"\\]|\\.)*)"')
_SYM_START_RE = re.compile(r'^\t\(symbol "((?:[^"\\]|\\.)*)"', re.M)
_EXT_RE = re.compile(r'\(extends "([^"]+)"')
_DESCR_RE = re.compile(r'\(descr "((?:[^"\\]|\\.)*)"')
_TAGS_RE = re.compile(r'\(tags "((?:[^"\\]|\\.)*)"')


def _unesc(s: str) -> str:
    return s.replace('\\"', '"').replace("\\\\", "\\")


def _index_symbol_lib(path: Path) -> list[list]:
    text = path.read_text(encoding="utf-8", errors="replace")
    starts = [(m.start(), m.group(1)) for m in _SYM_START_RE.finditer(text)]
    out = []
    for i, (st, name) in enumerate(starts):
        en = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        nested = text.find('\n\t\t(symbol "', st, en)
        head = text[st : (nested if nested != -1 else en)]
        props = {k: _unesc(v) for k, v in _PROP_RE.findall(head)}
        ext = _EXT_RE.search(head)
        out.append([
            name,
            props.get("Description", ""),
            props.get("ki_keywords", ""),
            props.get("Footprint", ""),
            props.get("ki_fp_filters", ""),
            ext.group(1) if ext else "",
        ])
    return out


def _index_footprint_lib(d: Path) -> list[list]:
    out = []
    for f in sorted(d.glob("*.kicad_mod")):
        try:
            with open(f, "r", encoding="utf-8", errors="replace") as fh:
                head = fh.read(2500)
        except OSError:
            continue
        dm, tm = _DESCR_RE.search(head), _TAGS_RE.search(head)
        out.append([f.stem, _unesc(dm.group(1)) if dm else "", _unesc(tm.group(1)) if tm else ""])
    return out


_INDEX: dict | None = None
_INDEX_LOCK = threading.Lock()  # MCP tools run in worker threads: parallel first calls must not build/write the index at the same time


def _sig(p: Path) -> list:
    st = p.stat()
    return [st.st_mtime_ns, st.st_size]


def _load_index() -> dict:
    """Index of every symbol / footprint in the official libs; per-library entries are cached on disk."""
    if _INDEX is not None:
        return _INDEX
    with _INDEX_LOCK:
        return _load_index_locked()


def _load_index_locked() -> dict:
    global _INDEX
    if _INDEX is not None:
        return _INDEX
    cp = _cache_path()
    cache: dict = {}
    if cp.exists():
        try:
            cache = json.loads(cp.read_text())
        except (OSError, ValueError):
            cache = {}
    if cache.get("root") != str(paths.share_dir()):
        cache = {}
    cache.setdefault("symbols", {})
    cache.setdefault("footprints", {})
    cache["root"] = str(paths.share_dir())
    dirty = False

    sym_root = paths.symbols_dir()
    seen = set()
    for f in sorted(sym_root.glob("*.kicad_sym")):
        lib = f.stem
        seen.add(lib)
        sig = _sig(f)
        ent = cache["symbols"].get(lib)
        if not ent or ent.get("sig") != sig:
            cache["symbols"][lib] = {"sig": sig, "items": _index_symbol_lib(f)}
            dirty = True
    for lib in list(cache["symbols"]):
        if lib not in seen:
            del cache["symbols"][lib]
            dirty = True

    fp_root = paths.footprints_dir()
    seen = set()
    for d in sorted(fp_root.glob("*.pretty")):
        lib = d.stem
        seen.add(lib)
        sig = _sig(d)
        ent = cache["footprints"].get(lib)
        if not ent or ent.get("sig") != sig:
            cache["footprints"][lib] = {"sig": sig, "items": _index_footprint_lib(d)}
            dirty = True
    for lib in list(cache["footprints"]):
        if lib not in seen:
            del cache["footprints"][lib]
            dirty = True

    if dirty:
        tmp = cp.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")  # unique per writer; replace() is atomic
        tmp.write_text(json.dumps(cache, separators=(",", ":")))
        os.replace(tmp, cp)
    _INDEX = cache
    return cache


def reset_index_cache() -> None:
    global _INDEX
    _INDEX = None
    get_symbol.cache_clear()
    get_footprint.cache_clear()


def list_symbol_libs() -> list[str]:
    return sorted(_load_index()["symbols"])


def list_footprint_libs() -> list[str]:
    return sorted(_load_index()["footprints"])


# --------------------------------------------------------------------------------------- search
def _tokens(q: str) -> list[str]:
    return [t for t in re.split(r"[\s,]+", q.lower().strip()) if t]


def _score(tokens: list[str], lib: str, name: str, *extra: str, require_all: bool = True) -> float | None:
    nl, ll = name.lower(), lib.lower()
    ex = [e.lower() for e in extra]
    total = 0.0
    matched = 0
    for t in tokens:
        s = 0.0
        if nl == t:
            s += 40
        elif nl.startswith(t):
            s += 20
        if t in nl:
            s += 10
        if t in ll:
            s += 4
        for i, e in enumerate(ex):
            if t in e:
                s += 3 if i == 0 else 2
                break
        if s == 0:
            if require_all:
                return None
            continue
        matched += 1
        total += s
    if matched == 0:
        return None
    return total + 100 * matched - len(name) * 0.01


def search_symbols(query: str, limit: int = 20, lib: str | None = None, match_any: bool = False) -> list[dict]:
    idx = _load_index()["symbols"]
    toks = _tokens(query)
    if not toks:
        return []
    hits = []
    for lname, ent in idx.items():
        if lib and lname != lib:
            continue
        for name, desc, kw, fp, fpf, ext in ent["items"]:
            sc = _score(toks, lname, name, kw, desc, require_all=not match_any)
            if sc is not None:
                hits.append((-sc, f"{lname}:{name}", desc, fp, fpf))
    hits.sort()
    return [
        {"lib_id": lid, "description": desc, "default_footprint": fp, "fp_filters": fpf}
        for _, lid, desc, fp, fpf in hits[:limit]
    ]


def search_footprints(query: str, limit: int = 20, lib: str | None = None, match_any: bool = False) -> list[dict]:
    idx = _load_index()["footprints"]
    toks = _tokens(query)
    if not toks:
        return []
    hits = []
    for lname, ent in idx.items():
        if lib and lname != lib:
            continue
        for name, descr, tags in ent["items"]:
            sc = _score(toks, lname, name, tags, descr, require_all=not match_any)
            if sc is not None:
                hits.append((-sc, f"{lname}:{name}", descr))
    hits.sort()
    return [{"lib_id": lid, "description": d} for _, lid, d in hits[:limit]]


def symbol_exists(lib_id: str) -> bool:
    try:
        lib, name = split_lib_id(lib_id)
    except LibraryError:
        return False
    ent = _load_index()["symbols"].get(lib)
    return bool(ent) and any(it[0] == name for it in ent["items"])


def footprint_exists(lib_id: str) -> bool:
    try:
        lib, name = split_lib_id(lib_id)
    except LibraryError:
        return False
    return (paths.footprints_dir() / f"{lib}.pretty" / f"{name}.kicad_mod").is_file()


def suggest_symbols(lib_id: str, n: int = 5) -> list[str]:
    return _suggest(lib_id, "symbols", n)


def suggest_footprints(lib_id: str, n: int = 5) -> list[str]:
    return _suggest(lib_id, "footprints", n)


def _suggest(lib_id: str, kind: str, n: int) -> list[str]:
    idx = _load_index()[kind]
    lib, _, name = (lib_id or "").partition(":")
    if not name:  # no library part given
        lib, name = "", lib
    out: list[str] = []
    libs = idx
    if lib and lib not in idx:
        close = difflib.get_close_matches(lib, list(idx), n=3, cutoff=0.6)
        libs = {k: idx[k] for k in close} if close else {}
        if not libs:
            libs = idx
    else:
        libs = {lib: idx[lib]} if lib else idx
    names = {}
    for lname, ent in libs.items():
        for it in ent["items"]:
            names.setdefault(it[0], []).append(lname)
    for m in difflib.get_close_matches(name, list(names), n=n, cutoff=0.55):
        for ln in names[m][:2]:
            out.append(f"{ln}:{m}")
    if len(out) < n and name:  # fall back to keyword search
        fn = search_symbols if kind == "symbols" else search_footprints
        for h in fn(re.sub(r"[_\-]+", " ", name), limit=n):
            if h["lib_id"] not in out:
                out.append(h["lib_id"])
    return out[:n]


# --------------------------------------------------------------------------------------- symbols
def _read_symbol_node(lib: str, name: str) -> list:
    f = paths.symbols_dir() / f"{lib}.kicad_sym"
    if not f.is_file():
        raise LibraryError(
            f"Unknown symbol library '{lib}'.", difflib.get_close_matches(lib, list_symbol_libs(), n=5, cutoff=0.5)
        )
    text = f.read_text(encoding="utf-8", errors="replace")
    pat = re.compile(r'^\t\(symbol "' + re.escape(name) + r'"\n', re.M)
    m = pat.search(text)
    if not m:
        raise LibraryError(f"Symbol '{lib}:{name}' not found.", suggest_symbols(f"{lib}:{name}"))
    nxt = _SYM_START_RE.search(text, m.end())
    end = nxt.start() if nxt else len(text)
    return parse(text[m.start() : end])  # a trailing lib-closing ')' (last symbol) is ignored by the parser


def _props(node: list) -> dict[str, str]:
    out = {}
    for p in children(node, "property"):
        if len(p) >= 3:
            out[p[1]] = p[2]
    return out


@lru_cache(maxsize=512)
def get_symbol(lib_id: str) -> SymbolInfo:
    lib, name = split_lib_id(lib_id)
    node = _read_symbol_node(lib, name)
    props = _props(node)
    ext = value(node, "extends", "")
    pins: list[Pin] = []
    if ext:
        parent = get_symbol(f"{lib}:{ext}")
        pins = list(parent.pins)
        for k, v in (
            ("Reference", parent.ref_prefix), ("Value", parent.value), ("Description", parent.description),
            ("ki_keywords", parent.keywords), ("Datasheet", parent.datasheet), ("Footprint", parent.default_footprint),
            ("ki_fp_filters", " ".join(parent.fp_filters)),
        ):
            props.setdefault(k, v)
    else:
        seen: set[str] = set()
        for sub in children(node, "symbol"):
            m = re.search(r"_(\d+)_(\d+)$", sub[1] if len(sub) > 1 else "")
            unit = int(m.group(1)) if m else 1
            style = int(m.group(2)) if m else 1
            if style == 2:  # De Morgan alternate body: same pin numbers again
                continue
            for pin in children(sub, "pin"):
                etype = pin[1] if len(pin) > 1 else "unspecified"
                nm = value(pin, "name", "")
                num = value(pin, "number", "")
                if num in seen:
                    continue
                seen.add(num)
                pins.append(Pin(number=num, name=nm, etype=etype, unit=max(unit, 1), hidden=flag(pin, "hide")))
    return SymbolInfo(
        lib_id=lib_id,
        ref_prefix=props.get("Reference", "U"),
        value=props.get("Value", name),
        description=props.get("Description", ""),
        keywords=props.get("ki_keywords", ""),
        datasheet=props.get("Datasheet", ""),
        default_footprint=props.get("Footprint", ""),
        fp_filters=tuple(f for f in props.get("ki_fp_filters", "").split() if f),
        pins=tuple(pins),
        extends=ext or "",
    )


# --------------------------------------------------------------------------------------- footprints
def _points_of(item: list) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for key in ("start", "end", "center", "mid"):
        n = find(item, key)
        v = numbers(n)
        if len(v) >= 2:
            pts.append((v[0], v[1]))
    p = find(item, "pts")
    if p:
        for xy in children(p, "xy"):
            v = numbers(xy)
            if len(v) >= 2:
                pts.append((v[0], v[1]))
    # circles: center + end define the radius
    if item and item[0] == "fp_circle":
        c, e = numbers(find(item, "center")), numbers(find(item, "end"))
        if len(c) >= 2 and len(e) >= 2:
            r = math.hypot(e[0] - c[0], e[1] - c[1])
            pts = [(c[0] - r, c[1] - r), (c[0] + r, c[1] + r)]
    return pts


def _layer_of(item: list) -> str:
    n = find(item, "layer")
    return n[1] if n and len(n) > 1 else ""


@lru_cache(maxsize=1024)
def get_footprint(lib_id: str) -> FootprintInfo:
    lib, name = split_lib_id(lib_id)
    f = paths.footprints_dir() / f"{lib}.pretty" / f"{name}.kicad_mod"
    if not f.is_file():
        if not (paths.footprints_dir() / f"{lib}.pretty").is_dir():
            raise LibraryError(
                f"Unknown footprint library '{lib}'.", difflib.get_close_matches(lib, list_footprint_libs(), n=5, cutoff=0.5)
            )
        raise LibraryError(f"Footprint '{lib_id}' not found.", suggest_footprints(lib_id))
    node = parse(f.read_text(encoding="utf-8", errors="replace"))
    pads: list[Pad] = []
    for p in children(node, "pad"):
        if len(p) < 4:
            continue
        at = numbers(find(p, "at"))
        sz = numbers(find(p, "size"))
        layers = tuple(find(p, "layers")[1:]) if find(p, "layers") else ()
        drill = None
        d_off = (0.0, 0.0)
        dn = find(p, "drill")
        if dn:
            vals = [v for v in dn[1:] if isinstance(v, str)]
            try:
                if vals and vals[0] == "oval":
                    drill = (float(vals[1]), float(vals[2]))
                elif vals:
                    drill = (float(vals[0]), float(vals[0]))
            except (ValueError, IndexError):
                drill = None
            off = numbers(find(dn, "offset"))
            if len(off) >= 2:
                d_off = (off[0], off[1])
        pads.append(Pad(
            number=p[1], ptype=p[2], shape=p[3],
            x=at[0] if at else 0.0, y=at[1] if len(at) > 1 else 0.0,
            w=sz[0] if sz else 0.0, h=sz[1] if len(sz) > 1 else (sz[0] if sz else 0.0),
            rotation=at[2] if len(at) > 2 else 0.0, layers=layers, drill=drill, drill_offset=d_off,
        ))
    pts: list[tuple[float, float]] = []
    for it in node:
        if isinstance(it, list) and it and it[0] in ("fp_rect", "fp_line", "fp_poly", "fp_circle", "fp_arc"):
            if _layer_of(it) in ("F.CrtYd", "B.CrtYd"):
                pts += _points_of(it)
    cy = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)) if pts else None
    attr = tuple(find(node, "attr")[1:]) if find(node, "attr") else ()
    return FootprintInfo(
        lib_id=lib_id, description=value(node, "descr", ""), tags=value(node, "tags", ""),
        attr=attr, pads=tuple(pads), courtyard=cy,
    )


def footprint_matches_filters(footprint_lib_id: str, filters: tuple[str, ...] | list[str]) -> bool:
    """KiCad ``ki_fp_filters`` are fnmatch patterns against the footprint name (or ``Lib:Name``)."""
    if not filters:
        return True
    _, name = split_lib_id(footprint_lib_id)
    return any(fnmatch.fnmatchcase(name, f) or fnmatch.fnmatchcase(footprint_lib_id, f) for f in filters)


_PREFERRED_LIBS = ("Resistor_SMD", "Capacitor_SMD", "LED_SMD", "Inductor_SMD", "Diode_SMD", "Package_SO", "Package_TO_SOT_SMD", "Package_DIP",
                   "Package_QFP", "Package_DFN_QFN", "Connector_PinHeader_2.54mm", "Connector_PinSocket_2.54mm")
_AWKWARD = ("HandSolder", "Handsolder", "Array", "Cat16", "_Pad", "Reverse", "Wave")


def compatible_footprints(symbol: SymbolInfo, limit: int = 15) -> tuple[list[str], int]:
    """Footprints whose name matches the symbol's ``ki_fp_filters`` (what KiCad would offer): (top ``limit`` ranked, total)."""
    if not symbol.fp_filters:
        return [], 0
    out: list[str] = []
    for lname, ent in _load_index()["footprints"].items():
        for it in ent["items"]:
            if footprint_matches_filters(f"{lname}:{it[0]}", symbol.fp_filters):
                out.append(f"{lname}:{it[0]}")

    def rank(fid: str):
        l, _, n = fid.partition(":")
        return (0 if l in _PREFERRED_LIBS else 1, sum(a in n for a in _AWKWARD), len(n), fid)

    out.sort(key=rank)
    return out[:limit], len(out)


def pin_pad_mapping(sym: SymbolInfo, fp: FootprintInfo) -> dict:
    """Symbol pin number -> pad (by identical number). Returns dict with ok flags and the discrepancies."""
    pad_nums = set(fp.pad_numbers)
    sym_nums = {p.number for p in sym.pins}
    return {
        "pins_without_pad": sorted(sym_nums - pad_nums, key=_natkey),
        "pads_without_pin": sorted(pad_nums - sym_nums, key=_natkey),
        "mapped": sorted(sym_nums & pad_nums, key=_natkey),
    }


def _natkey(s: str):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s)]


def natural_key(s: str):
    return _natkey(s)


def symbol_to_dict(s: SymbolInfo) -> dict:
    d = asdict(s)
    d["fp_filters"] = list(s.fp_filters)
    return d


def footprint_to_dict(fp: FootprintInfo) -> dict:
    d = asdict(fp)
    d["attr"] = list(fp.attr)
    return d
