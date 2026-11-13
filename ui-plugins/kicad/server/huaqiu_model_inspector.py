"""Safely compare Huaqiu's public KiCad text models with local KiCad libraries.

The model files are untrusted network input.  They are downloaded into memory
from a small allowlist, parsed as data, and never installed, written to disk, or
executed.  A model-to-library match is useful evidence, but is not a substitute
for the manufacturer's datasheet.
"""
from __future__ import annotations

import hashlib
import math
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from kicad import library as kicad_library
from kicad.library import FootprintInfo, Pad, Pin, SymbolInfo
from kicad.sexpr import children, find, flag, numbers, parse, value


MAX_MODEL_BYTES = 2 * 1024 * 1024
ALLOWED_MODEL_HOSTS = frozenset({"file.eda.cn", "file1.eda.cn"})
MODEL_EXTENSIONS = {"symbol": ".kicad_sym", "footprint": ".kicad_mod"}
_URL_FIELDS = ("url", "downloadUrl", "download_url", "fileUrl", "file_url")


class ModelInspectionError(ValueError):
    """A safe, user-facing model download or parse failure."""

    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201
        return None


@dataclass(frozen=True)
class DownloadedModel:
    kind: str
    url: str
    text: str
    byte_count: int
    sha256: str
    content_type: str | None

    def metadata(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "bytes": self.byte_count,
            "sha256": self.sha256,
            "content_type": self.content_type,
            "persisted": False,
        }


def _safe_model_url(url: Any, kind: str) -> str:
    if kind not in MODEL_EXTENSIONS:
        raise ModelInspectionError(f"Unknown model kind: {kind}", "invalid_model_kind")
    if not isinstance(url, str) or not url.strip():
        raise ModelInspectionError(f"Huaqiu detail has no {kind} model URL", f"huaqiu_{kind}_model_missing")
    url = url.strip()
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme.lower() != "https" or host not in ALLOWED_MODEL_HOSTS:
        raise ModelInspectionError(
            f"Refused {kind} model URL outside the allowed Huaqiu HTTPS file hosts",
            "huaqiu_model_url_refused",
        )
    try:
        port = parsed.port
    except ValueError as error:
        raise ModelInspectionError(f"Refused unsafe {kind} model URL", "huaqiu_model_url_refused") from error
    if parsed.username or parsed.password or port not in (None, 443) or parsed.fragment:
        raise ModelInspectionError(f"Refused unsafe {kind} model URL", "huaqiu_model_url_refused")
    if not parsed.path.lower().endswith(MODEL_EXTENSIONS[kind]):
        raise ModelInspectionError(
            f"Huaqiu {kind} URL does not end in {MODEL_EXTENSIONS[kind]}",
            "huaqiu_model_extension_refused",
        )
    return url


def model_url(models: Any, kind: str) -> str:
    """Extract only the requested model kind from normalized Huaqiu detail."""
    if not isinstance(models, dict):
        raise ModelInspectionError("Huaqiu detail has no EDA model metadata", "huaqiu_model_metadata_missing")
    entry = models.get(kind)
    if isinstance(entry, str):
        return _safe_model_url(entry, kind)
    if isinstance(entry, dict):
        for field in _URL_FIELDS:
            if entry.get(field):
                return _safe_model_url(entry[field], kind)
    raise ModelInspectionError(f"Huaqiu detail has no {kind} model URL", f"huaqiu_{kind}_model_missing")


