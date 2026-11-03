"""Resolve a Huaqiu part to candidates in the installed KiCad libraries.

This adapter deliberately stops at a reviewed candidate. A matching name and
pin/pad count cannot prove that a footprint has the manufacturer's exact body,
pitch, or exposed-pad geometry.
"""
from __future__ import annotations

import re
from typing import Any

from kicad import library as kicad_library


def _key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _package_values(part: dict[str, Any]) -> list[str]:
    values: list[str] = []
    if part.get("package"):
        values.append(str(part["package"]).strip())
    for attribute in part.get("attributes") or []:
        if not isinstance(attribute, dict):
            continue
        name = _key(attribute.get("shortName") or attribute.get("name"))
        if "package" in name or "封装" in str(attribute.get("name") or ""):
            value = str(attribute.get("value") or "").strip()
            if value:
                values.append(value)
    return list(dict.fromkeys(values))


def package_queries(part: dict[str, Any]) -> list[str]:
    """Return conservative KiCad search terms for Huaqiu package labels."""
    queries: list[str] = []
    for raw in _package_values(part):
        queries.append(raw)
        compact = re.sub(r"[ _]+", "-", raw.upper()).strip("-")
        match = re.search(r"(?:SOP|SO)(?:IC)?-?(\d+)", compact)
        if match:
            pins = match.group(1)
            queries.extend([f"SOIC-{pins}", f"SOP-{pins}"])
        for family in ("SSOP", "TSSOP", "MSOP", "QSOP", "DIP", "QFN", "DFN", "LQFP", "TQFP", "BGA"):
            match = re.search(rf"{family}-?(\d+)", compact)
            if match:
                queries.append(f"{family}-{match.group(1)}")
        match = re.search(r"SOT-?23-?(\d+)?", compact)
        if match:
            queries.append("SOT-23" + (f"-{match.group(1)}" if match.group(1) else ""))
        for imperial in ("0201", "0402", "0603", "0805", "1206", "1210"):
            if imperial in compact:
                queries.append(imperial)
    return list(dict.fromkeys(query for query in queries if query))


def _symbol_queries(part: dict[str, Any]) -> list[str]:
    mpn = str(part.get("mpn") or "").strip()
    queries = [mpn] if mpn else []
    # Common manufacturer suffixes follow '-' or space. Keep the full MPN first
    # and add only a useful family-sized prefix, never a one-character token.
    family = re.split(r"[- /]", mpn, maxsplit=1)[0]
    if len(family) >= 4 and family != mpn:
        queries.append(family)
    return list(dict.fromkeys(queries))