def download_text_model(
    url: str,
    kind: str,
    *,
    timeout: float = 20,
    max_bytes: int = MAX_MODEL_BYTES,
    opener: Any = None,
) -> DownloadedModel:
    """Download one allowlisted KiCad text model into memory with a hard cap."""
    url = _safe_model_url(url, kind)
    if not isinstance(max_bytes, int) or max_bytes < 1 or max_bytes > MAX_MODEL_BYTES:
        raise ModelInspectionError("Invalid model size limit", "invalid_model_size_limit")
    request = urllib.request.Request(
        url,
        headers={"Accept": "text/plain, application/octet-stream;q=0.9", "User-Agent": "ZCode-KiCad/0.11"},
        method="GET",
    )
    client = opener or urllib.request.build_opener(_NoRedirect())
    try:
        response = client.open(request, timeout=timeout)
        with response:
            final_url = response.geturl()
            if final_url != url:
                raise ModelInspectionError("Huaqiu model redirect was refused", "huaqiu_model_redirect_refused")
            length = response.headers.get("Content-Length")
            if length:
                try:
                    declared_length = int(length)
                except ValueError as error:
                    raise ModelInspectionError("Huaqiu model has an invalid Content-Length", "huaqiu_model_invalid_response") from error
                if declared_length > max_bytes:
                    raise ModelInspectionError("Huaqiu model exceeds the 2 MiB limit", "huaqiu_model_too_large")
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = response.read(min(64 * 1024, max_bytes + 1 - total))
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ModelInspectionError("Huaqiu model exceeds the 2 MiB limit", "huaqiu_model_too_large")
                chunks.append(chunk)
            raw = b"".join(chunks)
            content_type = response.headers.get_content_type() if hasattr(response.headers, "get_content_type") else response.headers.get("Content-Type")
    except ModelInspectionError:
        raise
    except urllib.error.HTTPError as error:
        if 300 <= error.code < 400:
            raise ModelInspectionError("Huaqiu model redirect was refused", "huaqiu_model_redirect_refused") from error
        raise ModelInspectionError(f"Huaqiu model download failed with HTTP {error.code}", "huaqiu_model_download_failed") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise ModelInspectionError(f"Huaqiu model download failed: {error}", "huaqiu_model_download_failed") from error
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ModelInspectionError("Huaqiu model is not valid UTF-8 text", "huaqiu_model_not_text") from error
    return DownloadedModel(kind, url, text, len(raw), hashlib.sha256(raw).hexdigest(), content_type)


def _symbol_root(text: str) -> list:
    node = parse(text)
    if not node:
        raise ModelInspectionError("Huaqiu symbol model is empty", "huaqiu_symbol_model_invalid")
    if node[0] == "symbol":
        return node
    if node[0] != "kicad_symbol_lib":
        raise ModelInspectionError("Huaqiu symbol model is not a KiCad symbol library", "huaqiu_symbol_model_invalid")
    candidates = list(children(node, "symbol"))
    if not candidates:
        raise ModelInspectionError("Huaqiu symbol library contains no symbol", "huaqiu_symbol_model_invalid")
    # Top-level aliases can occur; prefer the first definition that owns units.
    return next((candidate for candidate in candidates if any(True for _ in children(candidate, "symbol"))), candidates[0])


def parse_symbol_model(text: str) -> SymbolInfo:
    node = _symbol_root(text)
    name = str(node[1]) if len(node) > 1 else "HuaqiuModel"
    props = {str(p[1]): str(p[2]) for p in children(node, "property") if len(p) >= 3}
    pins: list[Pin] = []
    seen: set[str] = set()
    units = list(children(node, "symbol")) or [node]
    for unit_node in units:
        match = re.search(r"_(\d+)_(\d+)$", str(unit_node[1]) if len(unit_node) > 1 else "")
        unit = int(match.group(1)) if match else 1
        style = int(match.group(2)) if match else 1
        if style == 2:
            continue
        for pin_node in children(unit_node, "pin"):
            number = str(value(pin_node, "number", ""))
            if not number or number in seen:
                continue
            seen.add(number)
            pins.append(
                Pin(
                    number=number,
                    name=str(value(pin_node, "name", "")),
                    etype=str(pin_node[1]) if len(pin_node) > 1 else "unspecified",
                    unit=max(unit, 1),
                    hidden=flag(pin_node, "hide"),
                )
            )
    if not pins:
        raise ModelInspectionError("Huaqiu symbol model contains no pins", "huaqiu_symbol_model_invalid")
    return SymbolInfo(
        lib_id=f"Huaqiu:{name}",
        ref_prefix=props.get("Reference", "U"),
        value=props.get("Value", name),
        description=props.get("Description", ""),
        keywords=props.get("ki_keywords", ""),
        datasheet=props.get("Datasheet", ""),
        default_footprint=props.get("Footprint", ""),
        fp_filters=tuple(props.get("ki_fp_filters", "").split()),
        pins=tuple(pins),
    )


def _points_of(item: list) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for key in ("start", "end", "center", "mid"):
        vals = numbers(find(item, key))
        if len(vals) >= 2:
            points.append((vals[0], vals[1]))
    point_list = find(item, "pts")
    if point_list:
        for xy in children(point_list, "xy"):
            vals = numbers(xy)
            if len(vals) >= 2:
                points.append((vals[0], vals[1]))
    if item and item[0] == "fp_circle":
        center, end = numbers(find(item, "center")), numbers(find(item, "end"))
        if len(center) >= 2 and len(end) >= 2:
            radius = math.hypot(end[0] - center[0], end[1] - center[1])
            points = [(center[0] - radius, center[1] - radius), (center[0] + radius, center[1] + radius)]
    return points


def parse_footprint_model(text: str) -> FootprintInfo:
    node = parse(text)
    if not node or node[0] not in ("footprint", "module"):
        raise ModelInspectionError("Huaqiu footprint model is not a KiCad footprint", "huaqiu_footprint_model_invalid")
    name = str(node[1]) if len(node) > 1 else "HuaqiuModel"
    pads: list[Pad] = []
    for pad_node in children(node, "pad"):
        if len(pad_node) < 4:
            continue
        at, size = numbers(find(pad_node, "at")), numbers(find(pad_node, "size"))
        layers_node = find(pad_node, "layers")
        drill = None
        drill_node = find(pad_node, "drill")
        if drill_node:
            vals = [v for v in drill_node[1:] if isinstance(v, str)]
            try:
                if vals and vals[0] == "oval":
                    drill = (float(vals[1]), float(vals[2]))
                elif vals:
                    drill = (float(vals[0]), float(vals[0]))
            except (ValueError, IndexError):
                drill = None
        pads.append(
            Pad(
                number=str(pad_node[1]),
                ptype=str(pad_node[2]),
                shape=str(pad_node[3]),
                x=at[0] if at else 0.0,
                y=at[1] if len(at) > 1 else 0.0,
                w=size[0] if size else 0.0,
                h=size[1] if len(size) > 1 else (size[0] if size else 0.0),
                rotation=at[2] if len(at) > 2 else 0.0,
                layers=tuple(layers_node[1:]) if layers_node else (),
                drill=drill,
            )
        )
    numbered = [pad for pad in pads if pad.number and not pad.is_np]
    if not numbered:
        raise ModelInspectionError("Huaqiu footprint model contains no numbered pads", "huaqiu_footprint_model_invalid")
    courtyard_points: list[tuple[float, float]] = []
    for item in node:
        if not isinstance(item, list) or not item or item[0] not in ("fp_rect", "fp_line", "fp_poly", "fp_circle", "fp_arc"):
            continue
        layer = find(item, "layer")
        if layer and len(layer) > 1 and layer[1] in ("F.CrtYd", "B.CrtYd"):
            courtyard_points.extend(_points_of(item))
    courtyard = None
    if courtyard_points:
        courtyard = (
            min(point[0] for point in courtyard_points),
            min(point[1] for point in courtyard_points),
            max(point[0] for point in courtyard_points),
            max(point[1] for point in courtyard_points),
        )
    attr_node = find(node, "attr")
    return FootprintInfo(
        lib_id=f"Huaqiu:{name}",
        description=str(value(node, "descr", "")),
        tags=str(value(node, "tags", "")),
        attr=tuple(attr_node[1:]) if attr_node else (),
        pads=tuple(pads),
        courtyard=courtyard,
    )