def _collect_search(search, queries: list[str], limit: int) -> list[dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for query in queries:
        for hit in search(query, limit=limit, match_any=False):
            found.setdefault(hit["lib_id"], dict(hit))
    return list(found.values())


def _pin_dict(pin: Any) -> dict[str, Any]:
    return {
        "number": pin.number,
        "name": pin.display_name or "~",
        "type": pin.etype,
        **({"hidden": True} if pin.hidden else {}),
    }


def resolve_part(
    part: dict[str, Any],
    *,
    limit: int = 5,
    library: Any = kicad_library,
) -> dict[str, Any]:
    """Return ranked, locally verified symbol/footprint pairs for one part."""
    limit = max(1, min(int(limit), 10))
    mpn = str(part.get("mpn") or "").strip()
    if not mpn:
        return {"ok": False, "error": "Huaqiu part detail has no MPN", "code": "huaqiu_part_missing_mpn"}
    symbol_queries = _symbol_queries(part)
    footprint_queries = package_queries(part)
    symbol_hits = _collect_search(library.search_symbols, symbol_queries, 20)

    symbols: list[tuple[float, Any, dict[str, Any]]] = []
    for hit in symbol_hits:
        try:
            symbol = library.get_symbol(hit["lib_id"])
        except Exception:  # diagnostics should survive one broken library item
            continue
        name = hit["lib_id"].partition(":")[2]
        name_key, mpn_key = _key(name), _key(mpn)
        score = 0.0
        reasons = []
        if name_key == mpn_key:
            score += 120
            reasons.append("symbol name exactly matches the MPN")
        elif name_key.startswith(mpn_key) or mpn_key.startswith(name_key):
            score += 85
            reasons.append("symbol name matches the MPN family")
        elif mpn_key in name_key:
            score += 55
            reasons.append("symbol name contains the MPN")
        if symbol.default_footprint:
            score += 10
            reasons.append("symbol declares a default footprint")
        summary = {
            "id": symbol.lib_id,
            "description": symbol.description,
            "ref_prefix": symbol.ref_prefix,
            "default_footprint": symbol.default_footprint or None,
            "footprint_filters": list(symbol.fp_filters),
            "pins": [_pin_dict(pin) for pin in sorted(symbol.pins, key=lambda item: library.natural_key(item.number))],
            "match_reasons": reasons,
        }
        symbols.append((score, symbol, summary))
    symbols.sort(key=lambda item: (-item[0], item[1].lib_id))
    symbols = symbols[:10]

    footprint_hits = _collect_search(library.search_footprints, footprint_queries, 30)
    footprint_ids = {hit["lib_id"] for hit in footprint_hits}
    default_ids: set[str] = set()
    for _, symbol, _ in symbols:
        if symbol.default_footprint and library.footprint_exists(symbol.default_footprint):
            default_ids.add(symbol.default_footprint)
            footprint_ids.add(symbol.default_footprint)
        compatible, _ = library.compatible_footprints(symbol, limit=30)
        footprint_ids.update(compatible)

    package_keys = [_key(query) for query in footprint_queries]
    pairs: list[dict[str, Any]] = []
    footprint_summaries: dict[str, dict[str, Any]] = {}
    for footprint_id in sorted(footprint_ids):
        try:
            footprint = library.get_footprint(footprint_id)
        except Exception:
            continue
        bb = footprint.bbox()
        footprint_summaries[footprint_id] = {
            "id": footprint.lib_id,
            "description": footprint.description,
            "tags": footprint.tags,
            "pad_numbers": footprint.pad_numbers,
            "courtyard_mm": {
                "width": round(bb[2] - bb[0], 3),
                "height": round(bb[3] - bb[1], 3),
            },
        }
        footprint_key = _key(footprint_id)
        package_matches = [query for query, key in zip(footprint_queries, package_keys) if key and key in footprint_key]
        for symbol_score, symbol, _ in symbols:
            mapping = library.pin_pad_mapping(symbol, footprint)
            filters_match = library.footprint_matches_filters(footprint_id, symbol.fp_filters)
            score = symbol_score
            reasons = []
            if footprint_id == symbol.default_footprint:
                score += 80
                reasons.append("symbol's default footprint")
            if filters_match:
                score += 45
                reasons.append("matches the symbol's KiCad footprint filters")
            if package_matches:
                score += 55
                reasons.append(f"matches Huaqiu package query: {package_matches[0]}")
            if not mapping["pins_without_pad"]:
                score += 60
                reasons.append("every symbol pin has a same-numbered footprint pad")
            else:
                score -= 200
            if mapping["pads_without_pin"]:
                score -= min(30, 5 * len(mapping["pads_without_pin"]))
                reasons.append("footprint has additional pads that require review")
            pairs.append(
                {
                    "symbol": symbol.lib_id,
                    "footprint": footprint_id,
                    "score": round(score, 2),
                    "match_reasons": reasons,
                    "pin_pad_mapping": {
                        "consistent": not mapping["pins_without_pad"],
                        "pins_without_pad": mapping["pins_without_pad"],
                        "pads_without_pin": mapping["pads_without_pin"],
                        "filters_match": filters_match,
                    },
                    "package_matches": package_matches,
                }
            )
    pairs.sort(key=lambda item: (-item["score"], item["symbol"], item["footprint"]))
    safe_pairs = [
        pair
        for pair in pairs
        if pair["pin_pad_mapping"]["consistent"]
        and not pair["pin_pad_mapping"]["pads_without_pin"]
        and pair["pin_pad_mapping"]["filters_match"]
        and (not footprint_queries or bool(pair["package_matches"]))
    ][:limit]
    recommended = safe_pairs[0] if safe_pairs else None
    footprint_output = []
    seen_footprints = set()
    for pair in safe_pairs:
        footprint_id = pair["footprint"]
        if footprint_id not in seen_footprints:
            footprint_output.append(footprint_summaries[footprint_id])
            seen_footprints.add(footprint_id)

    model_files = part.get("models") if isinstance(part.get("models"), dict) else {}
    result: dict[str, Any] = {
        "ok": True,
        "error": None,
        "mpn": mpn,
        "manufacturer": part.get("manufacturer"),
        "huaqiu_package_values": _package_values(part),
        "search_queries": {"symbols": symbol_queries, "footprints": footprint_queries},
        "symbols": [summary for _, _, summary in symbols[:limit]],
        "footprints": footprint_output,
        "verified_pairs": safe_pairs,
        "recommended_pair": recommended,
        "review": {
            "local_pin_pad_mapping_verified": bool(recommended),
            "electrical_compatibility_confirmed": False,
            "physical_package_confirmed": False,
            "required": [
                "Confirm the exact manufacturer package dimensions and pitch against the datasheet or Huaqiu model.",
                "Confirm the selected symbol pinout against the manufacturer datasheet.",
            ],
        },
        "huaqiu_model_metadata": model_files,
        "huaqiu_model_files_downloaded": False,
    }
    if recommended:
        result["spec_part_fields"] = {
            "symbol": recommended["symbol"],
            "footprint": recommended["footprint"],
            "value": mpn,
        }
    else:
        result["note"] = "No locally consistent KiCad symbol/footprint pair was found; do not invent library ids."
    return result