def _name_key(value: str) -> str:
    value = re.sub(r"~\{([^}]*)\}", r"\1", value or "")
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def compare_symbols(remote: SymbolInfo, local: SymbolInfo) -> dict[str, Any]:
    remote_pins = {pin.number: pin for pin in remote.pins}
    local_pins = {pin.number: pin for pin in local.pins}
    numbers_match = set(remote_pins) == set(local_pins)
    shared = sorted(set(remote_pins) & set(local_pins), key=kicad_library.natural_key)
    name_mismatches = [
        {"number": number, "huaqiu": remote_pins[number].display_name, "local": local_pins[number].display_name}
        for number in shared
        if _name_key(remote_pins[number].display_name) != _name_key(local_pins[number].display_name)
    ]
    type_mismatches = [
        {"number": number, "huaqiu": remote_pins[number].etype, "local": local_pins[number].etype}
        for number in shared
        if remote_pins[number].etype != local_pins[number].etype
    ]
    return {
        "pin_numbers_match": numbers_match,
        "pin_names_match": numbers_match and not name_mismatches,
        "pin_types_match": numbers_match and not type_mismatches,
        "huaqiu_pin_numbers": sorted(remote_pins, key=kicad_library.natural_key),
        "local_pin_numbers": sorted(local_pins, key=kicad_library.natural_key),
        "name_mismatches": name_mismatches,
        "type_mismatches": type_mismatches,
        "model_matches_local_symbol": numbers_match and not name_mismatches,
    }


def _numbered_pads(footprint: FootprintInfo) -> list[Pad]:
    return [pad for pad in footprint.pads if pad.number and not pad.is_np]


def _pad_number_counts(pads: list[Pad]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for pad in pads:
        counts[pad.number] = counts.get(pad.number, 0) + 1
    return counts


def _distance_fingerprint(pads: list[Pad]) -> dict[tuple[str, str], list[float]]:
    result: dict[tuple[str, str], list[float]] = {}
    for index, left in enumerate(pads):
        for right in pads[index + 1 :]:
            key = tuple(sorted((left.number, right.number), key=kicad_library.natural_key))
            result.setdefault(key, []).append(math.hypot(left.x - right.x, left.y - right.y))
    for values in result.values():
        values.sort()
    return result


def _max_fingerprint_delta(left: dict, right: dict) -> float | None:
    if set(left) != set(right) or any(len(left[key]) != len(right[key]) for key in left):
        return None
    return max((abs(a - b) for key in left for a, b in zip(left[key], right[key])), default=0.0)


def _pad_size_fingerprint(pads: list[Pad]) -> dict[str, list[tuple[float, float]]]:
    result: dict[str, list[tuple[float, float]]] = {}
    for pad in pads:
        result.setdefault(pad.number, []).append((min(pad.w, pad.h), max(pad.w, pad.h)))
    for values in result.values():
        values.sort()
    return result


def _max_size_delta(left: dict[str, list[tuple[float, float]]], right: dict[str, list[tuple[float, float]]]) -> float | None:
    if set(left) != set(right) or any(len(left[key]) != len(right[key]) for key in left):
        return None
    return max((abs(a - b) for key in left for ls, rs in zip(left[key], right[key]) for a, b in zip(ls, rs)), default=0.0)


def _pad_style_fingerprint(pads: list[Pad]) -> dict[str, list[tuple[Any, ...]]]:
    result: dict[str, list[tuple[Any, ...]]] = {}
    for pad in pads:
        drill = tuple(round(value, 4) for value in pad.drill) if pad.drill else None
        result.setdefault(pad.number, []).append((pad.ptype, pad.shape, drill))
    for values in result.values():
        values.sort(key=str)
    return result


def _courtyard_size(footprint: FootprintInfo) -> list[float] | None:
    if not footprint.courtyard:
        return None
    x0, y0, x1, y1 = footprint.courtyard
    return sorted((x1 - x0, y1 - y0))


def compare_footprints(remote: FootprintInfo, local: FootprintInfo) -> dict[str, Any]:
    remote_pads, local_pads = _numbered_pads(remote), _numbered_pads(local)
    number_counts_match = _pad_number_counts(remote_pads) == _pad_number_counts(local_pads)
    geometry_delta = _max_fingerprint_delta(_distance_fingerprint(remote_pads), _distance_fingerprint(local_pads)) if number_counts_match else None
    size_delta = _max_size_delta(_pad_size_fingerprint(remote_pads), _pad_size_fingerprint(local_pads)) if number_counts_match else None
    styles_match = number_counts_match and _pad_style_fingerprint(remote_pads) == _pad_style_fingerprint(local_pads)
    remote_courtyard, local_courtyard = _courtyard_size(remote), _courtyard_size(local)
    courtyard_delta = (
        max(abs(a - b) for a, b in zip(remote_courtyard, local_courtyard))
        if remote_courtyard is not None and local_courtyard is not None
        else None
    )
    geometry_match = geometry_delta is not None and geometry_delta <= 0.05
    sizes_match = size_delta is not None and size_delta <= 0.05
    courtyard_match = courtyard_delta is not None and courtyard_delta <= 0.15
    exact = number_counts_match and geometry_match and sizes_match and styles_match and courtyard_match
    return {
        "pad_number_counts_match": number_counts_match,
        "pad_geometry_match": geometry_match,
        "pad_geometry_max_delta_mm": None if geometry_delta is None else round(geometry_delta, 4),
        "pad_sizes_match": sizes_match,
        "pad_size_max_delta_mm": None if size_delta is None else round(size_delta, 4),
        "pad_types_shapes_drills_match": styles_match,
        "courtyard_available": {"huaqiu": remote_courtyard is not None, "local": local_courtyard is not None},
        "courtyard_dimensions_match": courtyard_match,
        "courtyard_max_delta_mm": None if courtyard_delta is None else round(courtyard_delta, 4),
        "huaqiu_courtyard_mm": remote_courtyard,
        "local_courtyard_mm": local_courtyard,
        "model_matches_local_footprint": exact,
    }


def inspect_part_models(
    part: dict[str, Any],
    symbol_id: str,
    footprint_id: str,
    *,
    library: Any = kicad_library,
    downloader=download_text_model,
) -> dict[str, Any]:
    """Download both public models and compare them with explicit local ids."""
    try:
        local_symbol = library.get_symbol(symbol_id)
        local_footprint = library.get_footprint(footprint_id)
        models = part.get("models")
        symbol_download = downloader(model_url(models, "symbol"), "symbol")
        footprint_download = downloader(model_url(models, "footprint"), "footprint")
        remote_symbol = parse_symbol_model(symbol_download.text)
        remote_footprint = parse_footprint_model(footprint_download.text)
    except ModelInspectionError as error:
        return {"ok": False, "error": str(error), "code": error.code}
    except Exception as error:  # one broken local library entry must be a structured tool error
        return {"ok": False, "error": f"Could not read the selected local KiCad model: {error}", "code": "local_kicad_model_unavailable"}

    symbol_comparison = compare_symbols(remote_symbol, local_symbol)
    footprint_comparison = compare_footprints(remote_footprint, local_footprint)
    consistent = symbol_comparison["model_matches_local_symbol"] and footprint_comparison["model_matches_local_footprint"]
    result: dict[str, Any] = {
        "ok": True,
        "error": None,
        "mpn": part.get("mpn"),
        "manufacturer": part.get("manufacturer"),
        "local_candidate": {"symbol": symbol_id, "footprint": footprint_id},
        "downloads": {
            "symbol": symbol_download.metadata(),
            "footprint": footprint_download.metadata(),
            "written_to_disk": False,
        },
        "symbol_comparison": symbol_comparison,
        "footprint_comparison": footprint_comparison,
        "model_consistency_confirmed": consistent,
        "review": {
            "huaqiu_model_matches_local_candidate": consistent,
            "electrical_compatibility_confirmed": False,
            "physical_package_confirmed": False,
            "required": [
                "Confirm the symbol pinout against the manufacturer's datasheet.",
                "Confirm package dimensions, pitch, and thermal-pad requirements against the manufacturer's datasheet.",
            ],
        },
    }
    if consistent:
        result["spec_part_fields"] = {"symbol": symbol_id, "footprint": footprint_id, "value": str(part.get("mpn") or "")}
    else:
        result["note"] = "The Huaqiu text models do not fully match this local candidate; do not use it without manual review."
    return result
